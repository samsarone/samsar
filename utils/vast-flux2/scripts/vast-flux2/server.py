from __future__ import annotations

import asyncio
import hmac
import math
import os
import queue
import secrets
import threading
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from fastapi import Body, Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse


MODEL_ID = os.getenv("FLUX_MODEL_ID", "black-forest-labs/FLUX.2-klein-4B")
AUTH_HEADER = os.getenv("FLUX_API_HEADER", "Authorization")
AUTH_VALUE = os.getenv("FLUX_API_HEADER_VALUE", "")
OUTPUT_DIR = Path(os.getenv("FLUX_OUTPUT_DIR", "/workspace/flux2-api/outputs"))
JOB_TTL_SECONDS = int(os.getenv("FLUX_JOB_TTL_SECONDS", "86400"))
MAX_WIDTH = int(os.getenv("FLUX_MAX_WIDTH", "2048"))
MAX_HEIGHT = int(os.getenv("FLUX_MAX_HEIGHT", "2048"))
MAX_PIXELS = int(os.getenv("FLUX_MAX_PIXELS", "2097152"))
MAX_PENDING_JOBS = int(os.getenv("FLUX_MAX_PENDING_JOBS", "16"))
MAX_PROMPT_CHARS = int(os.getenv("FLUX_MAX_PROMPT_CHARS", "8000"))

PIPELINE: Any = None
PIPELINE_READY_AT: float | None = None
STOP_EVENT = threading.Event()
JOB_QUEUE: queue.Queue[str | None] = queue.Queue()
JOBS_LOCK = threading.RLock()


@dataclass
class Job:
    request_id: str
    payload: dict[str, Any]
    status: str = "IN_QUEUE"
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    started_at: float | None = None
    completed_at: float | None = None
    error: str | None = None
    output_files: list[str] = field(default_factory=list)
    download_token: str = field(default_factory=lambda: secrets.token_urlsafe(32))


JOBS: dict[str, Job] = {}


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def _require_auth(request: Request) -> None:
    if not AUTH_VALUE:
        raise HTTPException(status_code=503, detail="API authentication is not configured")
    supplied = request.headers.get(AUTH_HEADER, "")
    if not hmac.compare_digest(supplied, AUTH_VALUE):
        raise HTTPException(
            status_code=401,
            detail="Invalid API credential",
            headers={"WWW-Authenticate": "Bearer"},
        )


def _clamp_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(maximum, parsed))


def _clamp_float(value: Any, default: float, minimum: float, maximum: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(maximum, parsed))


def _normalize_dimension(value: int, maximum: int) -> int:
    return max(256, min(maximum, int(round(value / 16.0)) * 16))


def _resolve_dimensions(payload: dict[str, Any]) -> tuple[int, int]:
    width = 1024
    height = 1024
    image_size = payload.get("image_size") or payload.get("size")

    if isinstance(image_size, dict):
        width = _clamp_int(image_size.get("width"), width, 256, MAX_WIDTH)
        height = _clamp_int(image_size.get("height"), height, 256, MAX_HEIGHT)
    elif isinstance(image_size, str) and "x" in image_size.lower():
        left, right = image_size.lower().split("x", 1)
        width = _clamp_int(left, width, 256, MAX_WIDTH)
        height = _clamp_int(right, height, 256, MAX_HEIGHT)
    else:
        aspect_ratio = str(payload.get("aspect_ratio") or "").strip()
        ratios = {
            "16:9": (1344, 768),
            "9:16": (768, 1344),
            "4:3": (1152, 864),
            "3:4": (864, 1152),
            "1:1": (1024, 1024),
        }
        width, height = ratios.get(aspect_ratio, (width, height))

    width = _normalize_dimension(width, MAX_WIDTH)
    height = _normalize_dimension(height, MAX_HEIGHT)
    pixels = width * height
    if pixels > MAX_PIXELS:
        scale = math.sqrt(MAX_PIXELS / pixels)
        width = _normalize_dimension(int(width * scale), MAX_WIDTH)
        height = _normalize_dimension(int(height * scale), MAX_HEIGHT)
    return width, height


