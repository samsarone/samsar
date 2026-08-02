"""Stable internal HTTP errors for upstream provider failures."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


_STATUS_BY_PROVIDER_CODE = {
    "auth_failure": 401,
    "invalid_input": 400,
    "content_policy": 422,
    "rate_limit": 429,
    "timeout": 504,
    "model_error": 502,
    "server_error": 502,
    "unknown": 502,
}


@dataclass(slots=True)
class GatewayError(Exception):
    message: str
    status_code: int = 500
    code: str = "gateway_error"
    error_type: str = "gateway_error"
    retry_after: float | None = None

    def __post_init__(self) -> None:
        Exception.__init__(self, self.message)

    def __str__(self) -> str:
        return self.message

    def body(self) -> dict[str, dict[str, Any]]:
        return {
            "error": {
                "message": self.message,
                "type": self.error_type,
                "param": None,
                "code": self.code,
            }
        }

    @classmethod
    def from_provider(cls, exc: Exception, *, secret: str | None = None) -> "GatewayError":
        raw_code = getattr(exc, "error_code", None)
        code = getattr(raw_code, "value", raw_code) or "unknown"
        code = str(code)
        message = str(exc) or "GMICloud request failed"
        if secret:
            message = message.replace(secret, "[redacted]")
        return cls(
            message=message,
            status_code=_STATUS_BY_PROVIDER_CODE.get(code, 502),
            code=code,
            error_type="provider_error",
            retry_after=getattr(exc, "retry_after", None),
        )
