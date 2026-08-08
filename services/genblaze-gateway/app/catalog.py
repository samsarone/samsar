"""Credential-scoped Samsar-to-GMICloud model routing.

The setup wizard writes a catalog containing only model mappings verified for
the configured GMICloud credential.  This module deliberately adds a second,
static boundary: a runtime catalog may select upstream GMICloud identifiers,
but it can never introduce a Samsar model or modality that this gateway has not
been written to preserve.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Mapping


Modality = Literal["text", "image", "video", "audio"]


class CatalogConfigurationError(ValueError):
    """Raised when an explicitly configured runtime catalog is unusable."""


@dataclass(frozen=True, slots=True)
class CuratedModel:
    modality: Modality
    operation: str
    model_ids: tuple[str, ...]
    vision_model_ids: tuple[str, ...] = ()


# This is the complete gateway contract, not an upstream catalog.  Adding a
# name here requires a matching Samsar adapter and verified request/response
# compatibility.
CURATED_SAMSAR_MODELS: Mapping[str, CuratedModel] = {
    "gpt-5.6-sol": CuratedModel(
        "text",
        "chat.completions",
        ("openai/gpt-5.6-sol",),
        ("openai/gpt-5.6-sol",),
    ),
    "gemini-3.1-pro": CuratedModel(
        "text",
        "chat.completions",
        ("google/gemini-3.1-pro-preview",),
        ("google/gemini-3.1-pro-preview",),
    ),
    "QWEN3.8": CuratedModel(
        "text",
        "chat.completions",
        ("Qwen/Qwen3.8-Max",),
        ("Qwen/Qwen3.8-Max",),
    ),
    "GPTIMAGE2": CuratedModel("image", "image.generate", ("gpt-image-2-generate",)),
    "GPTIMAGE2EDIT": CuratedModel("image", "image.edit", ("gpt-image-2-edit",)),
    "SEEDREAM": CuratedModel("image", "image.generate", ("seedream-5.0-pro",)),
    "NANOBANANA2": CuratedModel(
        "image",
        "image.generate",
        ("gemini-3.1-flash-image",),
    ),
    "NANOBANANA2EDIT": CuratedModel(
        "image",
        "image.edit",
        ("gemini-3.1-flash-image",),
    ),
    "NANOBANANAPRO": CuratedModel(
        "image",
        "image.generate",
        ("gemini-3-pro-image",),
    ),
    "NANOBANANAPROEDIT": CuratedModel(
        "image",
        "image.edit",
        ("gemini-3-pro-image",),
    ),
    "BRIA_ERASER": CuratedModel("image", "image.edit", ("bria-eraser",)),
    "BRIA_GENFILL": CuratedModel("image", "image.edit", ("bria-genfill",)),
    "VEO3.1": CuratedModel("video", "video.generate", ("veo-3.1-generate-001",)),
    "VEO3.1FAST": CuratedModel(
        "video",
        "video.generate",
        ("veo-3.1-fast-generate-001",),
    ),
    "VEO3.1I2V": CuratedModel(
        "video",
        "video.generate",
        ("veo-3.1-generate-001",),
    ),
    "VEO3.1I2VFAST": CuratedModel(
        "video",
        "video.generate",
        ("veo-3.1-fast-generate-001",),
    ),
    "VEO3.1FLIV": CuratedModel(
        "video",
        "video.generate",
        ("veo-3.1-generate-001",),
    ),
    "SEEDANCEI2V": CuratedModel(
        "video",
        "video.generate",
        ("seedance-1-5-pro-251215",),
    ),
    "SEEDANCE2.0I2V": CuratedModel(
        "video",
        "video.generate",
        ("seedance-2-0-260128",),
    ),
    "SEEDANCE2.5I2V": CuratedModel(
        "video",
        "video.generate",
        ("seedance-2-5-260628",),
    ),
    "KLINGIMGTOVID3PRO": CuratedModel(
        "video",
        "video.generate",
        ("kling-v3-image-to-video",),
    ),
    "KLINGIMGTOVIDTURBO": CuratedModel(
        "video",
        "video.generate",
        ("kling-3.0-turbo-i2v",),
    ),
    "KLINGIMGTOVIDPRO": CuratedModel(
        "video",
        "video.generate",
        ("Kling-Image2Video-V1.6-Pro",),
    ),
    "KLINGIMGTOVID2.1MASTER": CuratedModel(
        "video",
        "video.generate",
        ("Kling-Image2Video-V2.1-Master",),
    ),
    "KLINGIMGTOVID2.1PRO": CuratedModel(
        "video",
        "video.generate",
        ("Kling-Image2Video-V2.1-Pro",),
    ),
    "KLINGIMGTOVID2.1STANDARD": CuratedModel(
        "video",
        "video.generate",
        ("Kling-Image2Video-V2.1-Standard",),
    ),
    "HAILUOPRO": CuratedModel(
        "video",
        "video.generate",
        ("Minimax-Hailuo-02",),
    ),
    "HAPPYHORSEI2V": CuratedModel(
        "video",
        "video.generate",
        ("happyhorse-1.1-i2v",),
    ),
    "ELEVENLABS": CuratedModel(
        "audio",
        "audio.generate",
        (
            "elevenlabs-tts-multilingual-v2",
            "elevenlabs-tts-v3",
        ),
    ),
    "OPENAI_TTS": CuratedModel(
        "audio",
        "audio.generate",
        ("gpt-4o-mini-tts",),
    ),
}


@dataclass(frozen=True, slots=True)
class ModelRoute:
    samsar_model: str
    gmi_model: str
    modality: Modality
    operation: str
    gmi_vision_model: str | None = None


class UnsupportedModelError(ValueError):
    def __init__(self, model: object, *, modality: Modality | None = None):
        requested = str(model).strip() if model is not None else ""
        suffix = f" for {modality}" if modality else ""
        super().__init__(
            f"Model {requested or '<missing>'!r} is not available via GMICloud{suffix}."
        )
        self.model = requested or None


@dataclass(frozen=True, slots=True)
class ModelCatalog:
    routes: tuple[ModelRoute, ...]

    def __post_init__(self) -> None:
        ids = [route.samsar_model for route in self.routes]
        if len(ids) != len(set(ids)):
            raise CatalogConfigurationError(
                "The GenBlaze model catalog contains duplicate Samsar model ids."
            )

    @property
    def by_samsar_model(self) -> Mapping[str, ModelRoute]:
        return {route.samsar_model: route for route in self.routes}

    def resolve(
        self,
        model: object,
        *,
        modality: Modality | None = None,
    ) -> ModelRoute:
        """Resolve an exact Samsar id; upstream GMICloud ids are never aliases."""

        key = str(model).strip() if model is not None else ""
        route = self.by_samsar_model.get(key)
        if route is None or (modality is not None and route.modality != modality):
            raise UnsupportedModelError(model, modality=modality)
        return route

    def openai_model_list(self) -> dict[str, Any]:
        return {
            "object": "list",
            "data": [
                {
                    "id": route.samsar_model,
                    "object": "model",
                    "created": 0,
                    "owned_by": "gmicloud",
                    "metadata": {
                        "upstream_model": route.gmi_model,
                        "upstream_vision_model": route.gmi_vision_model,
                        "modality": route.modality,
                        "operation": route.operation,
                    },
                }
                for route in self.routes
            ],
        }


# A missing path never guesses at GMICloud model names. Production Compose
# always supplies the credential-bound catalog; the empty fallback merely lets
# the dedicated container start safely in development and older deployments.
DEFAULT_MODEL_CATALOG = ModelCatalog(routes=())
MODEL_ROUTES = DEFAULT_MODEL_CATALOG.routes


def resolve_model(
    model: object,
    *,
    modality: Modality | None = None,
    catalog: ModelCatalog = DEFAULT_MODEL_CATALOG,
) -> ModelRoute:
    """Backward-compatible helper using the development fallback catalog."""

    return catalog.resolve(model, modality=modality)


def openai_model_list(
    catalog: ModelCatalog = DEFAULT_MODEL_CATALOG,
) -> dict[str, Any]:
    return catalog.openai_model_list()


def load_model_catalog(
    path: str | None,
    *,
    gmi_api_key: str | None = None,
) -> ModelCatalog:
    """Load and validate the setup-generated model catalog.

    An absent path selects the empty development fallback above.  A configured
    path is strict: missing, malformed, wrong-provider, or unsupported mappings
    are startup errors and must not silently broaden/fall back. An empty models
    object is valid for an authenticated account with no compatible routes.
    """

    if not path:
        return DEFAULT_MODEL_CATALOG

    catalog_path = Path(path)
    try:
        raw = catalog_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise CatalogConfigurationError(
            f"Unable to read the GenBlaze model catalog at {str(catalog_path)!r}: {exc}"
        ) from exc
    try:
        document = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise CatalogConfigurationError(
            f"The GenBlaze model catalog at {str(catalog_path)!r} is not valid JSON."
        ) from exc
    if not isinstance(document, dict):
        raise CatalogConfigurationError("The GenBlaze model catalog must be a JSON object.")
    if document.get("version") != 1:
        raise CatalogConfigurationError("The GenBlaze model catalog version must be 1.")
    if document.get("provider") != "gmicloud":
        raise CatalogConfigurationError(
            "The GenBlaze model catalog provider must be 'gmicloud'."
        )
    _verify_credential_fingerprint(document, gmi_api_key)

    models = document.get("models")
    if isinstance(models, dict):
        routes = _routes_from_model_object(models)
    elif isinstance(models, list):
        routes = _routes_from_model_array(models)
    else:
        raise CatalogConfigurationError(
            "The GenBlaze model catalog models field must be an object or array."
        )
    return ModelCatalog(routes=tuple(sorted(routes, key=_route_sort_key)))


def _verify_credential_fingerprint(
    document: Mapping[str, Any],
    gmi_api_key: str | None,
) -> None:
    fingerprint = document.get("credentialFingerprint")
    if fingerprint is None:
        fingerprint = document.get("credential_fingerprint")
    if fingerprint is None:
        raise CatalogConfigurationError(
            "The GenBlaze model catalog is missing its credential fingerprint."
        )
    if not isinstance(fingerprint, str) or len(fingerprint) != 64:
        raise CatalogConfigurationError(
            "The GenBlaze model catalog credential fingerprint is invalid."
        )
    if not gmi_api_key:
        raise CatalogConfigurationError(
            "The GenBlaze model catalog cannot be credential-bound without GMI_API_KEY."
        )
    expected = hashlib.sha256(gmi_api_key.strip().encode("utf-8")).hexdigest()
    if not hmac.compare_digest(fingerprint.lower(), expected):
        raise CatalogConfigurationError(
            "The GenBlaze model catalog was validated for a different GMICloud credential."
        )


def _routes_from_model_object(models: Mapping[str, Any]) -> list[ModelRoute]:
    routes: list[ModelRoute] = []
    for samsar_model, raw_entry in models.items():
        _require_curated_model_id(samsar_model)
        if not isinstance(raw_entry, dict):
            raise CatalogConfigurationError(
                f"Catalog entry for {samsar_model!r} must be an object."
            )
        curated = CURATED_SAMSAR_MODELS[samsar_model]
        # Canonical setup schema: one object per logical modality.  A false
        # availability marker is tolerated and omitted for compatibility with
        # validation-result snapshots; generated catalogs normally omit it.
        if any(
            key in raw_entry
            for key in ("text", "vision", "image", "video", "audio")
        ):
            unexpected_modalities = set(raw_entry).intersection(
                {"text", "vision", "image", "video", "audio"}
            ) - _allowed_catalog_modalities(curated.modality)
            if unexpected_modalities:
                raise CatalogConfigurationError(
                    f"Catalog entry for {samsar_model!r} contains unsupported "
                    f"modalities: {sorted(unexpected_modalities)}."
                )
            primary_entry = raw_entry.get(curated.modality)
            if not _entry_is_enabled(primary_entry):
                # A model with only an unavailable mapping is intentionally
                # absent from the runtime catalog.
                continue
            gmi_model, operation = _parse_mapping(
                samsar_model,
                curated.modality,
                primary_entry,
                expected_operation=curated.operation,
            )
            vision_model = None
            if curated.modality == "text" and _entry_is_enabled(raw_entry.get("vision")):
                vision_model, _ = _parse_mapping(
                    samsar_model,
                    "vision",
                    raw_entry["vision"],
                    expected_operation=curated.operation,
                )
            _validate_text_vision_pair(samsar_model, gmi_model, vision_model)
            routes.append(
                ModelRoute(
                    samsar_model=samsar_model,
                    gmi_model=gmi_model,
                    modality=curated.modality,
                    operation=operation,
                    gmi_vision_model=vision_model,
                )
            )
            continue

        # Tolerate a compact flat object for manually-authored dev catalogs.
        if raw_entry.get("available") is False:
            continue
        declared_modality = raw_entry.get("modality", curated.modality)
        if declared_modality != curated.modality:
            raise CatalogConfigurationError(
                f"Catalog entry for {samsar_model!r} must use modality "
                f"{curated.modality!r}."
            )
        gmi_model, operation = _parse_mapping(
            samsar_model,
            curated.modality,
            raw_entry,
            expected_operation=curated.operation,
        )
        vision_model = _optional_string(
            raw_entry.get("visionModelId")
            or raw_entry.get("gmiVisionModel")
            or raw_entry.get("upstreamVisionModel")
        )
        if curated.modality == "text" and vision_model is not None:
            _require_curated_upstream_model_id(
                samsar_model,
                "vision",
                vision_model,
            )
        _validate_text_vision_pair(samsar_model, gmi_model, vision_model)
        routes.append(
            ModelRoute(
                samsar_model=samsar_model,
                gmi_model=gmi_model,
                modality=curated.modality,
                operation=operation,
                gmi_vision_model=vision_model,
            )
        )
    return routes


def _routes_from_model_array(models: list[Any]) -> list[ModelRoute]:
    grouped: dict[str, dict[str, dict[str, Any]]] = {}
    for index, entry in enumerate(models):
        if not isinstance(entry, dict):
            raise CatalogConfigurationError(
                f"Catalog models[{index}] must be an object."
            )
        samsar_model = _optional_string(
            entry.get("samsarModel")
            or entry.get("samsar_model")
            or entry.get("id")
        )
        _require_curated_model_id(samsar_model)
        curated = CURATED_SAMSAR_MODELS[samsar_model]
        modality = _optional_string(entry.get("modality")) or curated.modality
        if modality == "vision" and curated.modality == "text":
            pass
        elif modality != curated.modality:
            raise CatalogConfigurationError(
                f"Catalog entry for {samsar_model!r} cannot use modality {modality!r}."
            )
        model_entries = grouped.setdefault(samsar_model, {})
        if modality in model_entries:
            raise CatalogConfigurationError(
                f"Catalog contains duplicate {modality!r} mappings for "
                f"{samsar_model!r}."
            )
        model_entries[modality] = entry
    return _routes_from_model_object(grouped)


def _parse_mapping(
    samsar_model: str,
    modality: str,
    entry: Any,
    *,
    expected_operation: str,
) -> tuple[str, str]:
    if not isinstance(entry, dict):
        raise CatalogConfigurationError(
            f"Catalog {modality} mapping for {samsar_model!r} must be an object."
        )
    model_id = _optional_string(
        entry.get("modelId")
        or entry.get("model_id")
        or entry.get("gmiModel")
        or entry.get("gmi_model")
        or entry.get("upstreamModel")
        or entry.get("upstream_model")
    )
    if not model_id:
        raise CatalogConfigurationError(
            f"Catalog {modality} mapping for {samsar_model!r} is missing modelId."
        )
    operation = _optional_string(entry.get("operation")) or expected_operation
    if operation != expected_operation:
        raise CatalogConfigurationError(
            f"Catalog {modality} mapping for {samsar_model!r} must use operation "
            f"{expected_operation!r}."
        )
    _require_curated_upstream_model_id(samsar_model, modality, model_id)
    return model_id, operation


def _entry_is_enabled(entry: Any) -> bool:
    return isinstance(entry, dict) and entry.get("available") is not False


def _allowed_catalog_modalities(modality: Modality) -> set[str]:
    return {"text", "vision"} if modality == "text" else {modality}


def _require_curated_model_id(model: object) -> None:
    if not isinstance(model, str) or model not in CURATED_SAMSAR_MODELS:
        raise CatalogConfigurationError(
            f"The GenBlaze model catalog contains unsupported Samsar model id "
            f"{str(model).strip() or '<missing>'!r}."
        )


def _require_curated_upstream_model_id(
    samsar_model: str,
    modality: str,
    model_id: str,
) -> None:
    curated = CURATED_SAMSAR_MODELS[samsar_model]
    candidates = (
        curated.vision_model_ids if modality == "vision" else curated.model_ids
    )
    if curated.modality == "text":
        matches = any(
            _chat_model_leaf(model_id) == _chat_model_leaf(candidate)
            for candidate in candidates
        )
    else:
        matches = any(model_id.casefold() == candidate.casefold() for candidate in candidates)
    if not matches:
        raise CatalogConfigurationError(
            f"Catalog {modality} mapping for {samsar_model!r} uses unsupported "
            f"GMICloud modelId {model_id!r}."
        )


def _chat_model_leaf(model_id: str) -> str:
    parts = [part for part in model_id.strip().split("/") if part]
    return parts[-1].casefold() if parts else ""


def _validate_text_vision_pair(
    samsar_model: str,
    text_model: str,
    vision_model: str | None,
) -> None:
    curated = CURATED_SAMSAR_MODELS[samsar_model]
    if curated.modality != "text" and vision_model is not None:
        raise CatalogConfigurationError(
            f"Media model {samsar_model!r} cannot declare a vision mapping."
        )
    # Every curated inference model uses its corresponding text model for vision.
    if curated.modality == "text":
        if vision_model is not None and vision_model != text_model:
            raise CatalogConfigurationError(
                f"Catalog vision mapping for {samsar_model!r} must match its text model."
            )


def _optional_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def _route_sort_key(route: ModelRoute) -> tuple[int, str]:
    modality_order = {"text": 0, "image": 1, "video": 2, "audio": 3}
    return modality_order[route.modality], route.samsar_model