def _load_pipeline() -> Any:
    global PIPELINE_READY_AT

    import torch
    from diffusers import Flux2KleinPipeline

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is not available; a supported NVIDIA GPU is required")

    token = os.getenv("HF_TOKEN") or None
    pipeline = Flux2KleinPipeline.from_pretrained(
        MODEL_ID,
        torch_dtype=torch.bfloat16,
        token=token,
    )
    if _truthy(os.getenv("FLUX_CPU_OFFLOAD")):
        pipeline.enable_model_cpu_offload()
    else:
        pipeline.to("cuda")
    pipeline.set_progress_bar_config(disable=True)
    PIPELINE_READY_AT = time.time()
    return pipeline


def _cleanup_expired_jobs() -> None:
    cutoff = time.time() - JOB_TTL_SECONDS
    expired: list[Job] = []
    with JOBS_LOCK:
        for request_id, job in list(JOBS.items()):
            if job.updated_at < cutoff and job.status in {"COMPLETED", "FAILED"}:
                expired.append(JOBS.pop(request_id))
    for job in expired:
        for output_file in job.output_files:
            path = Path(output_file)
            if path.parent == OUTPUT_DIR and path.is_file():
                path.unlink(missing_ok=True)


def _run_job(job: Job) -> None:
    import torch

    payload = job.payload
    prompt = str(payload.get("prompt") or "").strip()
    width, height = _resolve_dimensions(payload)
    steps = _clamp_int(payload.get("num_inference_steps"), 4, 1, 50)
    guidance = _clamp_float(payload.get("guidance_scale"), 1.0, 0.0, 20.0)
    image_count = _clamp_int(payload.get("num_images"), 1, 1, 4)
    seed = _clamp_int(payload.get("seed"), secrets.randbits(31), 0, 2**31 - 1)
    generator = torch.Generator(device="cuda").manual_seed(seed)

    result = PIPELINE(
        prompt=prompt,
        width=width,
        height=height,
        num_inference_steps=steps,
        guidance_scale=guidance,
        num_images_per_prompt=image_count,
        generator=generator,
    )

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_files: list[str] = []
    for index, image in enumerate(result.images):
        output_path = OUTPUT_DIR / f"{job.request_id}-{index}.png"
        image.save(output_path, format="PNG")
        output_files.append(str(output_path))

    with JOBS_LOCK:
        job.output_files = output_files
        job.status = "COMPLETED"
        job.completed_at = time.time()
        job.updated_at = job.completed_at


def _worker() -> None:
    while not STOP_EVENT.is_set():
        request_id = JOB_QUEUE.get()
        if request_id is None:
            JOB_QUEUE.task_done()
            break

        with JOBS_LOCK:
            job = JOBS.get(request_id)
            if job is not None:
                job.status = "IN_PROGRESS"
                job.started_at = time.time()
                job.updated_at = job.started_at

        if job is None:
            JOB_QUEUE.task_done()
            continue

        try:
            _run_job(job)
        except Exception as exc:  # The failure is returned through the polling API.
            with JOBS_LOCK:
                job.status = "FAILED"
                job.error = f"{type(exc).__name__}: {exc}"
                job.completed_at = time.time()
                job.updated_at = job.completed_at
        finally:
            try:
                import torch

                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception:
                pass
            JOB_QUEUE.task_done()
            _cleanup_expired_jobs()


@asynccontextmanager
async def _lifespan(_: FastAPI):
    global PIPELINE
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    PIPELINE = await asyncio.to_thread(_load_pipeline)
    worker = threading.Thread(target=_worker, name="flux2-worker", daemon=True)
    worker.start()
    try:
        yield
    finally:
        STOP_EVENT.set()
        JOB_QUEUE.put(None)
        worker.join(timeout=10)


app = FastAPI(title="Samsar FLUX.2 API", version="1.0.0", lifespan=_lifespan)


