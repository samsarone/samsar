from __future__ import annotations

import asyncio
import base64
import hashlib
import json
from dataclasses import replace
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient

from app.catalog import (
    CURATED_SAMSAR_MODELS,
    MODEL_ROUTES,
    CatalogConfigurationError,
    load_model_catalog,
    resolve_model,
)
from app.config import Settings
from app.main import create_app
from app.media_staging import GMICloudMediaStager
from app.runtime import (
    GatewayRuntime,
    GenBlazeBindings,
    _collect_managed_tunnel_media_urls,
    _rewrite_managed_tunnel_media_urls,
)


class FakeProviderError(Exception):
    def __init__(self, message: str, *, error_code: str = "unknown", retry_after=None):
        super().__init__(message)
        self.error_code = error_code
        self.retry_after = retry_after


class FakeModality:
    TEXT = "text"
    IMAGE = "image"
    VIDEO = "video"
    AUDIO = "audio"


class FakeAsset:
    def __init__(self, *, url: str, media_type: str):
        self.url = url
        self.media_type = media_type


class FakeStep:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)
        self.assets = []
        self.provider_payload = {}


class FakeSubmitResult:
    prediction_id = "gmi-upstream-job-123"


class FakeProvider:
    name = "fake-gmicloud"
    instances: list["FakeProvider"] = []
    asset_url = "https://cdn.example/result.png"
    asset_media_type = "image/png"

    def __init__(self, **options):
        self.options = options
        self.submitted_step = None
        self.submitted_steps = []
        self.terminal = False
        self.terminal_status = "success"
        self.terminal_error = "generation failed"
        self.closed = False
        type(self).instances.append(self)

    def submit(self, step):
        self.submitted_step = step
        self.submitted_steps.append(step)
        return FakeSubmitResult()

    def poll(self, prediction_id):
        self.polled_id = prediction_id
        return self.terminal

    def fetch_output(self, prediction_id, step):
        step.provider_payload = {
            "gmicloud": {
                "request_id": prediction_id,
                "status": self.terminal_status,
            }
        }
        if self.terminal_status in {"failed", "cancelled"}:
            raise FakeProviderError(self.terminal_error)
        step.assets.append(
            FakeAsset(
                url=self.asset_url,
                media_type=self.asset_media_type,
            )
        )
        return step

    def close(self):
        self.closed = True


class FakeImageProvider(FakeProvider):
    name = "gmicloud-image"
    instances = []


class FakeVideoProvider(FakeProvider):
    name = "gmicloud"
    instances = []


class FakeAudioProvider(FakeProvider):
    name = "gmicloud-audio"
    instances = []
    asset_url = "https://cdn.example/speech.mp3"
    asset_media_type = "audio/mpeg"


@pytest.fixture(autouse=True)
def clear_fake_instances():
    FakeImageProvider.instances.clear()
    FakeVideoProvider.instances.clear()
    FakeAudioProvider.instances.clear()


@pytest.fixture
def fake_bindings():
    chat_calls = []
    raw_response = {
        "id": "chatcmpl-123",
        "object": "chat.completion",
        "model": "Qwen/Qwen3.8-Max",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": "hello"},
                "finish_reason": "stop",
            }
        ],
    }

    async def fake_achat(model, messages, **kwargs):
        chat_calls.append({"model": model, "messages": messages, "kwargs": kwargs})
        return SimpleNamespace(raw=raw_response)

    bindings = GenBlazeBindings(
        achat=fake_achat,
        image_provider_type=FakeImageProvider,
        video_provider_type=FakeVideoProvider,
        audio_provider_type=FakeAudioProvider,
        provider_error_type=FakeProviderError,
        step_type=FakeStep,
        asset_type=FakeAsset,
        modality_type=FakeModality,
    )
    return bindings, chat_calls, raw_response


@pytest.fixture
def settings(tmp_path):
    catalog_path = write_catalog(
        tmp_path,
        {
            "QWEN3.8": {
                "text": {"modelId": "Qwen/Qwen3.8-Max"},
                "vision": {"modelId": "Qwen/Qwen3.8-Max"},
            }
        },
    )
    return Settings(
        gmi_api_key="gmi-test-key",
        upstream_timeout_seconds=15,
        job_token_secret="job-token-test-secret",
        model_catalog_path=str(catalog_path),
    )


def build_client(settings, bindings, **runtime_kwargs):
    app = create_app(
        settings=settings,
        runtime_factory=lambda configured: GatewayRuntime(
            configured,
            bindings=bindings,
            **runtime_kwargs,
        ),
    )
    return TestClient(app)


def write_catalog(tmp_path, models, *, api_key="gmi-test-key", **overrides):
    document = {
        "version": 1,
        "provider": "gmicloud",
        "credentialFingerprint": hashlib.sha256(api_key.encode("utf-8")).hexdigest(),
        "models": models,
        **overrides,
    }
    path = tmp_path / "genblaze-model-catalog.json"
    path.write_text(json.dumps(document), encoding="utf-8")
    return path


def settings_with_catalog(settings, path):
    return replace(settings, model_catalog_path=str(path))


def test_media_url_attempt_setting_prefers_generic_name_and_supports_vision_legacy_name(
    monkeypatch,
):
    monkeypatch.setenv("GENBLAZE_VISION_URL_MAX_ATTEMPTS", "4")
    assert Settings.from_env().media_url_max_attempts == 4

    monkeypatch.setenv("GENBLAZE_MEDIA_URL_MAX_ATTEMPTS", "5")
    assert Settings.from_env().media_url_max_attempts == 5

    monkeypatch.setenv("GENBLAZE_MEDIA_STAGE_TIMEOUT_SECONDS", "900")
    monkeypatch.setenv("GENBLAZE_MEDIA_STAGE_MAX_BYTES", "4294967296")
    configured = Settings.from_env()
    assert configured.media_stage_timeout_seconds == 900
    assert configured.media_stage_max_bytes == 4 * 1024 * 1024 * 1024


def test_development_fallback_is_empty_and_never_guesses_upstream_models():
    assert MODEL_ROUTES == ()
    with pytest.raises(ValueError, match="not available"):
        resolve_model("QWEN3.8")
    with pytest.raises(ValueError, match="not available"):
        resolve_model("Qwen/Qwen3.8-Max")


def test_curated_boundary_contains_only_supported_samsar_contracts():
    assert set(CURATED_SAMSAR_MODELS) == {
        "gpt-5.6-sol",
        "gemini-3.1-pro",
        "QWEN3.8",
        "GPTIMAGE2",
        "GPTIMAGE2EDIT",
        "SEEDREAM",
        "NANOBANANA2",
        "NANOBANANA2EDIT",
        "NANOBANANAPRO",
        "NANOBANANAPROEDIT",
        "BRIA_ERASER",
        "BRIA_GENFILL",
        "VEO3.1",
        "VEO3.1FAST",
        "VEO3.1I2V",
        "VEO3.1I2VFAST",
        "VEO3.1FLIV",
        "SEEDANCEI2V",
        "SEEDANCE2.0I2V",
        "KLINGIMGTOVID3PRO",
        "KLINGIMGTOVIDTURBO",
        "KLINGIMGTOVIDPRO",
        "KLINGIMGTOVID2.1MASTER",
        "KLINGIMGTOVID2.1PRO",
        "KLINGIMGTOVID2.1STANDARD",
        "HAILUOPRO",
        "HAPPYHORSEI2V",
        "ELEVENLABS",
        "OPENAI_TTS",
    }


def test_live_ready_and_models_contract(settings, fake_bindings):
    bindings, _, _ = fake_bindings
    with build_client(settings, bindings) as client:
        assert client.get("/health/live").json() == {"status": "ok"}
        assert client.get("/health/ready").json() == {
            "status": "ready",
            "provider": "gmicloud",
        }
        models = client.get("/v1/models").json()
        assert [item["id"] for item in models["data"]] == ["QWEN3.8"]
        assert models["data"][0]["metadata"]["upstream_model"] == "Qwen/Qwen3.8-Max"
        assert (
            models["data"][0]["metadata"]["upstream_vision_model"]
            == "Qwen/Qwen3.8-Max"
        )


