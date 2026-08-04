"""Small real-package smoke tests; all upstream HTTP remains mocked."""

from __future__ import annotations

import asyncio
from importlib.metadata import version

import pytest
from genblaze_core.exceptions import ProviderError
from genblaze_core.models.asset import Asset
from genblaze_core.models.enums import Modality
from genblaze_core.models.step import Step
from genblaze_gmicloud import (
    GMICloudAudioProvider,
    GMICloudImageProvider,
    GMICloudVideoProvider,
    achat,
)

from app.catalog import ModelRoute
from app.runtime import load_genblaze_bindings


class FakeResponse:
    status_code = 200
    text = ""

    def __init__(self, body):
        self._body = body

    def json(self):
        return self._body


class FakeChatClient:
    def __init__(self, body):
        self.body = body
        self.calls = []

    def post(self, path, *, json):
        self.calls.append((path, json))
        return FakeResponse(self.body)

    def get(self, path):
        self.calls.append((path, None))
        return FakeResponse(self.body)


def test_runtime_package_pins_and_provider_constructors_are_compatible():
    assert version("genblaze-core") == "0.3.8"
    assert version("genblaze-gmicloud") == "0.3.5"

    image = GMICloudImageProvider(api_key="offline-test-key", http_timeout=1)
    video = GMICloudVideoProvider(api_key="offline-test-key", http_timeout=1)
    audio = GMICloudAudioProvider(api_key="offline-test-key", http_timeout=1)
    image.close()
    video.close()
    audio.close()