def _external_url(request: Request, route_name: str, **path_params: Any) -> str:
    path = request.app.url_path_for(route_name, **path_params)
    scheme = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    return f"{scheme}://{host}{path}"


def _get_job(request_id: str) -> Job:
    with JOBS_LOCK:
        job = JOBS.get(request_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown request_id")
    return job


@app.get("/health", name="health")
def health() -> dict[str, Any]:
    import torch

    return {
        "status": "ready",
        "model": MODEL_ID,
        "pipeline_ready_at": PIPELINE_READY_AT,
        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "queued_jobs": JOB_QUEUE.qsize(),
    }


@app.post("/generate", name="generate")
def generate(
    request: Request,
    body: dict[str, Any] = Body(...),
    _: None = Depends(_require_auth),
) -> JSONResponse:
    payload = body.get("input", body)
    if not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail="input must be an object")
    prompt = str(payload.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(status_code=422, detail="input.prompt is required")
    if len(prompt) > MAX_PROMPT_CHARS:
        raise HTTPException(
            status_code=422,
            detail=f"input.prompt cannot exceed {MAX_PROMPT_CHARS} characters",
        )
    if JOB_QUEUE.qsize() >= MAX_PENDING_JOBS:
        raise HTTPException(status_code=429, detail="The generation queue is full; retry shortly")

    _cleanup_expired_jobs()
    request_id = uuid.uuid4().hex
    job = Job(request_id=request_id, payload=dict(payload))
    with JOBS_LOCK:
        JOBS[request_id] = job
    JOB_QUEUE.put(request_id)

    return JSONResponse(
        status_code=202,
        content={
            "request_id": request_id,
            "status": job.status,
            "status_url": _external_url(request, "status", request_id=request_id),
            "result_url": _external_url(request, "result", request_id=request_id),
        },
    )


@app.get("/generate/{request_id}/status", name="status")
def status(request_id: str, _: None = Depends(_require_auth)) -> dict[str, Any]:
    job = _get_job(request_id)
    with JOBS_LOCK:
        return {
            "request_id": job.request_id,
            "status": job.status,
            "created_at": job.created_at,
            "started_at": job.started_at,
            "completed_at": job.completed_at,
            "error": job.error if job.status == "FAILED" else None,
        }


@app.get("/generate/{request_id}/result", name="result")
def result(
    request: Request,
    request_id: str,
    _: None = Depends(_require_auth),
) -> JSONResponse:
    job = _get_job(request_id)
    with JOBS_LOCK:
        if job.status == "FAILED":
            return JSONResponse(
                status_code=422,
                content={"request_id": job.request_id, "status": job.status, "error": job.error},
            )
        if job.status != "COMPLETED":
            return JSONResponse(
                status_code=202,
                content={"request_id": job.request_id, "status": job.status},
            )
        token = job.download_token
        output_files = list(job.output_files)

    images = []
    for index, _output_file in enumerate(output_files):
        base_url = _external_url(request, "image", request_id=request_id, image_index=str(index))
        images.append({"url": f"{base_url}?{urlencode({'token': token})}"})
    return JSONResponse(
        content={
            "request_id": job.request_id,
            "status": job.status,
            "image": images[0] if images else None,
            "images": images,
        }
    )


@app.get("/generate/{request_id}/image/{image_index}", name="image")
def image(request_id: str, image_index: int, token: str) -> FileResponse:
    job = _get_job(request_id)
    with JOBS_LOCK:
        if not hmac.compare_digest(token, job.download_token):
            raise HTTPException(status_code=401, detail="Invalid download token")
        if job.status != "COMPLETED" or image_index < 0 or image_index >= len(job.output_files):
            raise HTTPException(status_code=404, detail="Image is not available")
        output_path = Path(job.output_files[image_index])

    if output_path.parent != OUTPUT_DIR or not output_path.is_file():
        raise HTTPException(status_code=404, detail="Image is not available")
    return FileResponse(output_path, media_type="image/png", filename=output_path.name)