def test_runtime_models_reflect_only_credential_catalog_routes(
    settings,
    fake_bindings,
    tmp_path,
):
    path = write_catalog(
        tmp_path,
        {
            "gpt-5.6-sol": {
                "text": {"modelId": "openai/gpt-5.6-sol", "operation": "chat.completions"},
                "vision": {"modelId": "openai/gpt-5.6-sol", "operation": "chat.completions"},
            },
            "GPTIMAGE2": {
                "image": {"modelId": "gpt-image-2-generate", "operation": "image.generate"}
            },
            "VEO3.1I2V": {
                "video": {"modelId": "veo-3.1-generate-001", "operation": "video.generate"}
            },
            "SEEDANCE2.0I2V": {
                "video": {"modelId": "seedance-2-0-260128", "operation": "video.generate"}
            },
            "ELEVENLABS": {
                "audio": {
                    "modelId": "elevenlabs-tts-multilingual-v2",
                    "operation": "audio.generate",
                }
            },
        },
    )
    bindings, _, _ = fake_bindings
    with build_client(settings_with_catalog(settings, path), bindings) as client:
        models = client.get("/v1/models").json()["data"]

    assert [model["id"] for model in models] == [
        "gpt-5.6-sol",
        "GPTIMAGE2",
        "SEEDANCE2.0I2V",
        "VEO3.1I2V",
        "ELEVENLABS",
    ]
    assert models[0]["metadata"] == {
        "upstream_model": "openai/gpt-5.6-sol",
        "upstream_vision_model": "openai/gpt-5.6-sol",
        "modality": "text",
        "operation": "chat.completions",
    }


def test_empty_credential_catalog_is_ready_and_advertises_no_models(
    settings,
    fake_bindings,
    tmp_path,
):
    path = write_catalog(tmp_path, {})
    bindings, calls, _ = fake_bindings
    with build_client(settings_with_catalog(settings, path), bindings) as client:
        assert client.get("/health/ready").json() == {
            "status": "ready",
            "provider": "gmicloud",
        }
        assert client.get("/v1/models").json() == {"object": "list", "data": []}
        response = client.post(
            "/v1/chat/completions",
            json={"model": "QWEN3.8", "messages": []},
        )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "GENBLAZE_MODEL_UNSUPPORTED"
    assert calls == []


def test_missing_key_is_live_but_not_ready_without_importing_genblaze(monkeypatch):
    def should_not_import():
        raise AssertionError("GenBlaze imports should stay lazy without credentials")

    monkeypatch.setattr("app.runtime.load_genblaze_bindings", should_not_import)
    missing = Settings(gmi_api_key=None)
    app = create_app(settings=missing)
    with TestClient(app) as client:
        assert client.get("/health/live").status_code == 200
        response = client.get("/health/ready")
        assert response.status_code == 503
        assert response.json()["reason"] == "GMI_API_KEY is not configured"


def test_configured_missing_catalog_is_not_ready(settings, fake_bindings, tmp_path):
    bindings, _, _ = fake_bindings
    configured = replace(
        settings,
        model_catalog_path=str(tmp_path / "does-not-exist.json"),
    )
    with build_client(configured, bindings) as client:
        ready = client.get("/health/ready")
        models = client.get("/v1/models")

    assert ready.status_code == 503
    assert "Unable to read" in ready.json()["reason"]
    assert models.status_code == 503
    assert models.json()["error"]["code"] == "gateway_not_ready"
    assert FakeImageProvider.instances == []
    assert FakeVideoProvider.instances == []
    assert FakeAudioProvider.instances == []


def test_catalog_must_match_the_configured_credential(
    settings,
    fake_bindings,
    tmp_path,
):
    path = write_catalog(
        tmp_path,
        {"QWEN3.8": {"text": {"modelId": "Qwen/Qwen3.8-Max"}}},
        api_key="some-other-key",
    )
    bindings, _, _ = fake_bindings
    with build_client(settings_with_catalog(settings, path), bindings) as client:
        response = client.get("/health/ready")

    assert response.status_code == 503
    assert "different GMICloud credential" in response.json()["reason"]


def test_catalog_rejects_unknown_samsar_ids_and_unverified_upstream_models(tmp_path):
    unknown_path = write_catalog(
        tmp_path,
        {"UNSUPPORTED": {"image": {"modelId": "some-upstream-model"}}},
    )
    with pytest.raises(CatalogConfigurationError, match="unsupported Samsar model id"):
        load_model_catalog(str(unknown_path), gmi_api_key="gmi-test-key")

    mismatch_path = write_catalog(
        tmp_path,
        {
            "gpt-5.6-sol": {
                "text": {"modelId": "gpt-5.6-sol"},
                "vision": {"modelId": "different-vision-model"},
            }
        },
    )
    with pytest.raises(CatalogConfigurationError, match="unsupported GMICloud modelId"):
        load_model_catalog(str(mismatch_path), gmi_api_key="gmi-test-key")

    media_path = write_catalog(
        tmp_path,
        {
            "GPTIMAGE2": {
                "image": {"modelId": "some-other-image-model"},
            }
        },
    )
    with pytest.raises(CatalogConfigurationError, match="unsupported GMICloud modelId"):
        load_model_catalog(str(media_path), gmi_api_key="gmi-test-key")


def test_catalog_rejects_split_qwen_text_and_vision_routes(tmp_path):
    path = write_catalog(
        tmp_path,
        {
            "QWEN3.8": {
                "text": {"modelId": "Qwen/Qwen3.8-Max"},
                "vision": {"modelId": "tenant/Qwen3.8-Max"},
            }
        },
    )

    with pytest.raises(CatalogConfigurationError, match="must match its text model"):
        load_model_catalog(str(path), gmi_api_key="gmi-test-key")


def test_catalog_accepts_only_the_distinct_kling_turbo_upstream_slug(tmp_path):
    assert CURATED_SAMSAR_MODELS["KLINGIMGTOVIDTURBO"].model_ids == (
        "kling-3.0-turbo-i2v",
    )
    current_path = write_catalog(
        tmp_path,
        {
            "KLINGIMGTOVIDTURBO": {
                "video": {
                    "modelId": "kling-3.0-turbo-i2v",
                    "operation": "video.generate",
                }
            }
        },
    )
    route = load_model_catalog(
        str(current_path),
        gmi_api_key="gmi-test-key",
    ).resolve("KLINGIMGTOVIDTURBO", modality="video")
    assert route.gmi_model == "kling-3.0-turbo-i2v"

    legacy_path = write_catalog(
        tmp_path,
        {
            "KLINGIMGTOVIDTURBO": {
                "video": {
                    "modelId": "kling-v3-image-to-video",
                    "operation": "video.generate",
                }
            }
        },
    )
    with pytest.raises(CatalogConfigurationError, match="unsupported GMICloud modelId"):
        load_model_catalog(str(legacy_path), gmi_api_key="gmi-test-key")


@pytest.mark.parametrize(
    ("samsar_model", "upstream_model"),
    [
        ("ELEVENLABS", "elevenlabs-tts-multilingual-v2"),
        ("ELEVENLABS", "elevenlabs-tts-v3"),
        ("OPENAI_TTS", "gpt-4o-mini-tts"),
    ],
)
def test_catalog_accepts_only_exact_credential_discovered_speech_routes(
    tmp_path,
    samsar_model,
    upstream_model,
):
    path = write_catalog(
        tmp_path,
        {
            samsar_model: {
                "audio": {
                    "modelId": upstream_model,
                    "operation": "audio.generate",
                }
            }
        },
    )

    catalog = load_model_catalog(str(path), gmi_api_key="gmi-test-key")

    assert catalog.routes == (
        catalog.resolve(samsar_model, modality="audio"),
    )
    route = catalog.routes[0]
    assert route.gmi_model == upstream_model
    assert route.operation == "audio.generate"


