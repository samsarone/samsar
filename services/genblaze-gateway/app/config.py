"""Environment-backed gateway configuration."""

from __future__ import annotations

import os
from dataclasses import dataclass


def _optional_env(name: str) -> str | None:
    value = os.environ.get(name, "").strip()
    return value or None


def _positive_float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be a number") from exc
    if value <= 0:
        raise ValueError(f"{name} must be greater than zero")
    return value


def _positive_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc
    if value <= 0:
        raise ValueError(f"{name} must be greater than zero")
    return value


def _positive_int_with_legacy_name(
    name: str,
    legacy_name: str,
    default: int,
) -> int:
    selected_name = name if os.environ.get(name, "").strip() else legacy_name
    return _positive_int(selected_name, default)


@dataclass(frozen=True, slots=True)
class Settings:
    """Runtime settings without a secret-bearing repr."""

    gmi_api_key: str | None
    chat_base_url: str | None = None
    media_base_url: str | None = None
    upstream_timeout_seconds: float = 120.0
    job_token_secret: str | None = None
    model_catalog_path: str | None = None
    tunnel_refresh_url: str = "http://media-tunnel-controller:8081/refresh"
    media_url_max_attempts: int = 3
    tunnel_refresh_wait_seconds: float = 120.0
    media_stage_timeout_seconds: float = 600.0
    media_stage_max_bytes: int = 2 * 1024 * 1024 * 1024

    @classmethod
    def from_env(cls) -> "Settings":
        api_key = _optional_env("GMI_API_KEY")
        return cls(
            gmi_api_key=api_key,
            chat_base_url=_optional_env("GMI_CHAT_BASE_URL"),
            media_base_url=_optional_env("GMI_BASE_URL"),
            upstream_timeout_seconds=_positive_float(
                "GENBLAZE_UPSTREAM_TIMEOUT_SECONDS",
                120.0,
            ),
            # The API key is already a container-only secret and is a safe
            # default signing key. A distinct secret is useful when operators
            # want job tokens to survive GMI credential rotation.
            job_token_secret=_optional_env("GENBLAZE_JOB_TOKEN_SECRET") or api_key,
            model_catalog_path=_optional_env("GENBLAZE_MODEL_CATALOG_PATH"),
            tunnel_refresh_url=(
                _optional_env("SAMSAR_MEDIA_TUNNEL_REFRESH_URL")
                or "http://media-tunnel-controller:8081/refresh"
            ),
            media_url_max_attempts=_positive_int_with_legacy_name(
                "GENBLAZE_MEDIA_URL_MAX_ATTEMPTS",
                "GENBLAZE_VISION_URL_MAX_ATTEMPTS",
                3,
            ),
            tunnel_refresh_wait_seconds=_positive_float(
                "GENBLAZE_TUNNEL_REFRESH_WAIT_SECONDS",
                120.0,
            ),
            media_stage_timeout_seconds=_positive_float(
                "GENBLAZE_MEDIA_STAGE_TIMEOUT_SECONDS",
                600.0,
            ),
            media_stage_max_bytes=_positive_int(
                "GENBLAZE_MEDIA_STAGE_MAX_BYTES",
                2 * 1024 * 1024 * 1024,
            ),
        )

    def __repr__(self) -> str:
        key_state = "configured" if self.gmi_api_key else "missing"
        token_state = "configured" if self.job_token_secret else "missing"
        return (
            "Settings("
            f"gmi_api_key={key_state!r}, "
            f"chat_base_url={self.chat_base_url!r}, "
            f"media_base_url={self.media_base_url!r}, "
            f"upstream_timeout_seconds={self.upstream_timeout_seconds!r}, "
            f"job_token_secret={token_state!r}, "
            f"model_catalog_path={self.model_catalog_path!r}, "
            f"tunnel_refresh_url={self.tunnel_refresh_url!r}, "
            f"media_url_max_attempts={self.media_url_max_attempts!r}, "
            f"tunnel_refresh_wait_seconds={self.tunnel_refresh_wait_seconds!r}, "
            f"media_stage_timeout_seconds={self.media_stage_timeout_seconds!r}, "
            f"media_stage_max_bytes={self.media_stage_max_bytes!r}"
            ")"
        )