def test_real_genblaze_chat_preserves_multimodal_wire_and_raw_response():
    upstream_body = {
        "id": "chatcmpl-real-wrapper",
        "model": "Qwen/Qwen3.8-Max",
        "choices": [
            {
                "message": {"role": "assistant", "content": "an image"},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 12, "completion_tokens": 3},
    }
    client = FakeChatClient(upstream_body)
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

    response = asyncio.run(
        achat(
            "Qwen/Qwen3.8-Max",
            messages,
            client=client,
        )
    )

    assert response.raw == upstream_body
    assert client.calls == [
        (
            "/chat/completions",
            {"model": "Qwen/Qwen3.8-Max", "messages": messages},
        )
    ]


@pytest.mark.parametrize(
    "upstream_model",
    ["elevenlabs-tts-multilingual-v2", "elevenlabs-tts-v3"],
)
def test_elevenlabs_audio_registry_maps_stable_samsar_fields_exactly(
    upstream_model,
):
    route = ModelRoute("ELEVENLABS", upstream_model, "audio", "audio.generate")
    factory = load_genblaze_bindings().media_registry_factory
    assert factory is not None
    registry = factory("audio", (route,))
    step = Step(
        provider="gmicloud-audio",
        model=upstream_model,
        modality=Modality.AUDIO,
        prompt="Read this clearly.",
        params={"voice": "voice-123", "output_format": "mp3_44100_128"},
    )

    assert registry.prepare_payload(step) == {
        "text": "Read this clearly.",
        "voice_id": "voice-123",
        "output_format": "mp3_44100_128",
    }

    step.params["instructions"] = "Eleven does not expose this contract."
    with pytest.raises(ProviderError, match="Unknown parameters"):
        registry.prepare_payload(step)

    step.params.pop("instructions")
    step.params["output_format"] = "mp3"
    with pytest.raises(ProviderError, match="mp3_44100_128"):
        registry.prepare_payload(step)


def test_elevenlabs_audio_registry_accepts_native_voice_id_and_default_format():
    route = ModelRoute(
        "ELEVENLABS",
        "elevenlabs-tts-multilingual-v2",
        "audio",
        "audio.generate",
    )
    factory = load_genblaze_bindings().media_registry_factory
    assert factory is not None
    registry = factory("audio", (route,))
    step = Step(
        provider="gmicloud-audio",
        model=route.gmi_model,
        modality=Modality.AUDIO,
        prompt="Hello.",
        params={"voice_id": "voice-native"},
    )

    assert registry.prepare_payload(step) == {
        "text": "Hello.",
        "voice_id": "voice-native",
        "output_format": "mp3_44100_128",
    }


def test_openai_audio_registry_maps_prompt_and_response_format_exactly():
    route = ModelRoute(
        "OPENAI_TTS",
        "gpt-4o-mini-tts",
        "audio",
        "audio.generate",
    )
    factory = load_genblaze_bindings().media_registry_factory
    assert factory is not None
    registry = factory("audio", (route,))
    step = Step(
        provider="gmicloud-audio",
        model=route.gmi_model,
        modality=Modality.AUDIO,
        prompt="Read this warmly.",
        params={
            "voice": "coral",
            "output_format": "mp3",
            "instructions": "Sound reassuring.",
        },
    )

    assert registry.prepare_payload(step) == {
        "input": "Read this warmly.",
        "voice": "coral",
        "response_format": "mp3",
        "instructions": "Sound reassuring.",
    }

    step.params["voice_id"] = "wrong-contract"
    with pytest.raises(ProviderError, match="Unknown parameters"):
        registry.prepare_payload(step)


def test_real_gmicloud_audio_provider_submits_translated_elevenlabs_payload():
    route = ModelRoute(
        "ELEVENLABS",
        "elevenlabs-tts-v3",
        "audio",
        "audio.generate",
    )
    factory = load_genblaze_bindings().media_registry_factory
    assert factory is not None
    client = FakeChatClient({"request_id": "offline-audio-job"})
    provider = GMICloudAudioProvider(
        http_client=client,
        models=factory("audio", (route,)),
    )
    step = Step(
        provider=provider.name,
        model=route.gmi_model,
        modality=Modality.AUDIO,
        prompt="A short line.",
        params={"voice_id": "voice-123", "output_format": "mp3_44100_128"},
    )

    result = provider.submit(step)

    assert result.prediction_id == "offline-audio-job"
    assert client.calls == [
        (
            "/requests",
            {
                "model": "elevenlabs-tts-v3",
                "payload": {
                    "text": "A short line.",
                    "voice_id": "voice-123",
                    "output_format": "mp3_44100_128",
                },
            },
        )
    ]


@pytest.mark.parametrize(
    ("aspect_ratio", "size"),
    [
        ("1:1", "1024x1024"),
        ("16:9", "1536x864"),
        ("9:16", "864x1536"),
    ],
)
def test_gpt_image_registry_translates_count_and_drops_redundant_ratio(
    aspect_ratio,
    size,
):
    route = ModelRoute(
        samsar_model="GPTIMAGE2",
        gmi_model="gpt-image-2-generate",
        modality="image",
        operation="image.generate",
    )
    factory = load_genblaze_bindings().media_registry_factory
    assert factory is not None
    registry = factory("image", (route,))
    step = Step(
        provider="gmicloud-image",
        model=route.gmi_model,
        modality=Modality.IMAGE,
        prompt="paint a city",
        params={
            "aspect_ratio": aspect_ratio,
            "size": size,
            "quality": "high",
            "output_format": "png",
            "number_of_images": 1,
        },
    )

    assert registry.prepare_payload(step) == {
        "prompt": "paint a city",
        "size": size,
        "quality": "high",
        "output_format": "png",
        "n": 1,
    }


def test_gpt_image_edit_registry_preserves_source_and_optional_mask():
    route = ModelRoute(
        samsar_model="GPTIMAGE2EDIT",
        gmi_model="gpt-image-2-edit",
        modality="image",
        operation="image.edit",
    )
    factory = load_genblaze_bindings().media_registry_factory
    assert factory is not None
    registry = factory("image", (route,))
    source = Asset(url="https://example/source.png", media_type="image/png")
    mask = Asset(url="https://example/mask.png", media_type="image/png")

    without_mask = Step(
        provider="gmicloud-image",
        model=route.gmi_model,
        modality=Modality.IMAGE,
        prompt="change the background",
        params={"size": "1024x1024", "quality": "high", "number_of_images": 1},
        inputs=[source],
    )
    assert registry.prepare_payload(without_mask) == {
        "prompt": "change the background",
        "size": "1024x1024",
        "quality": "high",
        "n": 1,
        "image": "https://example/source.png",
    }

    with_mask = Step(
        provider="gmicloud-image",
        model=route.gmi_model,
        modality=Modality.IMAGE,
        prompt="paint a rainbow",
        inputs=[source, mask],
    )
    assert registry.prepare_payload(with_mask) == {
        "prompt": "paint a rainbow",
        "image": "https://example/source.png",
        "mask": "https://example/mask.png",
    }


@pytest.mark.parametrize(
    ("samsar_model", "upstream_model"),
    [
        ("NANOBANANA2EDIT", "gemini-3.1-flash-image"),
        ("NANOBANANAPROEDIT", "gemini-3-pro-image"),
    ],
)
def test_nano_edit_registry_routes_up_to_fourteen_reference_images(
    samsar_model,
    upstream_model,
):
    route = ModelRoute(samsar_model, upstream_model, "image", "image.edit")
    factory = load_genblaze_bindings().media_registry_factory
    assert factory is not None
    registry = factory("image", (route,))
    urls = [f"https://example/{index}.png" for index in range(14)]
    step = Step(
        provider="gmicloud-image",
        model=route.gmi_model,
        modality=Modality.IMAGE,
        prompt="make a cohesive edit",
        params={"aspect_ratio": "16:9", "resolution": "1k", "output_format": "png"},
        inputs=[Asset(url=url, media_type="image/png") for url in urls],
    )

    assert registry.prepare_payload(step) == {
        "prompt": "make a cohesive edit",
        "aspect_ratio": "16:9",
        "image_size": "1K",
        "image_output_format": "png",
        "image": urls,
    }


@pytest.mark.parametrize(
    ("samsar_model", "upstream_model", "prompt", "params", "expected"),
    [
        (
            "BRIA_ERASER",
            "bria-eraser",
            None,
            {},
            {
                "image": "https://example/source.png",
                "mask": "https://example/mask.png",
            },
        ),
        (
            "BRIA_GENFILL",
            "bria-genfill",
            "fill with flowers",
            {"negative_prompt": "text", "guidance_scale": 5, "num_inference_steps": 30},
            {
                "prompt": "fill with flowers",
                "image": "https://example/source.png",
                "mask": "https://example/mask.png",
                "negative_prompt": "text",
                "guidance_scale": 5,
                "num_inference_steps": 30,
            },
        ),
    ],
)
def test_bria_edit_registry_preserves_source_mask_and_supported_controls(
    samsar_model,
    upstream_model,
    prompt,
    params,
    expected,
):
    route = ModelRoute(samsar_model, upstream_model, "image", "image.edit")
    factory = load_genblaze_bindings().media_registry_factory
    assert factory is not None
    registry = factory("image", (route,))
    step = Step(
        provider="gmicloud-image",
        model=route.gmi_model,
        modality=Modality.IMAGE,
        prompt=prompt,
        params=params,
        inputs=[
            Asset(url="https://example/source.png", media_type="image/png"),
            Asset(url="https://example/mask.png", media_type="image/png"),
        ],
    )

    assert registry.prepare_payload(step) == expected


@pytest.mark.parametrize(
    ("aspect_ratio", "expected_size"),
    [
        ("1:1", "1024x1024"),
        ("16:9", "1792x1024"),
        ("9:16", "1024x1792"),
        ("square_hd", "1024x1024"),
        ("landscape_16_9", "1792x1024"),
        ("portrait_16_9", "1024x1792"),
        ("landscape_4_3", "1152x864"),
        ("portrait_4_3", "864x1152"),
    ],
)
def test_seedream_registry_translates_ratio_to_exact_single_image_payload(
    aspect_ratio,
    expected_size,
):
    route = ModelRoute("SEEDREAM", "seedream-5.0-pro", "image", "image.generate")
    factory = load_genblaze_bindings().media_registry_factory
    assert factory is not None
    registry = factory("image", (route,))
    step = Step(
        provider="gmicloud-image",
        model=route.gmi_model,
        modality=Modality.IMAGE,
        prompt="wide landscape",
        params={
            "aspect_ratio": aspect_ratio,
            "number_of_images": 1,
            "output_format": "png",
            "resolution": "1k",
        },
    )

    assert registry.prepare_payload(step) == {
        "prompt": "wide landscape",
        "size": expected_size,
        "output_format": "png",
    }


@pytest.mark.parametrize(
    ("size", "expected_size"),
    [
        ("auto_1K", "1K"),
        ("auto_2K", "2K"),
        ({"width": 1280, "height": 720}, "1280x720"),
    ],
)
def test_seedream_registry_normalizes_fal_size_values(size, expected_size):
    route = ModelRoute("SEEDREAM", "seedream-5.0-pro", "image", "image.generate")
    factory = load_genblaze_bindings().media_registry_factory
    assert factory is not None
    registry = factory("image", (route,))
    step = Step(
        provider="gmicloud-image",
        model=route.gmi_model,
        modality=Modality.IMAGE,
        prompt="landscape",
        params={"size": size, "output_format": "png", "number_of_images": 1},
    )

    assert registry.prepare_payload(step) == {
        "prompt": "landscape",
        "size": expected_size,
        "output_format": "png",
    }


def test_real_gmicloud_provider_submits_minimal_seedream_pro_wire_payload():
    route = ModelRoute("SEEDREAM", "seedream-5.0-pro", "image", "image.generate")
    factory = load_genblaze_bindings().media_registry_factory
    assert factory is not None
    client = FakeChatClient({"request_id": "offline-seedream-job"})
    provider = GMICloudImageProvider(
        http_client=client,
        models=factory("image", (route,)),
    )

    result = provider.submit(
        Step(
            provider=provider.name,
            model=route.gmi_model,
            modality=Modality.IMAGE,
            prompt="a portrait",
            params={
                "aspect_ratio": "9:16",
                "resolution": "1k",
                "number_of_images": 1,
                "output_format": "png",
            },
        )
    )

    assert result.prediction_id == "offline-seedream-job"
    assert client.calls == [
        (
            "/requests",
            {
                "model": "seedream-5.0-pro",
                "payload": {
                    "prompt": "a portrait",
                    "size": "1024x1792",
                    "output_format": "png",
                },
            },
        )
    ]


@pytest.mark.parametrize(
    ("samsar_model", "upstream_model", "resolution", "expected_size"),
    [
        ("NANOBANANA2", "gemini-3.1-flash-image", "512", "512"),
        ("NANOBANANA2", "gemini-3.1-flash-image", "0.5k", "512"),
        ("NANOBANANA2", "gemini-3.1-flash-image", "auto_1K", "1K"),
        ("NANOBANANA2", "gemini-3.1-flash-image", "2k", "2K"),
        ("NANOBANANAPRO", "gemini-3-pro-image", "auto_2K", "2K"),
        ("NANOBANANAPRO", "gemini-3-pro-image", "4k", "4K"),
    ],
)
def test_nano_registry_uses_live_image_field_names(
    samsar_model,
    upstream_model,
    resolution,
    expected_size,
):
    route = ModelRoute(samsar_model, upstream_model, "image", "image.generate")
    factory = load_genblaze_bindings().media_registry_factory
    assert factory is not None
    registry = factory("image", (route,))
    step = Step(
        provider="gmicloud-image",
        model=route.gmi_model,
        modality=Modality.IMAGE,
        prompt="portrait",
        params={
            "aspect_ratio": " 9 x 16 ",
            "resolution": resolution,
            "output_format": "png",
            "number_of_images": 1,
        },
    )

    assert registry.prepare_payload(step) == {
        "prompt": "portrait",
        "aspect_ratio": "9:16",
        "image_size": expected_size,
        "image_output_format": "png",
    }


@pytest.mark.parametrize(
    ("samsar_model", "upstream_model", "aspect_ratios"),
    [
        (
            "NANOBANANA2",
            "gemini-3.1-flash-image",
            ("1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"),
        ),
        (
            "NANOBANANAPRO",
            "gemini-3-pro-image",
            ("1:1", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"),
        ),
    ],
)
def test_nano_registry_preserves_every_exact_gmicloud_aspect_ratio(
    samsar_model,
    upstream_model,
    aspect_ratios,
):
    route = ModelRoute(samsar_model, upstream_model, "image", "image.generate")
    factory = load_genblaze_bindings().media_registry_factory
    assert factory is not None
    registry = factory("image", (route,))

    for aspect_ratio in aspect_ratios:
        step = Step(
            provider="gmicloud-image",
            model=route.gmi_model,
            modality=Modality.IMAGE,
            prompt="preserve this canvas shape",
            params={
                "aspect_ratio": aspect_ratio,
                "resolution": "1k",
                "output_format": "png",
                "number_of_images": 1,
            },
        )
        assert registry.prepare_payload(step) == {
            "prompt": "preserve this canvas shape",
            "aspect_ratio": aspect_ratio,
            "image_size": "1K",
            "image_output_format": "png",
        }


@pytest.mark.parametrize("aspect_ratio", ["3:2", "2:3"])
def test_nano_pro_registry_rejects_ratios_missing_from_gmicloud_contract(
    aspect_ratio,
):
    route = ModelRoute(
        "NANOBANANAPRO",
        "gemini-3-pro-image",
        "image",
        "image.generate",
    )
    factory = load_genblaze_bindings().media_registry_factory
    assert factory is not None
    registry = factory("image", (route,))
    step = Step(
        provider="gmicloud-image",
        model=route.gmi_model,
        modality=Modality.IMAGE,
        prompt="do not approximate this ratio",
        params={"aspect_ratio": aspect_ratio, "resolution": "1k"},
    )

    with pytest.raises(ProviderError, match="expected one of"):
        registry.prepare_payload(step)


def test_nano_registry_rejects_fields_and_formats_absent_from_the_gmi_contract():
    route = ModelRoute(
        "NANOBANANA2",
        "gemini-3.1-flash-image",
        "image",
        "image.generate",
    )
    factory = load_genblaze_bindings().media_registry_factory
    assert factory is not None
    registry = factory("image", (route,))

    with pytest.raises(ProviderError, match="png or jpeg"):
        registry.prepare_payload(
            Step(
                provider="gmicloud-image",
                model=route.gmi_model,
                modality=Modality.IMAGE,
                prompt="keep the wire strict",
                params={"aspect_ratio": "1:1", "output_format": "webp"},
            )
        )

    for unsupported_field in ("seed", "negative_prompt"):
        with pytest.raises(ProviderError, match="Unknown parameters"):
            registry.prepare_payload(
                Step(
                    provider="gmicloud-image",
                    model=route.gmi_model,
                    modality=Modality.IMAGE,
                    prompt="keep the wire strict",
                    params={
                        "aspect_ratio": "1:1",
                        "output_format": "png",
                        unsupported_field: 7,
                    },
                )
            )


@pytest.mark.parametrize(
    ("samsar_model", "upstream_model", "params", "expected_payload"),
    [
        (
            "GPTIMAGE2",
            "gpt-image-2-generate",
            {
                "aspect_ratio": "16:9",
                "size": "1536x864",
                "quality": "high",
                "output_format": "png",
                "number_of_images": 1,
            },
            {
                "prompt": "an exact contract",
                "size": "1536x864",
                "quality": "high",
                "output_format": "png",
                "n": 1,
            },
        ),
        (
            "NANOBANANA2",
            "gemini-3.1-flash-image",
            {
                "aspect_ratio": "21:9",
                "resolution": "0.5K",
                "output_format": "png",
                "number_of_images": 1,
            },
            {
                "prompt": "an exact contract",
                "aspect_ratio": "21:9",
                "image_size": "512",
                "image_output_format": "png",
            },
        ),
        (
            "NANOBANANAPRO",
            "gemini-3-pro-image",
            {
                "aspect_ratio": "4:5",
                "resolution": "2K",
                "output_format": "jpeg",
                "number_of_images": 1,
            },
            {
                "prompt": "an exact contract",
                "aspect_ratio": "4:5",
                "image_size": "2K",
                "image_output_format": "jpeg",
            },
        ),
    ],
)
def test_real_gmicloud_provider_submits_exact_gpt_and_nano_wire_payloads(
    samsar_model,
    upstream_model,
    params,
    expected_payload,
):
    route = ModelRoute(samsar_model, upstream_model, "image", "image.generate")
    factory = load_genblaze_bindings().media_registry_factory
    assert factory is not None
    client = FakeChatClient({"request_id": "offline-image-job"})
    provider = GMICloudImageProvider(
        http_client=client,
        models=factory("image", (route,)),
    )

    result = provider.submit(
        Step(
            provider=provider.name,
            model=route.gmi_model,
            modality=Modality.IMAGE,
            prompt="an exact contract",
            params=params,
        )
    )

    assert result.prediction_id == "offline-image-job"
    assert client.calls == [
        (
            "/requests",
            {"model": upstream_model, "payload": expected_payload},
        )
    ]


@pytest.mark.parametrize(
    ("samsar_model", "params", "expected_params", "expected_inputs"),
    [
        (
            "KLINGIMGTOVID3PRO",
            {"duration": 8, "aspect_ratio": "16:9", "generate_audio": True},
            {"duration": "8", "sound": "on", "mode": "pro"},
            {"image": "https://example/start.png", "image_tail": "https://example/end.png"},
        ),
        (
            "SEEDANCEI2V",
            {
                "duration": 7,
                "aspect_ratio": " 9 x 16 ",
                "generate_audio": True,
                "seed": 7,
            },
            {"duration": 7, "ratio": "9:16", "generate_audio": True, "seed": 7},
            {
                "first_frame": "https://example/start.png",
                "last_frame": "https://example/end.png",
            },
        ),
    ],
)
def test_custom_video_registry_preserves_params_and_two_frame_order(
    samsar_model,
    params,
    expected_params,
    expected_inputs,
):
    route = ModelRoute(
        samsar_model=samsar_model,
        gmi_model="upstream-video-model",
        modality="video",
        operation="video.generate",
    )
    factory = load_genblaze_bindings().media_registry_factory
    assert factory is not None
    registry = factory("video", (route,))
    step = Step(
        provider="gmicloud",
        model=route.gmi_model,
        modality=Modality.VIDEO,
        prompt="animate",
        params=params,
        inputs=[
            Asset(url="https://example/start.png", media_type="image/png"),
            Asset(url="https://example/end.png", media_type="image/png"),
        ],
    )

    assert registry.prepare_payload(step) == {
        "prompt": "animate",
        **expected_params,
        **expected_inputs,
    }

    step.params["unsupported_control"] = "must-not-pass"
    with pytest.raises(ProviderError, match="Unknown parameters"):
        registry.prepare_payload(step)


@pytest.mark.parametrize(
    ("samsar_model", "upstream_model", "params", "expected"),
    [
        (
            "VEO3.1I2V",
            "veo-3.1-generate-001",
            {
                "duration": 5.9,
                "aspect_ratio": "9/16",
                "generate_audio": "true",
                "negative_prompt": "no text",
                "person_generation": "allow adult",
                "resolution": "1080P",
                "seed": "42",
            },
            {
                "durationSeconds": 6,
                "aspectRatio": "9:16",
                "generateAudio": True,
                "negativePrompt": "no text",
                "personGeneration": "allow_adult",
                "resolution": "1080p",
                "seed": 42,
            },
        ),
        (
            "HAPPYHORSEI2V",
            "happyhorse-1.1-i2v",
            {
                "duration": 8,
                "aspect_ratio": "9:16",
                "generate_audio": False,
                "resolution": "1080p",
                "seed": "2147483647",
            },
            {"duration": 10, "resolution": "720P", "seed": 2147483647},
        ),
    ],
)
def test_video_registry_uses_exact_live_gmi_field_names(
    samsar_model,
    upstream_model,
    params,
    expected,
):
    route = ModelRoute(samsar_model, upstream_model, "video", "video.generate")
    factory = load_genblaze_bindings().media_registry_factory
    assert factory is not None
    registry = factory("video", (route,))
    step = Step(
        provider="gmicloud",
        model=upstream_model,
        modality=Modality.VIDEO,
        prompt="animate",
        params=params,
        inputs=[
            Asset(url="https://example/start.png", media_type="image/png"),
        ],
    )

    assert registry.prepare_payload(step) == {
        "prompt": "animate",
        **expected,
        **(
            {
                "image": "https://example/start.png",
            }
            if samsar_model == "VEO3.1I2V"
            else {"first_frame": "https://example/start.png"}
        ),
    }

    if samsar_model == "HAPPYHORSEI2V":
        step.params["seed"] = 2_147_483_648
        with pytest.raises(ProviderError, match="HappyHorse seed"):
            registry.prepare_payload(step)


def test_real_gmicloud_provider_submits_the_translated_kling_wire_payload():
    route = ModelRoute(
        "KLINGIMGTOVID3PRO",
        "kling-v3-image-to-video",
        "video",
        "video.generate",
    )
    factory = load_genblaze_bindings().media_registry_factory
    assert factory is not None
    client = FakeChatClient({"request_id": "offline-video-job"})
    provider = GMICloudVideoProvider(
        http_client=client,
        models=factory("video", (route,)),
    )
    step = Step(
        provider=provider.name,
        model=route.gmi_model,
        modality=Modality.VIDEO,
        prompt="slow orbit",
        params={
            "duration": 8,
            "aspect_ratio": "16:9",
            "generate_audio": True,
        },
        inputs=[Asset(url="https://example/start.png", media_type="image/png")],
    )

    result = provider.submit(step)

    assert result.prediction_id == "offline-video-job"
    assert client.calls == [
        (
            "/requests",
            {
                "model": "kling-v3-image-to-video",
                "payload": {
                    "prompt": "slow orbit",
                    "duration": "8",
                    "sound": "on",
                    "mode": "pro",
                    "image": "https://example/start.png",
                },
            },
        )
    ]


def test_real_gmicloud_provider_submits_the_distinct_kling_turbo_wire_payload():
    route = ModelRoute(
        "KLINGIMGTOVIDTURBO",
        "kling-3.0-turbo-i2v",
        "video",
        "video.generate",
    )
    factory = load_genblaze_bindings().media_registry_factory
    assert factory is not None
    client = FakeChatClient({"request_id": "offline-turbo-video-job"})
    provider = GMICloudVideoProvider(
        http_client=client,
        models=factory("video", (route,)),
    )
    step = Step(
        provider=provider.name,
        model=route.gmi_model,
        modality=Modality.VIDEO,
        prompt="slow orbit",
        params={
            "duration": 5,
            "aspect_ratio": "9:16",
            "generate_audio": False,
            "mode": "std",
        },
        inputs=[Asset(url="https://example/start.png", media_type="image/png")],
    )

    result = provider.submit(step)

    assert result.prediction_id == "offline-turbo-video-job"
    assert client.calls == [
        (
            "/requests",
            {
                "model": "kling-3.0-turbo-i2v",
                "payload": {
                    "prompt": "slow orbit",
                    "duration": "5",
                    "resolution": "720p",
                    "first_frame": "https://example/start.png",
                },
            },
        )
    ]


@pytest.mark.parametrize(
    ("outcome", "expected_url"),
    [
        (
            {"media_urls": [{"url": "https://cdn.example/modern.mp4"}]},
            "https://cdn.example/modern.mp4",
        ),
        (
            {"video_url": "https://cdn.example/legacy.mp4"},
            "https://cdn.example/legacy.mp4",
        ),
    ],
)
def test_real_gmicloud_video_provider_normalizes_modern_and_legacy_outputs(
    outcome,
    expected_url,
):
    route = ModelRoute("VEO3.1", "veo-3.1-generate-001", "video", "video.generate")
    factory = load_genblaze_bindings().media_registry_factory
    assert factory is not None
    client = FakeChatClient({"status": "success", "outcome": outcome})
    provider = GMICloudVideoProvider(
        http_client=client,
        models=factory("video", (route,)),
    )
    step = Step(
        provider=provider.name,
        model=route.gmi_model,
        modality=Modality.VIDEO,
        prompt="sunrise",
    )

    assert provider.poll("offline-video-job") is True
    result = provider.fetch_output("offline-video-job", step)

    assert [(asset.url, asset.media_type) for asset in result.assets] == [
        (expected_url, "video/mp4")
    ]


def test_real_gmicloud_provider_submits_gpt_edit_source_with_optional_mask():
    route = ModelRoute(
        "GPTIMAGE2EDIT",
        "gpt-image-2-edit",
        "image",
        "image.edit",
    )
    factory = load_genblaze_bindings().media_registry_factory
    assert factory is not None
    client = FakeChatClient({"request_id": "offline-image-edit-job"})
    provider = GMICloudImageProvider(
        http_client=client,
        models=factory("image", (route,)),
    )
    source = Asset(url="https://example/source.png", media_type="image/png")
    mask = Asset(url="https://example/mask.png", media_type="image/png")

    provider.submit(
        Step(
            provider=provider.name,
            model=route.gmi_model,
            modality=Modality.IMAGE,
            prompt="change the background",
            params={"size": "1024x1024", "quality": "high"},
            inputs=[source],
        )
    )
    provider.submit(
        Step(
            provider=provider.name,
            model=route.gmi_model,
            modality=Modality.IMAGE,
            prompt="paint a rainbow",
            inputs=[source, mask],
        )
    )

    assert client.calls == [
        (
            "/requests",
            {
                "model": "gpt-image-2-edit",
                "payload": {
                    "prompt": "change the background",
                    "size": "1024x1024",
                    "quality": "high",
                    "image": "https://example/source.png",
                },
            },
        ),
        (
            "/requests",
            {
                "model": "gpt-image-2-edit",
                "payload": {
                    "prompt": "paint a rainbow",
                    "image": "https://example/source.png",
                    "mask": "https://example/mask.png",
                },
            },
        ),
    ]


def test_seedance_1_5_normalizes_duration_and_ratio():
    factory = load_genblaze_bindings().media_registry_factory
    assert factory is not None
    seedance_1_5 = ModelRoute(
        "SEEDANCEI2V",
        "seedance-1-5-pro-251215",
        "video",
        "video.generate",
    )
    registry = factory("video", (seedance_1_5,))

    first = Step(
        provider="gmicloud",
        model=seedance_1_5.gmi_model,
        modality=Modality.VIDEO,
        prompt="move",
        params={"duration": 2, "aspect_ratio": "landscape_16_9"},
        inputs=[Asset(url="https://example/start.png", media_type="image/png")],
    )
    assert registry.prepare_payload(first) == {
        "prompt": "move",
        "duration": 4,
        "ratio": "16:9",
        "first_frame": "https://example/start.png",
    }

    first.params["aspect_ratio"] = "auto"
    with pytest.raises(ProviderError, match="expected one of"):
        registry.prepare_payload(first)


def test_veo_invalid_text_to_video_hints_fall_back_like_native_adapter():
    route = ModelRoute("VEO3.1", "veo-3.1-generate-001", "video", "video.generate")
    factory = load_genblaze_bindings().media_registry_factory
    assert factory is not None
    registry = factory("video", (route,))
    step = Step(
        provider="gmicloud",
        model=route.gmi_model,
        modality=Modality.VIDEO,
        prompt="sunrise",
        params={
            "duration": "not-a-duration",
            "aspect_ratio": "auto",
            "resolution": "auto",
        },
    )

    assert registry.prepare_payload(step) == {
        "prompt": "sunrise",
        "durationSeconds": 8,
        "aspectRatio": "16:9",
    }


def test_kling_v3_pro_and_turbo_use_distinct_exact_gmi_contracts():
    routes = (
        ModelRoute("KLINGIMGTOVID3PRO", "kling-v3-image-to-video", "video", "video.generate"),
        ModelRoute("KLINGIMGTOVIDTURBO", "kling-3.0-turbo-i2v", "video", "video.generate"),
    )
    factory = load_genblaze_bindings().media_registry_factory
    assert factory is not None
    registry = factory("video", routes)
    source = Asset(url="https://example/start.png", media_type="image/png")

    pro = Step(
        provider="gmicloud",
        model="kling-v3-image-to-video",
        modality=Modality.VIDEO,
        prompt="orbit",
        params={"duration": 5, "generate_audio": False},
        inputs=[source],
    )
    assert registry.prepare_payload(pro) == {
        "prompt": "orbit",
        "duration": "5",
        "sound": "off",
        "mode": "pro",
        "image": "https://example/start.png",
    }

    turbo = Step(
        provider="gmicloud",
        model="kling-3.0-turbo-i2v",
        modality=Modality.VIDEO,
        prompt="orbit",
        params={
            "duration": 5,
            "aspect_ratio": "9:16",
            "generate_audio": True,
            "mode": "std",
            "resolution": "1080p",
        },
        inputs=[source],
    )
    assert registry.prepare_payload(turbo) == {
        "prompt": "orbit",
        "duration": "5",
        "resolution": "720p",
        "first_frame": "https://example/start.png",
    }


@pytest.mark.parametrize(
    ("samsar_model", "upstream_model"),
    [
        ("KLINGIMGTOVIDPRO", "Kling-Image2Video-V1.6-Pro"),
        ("KLINGIMGTOVID2.1MASTER", "Kling-Image2Video-V2.1-Master"),
        ("KLINGIMGTOVID2.1PRO", "Kling-Image2Video-V2.1-Pro"),
        ("KLINGIMGTOVID2.1STANDARD", "Kling-Image2Video-V2.1-Standard"),
    ],
)
def test_legacy_kling_registry_uses_only_exact_supported_wire_fields(
    samsar_model,
    upstream_model,
):
    route = ModelRoute(samsar_model, upstream_model, "video", "video.generate")
    factory = load_genblaze_bindings().media_registry_factory
    assert factory is not None
    registry = factory("video", (route,))
    step = Step(
        provider="gmicloud",
        model=upstream_model,
        modality=Modality.VIDEO,
        prompt="orbit",
        params={
            "duration": 10,
            "aspect_ratio": "16:9",
            "resolution": "1080P",
            "generate_audio": True,
            "seed": 42,
        },
        inputs=[Asset(url="https://example/start.png", media_type="image/png")],
    )

    assert registry.prepare_payload(step) == {
        "prompt": "orbit",
        "duration": "10",
        "image": "https://example/start.png",
    }
    step.params["duration"] = 6
    with pytest.raises(ProviderError, match="legacy Kling duration must be 5 or 10"):
        registry.prepare_payload(step)


def test_hailuo_pro_registry_forces_the_exact_1080p_six_second_contract():
    route = ModelRoute("HAILUOPRO", "Minimax-Hailuo-02", "video", "video.generate")
    factory = load_genblaze_bindings().media_registry_factory
    assert factory is not None
    registry = factory("video", (route,))
    step = Step(
        provider="gmicloud",
        model=route.gmi_model,
        modality=Modality.VIDEO,
        prompt="crane shot",
        params={
            "duration": 10,
            "resolution": "720P",
            "aspect_ratio": "16:9",
            "generate_audio": True,
            "prompt_optimizer": "false",
        },
        inputs=[Asset(url="https://example/start.png", media_type="image/png")],
    )

    assert registry.prepare_payload(step) == {
        "prompt": "crane shot",
        "duration": 6,
        "resolution": "1080P",
        "prompt_optimizer": False,
        "first_frame_image": "https://example/start.png",
    }


def test_full_media_catalog_builds_with_shared_upstream_ids():
    image_pairs = {
        "GPTIMAGE2": "gpt-image-2-generate",
        "GPTIMAGE2EDIT": "gpt-image-2-edit",
        "SEEDREAM": "seedream-5.0-pro",
        "NANOBANANA2": "gemini-3.1-flash-image",
        "NANOBANANA2EDIT": "gemini-3.1-flash-image",
        "NANOBANANAPRO": "gemini-3-pro-image",
        "NANOBANANAPROEDIT": "gemini-3-pro-image",
        "BRIA_ERASER": "bria-eraser",
        "BRIA_GENFILL": "bria-genfill",
    }
    video_pairs = {
        "VEO3.1": "veo-3.1-generate-001",
        "VEO3.1I2V": "veo-3.1-generate-001",
        "VEO3.1FLIV": "veo-3.1-generate-001",
        "VEO3.1FAST": "veo-3.1-fast-generate-001",
        "VEO3.1I2VFAST": "veo-3.1-fast-generate-001",
        "SEEDANCEI2V": "seedance-1-5-pro-251215",
        "KLINGIMGTOVID3PRO": "kling-v3-image-to-video",
        "KLINGIMGTOVIDTURBO": "kling-3.0-turbo-i2v",
        "KLINGIMGTOVIDPRO": "Kling-Image2Video-V1.6-Pro",
        "KLINGIMGTOVID2.1MASTER": "Kling-Image2Video-V2.1-Master",
        "KLINGIMGTOVID2.1PRO": "Kling-Image2Video-V2.1-Pro",
        "KLINGIMGTOVID2.1STANDARD": "Kling-Image2Video-V2.1-Standard",
        "HAILUOPRO": "Minimax-Hailuo-02",
        "HAPPYHORSEI2V": "happyhorse-1.1-i2v",
    }
    audio_pairs = {
        "ELEVENLABS": "elevenlabs-tts-multilingual-v2",
        "OPENAI_TTS": "gpt-4o-mini-tts",
    }
    image_routes = tuple(
        ModelRoute(
            model,
            upstream,
            "image",
            "image.edit" if model.endswith("EDIT") or model.startswith("BRIA_") else "image.generate",
        )
        for model, upstream in image_pairs.items()
    )
    video_routes = tuple(
        ModelRoute(model, upstream, "video", "video.generate")
        for model, upstream in video_pairs.items()
    )
    audio_routes = tuple(
        ModelRoute(model, upstream, "audio", "audio.generate")
        for model, upstream in audio_pairs.items()
    )
    factory = load_genblaze_bindings().media_registry_factory
    assert factory is not None

    image_registry = factory("image", image_routes)
    video_registry = factory("video", video_routes)
    audio_registry = factory("audio", audio_routes)

    assert set(image_registry.known()) == set(image_pairs.values())
    assert set(video_registry.known()) == set(video_pairs.values())
    assert set(audio_registry.known()) == set(audio_pairs.values())

    # The shared Veo slug has optional first/last image slots: T2V adds
    # nothing, while the FLIV route maps both without duplicate registration.
    text_to_video = Step(
        provider="gmicloud",
        model="veo-3.1-generate-001",
        modality=Modality.VIDEO,
        prompt="sunrise",
    )
    assert video_registry.prepare_payload(text_to_video) == {"prompt": "sunrise"}

    image_to_video = Step(
        provider="gmicloud",
        model="veo-3.1-generate-001",
        modality=Modality.VIDEO,
        prompt="move",
        inputs=[
            Asset(url="https://example/start.png", media_type="image/png"),
            Asset(url="https://example/end.png", media_type="image/png"),
        ],
    )
    assert video_registry.prepare_payload(image_to_video) == {
        "prompt": "move",
        "image": "https://example/start.png",
        "lastFrame": "https://example/end.png",
        "resolution": "720p",
    }