@pytest.mark.parametrize(
    ("samsar_model", "upstream_model"),
    [
        ("ELEVENLABS", "gpt-4o-mini-tts"),
        ("OPENAI_TTS", "elevenlabs-tts-v3"),
    ],
)
def test_catalog_rejects_cross_provider_or_approximate_speech_mappings(
    tmp_path,
    samsar_model,
    upstream_model,
):
    path = write_catalog(
        tmp_path,
        {samsar_model: {"audio": {"modelId": upstream_model}}},
    )

    with pytest.raises(CatalogConfigurationError, match="unsupported GMICloud modelId"):
        load_model_catalog(str(path), gmi_api_key="gmi-test-key")


def test_catalog_rejects_wrong_speech_operation(tmp_path):
    path = write_catalog(
        tmp_path,
        {
            "ELEVENLABS": {
                "audio": {
                    "modelId": "elevenlabs-tts-v3",
                    "operation": "audio.speech",
                }
            }
        },
    )

    with pytest.raises(CatalogConfigurationError, match="audio.generate"):
        load_model_catalog(str(path), gmi_api_key="gmi-test-key")


def test_chat_maps_model_and_returns_genblaze_raw_unchanged(settings, fake_bindings):
    bindings, calls, raw_response = fake_bindings
    request_body = {
        "model": "QWEN3.8",
        "messages": [{"role": "user", "content": "hello"}],
        "temperature": 0.25,
    }
    with build_client(settings, bindings) as client:
        response = client.post("/v1/chat/completions", json=request_body)

    assert response.status_code == 200
    assert response.json() == raw_response
    assert calls == [
        {
            "model": "Qwen/Qwen3.8-Max",
            "messages": request_body["messages"],
            "kwargs": {
                "temperature": 0.25,
                "api_key": "gmi-test-key",
                "timeout": 15,
            },
        }
    ]


@pytest.mark.parametrize(
    ("samsar_model", "upstream_model"),
    [
        ("gpt-5.6-sol", "openai/gpt-5.6-sol"),
        ("gemini-3.1-pro", "google/gemini-3.1-pro-preview"),
    ],
)
def test_high_reasoning_and_corresponding_vision_model_are_preserved(
    settings,
    fake_bindings,
    tmp_path,
    samsar_model,
    upstream_model,
):
    path = write_catalog(
        tmp_path,
        {
            samsar_model: {
                "text": {"modelId": upstream_model, "operation": "chat.completions"},
                "vision": {"modelId": upstream_model, "operation": "chat.completions"},
            }
        },
    )
    bindings, calls, _ = fake_bindings
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "reason carefully"},
                {"type": "image_url", "image_url": {"url": "https://example/frame.png"}},
            ],
        }
    ]
    with build_client(settings_with_catalog(settings, path), bindings) as client:
        response = client.post(
            "/v1/chat/completions",
            json={
                "model": samsar_model,
                "messages": messages,
                "reasoning": {"effort": "low"},
                "reasoning_effort": "high",
                "max_completion_tokens": 512,
            },
        )

    assert response.status_code == 200
    assert calls[0]["model"] == upstream_model
    assert calls[0]["messages"] == messages
    assert "reasoning" not in calls[0]["kwargs"]
    assert calls[0]["kwargs"]["reasoning_effort"] == "high"
    assert "max_tokens" not in calls[0]["kwargs"]
    assert "max_completion_tokens" not in calls[0]["kwargs"]
    assert "max_output_tokens" not in calls[0]["kwargs"]


def test_gmicloud_vision_rotates_public_tunnel_url_after_each_download_failure(
    settings,
    fake_bindings,
):
    bindings, _, raw_response = fake_bindings
    calls = []
    refreshed_urls = iter(
        (
            "https://second.trycloudflare.com/assets_v2/generations/session/frame.png",
            "https://third.trycloudflare.com/assets_v2/generations/session/frame.png",
        )
    )

    async def fail_two_downloads(model, messages, **kwargs):
        calls.append({"model": model, "messages": messages, "kwargs": kwargs})
        if len(calls) == 1:
            raise FakeProviderError(
                "Unable to download content from the provided URL before the timeout. "
                "Check that the URL is publicly accessible and responds promptly."
            )
        if len(calls) == 2:
            raise FakeProviderError(
                'Provider API error: Timeout while downloading '
                '(code="invalid_image_url")'
            )
        return SimpleNamespace(raw=raw_response)

    async def rotate_public_url(messages, attempted_urls, retry_number):
        assert retry_number in {1, 2}
        assert len(attempted_urls) == retry_number
        refreshed = json.loads(json.dumps(messages))
        refreshed[0]["content"][1]["image_url"]["url"] = next(refreshed_urls)
        return refreshed

    bindings = replace(bindings, achat=fail_two_downloads)
    configured = replace(settings, media_url_max_attempts=3)
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "describe"},
                {
                    "type": "image_url",
                    "image_url": {
                        "url": (
                            "https://first.trycloudflare.com/assets_v2/"
                            "generations/session/frame.png"
                        )
                    },
                },
            ],
        }
    ]

    with build_client(
        configured,
        bindings,
        tunnel_url_refresher=rotate_public_url,
    ) as client:
        response = client.post(
            "/v1/chat/completions",
            json={
                "model": "QWEN3.8",
                "messages": messages,
                "max_tokens": 512,
                "max_completion_tokens": 512,
            },
        )

    assert response.status_code == 200
    assert response.json() == raw_response
    assert [
        call["messages"][0]["content"][1]["image_url"]["url"]
        for call in calls
    ] == [
        "https://first.trycloudflare.com/assets_v2/generations/session/frame.png",
        "https://second.trycloudflare.com/assets_v2/generations/session/frame.png",
        "https://third.trycloudflare.com/assets_v2/generations/session/frame.png",
    ]
    for call in calls:
        assert call["messages"][0]["content"][1]["image_url"]["url"].startswith("https://")
        assert "max_tokens" not in call["kwargs"]
        assert "max_completion_tokens" not in call["kwargs"]
        assert "max_output_tokens" not in call["kwargs"]


def test_gmicloud_media_stager_buffers_internal_asset_and_returns_public_url():
    media_bytes = b"\x89PNG\r\n\x1a\nprovider-media"
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = request.read()
        requests.append((request.method, str(request.url), dict(request.headers), body))
        if request.method == "GET":
            assert str(request.url) == (
                "http://media-gateway/assets_v2/generations/session/frame.png"
            )
            return httpx.Response(
                200,
                headers={"Content-Type": "image/png"},
                content=media_bytes,
            )
        if request.method == "POST":
            assert str(request.url).endswith("/apikey/upload-url")
            assert request.headers["authorization"] == "Bearer gmi-test-key"
            assert json.loads(body) == {"file_type": "png"}
            return httpx.Response(
                200,
                json={
                    "upload_url": "https://storage.googleapis.com/upload/signed.png?token=1",
                    "public_url": "https://storage.googleapis.com/gmi-public/frame.png",
                },
            )
        assert request.method == "PUT"
        assert str(request.url) == "https://storage.googleapis.com/upload/signed.png?token=1"
        assert request.headers["content-type"] == "image/png"
        assert request.headers["content-length"] == str(len(media_bytes))
        assert body == media_bytes
        return httpx.Response(200)

    stager = GMICloudMediaStager(
        api_key="gmi-test-key",
        timeout_seconds=5,
        transport=httpx.MockTransport(handler),
    )

    async def stage_twice():
        first = await stager.stage("/assets_v2/generations/session/frame.png")
        second = await stager.stage("/assets_v2/generations/session/frame.png")
        return first, second

    first, second = asyncio.run(stage_twice())
    assert first == "https://storage.googleapis.com/gmi-public/frame.png"
    assert second == first
    assert [method for method, *_ in requests] == ["GET", "POST", "PUT"]


