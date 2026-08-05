"""GenBlaze/GMICloud runtime with no persisted job state."""

from __future__ import annotations

import asyncio
import base64
import binascii
import copy
import hashlib
import json
import math
import mimetypes
import os
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Sequence
from urllib.parse import quote, unquote, urljoin, urlsplit
from urllib.request import Request, urlopen

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .catalog import (
    CatalogConfigurationError,
    ModelCatalog,
    ModelRoute,
    UnsupportedModelError,
    load_model_catalog,
)
from .config import Settings
from .errors import GatewayError
from .media_staging import GMICloudMediaStager


_IMAGE_MEDIA_PARAMS = frozenset(
    {
        "negative_prompt",
        "aspect_ratio",
        "resolution",
        "size",
        "quality",
        "output_format",
        "number_of_images",
        "num_images",
        "image_size",
        "seed",
        "guidance_scale",
        "num_inference_steps",
    }
)
_VIDEO_MEDIA_PARAMS = frozenset(
    {
        "negative_prompt",
        "duration",
        "aspect_ratio",
        "resolution",
        "seed",
        "sound",
        "generate_audio",
        "mode",
        "person_generation",
        "prompt_optimizer",
    }
)
_ELEVENLABS_AUDIO_PARAMS = frozenset({"voice", "voice_id", "output_format"})
_OPENAI_AUDIO_PARAMS = frozenset({"voice", "output_format", "instructions"})
_AUDIO_MEDIA_PARAMS = _ELEVENLABS_AUDIO_PARAMS | _OPENAI_AUDIO_PARAMS
_SEEDREAM_SIZE_BY_ASPECT_RATIO = {
    "1:1": "1024x1024",
    "16:9": "1792x1024",
    "9:16": "1024x1792",
    "4:3": "1152x864",
    "3:4": "864x1152",
}
_FAL_ASPECT_RATIO_ALIASES = {
    "square": "1:1",
    "square_hd": "1:1",
    "landscape_16_9": "16:9",
    "portrait_16_9": "9:16",
    "landscape_4_3": "4:3",
    "portrait_4_3": "3:4",
}
_FAL_AUTO_SIZE_ALIASES = {
    "auto_1k": "1K",
    "auto_2k": "2K",
}
_SAMSAR_IMAGE_ASPECT_RATIOS = ("1:1", "16:9", "9:16", "4:3", "3:4")
_GMI_NANO_FLASH_ASPECT_RATIOS = (
    "1:1",
    "3:2",
    "2:3",
    "3:4",
    "4:3",
    "4:5",
    "5:4",
    "9:16",
    "16:9",
    "21:9",
)
_GMI_NANO_PRO_ASPECT_RATIOS = (
    "1:1",
    "3:4",
    "4:3",
    "4:5",
    "5:4",
    "9:16",
    "16:9",
    "21:9",
)
_GMI_SEEDANCE_ASPECT_RATIOS = ("16:9", "9:16", "4:3", "3:4", "21:9", "1:1")
_SEEDREAM_MIN_PIXELS = 1280 * 720
_SEEDREAM_MAX_PIXELS = int(2048 * 2048 * 1.1025)
_LOCAL_TUNNEL_HOST_SUFFIXES = (
    ".trycloudflare.com",
    ".loca.lt",
    ".share.zrok.io",
)
_LOCAL_MEDIA_PATH_PREFIXES = ("/assets/", "/assets_v2/")


def _normalize_chat_reasoning_params(params: dict[str, Any]) -> dict[str, Any]:
    """Emit only the Chat Completions reasoning shape accepted by GMICloud."""
    normalized = dict(params)
    reasoning = normalized.pop("reasoning", None)
    if "reasoning_effort" not in normalized and isinstance(reasoning, dict):
        effort = reasoning.get("effort")
        if isinstance(effort, str) and effort.strip():
            normalized["reasoning_effort"] = effort.strip().lower()
    if normalized.get("reasoning_effort") is None:
        normalized.pop("reasoning_effort", None)
    return normalized


def _is_unknown_reasoning_parameter(exc: Exception) -> bool:
    message = str(exc).lower()
    unknown_parameter = "unknown parameter" in message or "unknown_parameter" in message
    return unknown_parameter and (
        "reasoning_effort" in message or "'reasoning'" in message or '"reasoning"' in message
    )


def _is_gmicloud_media_download_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return (
        "invalid_image_url" in message
        or "invalid_video_url" in message
        or "invalid_media_url" in message
        or "timeout while downloading" in message
        or "timed out while downloading" in message
        or "unable to download content from the provided url before the timeout" in message
        or "error while downloading file" in message
        or "error while downloading image" in message
        or "error while downloading video" in message
        or "error while downloading media" in message
        or "upstream status code: 530" in message
    )


def _managed_tunnel_media_path(provider_url: str) -> str | None:
    try:
        provider = urlsplit(provider_url)
    except ValueError:
        return None
    hostname = (provider.hostname or "").lower()
    if provider.scheme != "https" or not hostname.endswith(_LOCAL_TUNNEL_HOST_SUFFIXES):
        return None
    try:
        decoded_segments = [unquote(segment) for segment in provider.path.split("/") if segment]
    except (TypeError, ValueError):
        return None
    if not decoded_segments or decoded_segments[0] not in {"assets", "assets_v2"}:
        return None
    if any(
        not segment
        or segment in {".", ".."}
        or "/" in segment
        or "\\" in segment
        for segment in decoded_segments
    ):
        return None
    safe_path = "/" + "/".join(quote(segment, safe="") for segment in decoded_segments)
    if not safe_path.startswith(_LOCAL_MEDIA_PATH_PREFIXES):
        return None
    return safe_path


def _collect_managed_tunnel_media_urls(payload: Any) -> list[str]:
    urls: list[str] = []

    def visit(value: Any) -> None:
        if isinstance(value, str):
            if _managed_tunnel_media_path(value):
                urls.append(value)
            return
        if isinstance(value, list):
            for item in value:
                visit(item)
            return
        if not isinstance(value, dict):
            return
        for child in value.values():
            visit(child)

    visit(payload)
    return list(dict.fromkeys(urls))


