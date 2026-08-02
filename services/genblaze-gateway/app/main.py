"""Internal HTTP surface for Samsar's GenBlaze container."""

from __future__ import annotations

import math
from contextlib import asynccontextmanager
from typing import Any, Callable

from fastapi import Body, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .config import Settings
from .errors import GatewayError
from .runtime import GatewayRuntime


RuntimeFactory = Callable[[Settings], GatewayRuntime]


def create_app(
    *,
    settings: Settings | None = None,
    runtime_factory: RuntimeFactory = GatewayRuntime,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI):
        runtime_settings = settings or Settings.from_env()
        runtime = runtime_factory(runtime_settings)
        application.state.runtime = runtime
        try:
            yield
        finally:
            close = getattr(runtime, "close", None)
            if callable(close):
                await close()

    application = FastAPI(
        title="Samsar GenBlaze Gateway",
        version="1.0.0",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )

    @application.exception_handler(GatewayError)
    async def handle_gateway_error(_: Request, exc: GatewayError) -> JSONResponse:
        headers = None
        if exc.retry_after is not None:
            headers = {"Retry-After": str(max(0, math.ceil(exc.retry_after)))}
        return JSONResponse(
            status_code=exc.status_code,
            content=exc.body(),
            headers=headers,
        )

    @application.exception_handler(RequestValidationError)
    async def handle_validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "message": "The request body must be a JSON object.",
                    "type": "invalid_request_error",
                    "param": None,
                    "code": "invalid_request_body",
                    "details": exc.errors(),
                }
            },
        )

    def runtime_for(request: Request) -> GatewayRuntime:
        return request.app.state.runtime

    @application.get("/health/live")
    async def health_live() -> dict[str, str]:
        return {"status": "ok"}

    @application.get("/health/ready")
    async def health_ready(request: Request) -> JSONResponse:
        runtime = runtime_for(request)
        if runtime.ready:
            return JSONResponse(
                status_code=200,
                content={"status": "ready", "provider": "gmicloud"},
            )
        return JSONResponse(
            status_code=503,
            content={
                "status": "not_ready",
                "provider": "gmicloud",
                "reason": runtime.readiness_reason or "gateway initialization failed",
            },
        )

    @application.get("/v1/models")
    async def models(request: Request) -> dict[str, Any]:
        return runtime_for(request).model_list()

    @application.post("/v1/chat/completions")
    async def chat_completions(
        request: Request,
        payload: dict[str, Any] = Body(...),
    ) -> dict[str, Any]:
        return await runtime_for(request).chat_completion(payload)

    @application.post("/v1/media/requests", status_code=202)
    async def submit_media(
        request: Request,
        payload: dict[str, Any] = Body(...),
    ) -> dict[str, str]:
        return await runtime_for(request).submit_media(payload)

    @application.get("/v1/media/requests/{request_id}")
    async def poll_media(request: Request, request_id: str) -> dict[str, Any]:
        return await runtime_for(request).poll_media(request_id)

    return application


app = create_app()