def test_gmicloud_media_stager_spools_and_streams_mp4_inputs(monkeypatch):
    import app.media_staging as media_staging

    monkeypatch.setattr(media_staging, "_SPOOL_MEMORY_BYTES", 8)
    media_bytes = b"video-input" * 64
    uploaded_bodies = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = request.read()
        if request.method == "GET":
            assert str(request.url).endswith("/assets_v2/video/source.mp4")
            return httpx.Response(
                200,
                headers={"Content-Type": "video/mp4"},
                content=media_bytes,
            )
        if request.method == "POST":
            assert json.loads(body) == {"file_type": "mp4"}
            return httpx.Response(
                200,
                json={
                    "upload_url": "https://storage.googleapis.com/upload/signed.mp4",
                    "public_url": "https://storage.googleapis.com/gmi-public/source.mp4",
                },
            )
        assert request.headers["content-type"] == "video/mp4"
        assert request.headers["content-length"] == str(len(media_bytes))
        uploaded_bodies.append(body)
        return httpx.Response(200)

    stager = GMICloudMediaStager(
        api_key="gmi-test-key",
        timeout_seconds=5,
        transport=httpx.MockTransport(handler),
    )
    public_url = asyncio.run(stager.stage("/assets_v2/video/source.mp4"))

    assert public_url == "https://storage.googleapis.com/gmi-public/source.mp4"
    assert uploaded_bodies == [media_bytes]


def test_gmicloud_vision_stages_tunnel_image_after_remote_download_failure(
    settings,
    fake_bindings,
):
    bindings, _, raw_response = fake_bindings
    calls = []
    staging_calls = []
    public_url = "https://storage.googleapis.com/gmi-public/frame.png"

    async def fail_first_download(model, messages, **kwargs):
        calls.append({"model": model, "messages": messages, "kwargs": kwargs})
        if len(calls) == 1:
            raise FakeProviderError(
                "Unable to download content from the provided URL before the timeout."
            )
        return SimpleNamespace(raw=raw_response)

    async def stage_public_url(messages):
        staging_calls.append(messages)
        staged = json.loads(json.dumps(messages))
        staged[0]["content"][1]["image_url"]["url"] = public_url
        return staged

    bindings = replace(bindings, achat=fail_first_download)
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "describe"},
                {
                    "type": "image_url",
                    "image_url": {
                        "url": (
                            "https://first.trycloudflare.com/assets_v2/"
                            "generations/session/frame.png"
                        )
                    },
                },
            ],
        }
    ]

    with build_client(
        settings,
        bindings,
        media_url_stager=stage_public_url,
    ) as client:
        response = client.post(
            "/v1/chat/completions",
            json={
                "model": "QWEN3.8",
                "messages": messages,
                "max_tokens": 512,
            },
        )

    assert response.status_code == 200
    assert response.json() == raw_response
    assert len(staging_calls) == 1
    assert [
        call["messages"][0]["content"][1]["image_url"]["url"]
        for call in calls
    ] == [
        "https://first.trycloudflare.com/assets_v2/generations/session/frame.png",
        public_url,
    ]
    assert all("max_tokens" not in call["kwargs"] for call in calls)


def test_gmicloud_vision_rotates_tunnel_when_byte_staging_fails(
    settings,
    fake_bindings,
):
    bindings, _, raw_response = fake_bindings
    calls = []
    recovery_calls = []

    async def fail_first_download(model, messages, **kwargs):
        calls.append(messages[0]["content"][1]["image_url"]["url"])
        if len(calls) == 1:
            raise FakeProviderError("Timeout while downloading image")
        return SimpleNamespace(raw=raw_response)

    async def fail_staging(_messages):
        recovery_calls.append("stage")
        raise OSError("GMI upload allocation unavailable")

    async def rotate_public_url(messages, attempted_urls, retry_number):
        recovery_calls.append("rotate")
        assert attempted_urls
        assert retry_number == 1
        refreshed = json.loads(json.dumps(messages))
        refreshed[0]["content"][1]["image_url"]["url"] = (
            "https://second.trycloudflare.com/assets_v2/generations/session/frame.png"
        )
        return refreshed

    bindings = replace(bindings, achat=fail_first_download)
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "describe"},
                {
                    "type": "image_url",
                    "image_url": {
                        "url": (
                            "https://first.trycloudflare.com/assets_v2/"
                            "generations/session/frame.png"
                        )
                    },
                },
            ],
        }
    ]

    with build_client(
        settings,
        bindings,
        media_url_stager=fail_staging,
        tunnel_url_refresher=rotate_public_url,
    ) as client:
        response = client.post(
            "/v1/chat/completions",
            json={"model": "QWEN3.8", "messages": messages},
        )

    assert response.status_code == 200
    assert calls == [
        "https://first.trycloudflare.com/assets_v2/generations/session/frame.png",
        "https://second.trycloudflare.com/assets_v2/generations/session/frame.png",
    ]
    assert recovery_calls == ["stage", "rotate"]


def test_chat_retries_once_without_reasoning_effort_when_gmicloud_rejects_it(
    settings,
    fake_bindings,
    tmp_path,
):
    path = write_catalog(
        tmp_path,
        {
            "gpt-5.6-sol": {
                "text": {
                    "modelId": "openai/gpt-5.6-sol",
                    "operation": "chat.completions",
                },
                "vision": {
                    "modelId": "openai/gpt-5.6-sol",
                    "operation": "chat.completions",
                },
            }
        },
    )
    bindings, _, raw_response = fake_bindings
    calls = []

    async def reject_reasoning_once(model, messages, **kwargs):
        calls.append({"model": model, "messages": messages, "kwargs": kwargs})
        if len(calls) == 1:
            raise FakeProviderError(
                "GMICloud chat failed (400): Unknown parameter: 'reasoning_effort'"
            )
        return SimpleNamespace(raw=raw_response)

    bindings = replace(bindings, achat=reject_reasoning_once)
    with build_client(settings_with_catalog(settings, path), bindings) as client:
        response = client.post(
            "/v1/chat/completions",
            json={
                "model": "gpt-5.6-sol",
                "messages": [{"role": "user", "content": "reason carefully"}],
                "reasoning": {"effort": "high"},
            },
        )

    assert response.status_code == 200
    assert "reasoning" not in calls[0]["kwargs"]
    assert calls[0]["kwargs"]["reasoning_effort"] == "high"
    assert "reasoning" not in calls[1]["kwargs"]
    assert "reasoning_effort" not in calls[1]["kwargs"]


def test_qwen_vision_is_optional_and_fails_clearly_when_not_mapped(
    settings,
    fake_bindings,
    tmp_path,
):
    path = write_catalog(
        tmp_path,
        {"QWEN3.8": {"text": {"modelId": "Qwen/Qwen3.8-Max"}}},
    )
    bindings, calls, _ = fake_bindings
    with build_client(settings_with_catalog(settings, path), bindings) as client:
        response = client.post(
            "/v1/chat/completions",
            json={
                "model": "QWEN3.8",
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "image_url", "image_url": {"url": "https://example/a.png"}}
                        ],
                    }
                ],
            },
        )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "multimodal_not_supported"
    assert "configured GMICloud vision model" in response.json()["error"]["message"]
    assert calls == []


def test_chat_maps_vision_to_qwen_max_without_openrouter_completion_limits(settings, fake_bindings):
    bindings, calls, raw_response = fake_bindings
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "describe"},
                {
                    "type": "image_url",
                    "image_url": {"url": "https://example/image.png", "detail": "high"},
                },
            ],
        }
    ]
    with build_client(settings, bindings) as client:
        response = client.post(
            "/v1/chat/completions",
            json={"model": "QWEN3.8", "messages": messages, "max_tokens": 100},
        )

    assert response.status_code == 200
    assert response.json() == raw_response
    assert calls[0]["model"] == "Qwen/Qwen3.8-Max"
    assert calls[0]["messages"] == messages
    assert "max_tokens" not in calls[0]["kwargs"]