def _normalize_tunnel_base_url(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        return ""
    try:
        parsed = urlsplit(value.strip())
    except ValueError:
        return ""
    hostname = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not hostname.endswith(_LOCAL_TUNNEL_HOST_SUFFIXES):
        return ""
    return f"https://{parsed.netloc}"


def _request_replacement_tunnel_base_url(
    refresh_url: str,
    *,
    attempted_urls: Sequence[str],
    retry_number: int,
    timeout_seconds: float,
) -> str:
    try:
        parsed_refresh_url = urlsplit(refresh_url)
    except ValueError:
        return ""
    if parsed_refresh_url.scheme != "http" or parsed_refresh_url.hostname != "media-tunnel-controller":
        return ""
    body = json.dumps({
        "schema": "samsar.media-tunnel-refresh.v1",
        "service": "samsar_genblaze_gmicloud_media",
        "reason": "gmicloud_media_download_failed",
        "retryNumber": retry_number,
        "attemptedUrls": list(attempted_urls),
    }, separators=(",", ":")).encode("utf-8")
    request = Request(
        refresh_url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urlopen(request, timeout=timeout_seconds + 5) as response:  # noqa: S310 - fixed internal service
            if response.status != 200:
                return ""
            response_payload = json.loads(response.read(16 * 1024))
    except (OSError, TypeError, ValueError):
        return ""
    return _normalize_tunnel_base_url(response_payload.get("publicUrl"))


def _rewrite_managed_tunnel_media_urls(payload: Any, new_base_url: str) -> Any | None:
    def visit(value: Any) -> tuple[Any, int]:
        if isinstance(value, str):
            media_path = _managed_tunnel_media_path(value)
            if not media_path:
                return value, 0
            return (
                urljoin(new_base_url.rstrip("/") + "/", media_path.lstrip("/")),
                1,
            )
        if isinstance(value, list):
            rewritten_items = []
            replaced = 0
            for item in value:
                rewritten, child_replaced = visit(item)
                rewritten_items.append(rewritten)
                replaced += child_replaced
            return rewritten_items, replaced
        if not isinstance(value, dict):
            return value, 0
        rewritten_object = {}
        replaced = 0
        for key, child in value.items():
            rewritten, child_replaced = visit(child)
            rewritten_object[key] = rewritten
            replaced += child_replaced
        return rewritten_object, replaced

    rewritten_payload, replaced = visit(copy.deepcopy(payload))
    return rewritten_payload if replaced else None


def _rewrite_managed_tunnel_media_urls_with_staged_urls(
    payload: Any,
    staged_urls_by_path: dict[str, str],
) -> Any | None:
    def visit(value: Any) -> tuple[Any, int]:
        if isinstance(value, str):
            media_path = _managed_tunnel_media_path(value)
            staged_url = staged_urls_by_path.get(media_path or "")
            return (staged_url, 1) if staged_url else (value, 0)
        if isinstance(value, list):
            rewritten_items = []
            replaced = 0
            for item in value:
                rewritten, child_replaced = visit(item)
                rewritten_items.append(rewritten)
                replaced += child_replaced
            return rewritten_items, replaced
        if not isinstance(value, dict):
            return value, 0
        rewritten_object = {}
        replaced = 0
        for key, child in value.items():
            rewritten, child_replaced = visit(child)
            rewritten_object[key] = rewritten
            replaced += child_replaced
        return rewritten_object, replaced

    rewritten_payload, replaced = visit(copy.deepcopy(payload))
    return rewritten_payload if replaced else None


async def _stage_managed_tunnel_media_urls(
    payload: Any,
    *,
    stager: GMICloudMediaStager,
) -> Any | None:
    managed_urls = _collect_managed_tunnel_media_urls(payload)
    if not managed_urls:
        return None
    staged_urls_by_path: dict[str, str] = {}
    for provider_url in managed_urls:
        media_path = _managed_tunnel_media_path(provider_url)
        if not media_path or media_path in staged_urls_by_path:
            continue
        staged_urls_by_path[media_path] = await stager.stage(media_path)
    if not staged_urls_by_path:
        return None
    return _rewrite_managed_tunnel_media_urls_with_staged_urls(
        payload,
        staged_urls_by_path,
    )


async def _refresh_managed_tunnel_media_urls(
    payload: Any,
    *,
    settings: Settings,
    attempted_urls: Sequence[str],
    retry_number: int,
) -> Any | None:
    managed_urls = _collect_managed_tunnel_media_urls(payload)
    if not managed_urls:
        return None
    excluded_origins = {
        _normalize_tunnel_base_url(url)
        for url in [*attempted_urls, *managed_urls]
    }
    excluded_origins.discard("")
    new_base_url = await asyncio.to_thread(
        _request_replacement_tunnel_base_url,
        settings.tunnel_refresh_url,
        attempted_urls=[*attempted_urls, *managed_urls],
        retry_number=retry_number,
        timeout_seconds=settings.tunnel_refresh_wait_seconds,
    )
    if not new_base_url or new_base_url in excluded_origins:
        return None
    return _rewrite_managed_tunnel_media_urls(payload, new_base_url)


def _drop_params(*names: str) -> Callable[[dict[str, Any]], dict[str, Any]]:
    def transform(params: dict[str, Any]) -> dict[str, Any]:
        transformed = dict(params)
        for name in names:
            transformed.pop(name, None)
        return transformed

    return transform


def _aspect_ratio_coercer(*allowed: str) -> Callable[[Any], str]:
    allowed_values = frozenset(allowed)

    def coerce(value: Any) -> str:
        normalized = str(value).strip().lower().replace(" ", "").replace("x", ":")
        normalized = _FAL_ASPECT_RATIO_ALIASES.get(normalized, normalized)
        if normalized not in allowed_values:
            raise ValueError(f"expected one of {sorted(allowed_values)}")
        return normalized

    return coerce


def _seedream_size(value: Any) -> str:
    if isinstance(value, dict):
        if set(value) != {"width", "height"}:
            raise ValueError("custom Seedream size requires width and height")
        width = value["width"]
        height = value["height"]
        if isinstance(width, bool) or isinstance(height, bool):
            raise ValueError("custom Seedream width and height must be integers")
        try:
            width = int(width)
            height = int(height)
        except (TypeError, ValueError) as exc:
            raise ValueError("custom Seedream width and height must be integers") from exc
        if width <= 0 or height <= 0:
            raise ValueError("custom Seedream width and height must be positive")
        normalized = f"{width}x{height}"
    else:
        raw = str(value).strip()
        alias = raw.lower().replace(" ", "")
        if alias in _FAL_AUTO_SIZE_ALIASES:
            return _FAL_AUTO_SIZE_ALIASES[alias]
        if alias in _FAL_ASPECT_RATIO_ALIASES:
            ratio = _FAL_ASPECT_RATIO_ALIASES[alias]
            return _SEEDREAM_SIZE_BY_ASPECT_RATIO[ratio]
        if raw.upper() in {"1K", "2K"}:
            return raw.upper()
        normalized = raw.lower().replace(" ", "")

    try:
        width_text, height_text = normalized.split("x", 1)
        width = int(width_text)
        height = int(height_text)
    except (AttributeError, TypeError, ValueError) as exc:
        raise ValueError(
            "Seedream size must be 1K, 2K, a supported Fal size, or widthxheight"
        ) from exc
    pixels = width * height
    ratio = width / height
    if not _SEEDREAM_MIN_PIXELS <= pixels <= _SEEDREAM_MAX_PIXELS:
        raise ValueError(
            "Seedream 5 Pro custom size must contain between 921600 and "
            f"{_SEEDREAM_MAX_PIXELS} pixels"
        )
    if not 1 / 16 <= ratio <= 16:
        raise ValueError("Seedream 5 Pro custom size aspect ratio must be between 1:16 and 16:1")
    return f"{width}x{height}"


def _seedream_params(params: dict[str, Any]) -> dict[str, Any]:
    transformed = dict(params)
    # Samsar always supplies an aspect ratio; the exact size mapping below is
    # authoritative for this GMI route, so its generic resolution hint must
    # not reach the strict upstream payload.
    transformed.pop("resolution", None)
    # Samsar's Seedream contract generates one image per request. GMICloud's
    # max_images parameter is only meaningful when sequential generation is
    # enabled, so forwarding the shared image-count hint can make an otherwise
    # valid single-image request fail upstream.
    transformed.pop("number_of_images", None)
    transformed.pop("num_images", None)
    transformed.pop("max_images", None)
    aspect_ratio = transformed.pop("aspect_ratio", None)
    explicit_size = transformed.get("size")
    if explicit_size is not None:
        transformed["size"] = _seedream_size(explicit_size)
    elif aspect_ratio is not None:
        normalized_ratio = _aspect_ratio_coercer(*_SAMSAR_IMAGE_ASPECT_RATIOS)(
            aspect_ratio
        )
        transformed["size"] = _SEEDREAM_SIZE_BY_ASPECT_RATIO[normalized_ratio]
    return transformed


def _image_size_coercer(*allowed: str) -> Callable[[Any], str]:
    allowed_values = frozenset(allowed)

    def coerce(value: Any) -> str:
        normalized = str(value).strip().upper()
        # Samsar/Fal call Gemini Flash Image's 512px tier `0.5K`, while
        # GMICloud's queue contract names the same tier `512`.
        if normalized == "0.5K":
            normalized = "512"
        # Accept the Fal-style automatic tier names at the gateway boundary,
        # but emit only the exact GMICloud enum values on the upstream wire.
        elif normalized == "AUTO_1K":
            normalized = "1K"
        elif normalized == "AUTO_2K":
            normalized = "2K"
        if normalized not in allowed_values:
            raise ValueError(f"expected one of {sorted(allowed_values)}")
        return normalized

    return coerce


def _image_output_format(value: Any) -> str:
    normalized = str(value).strip().lower()
    if normalized not in {"png", "jpeg"}:
        raise ValueError("image output format must be png or jpeg")
    return normalized


def _whole_seconds_string(value: Any) -> str:
    if isinstance(value, bool):
        raise ValueError("duration must be a whole number of seconds")
    try:
        numeric = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("duration must be a whole number of seconds") from exc
    if not numeric.is_integer() or numeric <= 0:
        raise ValueError("duration must be a positive whole number of seconds")
    return str(int(numeric))


def _legacy_kling_duration(value: Any) -> str:
    duration = _whole_seconds_string(value)
    if duration not in {"5", "10"}:
        raise ValueError("legacy Kling duration must be 5 or 10 seconds")
    return duration


def _boolean(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    normalized = str(value).strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError("expected a boolean value")


def _uint32(value: Any) -> int:
    if isinstance(value, bool):
        raise ValueError("seed must be an integer between 0 and 4294967295")
    try:
        numeric = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("seed must be an integer between 0 and 4294967295") from exc
    if str(value).strip() != str(numeric) and not isinstance(value, int):
        try:
            if float(value) != numeric:
                raise ValueError
        except (TypeError, ValueError) as exc:
            raise ValueError(
                "seed must be an integer between 0 and 4294967295"
            ) from exc
    if not 0 <= numeric <= 4_294_967_295:
        raise ValueError("seed must be an integer between 0 and 4294967295")
    return numeric


def _veo_duration(value: Any) -> int:
    if isinstance(value, bool):
        return 8
    try:
        # This deliberately mirrors the native adapter's parseInt-style
        # duration buckets rather than exposing GMICloud's enum directly.
        duration = int(float(value))
    except (TypeError, ValueError, OverflowError):
        return 8
    if duration <= 4:
        return 4
    if duration <= 6:
        return 6
    return 8


def _veo_aspect_ratio(value: Any) -> str:
    normalized = (
        str(value)
        .strip()
        .lower()
        .replace(" ", "")
        .replace("x", ":")
        .replace("/", ":")
    )
    if normalized in {"9:16", "portrait", "vertical"}:
        return "9:16"
    if normalized in {"16:9", "landscape", "horizontal"}:
        return "16:9"
    return "16:9"


def _veo_resolution_or_none(value: Any) -> str | None:
    normalized = str(value).strip().lower()
    aliases = {
        "720": "720p",
        "720p": "720p",
        "1080": "1080p",
        "1080p": "1080p",
        "4k": "4k",
    }
    return aliases.get(normalized)


def _veo_params(params: dict[str, Any]) -> dict[str, Any]:
    transformed = dict(params)
    if "resolution" in transformed:
        resolution = _veo_resolution_or_none(transformed["resolution"])
        if resolution is None:
            transformed.pop("resolution", None)
        else:
            transformed["resolution"] = resolution
    return transformed


def _veo_person_generation(value: Any) -> str:
    normalized = str(value).strip().lower().replace("-", "_").replace(" ", "_")
    if normalized not in {"allow_all", "allow_adult", "disallow"}:
        raise ValueError("person generation must be allow_all, allow_adult, or disallow")
    return normalized


def _string(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("expected a string")
    return value


def _rounded_duration(value: Any, *, minimum: int, maximum: int, name: str) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{name} duration must be a number")
    try:
        numeric = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} duration must be a number") from exc
    if not math.isfinite(numeric):
        raise ValueError(f"{name} duration must be finite")
    rounded = math.floor(numeric + 0.5)
    return min(max(rounded, minimum), maximum)


def _seedance_1_5_duration(value: Any) -> int:
    return _rounded_duration(value, minimum=4, maximum=12, name="Seedance 1.5")


def _seedance_2_duration(value: Any) -> int:
    return _rounded_duration(value, minimum=4, maximum=15, name="Seedance 2.0")


def _seedance_2_aspect_ratio(value: Any) -> str:
    normalized = str(value).strip().lower().replace(" ", "").replace("x", ":")
    normalized = _FAL_ASPECT_RATIO_ALIASES.get(normalized, normalized)
    if normalized == "auto":
        normalized = "adaptive"
    allowed = frozenset((*_GMI_SEEDANCE_ASPECT_RATIOS, "adaptive"))
    if normalized not in allowed:
        raise ValueError(f"expected one of {sorted(allowed)}")
    return normalized


def _seedance_2_resolution(value: Any) -> str:
    normalized = str(value).strip().lower().replace(" ", "")
    if normalized in {"720", "720p"}:
        return "720p"
    raise ValueError("Seedance 2.0 resolution must be 720p")


def _kling_v3_turbo_duration(value: Any) -> str:
    duration = _whole_seconds_string(value)
    if not 3 <= int(duration) <= 15:
        raise ValueError("Kling 3.0 Turbo duration must be between 3 and 15 seconds")
    return duration


def _kling_v3_turbo_params(params: dict[str, Any]) -> dict[str, Any]:
    transformed = _drop_params(
        "aspect_ratio",
        "negative_prompt",
        "seed",
        "sound",
        "generate_audio",
        "mode",
    )(params)
    # Samsar's Turbo route is the fixed Standard/720p equivalent.
    transformed["resolution"] = "720p"
    return transformed


def _bool_to_on_off(value: Any) -> str:
    if isinstance(value, bool):
        return "on" if value else "off"
    normalized = str(value).strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return "on"
    if normalized in {"0", "false", "no", "off"}:
        return "off"
    raise ValueError("sound must be a boolean or on/off value")


def _happyhorse_duration(value: Any) -> int:
    if isinstance(value, bool):
        return 5
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return 5
    if not math.isfinite(numeric):
        return 5
    for duration in (5, 10, 15):
        if duration >= numeric:
            return duration
    return 15


def _happyhorse_seed(value: Any) -> int:
    seed = _uint32(value)
    if seed > 2_147_483_647:
        raise ValueError("HappyHorse seed must be between 0 and 2147483647")
    return seed


def _happyhorse_params(params: dict[str, Any]) -> dict[str, Any]:
    # Audio is not a Samsar HappyHorse setting. Drop the shared adapter's
    # synthetic false value so GMICloud, like the native model, applies its
    # own model default instead of making this route uniquely silent.
    transformed = _drop_params(
        "aspect_ratio",
        "audio",
        "generate_audio",
        "negative_prompt",
        "sound",
        "mode",
    )(params)
    transformed["resolution"] = "720P"
    return transformed


def _elevenlabs_output_format(value: Any) -> str:
    normalized = str(value).strip()
    if normalized != "mp3_44100_128":
        raise ValueError(
            "ElevenLabs via GMICloud supports output_format mp3_44100_128"
        )
    return normalized


def _legacy_kling_params(params: dict[str, Any]) -> dict[str, Any]:
    return _drop_params(
        "aspect_ratio",
        "resolution",
        "seed",
        "sound",
        "generate_audio",
        "mode",
    )(params)


def _hailuo_pro_params(params: dict[str, Any]) -> dict[str, Any]:
    transformed = _drop_params(
        "aspect_ratio",
        "seed",
        "sound",
        "generate_audio",
        "mode",
    )(params)
    # The live GMICloud Hailuo route supports 1080P only at six seconds.
    # Samsar's HAILUOPRO contract is pinned to that exact quality tier.
    transformed["duration"] = 6
    transformed["resolution"] = "1080P"
    return transformed


def _media_contract_key(samsar_model: str) -> str:
    if samsar_model == "GPTIMAGE2":
        return "gpt-image"
    if samsar_model == "GPTIMAGE2EDIT":
        return "gpt-image-edit"
    if samsar_model == "SEEDREAM":
        return "seedream"
    if samsar_model in {"NANOBANANA2", "NANOBANANA2EDIT"}:
        return "nano-flash"
    if samsar_model in {"NANOBANANAPRO", "NANOBANANAPROEDIT"}:
        return "nano-pro"
    if samsar_model == "BRIA_ERASER":
        return "bria-eraser"
    if samsar_model == "BRIA_GENFILL":
        return "bria-genfill"
    if samsar_model.startswith("VEO3.1"):
        return "veo"
    if samsar_model == "SEEDANCEI2V":
        return "seedance-1-5"
    if samsar_model == "SEEDANCE2.0I2V":
        return "seedance-2"
    if samsar_model == "KLINGIMGTOVID3PRO":
        return "kling-v3"
    if samsar_model == "KLINGIMGTOVIDTURBO":
        return "kling-v3-turbo"
    if samsar_model in {
        "KLINGIMGTOVIDPRO",
        "KLINGIMGTOVID2.1MASTER",
        "KLINGIMGTOVID2.1PRO",
        "KLINGIMGTOVID2.1STANDARD",
    }:
        return "kling-legacy"
    if samsar_model == "HAILUOPRO":
        return "hailuo-pro"
    if samsar_model == "HAPPYHORSEI2V":
        return "happyhorse"
    if samsar_model == "ELEVENLABS":
        return "elevenlabs-tts"
    if samsar_model == "OPENAI_TTS":
        return "openai-tts"
    raise ValueError(f"No exact GenBlaze media contract for {samsar_model!r}")


@dataclass(frozen=True, slots=True)
class GenBlazeBindings:
    """Imported GenBlaze symbols, injectable for network-free contract tests."""

    achat: Callable[..., Awaitable[Any]]
    image_provider_type: type
    video_provider_type: type
    audio_provider_type: type
    provider_error_type: type[Exception]
    step_type: type
    asset_type: type
    modality_type: type
    media_registry_factory: Callable[[str, Sequence[ModelRoute]], Any] | None = None


def load_genblaze_bindings() -> GenBlazeBindings:
    from genblaze_core.exceptions import ProviderError
    from genblaze_core.models.asset import Asset
    from genblaze_core.models.enums import Modality
    from genblaze_core.models.step import Step
    from genblaze_core.providers import ModelRegistry, ModelSpec, route_images
    from genblaze_gmicloud import (
        GMICloudAudioProvider,
        GMICloudImageProvider,
        GMICloudVideoProvider,
        achat,
    )

    def media_registry_factory(
        modality: str,
        routes: Sequence[ModelRoute],
    ) -> Any:
        if modality not in {"image", "video", "audio"} or any(
            route.modality != modality for route in routes
        ):
            raise ValueError(f"Invalid {modality!r} routes for GenBlaze media registry")
        registry = ModelRegistry(strict_params=True)
        specs = []
        routes_by_upstream: dict[str, list[ModelRoute]] = {}
        for route in routes:
            routes_by_upstream.setdefault(route.gmi_model, []).append(route)
        for upstream_model, upstream_routes in routes_by_upstream.items():
            contract_keys = {
                _media_contract_key(route.samsar_model) for route in upstream_routes
            }
            if len(contract_keys) != 1:
                raise ValueError(
                    f"Conflicting Samsar contracts for GMICloud model {upstream_model!r}"
                )
            contract_key = contract_keys.pop()
            input_mapping = None
            param_aliases: dict[str, str] = {}
            param_transformer = None
            param_coercers: dict[str, Callable[[Any], Any]] = {}
            param_defaults: dict[str, Any] = {}
            param_required: frozenset[str] = frozenset()
            extras: dict[str, Any] = {"envelope_key": "payload"}

            if modality == "video":
                slot_options = [_media_input_slots(route) for route in upstream_routes]
                # GMI can expose one upstream slug through both Samsar T2V and
                # I2V contracts (Veo) or through two quality labels (Kling).
                # A longer positional mapping is a safe union: with no inputs
                # it adds nothing, while I2V still reaches the expected slot.
                input_slots = max(slot_options, key=len, default=())
                if any(
                    slots and input_slots[: len(slots)] != slots
                    for slots in slot_options
                ):
                    raise ValueError(
                        f"Conflicting input mappings for GMICloud model {upstream_model!r}"
                    )
                input_mapping = route_images(slots=input_slots)

            if contract_key == "gpt-image-edit":
                input_mapping = route_images(slots=("image", "mask"))
            elif contract_key in {"nano-flash", "nano-pro"}:
                input_mapping = route_images(array_slot="image")
            elif contract_key in {"bria-eraser", "bria-genfill"}:
                input_mapping = route_images(slots=("image", "mask"))

            if contract_key == "gpt-image":
                param_aliases = {"number_of_images": "n", "num_images": "n"}
                param_transformer = _drop_params("aspect_ratio")
                allowlist = frozenset({"prompt", "size", "quality", "output_format", "n"})
            elif contract_key == "gpt-image-edit":
                param_aliases = {"number_of_images": "n", "num_images": "n"}
                allowlist = frozenset({"prompt", "image", "mask", "size", "quality", "n"})
                param_required = frozenset({"prompt", "image"})
            elif contract_key == "seedream":
                param_transformer = _seedream_params
                allowlist = frozenset(
                    {
                        "prompt",
                        "size",
                        "output_format",
                    }
                )
            elif contract_key in {"nano-flash", "nano-pro"}:
                param_aliases = {
                    "output_format": "image_output_format",
                    "resolution": "image_size",
                }
                param_transformer = _drop_params("number_of_images", "num_images")
                param_coercers = {
                    "aspect_ratio": _aspect_ratio_coercer(
                        *(
                            _GMI_NANO_FLASH_ASPECT_RATIOS
                            if contract_key == "nano-flash"
                            else _GMI_NANO_PRO_ASPECT_RATIOS
                        )
                    ),
                    "image_size": _image_size_coercer(
                        *("512", "1K", "2K", "4K")
                        if contract_key == "nano-flash"
                        else ("1K", "2K", "4K")
                    ),
                    "image_output_format": _image_output_format,
                }
                allowlist = frozenset(
                    {
                        "prompt",
                        "aspect_ratio",
                        "image_output_format",
                        "image_size",
                        "image",
                    }
                )
            elif contract_key == "bria-eraser":
                allowlist = frozenset({"image", "mask"})
                param_required = frozenset({"image", "mask"})
            elif contract_key == "bria-genfill":
                allowlist = frozenset(
                    {
                        "prompt",
                        "image",
                        "mask",
                        "negative_prompt",
                        "guidance_scale",
                        "num_inference_steps",
                    }
                )
                param_required = frozenset({"prompt", "image", "mask"})
            elif contract_key == "veo":
                param_aliases = {
                    "duration": "durationSeconds",
                    "aspect_ratio": "aspectRatio",
                    "generate_audio": "generateAudio",
                    "negative_prompt": "negativePrompt",
                    "person_generation": "personGeneration",
                }
                param_transformer = _veo_params
                allowlist = frozenset(
                    {
                        "prompt",
                        "durationSeconds",
                        "aspectRatio",
                        "generateAudio",
                        "negativePrompt",
                        "personGeneration",
                        "resolution",
                        "seed",
                        "image",
                        "lastFrame",
                    }
                )
                param_coercers = {
                    "durationSeconds": _veo_duration,
                    "aspectRatio": _veo_aspect_ratio,
                    "generateAudio": _boolean,
                    "negativePrompt": _string,
                    "personGeneration": _veo_person_generation,
                    "seed": _uint32,
                }
                if input_mapping is not None:
                    veo_image_mapping = input_mapping

                    def map_veo_inputs(
                        inputs: Sequence[Any],
                        mapping: Callable[[Sequence[Any]], dict[str, Any]] = veo_image_mapping,
                    ) -> dict[str, Any]:
                        mapped = mapping(inputs)
                        if any(key in mapped for key in ("image", "lastFrame")):
                            mapped.setdefault("resolution", "720p")
                        return mapped

                    input_mapping = map_veo_inputs
                extras["has_audio"] = True
            elif contract_key == "kling-v3":
                param_aliases = {"generate_audio": "sound"}
                param_transformer = _drop_params("aspect_ratio")
                param_coercers = {
                    "duration": _whole_seconds_string,
                    "sound": _bool_to_on_off,
                }
                param_defaults = {"mode": "pro"}
                allowlist = frozenset(
                    {"prompt", "image", "image_tail", "duration", "sound", "mode"}
                )
            elif contract_key == "kling-v3-turbo":
                param_transformer = _kling_v3_turbo_params
                param_coercers = {"duration": _kling_v3_turbo_duration}
                allowlist = frozenset(
                    {"prompt", "first_frame", "duration", "resolution"}
                )
            elif contract_key == "kling-legacy":
                param_transformer = _legacy_kling_params
                param_coercers = {"duration": _legacy_kling_duration}
                allowlist = frozenset(
                    {"prompt", "image", "duration", "negative_prompt"}
                )
            elif contract_key in {"seedance-1-5", "seedance-2"}:
                param_aliases = {"aspect_ratio": "ratio"}
                param_coercers = {
                    "duration": (
                        _seedance_1_5_duration
                        if contract_key == "seedance-1-5"
                        else _seedance_2_duration
                    ),
                    "ratio": (
                        _aspect_ratio_coercer(*_GMI_SEEDANCE_ASPECT_RATIOS)
                        if contract_key == "seedance-1-5"
                        else _seedance_2_aspect_ratio
                    ),
                    "generate_audio": _boolean,
                    "seed": _uint32,
                }
                seedance_allowlist = {
                    "prompt",
                    "first_frame",
                    "last_frame",
                    "duration",
                    "ratio",
                    "generate_audio",
                    "seed",
                }
                if contract_key == "seedance-2":
                    param_coercers["resolution"] = _seedance_2_resolution
                    param_defaults = {"resolution": "720p"}
                    seedance_allowlist.add("resolution")
                allowlist = frozenset(seedance_allowlist)
            elif contract_key == "hailuo-pro":
                param_transformer = _hailuo_pro_params
                param_coercers = {"prompt_optimizer": _boolean}
                allowlist = frozenset(
                    {
                        "prompt",
                        "first_frame_image",
                        "duration",
                        "resolution",
                        "prompt_optimizer",
                    }
                )
            elif contract_key == "happyhorse":
                param_transformer = _happyhorse_params
                param_coercers = {
                    "duration": _happyhorse_duration,
                    "seed": _happyhorse_seed,
                }
                allowlist = frozenset(
                    {
                        "prompt",
                        "first_frame",
                        "duration",
                        "resolution",
                        "seed",
                    }
                )
            elif contract_key == "elevenlabs-tts":
                param_aliases = {
                    "prompt": "text",
                    "voice": "voice_id",
                }
                param_defaults = {"output_format": "mp3_44100_128"}
                param_coercers = {"output_format": _elevenlabs_output_format}
                allowlist = frozenset({"text", "voice_id", "output_format"})
                param_required = frozenset({"text", "voice_id"})
                extras["is_music"] = False
            elif contract_key == "openai-tts":
                param_aliases = {
                    "prompt": "input",
                    "output_format": "response_format",
                }
                param_defaults = {"response_format": "mp3"}
                allowlist = frozenset(
                    {"input", "voice", "response_format", "instructions"}
                )
                param_required = frozenset({"input", "voice"})
                extras["is_music"] = False
            else:  # pragma: no cover - protected by _media_contract_key
                raise ValueError(f"Unhandled GenBlaze media contract {contract_key!r}")

            specs.append(
                ModelSpec(
                    model_id=upstream_model,
                    modality=getattr(Modality, modality.upper()),
                    param_allowlist=allowlist,
                    param_aliases=param_aliases,
                    param_transformer=param_transformer,
                    param_coercers=param_coercers,
                    param_defaults=param_defaults,
                    param_required=param_required,
                    input_mapping=input_mapping,
                    extras=extras,
                )
            )
        registry.extend(specs)
        return registry

    return GenBlazeBindings(
        achat=achat,
        image_provider_type=GMICloudImageProvider,
        video_provider_type=GMICloudVideoProvider,
        audio_provider_type=GMICloudAudioProvider,
        provider_error_type=ProviderError,
        step_type=Step,
        asset_type=Asset,
        modality_type=Modality,
        media_registry_factory=media_registry_factory,
    )


class JobTokenCodec:
    """AES-GCM-sealed job envelope used as the public, opaque request id."""

    _VERSION = 1
    _MAX_TOKEN_LENGTH = 4096
    _NONCE_BYTES = 12
    _AAD = b"samsar-genblaze-media-job:v1"

    def __init__(self, secret: str, *, legacy_secrets: Sequence[str] = ()):
        if not secret:
            raise ValueError("A job token secret is required")
        secrets = (
            secret,
            *(value for value in legacy_secrets if value and value != secret),
        )
        self._ciphers = tuple(
            AESGCM(
                hashlib.sha256(
                    b"samsar-genblaze-media-job-key:v1\0" + value.encode("utf-8")
                ).digest()
            )
            for value in secrets
        )
        self._cipher = self._ciphers[0]

    @staticmethod
    def _encode_part(value: bytes) -> str:
        return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")

    @staticmethod
    def _decode_part(value: str) -> bytes:
        padding = "=" * (-len(value) % 4)
        return base64.b64decode(value + padding, altchars=b"-_", validate=True)

    def encode(self, *, model: str, upstream_id: str) -> str:
        payload = json.dumps(
            {"v": self._VERSION, "m": model, "i": upstream_id},
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        nonce = os.urandom(self._NONCE_BYTES)
        ciphertext = self._cipher.encrypt(nonce, payload, self._AAD)
        return self._encode_part(nonce + ciphertext)

    def decode(self, token: str) -> tuple[str, str]:
        try:
            if not token or len(token) > self._MAX_TOKEN_LENGTH:
                raise ValueError("invalid token length")
            sealed = self._decode_part(token)
            if len(sealed) <= self._NONCE_BYTES + 16:
                raise ValueError("invalid token payload")
            nonce = sealed[: self._NONCE_BYTES]
            ciphertext = sealed[self._NONCE_BYTES :]
            invalid_tag: InvalidTag | None = None
            for cipher in self._ciphers:
                try:
                    plaintext = cipher.decrypt(nonce, ciphertext, self._AAD)
                except InvalidTag as exc:
                    invalid_tag = exc
                    continue
                payload = json.loads(plaintext)
                if set(payload) != {"v", "m", "i"} or payload["v"] != self._VERSION:
                    raise ValueError("invalid token payload")
                model = payload["m"]
                upstream_id = payload["i"]
                if (
                    not isinstance(model, str)
                    or not model
                    or not isinstance(upstream_id, str)
                    or not upstream_id
                ):
                    raise ValueError("invalid token fields")
                return model, upstream_id
            raise invalid_tag or InvalidTag
        except (
            InvalidTag,
            binascii.Error,
            ValueError,
            TypeError,
            KeyError,
            json.JSONDecodeError,
        ) as exc:
            raise GatewayError(
                "The GenBlaze request id is invalid or has been tampered with.",
                status_code=400,
                code="invalid_request_id",
                error_type="invalid_request_error",
            ) from exc


class GatewayRuntime:
    def __init__(
        self,
        settings: Settings,
        *,
        bindings: GenBlazeBindings | None = None,
        tunnel_url_refresher: Callable[
            [Any, Sequence[str], int],
            Awaitable[Any | None],
        ] | None = None,
        media_url_stager: Callable[[Any], Awaitable[Any | None]] | None = None,
    ):
        self.settings = settings
        self._bindings: GenBlazeBindings | None = None
        self._image_provider: Any = None
        self._video_provider: Any = None
        self._audio_provider: Any = None
        self._token_codec: JobTokenCodec | None = None
        self._catalog: ModelCatalog | None = None
        self._tunnel_url_refresher = tunnel_url_refresher
        self._media_url_stager = media_url_stager
        self._gmi_media_stager: GMICloudMediaStager | None = None
        self._initialization_error: str | None = None

        if not settings.gmi_api_key:
            if not settings.model_catalog_path:
                self._catalog = load_model_catalog(None)
            self._initialization_error = "GMI_API_KEY is not configured"
            return

        try:
            self._catalog = load_model_catalog(
                settings.model_catalog_path,
                gmi_api_key=settings.gmi_api_key,
            )
            self._bindings = bindings or load_genblaze_bindings()
            common_provider_options: dict[str, Any] = {
                "api_key": settings.gmi_api_key,
                "http_timeout": settings.upstream_timeout_seconds,
            }
            if settings.media_base_url:
                common_provider_options["base_url"] = settings.media_base_url
            image_options = dict(common_provider_options)
            video_options = dict(common_provider_options)
            audio_options = dict(common_provider_options)
            if self._bindings.media_registry_factory is not None:
                image_options["models"] = self._bindings.media_registry_factory(
                    "image",
                    tuple(
                        route for route in self._catalog.routes if route.modality == "image"
                    ),
                )
                video_options["models"] = self._bindings.media_registry_factory(
                    "video",
                    tuple(
                        route for route in self._catalog.routes if route.modality == "video"
                    ),
                )
                audio_options["models"] = self._bindings.media_registry_factory(
                    "audio",
                    tuple(
                        route for route in self._catalog.routes if route.modality == "audio"
                    ),
                )
            self._image_provider = self._bindings.image_provider_type(**image_options)
            self._video_provider = self._bindings.video_provider_type(**video_options)
            self._audio_provider = self._bindings.audio_provider_type(**audio_options)
            primary_token_secret = settings.job_token_secret or settings.gmi_api_key
            legacy_token_secrets = (
                (settings.gmi_api_key,)
                if settings.gmi_api_key != primary_token_secret
                else ()
            )
            self._token_codec = JobTokenCodec(
                primary_token_secret,
                legacy_secrets=legacy_token_secrets,
            )
            # A custom tunnel refresher is a test/integration seam that owns the
            # complete retry path unless a stager is explicitly injected too.
            if self._media_url_stager is None and self._tunnel_url_refresher is None:
                self._gmi_media_stager = GMICloudMediaStager(
                    api_key=settings.gmi_api_key,
                    media_base_url=settings.media_base_url,
                    timeout_seconds=settings.media_stage_timeout_seconds,
                    max_media_bytes=settings.media_stage_max_bytes,
                )
        except CatalogConfigurationError as exc:
            self._catalog = None
            self._initialization_error = f"GenBlaze model catalog is invalid: {exc}"
        except Exception as exc:
            message = str(exc)
            if settings.gmi_api_key:
                message = message.replace(settings.gmi_api_key, "[redacted]")
            self._initialization_error = f"GenBlaze initialization failed: {message}"

    @property
    def ready(self) -> bool:
        return (
            self._initialization_error is None
            and self._bindings is not None
            and self._image_provider is not None
            and self._video_provider is not None
            and self._audio_provider is not None
            and self._token_codec is not None
            and self._catalog is not None
        )

    @property
    def readiness_reason(self) -> str | None:
        return self._initialization_error

    def _require_ready(self) -> tuple[GenBlazeBindings, JobTokenCodec]:
        if not self.ready:
            raise GatewayError(
                "The GenBlaze gateway is not ready.",
                status_code=503,
                code="gateway_not_ready",
            )
        assert self._bindings is not None
        assert self._token_codec is not None
        return self._bindings, self._token_codec

    def model_list(self) -> dict[str, Any]:
        if self._catalog is None:
            raise GatewayError(
                "The GenBlaze model catalog is unavailable.",
                status_code=503,
                code="gateway_not_ready",
            )
        return self._catalog.openai_model_list()

    def _resolve_model(
        self,
        model: object,
        *,
        modality: str | None = None,
    ) -> ModelRoute:
        if self._catalog is None:
            raise GatewayError(
                "The GenBlaze model catalog is unavailable.",
                status_code=503,
                code="gateway_not_ready",
            )
        # The only modality values passed internally are the catalog Literal
        # values. Keeping the small wrapper here avoids any global catalog.
        return self._catalog.resolve(model, modality=modality)  # type: ignore[arg-type]

    @staticmethod
    def _model_error(exc: UnsupportedModelError) -> GatewayError:
        return GatewayError(
            str(exc),
            status_code=404,
            code="GENBLAZE_MODEL_UNSUPPORTED",
            error_type="invalid_request_error",
        )

    def _provider_error(self, exc: Exception) -> GatewayError:
        return GatewayError.from_provider(exc, secret=self.settings.gmi_api_key)

    async def _stage_managed_media_urls(self, payload: Any) -> Any | None:
        if self._media_url_stager is not None:
            return await self._media_url_stager(payload)
        if self._gmi_media_stager is None:
            return None
        return await _stage_managed_tunnel_media_urls(
            payload,
            stager=self._gmi_media_stager,
        )

    async def _recover_managed_media_urls(
        self,
        active_payload: Any,
        *,
        last_tunnel_payload: Any,
        attempted_urls: Sequence[str],
        retry_number: int,
    ) -> Any | None:
        current_managed_urls = _collect_managed_tunnel_media_urls(active_payload)
        if current_managed_urls:
            try:
                staged_payload = await self._stage_managed_media_urls(active_payload)
            except Exception:
                staged_payload = None
            if (
                staged_payload is not None
                and not _collect_managed_tunnel_media_urls(staged_payload)
            ):
                return staged_payload
            refresh_source = active_payload
        else:
            # A GMI-hosted staged URL should be the most reliable second attempt.
            # If GMI still reports a download failure, retain the previous tunnel
            # payload so the final bounded attempt can use a newly rotated origin.
            refresh_source = last_tunnel_payload

        if not _collect_managed_tunnel_media_urls(refresh_source):
            return None
        if self._tunnel_url_refresher is not None:
            return await self._tunnel_url_refresher(
                refresh_source,
                attempted_urls,
                retry_number,
            )
        return await _refresh_managed_tunnel_media_urls(
            refresh_source,
            settings=self.settings,
            attempted_urls=attempted_urls,
            retry_number=retry_number,
        )

    async def chat_completion(self, request: dict[str, Any]) -> dict[str, Any]:
        bindings, _ = self._require_ready()
        try:
            route = self._resolve_model(request.get("model"), modality="text")
        except UnsupportedModelError as exc:
            raise self._model_error(exc) from exc

        stream = request.get("stream")
        if stream is not None and stream is not False:
            raise GatewayError(
                "Streaming chat completions are not supported by the pinned "
                "GenBlaze GMICloud connector.",
                status_code=400,
                code="streaming_not_supported",
                error_type="invalid_request_error",
            )
        content_kinds = _message_content_kinds(request.get("messages"))
        if "audio" in content_kinds:
            raise GatewayError(
                f"{route.samsar_model} via GMICloud does not support audio message content.",
                status_code=400,
                code="multimodal_not_supported",
                error_type="invalid_request_error",
            )

        upstream_model = route.gmi_model
        if "vision" in content_kinds:
            if not route.gmi_vision_model:
                raise GatewayError(
                    f"{route.samsar_model} does not have a configured GMICloud vision model.",
                    status_code=400,
                    code="multimodal_not_supported",
                    error_type="invalid_request_error",
                )
            upstream_model = route.gmi_vision_model

        payload = dict(request)
        payload.pop("model", None)
        messages = payload.pop("messages", None)
        # These are gateway transport controls, never upstream JSON fields.
        # Removing them prevents an internal caller from overriding the trusted
        # endpoint or injecting a fake client object through the request body.
        for protected_field in ("api_key", "base_url", "client", "stream", "timeout"):
            payload.pop(protected_field, None)
        payload = _normalize_chat_reasoning_params(payload)
        if "vision" in content_kinds:
            # Completion limits are OpenRouter controls in Samsar's vision
            # path and are not accepted consistently by GMICloud models.
            payload.pop("max_tokens", None)
            payload.pop("max_completion_tokens", None)
            payload.pop("max_output_tokens", None)
        payload["api_key"] = self.settings.gmi_api_key
        payload["timeout"] = self.settings.upstream_timeout_seconds
        if self.settings.chat_base_url:
            payload["base_url"] = self.settings.chat_base_url

        active_messages = messages
        last_tunnel_messages = messages
        active_error: Exception | None = None
        attempted_urls = _collect_managed_tunnel_media_urls(active_messages)
        max_url_attempts = (
            self.settings.media_url_max_attempts
            if attempted_urls
            else 1
        )
        for url_attempt in range(1, max_url_attempts + 1):
            try:
                response = await bindings.achat(upstream_model, active_messages, **payload)
                active_error = None
                break
            except bindings.provider_error_type as exc:
                active_error = exc
                can_refresh = (
                    url_attempt < max_url_attempts
                    and _is_gmicloud_media_download_error(exc)
                )
                if not can_refresh:
                    break
                try:
                    if _collect_managed_tunnel_media_urls(active_messages):
                        last_tunnel_messages = active_messages
                    refreshed_messages = await self._recover_managed_media_urls(
                        active_messages,
                        last_tunnel_payload=last_tunnel_messages,
                        attempted_urls=tuple(attempted_urls),
                        retry_number=url_attempt,
                    )
                except Exception:
                    refreshed_messages = None
                if refreshed_messages is None:
                    break
                refreshed_urls = _collect_managed_tunnel_media_urls(refreshed_messages)
                if refreshed_urls:
                    if all(url in attempted_urls for url in refreshed_urls):
                        break
                    attempted_urls.extend(
                        url for url in refreshed_urls if url not in attempted_urls
                    )
                active_messages = refreshed_messages

        if active_error is not None:
            # GMICloud's generic Chat Completions contract does not document a
            # reasoning control, and parameter support can vary by upstream
            # model revision. Prefer the canonical reasoning_effort field, but
            # retry once without it when the provider explicitly rejects it.
            # This avoids multiplying the processor's outer retry loop while
            # preserving explicit reasoning wherever GMICloud accepts it.
            if (
                "reasoning_effort" not in payload
                or not _is_unknown_reasoning_parameter(active_error)
            ):
                raise self._provider_error(active_error) from active_error
            fallback_payload = dict(payload)
            fallback_payload.pop("reasoning_effort", None)
            try:
                response = await bindings.achat(
                    upstream_model,
                    active_messages,
                    **fallback_payload,
                )
            except bindings.provider_error_type as fallback_exc:
                raise self._provider_error(fallback_exc) from fallback_exc

        raw = getattr(response, "raw", None)
        if not isinstance(raw, dict):
            raise GatewayError(
                "GMICloud returned an invalid chat completion payload.",
                status_code=502,
                code="invalid_upstream_response",
                error_type="provider_error",
            )
        return raw

    async def submit_media(self, request: dict[str, Any]) -> dict[str, str]:
        bindings, token_codec = self._require_ready()
        route = self._resolve_media_request(request)
        provider = self._provider_for(route)
        active_request = request
        last_tunnel_request = request
        active_error: Exception | None = None
        attempted_urls = _collect_managed_tunnel_media_urls(request)
        max_url_attempts = (
            self.settings.media_url_max_attempts
            if attempted_urls
            else 1
        )
        for url_attempt in range(1, max_url_attempts + 1):
            step = self._build_media_step(bindings, provider, route, active_request)
            try:
                result = await asyncio.to_thread(provider.submit, step)
                active_error = None
                break
            except bindings.provider_error_type as exc:
                active_error = exc
                can_refresh = (
                    url_attempt < max_url_attempts
                    and _is_gmicloud_media_download_error(exc)
                )
                if not can_refresh:
                    break
                try:
                    if _collect_managed_tunnel_media_urls(active_request):
                        last_tunnel_request = active_request
                    refreshed_request = await self._recover_managed_media_urls(
                        active_request,
                        last_tunnel_payload=last_tunnel_request,
                        attempted_urls=tuple(attempted_urls),
                        retry_number=url_attempt,
                    )
                except Exception:
                    refreshed_request = None
                if refreshed_request is None:
                    break
                refreshed_urls = _collect_managed_tunnel_media_urls(refreshed_request)
                if refreshed_urls:
                    if all(url in attempted_urls for url in refreshed_urls):
                        break
                    attempted_urls.extend(
                        url for url in refreshed_urls if url not in attempted_urls
                    )
                active_request = refreshed_request

        if active_error is not None:
            raise self._provider_error(active_error) from active_error

        upstream_id = str(getattr(result, "prediction_id", "") or "").strip()
        if not upstream_id:
            raise GatewayError(
                "GMICloud accepted the media request without returning a request id.",
                status_code=502,
                code="invalid_upstream_response",
                error_type="provider_error",
            )
        request_id = token_codec.encode(
            model=route.samsar_model,
            upstream_id=upstream_id,
        )
        return {"request_id": request_id, "status": "pending"}

    async def poll_media(self, request_id: str) -> dict[str, Any]:
        bindings, token_codec = self._require_ready()
        model, upstream_id = token_codec.decode(request_id)
        try:
            route = self._resolve_model(model)
        except UnsupportedModelError as exc:
            raise GatewayError(
                "The model encoded in this GenBlaze request id is no longer enabled.",
                status_code=410,
                code="model_no_longer_available",
                error_type="invalid_request_error",
            ) from exc
        if route.modality not in {"image", "video", "audio"}:
            raise GatewayError(
                "The GenBlaze request id does not refer to a media model.",
                status_code=400,
                code="invalid_request_id",
                error_type="invalid_request_error",
            )

        provider = self._provider_for(route)
        step = self._build_media_step(bindings, provider, route, {})

        def poll_once() -> tuple[bool, Any, Exception | None]:
            terminal = provider.poll(upstream_id)
            if not terminal:
                return False, step, None
            try:
                return True, provider.fetch_output(upstream_id, step), None
            except bindings.provider_error_type as exc:
                return True, step, exc

        try:
            terminal, fetched_step, terminal_error = await asyncio.to_thread(poll_once)
        except bindings.provider_error_type as exc:
            raise self._provider_error(exc) from exc

        if not terminal:
            return {"status": "pending", "assets": [], "error": None}

        terminal_status = _terminal_status(fetched_step)
        if terminal_error is not None:
            if terminal_status not in {"failed", "cancelled"}:
                raise self._provider_error(terminal_error) from terminal_error
            message = str(terminal_error) or f"Media generation {terminal_status}"
            if self.settings.gmi_api_key:
                message = message.replace(self.settings.gmi_api_key, "[redacted]")
            return {"status": terminal_status, "assets": [], "error": message}

        return {
            "status": "succeeded",
            "assets": [
                {"url": asset.url, "media_type": asset.media_type}
                for asset in getattr(fetched_step, "assets", [])
            ],
            "error": None,
        }

    def _resolve_media_request(self, request: dict[str, Any]) -> ModelRoute:
        allowed_fields = {"model", "modality", "prompt", "input_urls", "params"}
        unknown_fields = sorted(set(request) - allowed_fields)
        if unknown_fields:
            raise GatewayError(
                f"Unknown media request fields: {unknown_fields}",
                status_code=400,
                code="invalid_media_request",
                error_type="invalid_request_error",
            )
        modality = request.get("modality")
        if modality not in {"image", "video", "audio"}:
            raise GatewayError(
                "Media request modality must be 'image', 'video', or 'audio'.",
                status_code=400,
                code="invalid_media_request",
                error_type="invalid_request_error",
            )
        try:
            return self._resolve_model(request.get("model"), modality=modality)
        except UnsupportedModelError as exc:
            raise self._model_error(exc) from exc

    def _provider_for(self, route: ModelRoute) -> Any:
        if route.modality == "image":
            return self._image_provider
        if route.modality == "video":
            return self._video_provider
        if route.modality == "audio":
            return self._audio_provider
        raise GatewayError(
            f"Model {route.samsar_model!r} is not a media model.",
            status_code=400,
            code="invalid_media_request",
            error_type="invalid_request_error",
        )

    @staticmethod
    def _build_media_step(
        bindings: GenBlazeBindings,
        provider: Any,
        route: ModelRoute,
        request: dict[str, Any],
    ) -> Any:
        prompt = request.get("prompt")
        if prompt is not None and not isinstance(prompt, str):
            raise GatewayError(
                "Media request prompt must be a string.",
                status_code=400,
                code="invalid_media_request",
                error_type="invalid_request_error",
            )
        params = request.get("params", {})
        if not isinstance(params, dict):
            raise GatewayError(
                "Media request params must be an object.",
                status_code=400,
                code="invalid_media_request",
                error_type="invalid_request_error",
            )
        allowed_params = {
            "image": _IMAGE_MEDIA_PARAMS,
            "video": _VIDEO_MEDIA_PARAMS,
            "audio": _AUDIO_MEDIA_PARAMS,
        }[route.modality]
        if route.modality == "audio":
            allowed_params = {
                "elevenlabs-tts": _ELEVENLABS_AUDIO_PARAMS,
                "openai-tts": _OPENAI_AUDIO_PARAMS,
            }[_media_contract_key(route.samsar_model)]
        unknown_params = sorted(set(params) - allowed_params)
        if unknown_params:
            raise GatewayError(
                f"Unsupported params for {route.samsar_model}: {unknown_params}",
                status_code=400,
                code="invalid_media_request",
                error_type="invalid_request_error",
            )
        input_urls = request.get("input_urls", [])
        if not isinstance(input_urls, list) or not all(
            isinstance(value, str) and value.strip() for value in input_urls
        ):
            raise GatewayError(
                "Media request input_urls must be an array of non-empty URLs.",
                status_code=400,
                code="invalid_media_request",
                error_type="invalid_request_error",
            )
        if request and route.modality == "image":
            if route.operation == "image.generate" and input_urls:
                raise GatewayError(
                    f"{route.samsar_model} is an image-generation route and does not "
                    "accept edit/reference inputs through GMICloud.",
                    status_code=400,
                    code="invalid_media_request",
                    error_type="invalid_request_error",
                )
            if route.operation == "image.edit":
                minimum_inputs, maximum_inputs = _image_edit_input_bounds(route)
                if len(input_urls) < minimum_inputs or len(input_urls) > maximum_inputs:
                    expected = (
                        str(minimum_inputs)
                        if minimum_inputs == maximum_inputs
                        else f"{minimum_inputs} to {maximum_inputs}"
                    )
                    raise GatewayError(
                        f"{route.samsar_model} requires {expected} public image input URL(s).",
                        status_code=400,
                        code="invalid_media_request",
                        error_type="invalid_request_error",
                    )
        if request and route.modality == "video":
            input_slots = _media_input_slots(route)
            minimum_inputs = _media_minimum_input_count(route)
            if len(input_urls) < minimum_inputs:
                raise GatewayError(
                    f"{route.samsar_model} requires {minimum_inputs} public image "
                    "input URL(s).",
                    status_code=400,
                    code="invalid_media_request",
                    error_type="invalid_request_error",
                )
            if len(input_urls) > len(input_slots):
                raise GatewayError(
                    f"{route.samsar_model} accepts at most {len(input_slots)} input URL(s).",
                    status_code=400,
                    code="invalid_media_request",
                    error_type="invalid_request_error",
                )
            if route.samsar_model.startswith("VEO3.1") and (
                not isinstance(prompt, str) or not prompt.strip()
            ):
                raise GatewayError(
                    f"{route.samsar_model} requires a non-empty prompt.",
                    status_code=400,
                    code="invalid_media_request",
                    error_type="invalid_request_error",
                )
            if route.samsar_model == "HAILUOPRO" and not input_urls and (
                not isinstance(prompt, str) or not prompt.strip()
            ):
                raise GatewayError(
                    "HAILUOPRO requires a non-empty prompt or first-frame input.",
                    status_code=400,
                    code="invalid_media_request",
                    error_type="invalid_request_error",
                )
        if request and route.modality == "audio":
            if not isinstance(prompt, str) or not prompt.strip():
                raise GatewayError(
                    f"{route.samsar_model} requires a non-empty speech prompt.",
                    status_code=400,
                    code="invalid_media_request",
                    error_type="invalid_request_error",
                )
            if input_urls:
                raise GatewayError(
                    f"{route.samsar_model} text-to-speech does not accept input URLs.",
                    status_code=400,
                    code="invalid_media_request",
                    error_type="invalid_request_error",
                )
            if route.samsar_model == "ELEVENLABS" and "output_format" in params:
                try:
                    _elevenlabs_output_format(params["output_format"])
                except ValueError as exc:
                    raise GatewayError(
                        str(exc),
                        status_code=400,
                        code="invalid_media_request",
                        error_type="invalid_request_error",
                    ) from exc
            voice = (
                params.get("voice")
                if route.samsar_model == "OPENAI_TTS"
                else params.get("voice_id") or params.get("voice")
            )
            if not isinstance(voice, str) or not voice.strip():
                field_name = (
                    "voice"
                    if route.samsar_model == "OPENAI_TTS"
                    else "voice_id or voice"
                )
                raise GatewayError(
                    f"{route.samsar_model} requires a non-empty {field_name}.",
                    status_code=400,
                    code="invalid_media_request",
                    error_type="invalid_request_error",
                )
        inputs = [
            bindings.asset_type(
                url=url.strip(),
                media_type=_input_media_type(url),
            )
            for url in input_urls
        ]
        modality = getattr(bindings.modality_type, route.modality.upper())
        return bindings.step_type(
            provider=provider.name,
            model=route.gmi_model,
            modality=modality,
            prompt=prompt,
            params=dict(params),
            inputs=inputs,
        )

    async def close(self) -> None:
        for provider in (
            self._image_provider,
            self._video_provider,
            self._audio_provider,
        ):
            if provider is None:
                continue
            close = getattr(provider, "close", None)
            if callable(close):
                await asyncio.to_thread(close)


def _message_content_kinds(messages: object) -> set[str]:
    kinds: set[str] = set()
    if not isinstance(messages, list):
        return kinds
    for message in messages:
        if not isinstance(message, dict):
            continue
        if any(key in message for key in ("image", "image_url", "images")):
            kinds.add("vision")
        if any(key in message for key in ("video", "video_url", "videos")):
            kinds.add("vision")
        if any(key in message for key in ("audio", "audio_url", "audios")):
            kinds.add("audio")
        content = message.get("content")
        blocks = content if isinstance(content, list) else [content]
        for block in blocks:
            if not isinstance(block, dict):
                continue
            block_type = str(block.get("type", "")).lower()
            if "image" in block_type or "video" in block_type:
                kinds.add("vision")
            if "audio" in block_type:
                kinds.add("audio")
            if any(key in block for key in ("image", "image_url", "video", "video_url")):
                kinds.add("vision")
            if any(key in block for key in ("audio", "audio_url")):
                kinds.add("audio")
    return kinds


def _input_media_type(url: str) -> str:
    media_type, _ = mimetypes.guess_type(url.split("?", 1)[0])
    if media_type and media_type.startswith(("image/", "video/", "audio/")):
        return media_type
    # Current/future Samsar media intersections consume image references. The
    # explicit input_urls field intentionally denotes those source images.
    return "image/png"


def _media_input_slots(route: ModelRoute) -> tuple[str, ...]:
    if route.samsar_model in {"VEO3.1", "VEO3.1FAST"}:
        return ()
    if route.samsar_model in {"SEEDANCEI2V", "SEEDANCE2.0I2V"}:
        return ("first_frame", "last_frame")
    if route.samsar_model in {"VEO3.1I2V", "VEO3.1I2VFAST"}:
        return ("image",)
    if route.samsar_model == "VEO3.1FLIV":
        return ("image", "lastFrame")
    if route.samsar_model == "KLINGIMGTOVID3PRO":
        return ("image", "image_tail")
    if route.samsar_model == "KLINGIMGTOVIDTURBO":
        return ("first_frame",)
    if route.samsar_model in {
        "KLINGIMGTOVIDPRO",
        "KLINGIMGTOVID2.1MASTER",
        "KLINGIMGTOVID2.1PRO",
        "KLINGIMGTOVID2.1STANDARD",
    }:
        return ("image",)
    if route.samsar_model == "HAILUOPRO":
        return ("first_frame_image",)
    if route.samsar_model == "HAPPYHORSEI2V":
        return ("first_frame",)
    raise ValueError(f"No exact video input contract for {route.samsar_model!r}")


def _media_minimum_input_count(route: ModelRoute) -> int:
    if route.samsar_model == "VEO3.1FLIV":
        return 2
    if route.samsar_model in {
        "VEO3.1I2V",
        "VEO3.1I2VFAST",
        "SEEDANCEI2V",
        "SEEDANCE2.0I2V",
        "KLINGIMGTOVID3PRO",
        "KLINGIMGTOVIDTURBO",
        "KLINGIMGTOVIDPRO",
        "KLINGIMGTOVID2.1MASTER",
        "KLINGIMGTOVID2.1PRO",
        "KLINGIMGTOVID2.1STANDARD",
        "HAPPYHORSEI2V",
    }:
        return 1
    if route.samsar_model in {
        "VEO3.1",
        "VEO3.1FAST",
        "HAILUOPRO",
    }:
        return 0
    raise ValueError(f"No exact video input contract for {route.samsar_model!r}")


def _image_edit_input_bounds(route: ModelRoute) -> tuple[int, int]:
    if route.samsar_model == "GPTIMAGE2EDIT":
        return 1, 2
    if route.samsar_model in {"NANOBANANA2EDIT", "NANOBANANAPROEDIT"}:
        return 1, 14
    if route.samsar_model in {"BRIA_ERASER", "BRIA_GENFILL"}:
        return 2, 2
    raise ValueError(f"No exact image edit input contract for {route.samsar_model!r}")


def _terminal_status(step: Any) -> str | None:
    payload = getattr(step, "provider_payload", {})
    if not isinstance(payload, dict):
        return None
    gmi = payload.get("gmicloud", {})
    if not isinstance(gmi, dict):
        return None
    status = str(gmi.get("status", "")).lower()
    return status if status in {"failed", "cancelled", "success"} else None
