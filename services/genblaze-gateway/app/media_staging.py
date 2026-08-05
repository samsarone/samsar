"""Provider-native staging for local Samsar media consumed by GMICloud."""

from __future__ import annotations

import asyncio
import mimetypes
import tempfile
from pathlib import PurePosixPath
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpx


_DEFAULT_GMI_MEDIA_BASE_URL = "https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey"
_DEFAULT_INTERNAL_MEDIA_BASE_URL = "http://media-gateway"
_DEFAULT_MAX_MEDIA_BYTES = 2 * 1024 * 1024 * 1024
_SPOOL_MEMORY_BYTES = 16 * 1024 * 1024
_STREAM_CHUNK_BYTES = 1024 * 1024
_UPLOAD_FORMATS = {
    ".jpeg": ("jpeg", "image/jpeg"),
    ".jpg": ("jpg", "image/jpeg"),
    ".mp3": ("mp3", "audio/mpeg"),
    ".mp4": ("mp4", "video/mp4"),
    ".png": ("png", "image/png"),
    ".wav": ("wav", "audio/wav"),
}


class GMICloudMediaStagingError(RuntimeError):
    """Raised when a managed Samsar asset cannot be staged in GMI storage."""


def _validated_public_url(value: Any, *, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise GMICloudMediaStagingError(f"GMICloud upload response omitted {field_name}.")
    try:
        parsed = urlsplit(value.strip())
    except ValueError as exc:
        raise GMICloudMediaStagingError(
            f"GMICloud upload response returned an invalid {field_name}."
        ) from exc
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise GMICloudMediaStagingError(
            f"GMICloud upload response returned a non-public {field_name}."
        )
    return value.strip()


def _upload_endpoint(base_url: str | None) -> str:
    configured = (base_url or _DEFAULT_GMI_MEDIA_BASE_URL).strip().rstrip("/")
    if configured.endswith("/upload-url"):
        return configured
    return f"{configured}/upload-url"


def _upload_format(media_path: str, response_content_type: str) -> tuple[str, str]:
    extension = PurePosixPath(urlsplit(media_path).path).suffix.lower()
    configured = _UPLOAD_FORMATS.get(extension)
    if configured is None:
        guessed_extension = mimetypes.guess_extension(
            response_content_type.split(";", 1)[0].strip().lower()
        )
        configured = _UPLOAD_FORMATS.get((guessed_extension or "").lower())
    if configured is None:
        raise GMICloudMediaStagingError(
            "GMICloud staging supports jpeg, jpg, png, mp4, mp3, and wav inputs only."
        )
    return configured


def _file_chunks(file_object: Any):
    while True:
        chunk = file_object.read(_STREAM_CHUNK_BYTES)
        if not chunk:
            return
        yield chunk


class GMICloudMediaStager:
    """Upload a mounted Samsar media path to GMI and return its stable public URL.

    The gateway reads the asset over the fixed internal ``media-gateway`` service,
    spools it with a bounded in-memory threshold, asks GMICloud for a signed upload
    URL, and streams the bytes to that URL. The resulting ``public_url`` is what is
    sent to GMI inference; raw bytes and data URIs never enter an inference payload.
    """

    def __init__(
        self,
        *,
        api_key: str,
        media_base_url: str | None = None,
        timeout_seconds: float = 120.0,
        max_media_bytes: int = _DEFAULT_MAX_MEDIA_BYTES,
        transport: httpx.BaseTransport | None = None,
    ):
        self._api_key = api_key
        self._upload_endpoint = _upload_endpoint(media_base_url)
        self._timeout_seconds = timeout_seconds
        self._max_media_bytes = max_media_bytes
        self._transport = transport
        self._cache: dict[str, str] = {}
        self._inflight: dict[str, asyncio.Task[str]] = {}
        self._lock = asyncio.Lock()

    async def stage(self, media_path: str) -> str:
        """Stage one safe ``/assets`` path, coalescing concurrent uploads."""
        cached = self._cache.get(media_path)
        if cached:
            return cached

        async with self._lock:
            cached = self._cache.get(media_path)
            if cached:
                return cached
            task = self._inflight.get(media_path)
            if task is None:
                task = asyncio.create_task(
                    asyncio.to_thread(self._stage_sync, media_path)
                )
                self._inflight[media_path] = task

        try:
            public_url = await asyncio.shield(task)
        finally:
            if task.done():
                async with self._lock:
                    if self._inflight.get(media_path) is task:
                        self._inflight.pop(media_path, None)

        self._cache[media_path] = public_url
        return public_url

    def _stage_sync(self, media_path: str) -> str:
        if not media_path.startswith(("/assets/", "/assets_v2/")):
            raise GMICloudMediaStagingError("Only mounted Samsar media paths can be staged.")

        internal_url = urljoin(
            _DEFAULT_INTERNAL_MEDIA_BASE_URL.rstrip("/") + "/",
            media_path.lstrip("/"),
        )
        timeout = httpx.Timeout(self._timeout_seconds, connect=min(10.0, self._timeout_seconds))
        with httpx.Client(
            timeout=timeout,
            follow_redirects=True,
            transport=self._transport,
        ) as client:
            with client.stream(
                "GET",
                internal_url,
                headers={"Accept": "image/*, video/*, audio/*, application/octet-stream"},
            ) as source:
                source.raise_for_status()
                advertised_size = source.headers.get("content-length")
                if advertised_size:
                    try:
                        if int(advertised_size) > self._max_media_bytes:
                            raise GMICloudMediaStagingError(
                                f"Managed media exceeds the {self._max_media_bytes}-byte staging limit."
                            )
                    except ValueError as exc:
                        raise GMICloudMediaStagingError(
                            "Managed media returned an invalid Content-Length."
                        ) from exc

                response_content_type = source.headers.get("content-type", "")
                file_type, content_type = _upload_format(media_path, response_content_type)
                with tempfile.SpooledTemporaryFile(max_size=_SPOOL_MEMORY_BYTES) as buffered:
                    size = 0
                    for chunk in source.iter_bytes(_STREAM_CHUNK_BYTES):
                        size += len(chunk)
                        if size > self._max_media_bytes:
                            raise GMICloudMediaStagingError(
                                f"Managed media exceeds the {self._max_media_bytes}-byte staging limit."
                            )
                        buffered.write(chunk)
                    if size == 0:
                        raise GMICloudMediaStagingError("Managed media response was empty.")

                    allocation = client.post(
                        self._upload_endpoint,
                        headers={
                            "Authorization": f"Bearer {self._api_key}",
                            "Accept": "application/json",
                        },
                        json={"file_type": file_type},
                    )
                    allocation.raise_for_status()
                    try:
                        allocation_payload = allocation.json()
                    except ValueError as exc:
                        raise GMICloudMediaStagingError(
                            "GMICloud upload allocation returned invalid JSON."
                        ) from exc
                    if not isinstance(allocation_payload, dict):
                        raise GMICloudMediaStagingError(
                            "GMICloud upload allocation returned an invalid payload."
                        )
                    upload_url = _validated_public_url(
                        allocation_payload.get("upload_url"),
                        field_name="upload_url",
                    )
                    public_url = _validated_public_url(
                        allocation_payload.get("public_url"),
                        field_name="public_url",
                    )

                    buffered.seek(0)
                    upload = client.put(
                        upload_url,
                        headers={
                            "Content-Type": content_type,
                            "Content-Length": str(size),
                        },
                        content=_file_chunks(buffered),
                    )
                    upload.raise_for_status()
                    return public_url