def test_chat_ignores_request_body_transport_overrides(settings, fake_bindings):
    bindings, calls, _ = fake_bindings
    with build_client(settings, bindings) as client:
        response = client.post(
            "/v1/chat/completions",
            json={
                "model": "QWEN3.8",
                "messages": [{"role": "user", "content": "hello"}],
                "api_key": "attacker-key",
                "base_url": "http://attacker.invalid/v1",
                "client": {"not": "an httpx client"},
                "timeout": 999999,
            },
        )

    assert response.status_code == 200
    assert calls[0]["kwargs"]["api_key"] == "gmi-test-key"
    assert calls[0]["kwargs"]["timeout"] == 15
    assert "base_url" not in calls[0]["kwargs"]
    assert "client" not in calls[0]["kwargs"]


@pytest.mark.parametrize(
    ("body", "code"),
    [
        (
            {"model": "QWEN3.8", "messages": [], "stream": True},
            "streaming_not_supported",
        ),
        (
            {"model": "QWEN3.8", "messages": [], "stream": 1},
            "streaming_not_supported",
        ),
        (
            {"model": "QWEN3.8", "messages": [], "stream": "true"},
            "streaming_not_supported",
        ),
        (
            {"model": "Qwen/unsupported-vision-model", "messages": []},
            "GENBLAZE_MODEL_UNSUPPORTED",
        ),
        (
            {
                "model": "QWEN3.8",
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "input_audio", "input_audio": {"data": "..."}}
                        ],
                    }
                ],
            },
            "multimodal_not_supported",
        ),
    ],
)
def test_chat_rejects_contracts_the_connector_cannot_preserve(
    settings,
    fake_bindings,
    body,
    code,
):
    bindings, calls, _ = fake_bindings
    with build_client(settings, bindings) as client:
        response = client.post("/v1/chat/completions", json=body)
    assert response.status_code in {400, 404}
    assert response.json()["error"]["code"] == code
    assert calls == []


def test_empty_media_catalog_rejects_samsar_models_before_submit(settings, fake_bindings):
    bindings, _, _ = fake_bindings
    with build_client(settings, bindings) as client:
        response = client.post(
            "/v1/media/requests",
            json={
                "model": "GPTIMAGE2EDIT",
                "modality": "image",
                "prompt": "edit",
                "input_urls": ["https://example/source.png"],
                "params": {"mask": "https://example/mask.png"},
            },
        )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "GENBLAZE_MODEL_UNSUPPORTED"
    assert FakeImageProvider.instances[0].submitted_step is None


def test_elevenlabs_audio_contract_is_async_and_returns_audio_assets(
    settings,
    fake_bindings,
    tmp_path,
):
    path = write_catalog(
        tmp_path,
        {
            "ELEVENLABS": {
                "audio": {
                    "modelId": "elevenlabs-tts-multilingual-v2",
                    "operation": "audio.generate",
                }
            }
        },
    )
    bindings, _, _ = fake_bindings
    with build_client(settings_with_catalog(settings, path), bindings) as client:
        submitted = client.post(
            "/v1/media/requests",
            json={
                "model": "ELEVENLABS",
                "modality": "audio",
                "prompt": "Read this clearly.",
                "input_urls": [],
                "params": {
                    "voice_id": "voice-123",
                    "output_format": "mp3_44100_128",
                },
            },
        )

        assert submitted.status_code == 202
        token = submitted.json()["request_id"]
        provider = FakeAudioProvider.instances[0]
        assert provider.submitted_step.model == "elevenlabs-tts-multilingual-v2"
        assert provider.submitted_step.modality == FakeModality.AUDIO
        assert provider.submitted_step.prompt == "Read this clearly."
        assert provider.submitted_step.params == {
            "voice_id": "voice-123",
            "output_format": "mp3_44100_128",
        }
        assert client.get(f"/v1/media/requests/{token}").json() == {
            "status": "pending",
            "assets": [],
            "error": None,
        }

        provider.terminal = True
        completed = client.get(f"/v1/media/requests/{token}")

    assert completed.json() == {
        "status": "succeeded",
        "assets": [
            {
                "url": "https://cdn.example/speech.mp3",
                "media_type": "audio/mpeg",
            }
        ],
        "error": None,
    }


def test_openai_tts_dormant_route_preserves_its_stable_gateway_params(
    settings,
    fake_bindings,
    tmp_path,
):
    path = write_catalog(
        tmp_path,
        {
            "OPENAI_TTS": {
                "audio": {
                    "modelId": "gpt-4o-mini-tts",
                    "operation": "audio.generate",
                }
            }
        },
    )
    bindings, _, _ = fake_bindings
    with build_client(settings_with_catalog(settings, path), bindings) as client:
        response = client.post(
            "/v1/media/requests",
            json={
                "model": "OPENAI_TTS",
                "modality": "audio",
                "prompt": "Read this warmly.",
                "input_urls": [],
                "params": {
                    "voice": "coral",
                    "output_format": "mp3",
                    "instructions": "Sound reassuring.",
                },
            },
        )

    assert response.status_code == 202
    step = FakeAudioProvider.instances[0].submitted_step
    assert step.model == "gpt-4o-mini-tts"
    assert step.params == {
        "voice": "coral",
        "output_format": "mp3",
        "instructions": "Sound reassuring.",
    }


@pytest.mark.parametrize(
    ("model", "prompt", "input_urls", "params", "message"),
    [
        ("ELEVENLABS", "", [], {"voice_id": "voice-123"}, "speech prompt"),
        ("ELEVENLABS", "hello", [], {}, "voice_id or voice"),
        (
            "ELEVENLABS",
            "hello",
            ["https://example/source.mp3"],
            {"voice_id": "voice-123"},
            "does not accept input URLs",
        ),
        (
            "ELEVENLABS",
            "hello",
            [],
            {"voice_id": "voice-123", "instructions": "not supported"},
            "Unsupported params",
        ),
        (
            "ELEVENLABS",
            "hello",
            [],
            {"voice_id": "voice-123", "output_format": "mp3"},
            "mp3_44100_128",
        ),
        ("OPENAI_TTS", "hello", [], {"voice_id": "voice-123"}, "Unsupported params"),
    ],
)
def test_audio_gateway_rejects_cross_contract_or_invalid_inputs_before_submit(
    settings,
    fake_bindings,
    tmp_path,
    model,
    prompt,
    input_urls,
    params,
    message,
):
    path = write_catalog(
        tmp_path,
        {
            "ELEVENLABS": {
                "audio": {"modelId": "elevenlabs-tts-v3"},
            },
            "OPENAI_TTS": {
                "audio": {"modelId": "gpt-4o-mini-tts"},
            },
        },
    )
    bindings, _, _ = fake_bindings
    with build_client(settings_with_catalog(settings, path), bindings) as client:
        response = client.post(
            "/v1/media/requests",
            json={
                "model": model,
                "modality": "audio",
                "prompt": prompt,
                "input_urls": input_urls,
                "params": params,
            },
        )

    assert response.status_code == 400
    assert message in response.json()["error"]["message"]
    assert FakeAudioProvider.instances[0].submitted_step is None


def test_image_edit_contract_preserves_inputs_and_enforces_per_model_limits(
    settings,
    fake_bindings,
    tmp_path,
):
    path = write_catalog(
        tmp_path,
        {
            "GPTIMAGE2EDIT": {
                "image": {"modelId": "gpt-image-2-edit", "operation": "image.edit"}
            },
            "NANOBANANA2EDIT": {
                "image": {"modelId": "gemini-3.1-flash-image", "operation": "image.edit"}
            },
            "BRIA_ERASER": {
                "image": {"modelId": "bria-eraser", "operation": "image.edit"}
            },
        },
    )
    bindings, _, _ = fake_bindings
    with build_client(settings_with_catalog(settings, path), bindings) as client:
        submitted = client.post(
            "/v1/media/requests",
            json={
                "model": "GPTIMAGE2EDIT",
                "modality": "image",
                "prompt": "paint a rainbow",
                "input_urls": [
                    "https://example/source.png",
                    "https://example/mask.png",
                ],
                "params": {"size": "1024x1024", "quality": "high"},
            },
        )
        assert submitted.status_code == 202
        step = FakeImageProvider.instances[0].submitted_step
        assert step.model == "gpt-image-2-edit"
        assert [asset.url for asset in step.inputs] == [
            "https://example/source.png",
            "https://example/mask.png",
        ]

        optional_mask = client.post(
            "/v1/media/requests",
            json={
                "model": "GPTIMAGE2EDIT",
                "modality": "image",
                "prompt": "change the background",
                "input_urls": ["https://example/source.png"],
                "params": {},
            },
        )
        assert optional_mask.status_code == 202

        missing_source = client.post(
            "/v1/media/requests",
            json={
                "model": "GPTIMAGE2EDIT",
                "modality": "image",
                "prompt": "edit",
                "input_urls": [],
                "params": {},
            },
        )
        assert missing_source.status_code == 400

        too_many_nano_inputs = client.post(
            "/v1/media/requests",
            json={
                "model": "NANOBANANA2EDIT",
                "modality": "image",
                "prompt": "edit",
                "input_urls": [f"https://example/{index}.png" for index in range(15)],
                "params": {},
            },
        )
        assert too_many_nano_inputs.status_code == 400

        missing_bria_mask = client.post(
            "/v1/media/requests",
            json={
                "model": "BRIA_ERASER",
                "modality": "image",
                "input_urls": ["https://example/source.png"],
                "params": {},
            },
        )
        assert missing_bria_mask.status_code == 400


def test_gmicloud_image_edit_rotates_all_tunneled_inputs_after_download_failures(
    settings,
    fake_bindings,
    tmp_path,
):
    class RetryingImageProvider(FakeImageProvider):
        instances = []

        def submit(self, step):
            self.submitted_step = step
            self.submitted_steps.append(step)
            if len(self.submitted_steps) < 3:
                raise FakeProviderError(
                    'GMICloud submit failed (400): code="invalid_image_url" '
                    "Timeout while downloading image"
                )
            return FakeSubmitResult()

    path = write_catalog(
        tmp_path,
        {
            "GPTIMAGE2EDIT": {
                "image": {"modelId": "gpt-image-2-edit", "operation": "image.edit"}
            }
        },
    )
    bindings, _, _ = fake_bindings
    bindings = replace(bindings, image_provider_type=RetryingImageProvider)
    replacement_origins = iter(
        (
            "https://second.trycloudflare.com",
            "https://third.trycloudflare.com",
        )
    )
    refresh_calls = []

    async def rotate_public_urls(payload, attempted_urls, retry_number):
        refresh_calls.append((tuple(attempted_urls), retry_number))
        replacement_origin = next(replacement_origins)
        refreshed = json.loads(json.dumps(payload))
        refreshed["input_urls"] = [
            f"{replacement_origin}/{url.split('/', 3)[3]}"
            for url in refreshed["input_urls"]
        ]
        return refreshed

    configured = replace(
        settings_with_catalog(settings, path),
        media_url_max_attempts=3,
    )
    with build_client(
        configured,
        bindings,
        tunnel_url_refresher=rotate_public_urls,
    ) as client:
        response = client.post(
            "/v1/media/requests",
            json={
                "model": "GPTIMAGE2EDIT",
                "modality": "image",
                "prompt": "edit",
                "input_urls": [
                    "https://first.trycloudflare.com/assets_v2/generations/session/source.png",
                    "https://first.trycloudflare.com/assets_v2/generations/session/mask.png",
                ],
                "params": {},
            },
        )

    assert response.status_code == 202
    provider = RetryingImageProvider.instances[0]
    assert [
        [asset.url for asset in step.inputs]
        for step in provider.submitted_steps
    ] == [
        [
            "https://first.trycloudflare.com/assets_v2/generations/session/source.png",
            "https://first.trycloudflare.com/assets_v2/generations/session/mask.png",
        ],
        [
            "https://second.trycloudflare.com/assets_v2/generations/session/source.png",
            "https://second.trycloudflare.com/assets_v2/generations/session/mask.png",
        ],
        [
            "https://third.trycloudflare.com/assets_v2/generations/session/source.png",
            "https://third.trycloudflare.com/assets_v2/generations/session/mask.png",
        ],
    ]
    assert [retry_number for _, retry_number in refresh_calls] == [1, 2]


def test_gmicloud_image_edit_stages_all_tunneled_inputs_after_download_failure(
    settings,
    fake_bindings,
    tmp_path,
):
    class StagingImageProvider(FakeImageProvider):
        instances = []

        def submit(self, step):
            self.submitted_step = step
            self.submitted_steps.append(step)
            if len(self.submitted_steps) == 1:
                raise FakeProviderError(
                    "GMICloud submit failed (400): Timeout while downloading image"
                )
            return FakeSubmitResult()

    path = write_catalog(
        tmp_path,
        {
            "GPTIMAGE2EDIT": {
                "image": {"modelId": "gpt-image-2-edit", "operation": "image.edit"}
            }
        },
    )
    bindings, _, _ = fake_bindings
    bindings = replace(bindings, image_provider_type=StagingImageProvider)
    staging_calls = []

    async def stage_public_urls(payload):
        staging_calls.append(payload)
        staged = json.loads(json.dumps(payload))
        staged["input_urls"] = [
            f"https://storage.googleapis.com/gmi-public/{url.rsplit('/', 1)[-1]}"
            for url in payload["input_urls"]
        ]
        return staged

    configured = settings_with_catalog(settings, path)
    with build_client(
        configured,
        bindings,
        media_url_stager=stage_public_urls,
    ) as client:
        response = client.post(
            "/v1/media/requests",
            json={
                "model": "GPTIMAGE2EDIT",
                "modality": "image",
                "prompt": "edit",
                "input_urls": [
                    "https://first.trycloudflare.com/assets_v2/generations/session/source.png",
                    "https://first.trycloudflare.com/assets_v2/generations/session/mask.png",
                ],
                "params": {},
            },
        )

    assert response.status_code == 202
    assert len(staging_calls) == 1
    provider = StagingImageProvider.instances[0]
    assert [
        [asset.url for asset in step.inputs]
        for step in provider.submitted_steps
    ] == [
        [
            "https://first.trycloudflare.com/assets_v2/generations/session/source.png",
            "https://first.trycloudflare.com/assets_v2/generations/session/mask.png",
        ],
        [
            "https://storage.googleapis.com/gmi-public/source.png",
            "https://storage.googleapis.com/gmi-public/mask.png",
        ],
    ]


def test_gmicloud_image_to_video_rotates_tunneled_frames_after_download_failures(
    settings,
    fake_bindings,
    tmp_path,
):
    class RetryingVideoProvider(FakeVideoProvider):
        instances = []

        def submit(self, step):
            self.submitted_step = step
            self.submitted_steps.append(step)
            if len(self.submitted_steps) < 3:
                raise FakeProviderError(
                    "GMICloud submit failed: Error while downloading file. "
                    "Upstream status code: 530"
                )
            return FakeSubmitResult()

    path = write_catalog(
        tmp_path,
        {
            "KLINGIMGTOVID3PRO": {
                "video": {
                    "modelId": "kling-v3-image-to-video",
                    "operation": "video.generate",
                }
            }
        },
    )
    bindings, _, _ = fake_bindings
    bindings = replace(bindings, video_provider_type=RetryingVideoProvider)
    replacement_origins = iter(
        (
            "https://second.trycloudflare.com",
            "https://third.trycloudflare.com",
        )
    )

    async def rotate_public_urls(payload, attempted_urls, retry_number):
        assert attempted_urls
        assert retry_number in {1, 2}
        replacement_origin = next(replacement_origins)
        refreshed = json.loads(json.dumps(payload))
        refreshed["input_urls"] = [
            f"{replacement_origin}/{url.split('/', 3)[3]}"
            for url in refreshed["input_urls"]
        ]
        return refreshed

    configured = replace(
        settings_with_catalog(settings, path),
        media_url_max_attempts=3,
    )
    with build_client(
        configured,
        bindings,
        tunnel_url_refresher=rotate_public_urls,
    ) as client:
        response = client.post(
            "/v1/media/requests",
            json={
                "model": "KLINGIMGTOVID3PRO",
                "modality": "video",
                "prompt": "animate",
                "input_urls": [
                    "https://first.trycloudflare.com/assets_v2/generations/session/start.png",
                    "https://first.trycloudflare.com/assets_v2/generations/session/end.png",
                ],
                "params": {},
            },
        )

    assert response.status_code == 202
    provider = RetryingVideoProvider.instances[0]
    assert [
        [asset.url for asset in step.inputs]
        for step in provider.submitted_steps
    ] == [
        [
            "https://first.trycloudflare.com/assets_v2/generations/session/start.png",
            "https://first.trycloudflare.com/assets_v2/generations/session/end.png",
        ],
        [
            "https://second.trycloudflare.com/assets_v2/generations/session/start.png",
            "https://second.trycloudflare.com/assets_v2/generations/session/end.png",
        ],
        [
            "https://third.trycloudflare.com/assets_v2/generations/session/start.png",
            "https://third.trycloudflare.com/assets_v2/generations/session/end.png",
        ],
    ]


def test_managed_media_rewriter_covers_video_to_video_urls_without_touching_external_media():
    payload = {
        "input_urls": [
            "https://first.trycloudflare.com/assets_v2/generations/session/source.mp4",
            "https://cdn.example/reference.mp4",
        ],
        "params": {
            "nested_video_url": (
                "https://first.trycloudflare.com/assets/generations/session/mask.mp4"
            ),
        },
    }

    assert _collect_managed_tunnel_media_urls(payload) == [
        "https://first.trycloudflare.com/assets_v2/generations/session/source.mp4",
        "https://first.trycloudflare.com/assets/generations/session/mask.mp4",
    ]
    assert _rewrite_managed_tunnel_media_urls(
        payload,
        "https://second.trycloudflare.com",
    ) == {
        "input_urls": [
            "https://second.trycloudflare.com/assets_v2/generations/session/source.mp4",
            "https://cdn.example/reference.mp4",
        ],
        "params": {
            "nested_video_url": (
                "https://second.trycloudflare.com/assets/generations/session/mask.mp4"
            ),
        },
    }


def test_video_input_contracts_enforce_exact_required_frame_counts(
    settings,
    fake_bindings,
    tmp_path,
):
    path = write_catalog(
        tmp_path,
        {
            "VEO3.1FLIV": {
                "video": {"modelId": "veo-3.1-generate-001", "operation": "video.generate"}
            },
            "VEO3.1I2V": {
                "video": {"modelId": "veo-3.1-generate-001", "operation": "video.generate"}
            },
            "SEEDANCE2.0I2V": {
                "video": {"modelId": "seedance-2-0-260128", "operation": "video.generate"}
            },
            "KLINGIMGTOVIDPRO": {
                "video": {
                    "modelId": "Kling-Image2Video-V1.6-Pro",
                    "operation": "video.generate",
                }
            },
            "KLINGIMGTOVIDTURBO": {
                "video": {
                    "modelId": "kling-3.0-turbo-i2v",
                    "operation": "video.generate",
                }
            },
            "HAILUOPRO": {
                "video": {"modelId": "Minimax-Hailuo-02", "operation": "video.generate"}
            },
        },
    )
    bindings, _, _ = fake_bindings
    with build_client(settings_with_catalog(settings, path), bindings) as client:
        missing_last_frame = client.post(
            "/v1/media/requests",
            json={
                "model": "VEO3.1FLIV",
                "modality": "video",
                "prompt": "transition",
                "input_urls": ["https://example/start.png"],
                "params": {},
            },
        )
        assert missing_last_frame.status_code == 400

        exact_first_last_frames = client.post(
            "/v1/media/requests",
            json={
                "model": "VEO3.1FLIV",
                "modality": "video",
                "prompt": "transition",
                "input_urls": [
                    "https://example/start.png",
                    "https://example/end.png",
                ],
                "params": {},
            },
        )
        assert exact_first_last_frames.status_code == 202

        i2v_end_frame = client.post(
            "/v1/media/requests",
            json={
                "model": "VEO3.1I2V",
                "modality": "video",
                "prompt": "move",
                "input_urls": [
                    "https://example/start.png",
                    "https://example/end.png",
                ],
                "params": {},
            },
        )
        assert i2v_end_frame.status_code == 400

        missing_seedance_source = client.post(
            "/v1/media/requests",
            json={
                "model": "SEEDANCE2.0I2V",
                "modality": "video",
                "prompt": "move",
                "input_urls": [],
                "params": {},
            },
        )
        assert missing_seedance_source.status_code == 400

        seedance_first_last_frames = client.post(
            "/v1/media/requests",
            json={
                "model": "SEEDANCE2.0I2V",
                "modality": "video",
                "prompt": "move",
                "input_urls": [
                    "https://example/start.png",
                    "https://example/end.png",
                ],
                "params": {"resolution": "720P"},
            },
        )
        assert seedance_first_last_frames.status_code == 202

        missing_kling_source = client.post(
            "/v1/media/requests",
            json={
                "model": "KLINGIMGTOVIDPRO",
                "modality": "video",
                "prompt": "orbit",
                "input_urls": [],
                "params": {"duration": 5},
            },
        )
        assert missing_kling_source.status_code == 400

        exact_turbo_source = client.post(
            "/v1/media/requests",
            json={
                "model": "KLINGIMGTOVIDTURBO",
                "modality": "video",
                "prompt": "orbit",
                "input_urls": ["https://example/start.png"],
                "params": {"duration": 5},
            },
        )
        assert exact_turbo_source.status_code == 202

        turbo_end_frame = client.post(
            "/v1/media/requests",
            json={
                "model": "KLINGIMGTOVIDTURBO",
                "modality": "video",
                "prompt": "orbit",
                "input_urls": [
                    "https://example/start.png",
                    "https://example/end.png",
                ],
                "params": {"duration": 5},
            },
        )
        assert turbo_end_frame.status_code == 400

        optional_hailuo_source = client.post(
            "/v1/media/requests",
            json={
                "model": "HAILUOPRO",
                "modality": "video",
                "prompt": "camera move",
                "input_urls": [],
                "params": {},
            },
        )
        assert optional_hailuo_source.status_code == 202


def test_veo_and_hailuo_prompt_requirements_fail_before_upstream_submit(
    settings,
    fake_bindings,
    tmp_path,
):
    veo_models = {
        "VEO3.1": "veo-3.1-generate-001",
        "VEO3.1FAST": "veo-3.1-fast-generate-001",
        "VEO3.1I2V": "veo-3.1-generate-001",
        "VEO3.1I2VFAST": "veo-3.1-fast-generate-001",
        "VEO3.1FLIV": "veo-3.1-generate-001",
    }
    path = write_catalog(
        tmp_path,
        {
            **{
                model: {
                    "video": {
                        "modelId": upstream,
                        "operation": "video.generate",
                    }
                }
                for model, upstream in veo_models.items()
            },
            "HAILUOPRO": {
                "video": {
                    "modelId": "Minimax-Hailuo-02",
                    "operation": "video.generate",
                }
            },
        },
    )
    bindings, _, _ = fake_bindings
    inputs_by_model = {
        "VEO3.1": [],
        "VEO3.1FAST": [],
        "VEO3.1I2V": ["https://example/start.png"],
        "VEO3.1I2VFAST": ["https://example/start.png"],
        "VEO3.1FLIV": [
            "https://example/start.png",
            "https://example/end.png",
        ],
    }

    with build_client(settings_with_catalog(settings, path), bindings) as client:
        for model, input_urls in inputs_by_model.items():
            response = client.post(
                "/v1/media/requests",
                json={
                    "model": model,
                    "modality": "video",
                    "prompt": "   ",
                    "input_urls": input_urls,
                    "params": {},
                },
            )
            assert response.status_code == 400
            assert "non-empty prompt" in response.json()["error"]["message"]

        empty_hailuo = client.post(
            "/v1/media/requests",
            json={
                "model": "HAILUOPRO",
                "modality": "video",
                "prompt": "",
                "input_urls": [],
                "params": {},
            },
        )
        assert empty_hailuo.status_code == 400

        image_only_hailuo = client.post(
            "/v1/media/requests",
            json={
                "model": "HAILUOPRO",
                "modality": "video",
                "prompt": "",
                "input_urls": ["https://example/start.png"],
                "params": {},
            },
        )
        assert image_only_hailuo.status_code == 202


def test_media_contract_is_async_signed_and_stateless(
    settings,
    fake_bindings,
    tmp_path,
):
    path = write_catalog(
        tmp_path,
        {
            "KLINGIMGTOVID3PRO": {
                "video": {
                    "modelId": "kling-v3-image-to-video",
                    "operation": "video.generate",
                }
            }
        },
    )
    configured = settings_with_catalog(settings, path)
    bindings, _, _ = fake_bindings
    with build_client(configured, bindings) as first_client:
        submitted = first_client.post(
            "/v1/media/requests",
            json={
                "model": "KLINGIMGTOVID3PRO",
                "modality": "video",
                "prompt": "animate this",
                "input_urls": [
                    "https://example/start.png",
                    "https://example/end.png",
                ],
                "params": {
                    "duration": 8,
                    "aspect_ratio": "16:9",
                    "generate_audio": True,
                },
            },
        )
        assert submitted.status_code == 202
        assert set(submitted.json()) == {"request_id", "status"}
        assert submitted.json()["status"] == "pending"
        token = submitted.json()["request_id"]
        assert "gmi-upstream-job-123" not in token
        padding = "=" * (-len(token) % 4)
        decoded_token = base64.urlsafe_b64decode(token + padding)
        assert b"gmi-upstream-job-123" not in decoded_token
        assert b"KLINGIMGTOVID3PRO" not in decoded_token

        pending = first_client.get(f"/v1/media/requests/{token}")
        assert pending.json() == {"status": "pending", "assets": [], "error": None}
        submitted_step = FakeVideoProvider.instances[0].submitted_step
        assert submitted_step.model == "kling-v3-image-to-video"
        assert submitted_step.prompt == "animate this"
        assert submitted_step.params == {
            "duration": 8,
            "aspect_ratio": "16:9",
            "generate_audio": True,
        }
        assert [asset.url for asset in submitted_step.inputs] == [
            "https://example/start.png",
            "https://example/end.png",
        ]

    # A new runtime can decode and poll the same id: no in-memory job registry
    # is involved.
    with build_client(configured, bindings) as second_client:
        second_provider = FakeVideoProvider.instances[-1]
        second_provider.terminal = True
        completed = second_client.get(f"/v1/media/requests/{token}")
        assert completed.json() == {
            "status": "succeeded",
            "assets": [
                {"url": "https://cdn.example/result.png", "media_type": "image/png"}
            ],
            "error": None,
        }
        assert second_provider.polled_id == "gmi-upstream-job-123"


def test_new_job_token_secret_decodes_tokens_sealed_with_legacy_gmi_key(
    settings,
    fake_bindings,
    tmp_path,
):
    path = write_catalog(
        tmp_path,
        {"GPTIMAGE2": {"image": {"modelId": "gpt-image-2-generate"}}},
    )
    configured = settings_with_catalog(settings, path)
    legacy_settings = replace(configured, job_token_secret=None)
    stable_settings = replace(configured, job_token_secret="new-stable-token-secret")
    bindings, _, _ = fake_bindings

    with build_client(legacy_settings, bindings) as legacy_client:
        legacy_token = legacy_client.post(
            "/v1/media/requests",
            json={
                "model": "GPTIMAGE2",
                "modality": "image",
                "prompt": "create",
                "input_urls": [],
                "params": {},
            },
        ).json()["request_id"]

    with build_client(stable_settings, bindings) as stable_client:
        migrated_poll = stable_client.get(f"/v1/media/requests/{legacy_token}")
        assert migrated_poll.status_code == 200
        assert migrated_poll.json() == {
            "status": "pending",
            "assets": [],
            "error": None,
        }
        assert FakeImageProvider.instances[-1].polled_id == "gmi-upstream-job-123"

        stable_token = stable_client.post(
            "/v1/media/requests",
            json={
                "model": "GPTIMAGE2",
                "modality": "image",
                "prompt": "create",
                "input_urls": [],
                "params": {},
            },
        ).json()["request_id"]

    # The fallback is decode-only: newly issued tokens use the primary stable
    # secret and cannot be opened by a runtime that only knows the legacy key.
    with build_client(legacy_settings, bindings) as legacy_client:
        stable_poll = legacy_client.get(f"/v1/media/requests/{stable_token}")
    assert stable_poll.status_code == 400
    assert stable_poll.json()["error"]["code"] == "invalid_request_id"


@pytest.mark.parametrize("terminal_status", ["failed", "cancelled"])
def test_media_terminal_failures_remain_poll_results(
    settings,
    fake_bindings,
    tmp_path,
    terminal_status,
):
    path = write_catalog(
        tmp_path,
        {
            "GPTIMAGE2": {
                "image": {
                    "modelId": "gpt-image-2-generate",
                    "operation": "image.generate",
                }
            }
        },
    )
    bindings, _, _ = fake_bindings
    with build_client(settings_with_catalog(settings, path), bindings) as client:
        submitted = client.post(
            "/v1/media/requests",
            json={
                "model": "GPTIMAGE2",
                "modality": "image",
                "prompt": "create",
                "input_urls": [],
                "params": {"size": "1536x1024", "quality": "high"},
            },
        ).json()
        provider = FakeImageProvider.instances[0]
        provider.terminal = True
        provider.terminal_status = terminal_status
        response = client.get(f"/v1/media/requests/{submitted['request_id']}")

    assert response.status_code == 200
    assert response.json() == {
        "status": terminal_status,
        "assets": [],
        "error": "generation failed",
    }


def test_tampered_media_request_id_is_rejected(
    settings,
    fake_bindings,
    tmp_path,
):
    path = write_catalog(
        tmp_path,
        {"GPTIMAGE2": {"image": {"modelId": "gpt-image-2-generate"}}},
    )
    bindings, _, _ = fake_bindings
    with build_client(settings_with_catalog(settings, path), bindings) as client:
        token = client.post(
            "/v1/media/requests",
            json={
                "model": "GPTIMAGE2",
                "modality": "image",
                "prompt": "create",
                "input_urls": [],
                "params": {},
            },
        ).json()["request_id"]
        index = len(token) // 2
        replacement = "A" if token[index] != "A" else "B"
        tampered = token[:index] + replacement + token[index + 1 :]
        response = client.get(f"/v1/media/requests/{tampered}")

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request_id"


def test_provider_rate_limit_maps_to_openai_error_and_retry_after(settings, fake_bindings):
    _, _, _ = fake_bindings

    async def rate_limited(*args, **kwargs):
        raise FakeProviderError(
            "slow down",
            error_code="rate_limit",
            retry_after=2.2,
        )

    bindings = GenBlazeBindings(
        achat=rate_limited,
        image_provider_type=FakeImageProvider,
        video_provider_type=FakeVideoProvider,
        audio_provider_type=FakeAudioProvider,
        provider_error_type=FakeProviderError,
        step_type=FakeStep,
        asset_type=FakeAsset,
        modality_type=FakeModality,
    )
    with build_client(settings, bindings) as client:
        response = client.post(
            "/v1/chat/completions",
            json={"model": "QWEN3.8", "messages": []},
        )

    assert response.status_code == 429
    assert response.headers["retry-after"] == "3"
    assert response.json()["error"]["code"] == "rate_limit"
