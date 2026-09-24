# Model matrix

Start with [hosted Samsar Studio](https://app.samsar.one) or [samsar-js](https://www.npmjs.com/package/samsar-js). The tables below cover every model in the standalone setup registry, then identify additional Studio catalog entries and service-specific models separately.

**Read across a row:** choose the Samsar request key, open its API reference, then expand into a supported deployment adapter. Samsar.js appears first for media; native inference adapters may lead the inference rows. This is documentation order, not an override of your saved runtime priority.

**Availability is scoped.** “Samsar” means a managed route is documented or registered, not a live health check. “Deployment only” requires a local adapter. “Studio catalog” entries are not a claim of current endpoint availability. Express and branching are separate allowlists, and their runtime responses can narrow the lists further.

[Hosted API overview](https://docs.samsar.one/) · [Pricing](https://docs.samsar.one/pricing) · [Provider setup and routing](providers-and-models.md) · [Setup wizard](setup-wizard.md)

## Choose a modality

- [Inference & vision](#inference) — Plan scenes, understand images, write copy and build assistants.
- [Image generation](#image) — Create scene images, illustrations and reusable visual assets.
- [Image editing](#image-edit) — Edit reference images, remove objects and fill selected regions.
- [Video generation](#video) — Generate motion from text, an image or first and last frames.
- [Speech](#speech) — Turn dialogue into narration and voice tracks.
- [Music](#music) — Generate a backing track for your video or an audio asset.
- [Lip sync](#lip-sync) — Match a visible speaker to a supplied audio track.
- [Sound effects](#sound) — Add sound to an existing video or generate an audio effect.
- [Embeddings & search](#embeddings) — Index content for semantic search and recommendations.
- [Transcription](#transcription) — Align speech with text for transcripts and subtitles.

<a id="inference"></a>

## Inference & vision

Plan scenes, understand images, write copy and build assistants.

**Request field:** inference_model (workflow) / model (chat). [Samsar API reference](https://docs.samsar.one/external-requests#chat).

| Model / request key | Hosted path | Supported deployment adapters | Workflow scope | Notes |
| --- | --- | --- | --- | --- |
| GPT 6 Astra · `gpt-6-astra` (setup: `gpt-5.6-sol`) | [Samsar.js](https://docs.samsar.one/external-requests#chat) | [OpenAI](https://platform.openai.com/docs/overview) · [Samsar.js](https://docs.samsar.one/external-requests) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [OpenRouter](https://openrouter.ai/docs/quickstart) | Branching | Current public key. Older setup files may contain gpt-5.6-sol; the processor normalizes that alias. GenBlaze still requires an exact validated mapping. |
| Claude Opus 5.5 · `claude-opus-5.5` | [Samsar.js](https://docs.samsar.one/external-requests#chat) | [Anthropic](https://platform.claude.com/docs/en/api/overview) · [Samsar.js](https://docs.samsar.one/external-requests) · [OpenRouter](https://openrouter.ai/docs/quickstart) | Branching | Enable a supported adapter and check the target deployment before selecting this model. |
| Gemini 3.1 Pro · `gemini-3.1-pro` | [Samsar.js](https://docs.samsar.one/external-requests#chat) | [Google Cloud](https://cloud.google.com/vertex-ai/generative-ai/docs) · [Samsar.js](https://docs.samsar.one/external-requests) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [OpenRouter](https://openrouter.ai/docs/quickstart) | Modality API / Studio | Enable a supported adapter and check the target deployment before selecting this model. |
| Kimi K3 · `kimi-k3` (setup: `KIMIK3`) | [Samsar.js](https://docs.samsar.one/external-requests#chat) | [Kimi](https://platform.kimi.ai/docs/overview) · [Samsar.js](https://docs.samsar.one/external-requests) | Modality API / Studio | Setup key KIMIK3; inference requests use kimi-k3. Native Kimi first, then Samsar; OpenRouter is not in this chain. |
| Qwen 3.8 Max · `QWEN3.8` | [Samsar.js](https://docs.samsar.one/external-requests#chat) | [Alibaba Cloud](https://www.alibabacloud.com/help/en/model-studio/) · [Samsar.js](https://docs.samsar.one/external-requests) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [OpenRouter](https://openrouter.ai/docs/quickstart) | Modality API / Studio | Native Alibaba is a Docker option. Hosted Qwen uses OpenRouter internally; callers still use Samsar.js. |
| GPT 6 Astra · extra high reasoning · `gpt-6-astra-xhigh` | [Samsar.js](https://docs.samsar.one/external-requests#chat) | [OpenAI](https://platform.openai.com/docs/overview) · [Samsar.js](https://docs.samsar.one/external-requests) · [OpenRouter](https://openrouter.ai/docs/quickstart) | Branching | Reasoning option on GPT 6 Astra, not a separate provider model. Omitted from the normal runtime catalog. |

<a id="image"></a>

## Image generation

Create scene images, illustrations and reusable visual assets.

**Request field:** image_model (workflow) / model (image). [Samsar API reference](https://docs.samsar.one/image-api#post-imagetext_to_image).

| Model / request key | Hosted path | Supported deployment adapters | Workflow scope | Notes |
| --- | --- | --- | --- | --- |
| Qwen Image 3.0 Pro · `QWENIMAGE3PRO` | Deployment only | [Alibaba Cloud](https://www.alibabacloud.com/help/en/model-studio/) | Express | Standalone native adapter only. Requires Alibaba standard pay-as-you-go credentials; Token Plan credentials do not enable it. |
| GPT Image 2.5 · `GPTIMAGE2` | [Samsar.js](https://docs.samsar.one/image-api#post-imagetext_to_image) | [Samsar.js](https://docs.samsar.one/external-requests) · [OpenAI](https://platform.openai.com/docs/overview) · [fal](https://fal.ai/docs/documentation) | Express · Branching | Stable Samsar key for GPT Image 2.5. Legacy GenBlaze GPT Image 2 routes are excluded from this model. |
| Seedream 5 Pro · `SEEDREAM` | [Samsar.js](https://docs.samsar.one/image-api#post-imagetext_to_image) | [Samsar.js](https://docs.samsar.one/external-requests) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Express | Stable key currently maps to Seedream 5 Pro. |
| Nano Banana 2 · `NANOBANANA2` | [Samsar.js](https://docs.samsar.one/image-api#post-imagetext_to_image) | [Samsar.js](https://docs.samsar.one/external-requests) · [Google Cloud](https://cloud.google.com/vertex-ai/generative-ai/docs) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Image generation catalog model; not in the current Express image allowlist. |
| Nano Banana Pro · `NANOBANANAPRO` | [Samsar.js](https://docs.samsar.one/image-api#post-imagetext_to_image) | [Samsar.js](https://docs.samsar.one/external-requests) · [Google Cloud](https://cloud.google.com/vertex-ai/generative-ai/docs) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Express · Branching | Enable a supported adapter and check the target deployment before selecting this model. |
| Wan 2.7 Pro · `WAN2.7PRO` | [Samsar.js](https://docs.samsar.one/image-api#post-imagetext_to_image) | [Samsar.js](https://docs.samsar.one/external-requests) · [Alibaba Cloud](https://www.alibabacloud.com/help/en/model-studio/) · [fal](https://fal.ai/docs/documentation) | Express | Enable a supported adapter and check the target deployment before selecting this model. |
| Custom image endpoint · `CUSTOM_TEXT_TO_IMAGE:<adapter-id>` | Deployment only | [Custom endpoint](https://github.com/samsarone/samsar/blob/main/utils/vast-flux2/README.md) | Custom endpoint | Register a named standalone image adapter; use the exact returned key. Includes the optional Vast.ai FLUX.2 utility. |

<details>
<summary>Additional image generation entries in the Studio source catalog (17)</summary>

These entries are outside the standalone setup registry. Check the target Studio and its configured provider before using them. They are not added to the Express or branching allowlist by appearing here.

| Model | Catalog key |
| --- | --- |
| F-Lite | `FLITE` |
| Google Imagen3 | `IMAGEN3` |
| Flux-1.1 Pro | `FLUX1.1PRO` |
| Dall-E 3 | `DALLE3` |
| Flux-1 Pro | `FLUX1PRO` |
| Flux 1.1 Ultra | `FLUX1.1ULTRA` |
| Flux-1 Dev | `FLUX1DEV` |
| Recraft V3 | `RECRAFTV3` |
| Stable Diffusion V3.5 | `SDV3.5` |
| Sana 4.5B | `SANA4.5B` |
| Sana Sprint | `SANASPRINT` |
| Recraft 20B | `RECRAFT20B` |
| Lumalabs Photon | `PHOTON` |
| Lumalabs Photon Flash | `PHOTONFLASH` |
| Lumina V2 | `LUMINAV2` |
| Ideogram V3 | `IDEOGRAMV3` |
| HiDream I1 | `HIDREAMI1` |

</details>

<a id="image-edit"></a>

## Image editing

Edit reference images, remove objects and fill selected regions.

**Request field:** Route-specific edit model. [Samsar API reference](https://docs.samsar.one/v2#v2-image-edit-routes).

| Model / request key | Hosted path | Supported deployment adapters | Workflow scope | Notes |
| --- | --- | --- | --- | --- |
| GPT Image 2.5 Edit · `GPTIMAGE2EDIT` | [Samsar.js](https://docs.samsar.one/v2#v2-image-edit-routes) | [Samsar.js](https://docs.samsar.one/external-requests) · [OpenAI](https://platform.openai.com/docs/overview) | Modality API / Studio | Stable Samsar key for GPT Image 2.5 editing. Legacy GenBlaze routes are excluded. |
| Nano Banana 2 Edit · `NANOBANANA2EDIT` | [Samsar.js](https://docs.samsar.one/v2#v2-image-edit-routes) | [Samsar.js](https://docs.samsar.one/external-requests) · [Google Cloud](https://cloud.google.com/vertex-ai/generative-ai/docs) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Used by image enhancement and branding removal. Multi-output image-set jobs bypass GenBlaze. |
| Nano Banana Pro Edit · `NANOBANANAPROEDIT` | [Samsar.js](https://docs.samsar.one/v2#v2-image-edit-routes) | [Samsar.js](https://docs.samsar.one/external-requests) · [Google Cloud](https://cloud.google.com/vertex-ai/generative-ai/docs) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Required by VidGenie image-list mode. Multi-output image-set jobs bypass GenBlaze. |
| BRIA Eraser · `BRIA_ERASER` | [Samsar.js](https://docs.samsar.one/v2#v2-image-edit-routes) | [Samsar.js](https://docs.samsar.one/external-requests) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Enable a supported adapter and check the target deployment before selecting this model. |
| BRIA GenFill · `BRIA_GENFILL` | [Samsar.js](https://docs.samsar.one/v2#v2-image-edit-routes) | [Samsar.js](https://docs.samsar.one/external-requests) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Enable a supported adapter and check the target deployment before selecting this model. |

<details>
<summary>Additional image editing entries in the Studio source catalog (3)</summary>

These entries are outside the standalone setup registry. Check the target Studio and its configured provider before using them. They are not added to the Express or branching allowlist by appearing here.

| Model | Catalog key |
| --- | --- |
| Flux-1 Pro Fill | `FLUX1PROFILL` |
| Flux-1.1 Pro Ultra Redux | `FLUX1.1PROULTRAREDUX` |
| Flux-1.1 Pro Redux | `FLUX1.1PROREDUX` |

</details>

<a id="video"></a>

## Video generation

Generate motion from text, an image or first and last frames.

**Request field:** video_model. [Samsar API reference](https://docs.samsar.one/external-requests#video).

| Model / request key | Hosted path | Supported deployment adapters | Workflow scope | Notes |
| --- | --- | --- | --- | --- |
| RunwayML · `RUNWAYML` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [Runway](https://docs.dev.runwayml.com/) | Express | Express turns planned scene images into motion. This is different from a raw text-to-video model call. |
| Veo 3.1 Text to Video · `VEO3.1` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [Google Cloud](https://cloud.google.com/vertex-ai/generative-ai/docs) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Text-to-video model; the I2V variants have separate keys. |
| Veo 3.1 Fast Text to Video · `VEO3.1FAST` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [Google Cloud](https://cloud.google.com/vertex-ai/generative-ai/docs) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Fast text-to-video model; use VEO3.1I2VFAST for Express scene animation. |
| Veo 3.1 Image to Video · `VEO3.1I2V` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [Google Cloud](https://cloud.google.com/vertex-ai/generative-ai/docs) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Express · Branching | Enable a supported adapter and check the target deployment before selecting this model. |
| Veo 3.1 Fast Image to Video · `VEO3.1I2VFAST` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [Google Cloud](https://cloud.google.com/vertex-ai/generative-ai/docs) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Express · Branching | Enable a supported adapter and check the target deployment before selecting this model. |
| Veo 3.1 First/Last Frame to Video · `VEO3.1FLIV` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | First/last-frame generation; not an Express video selection. |
| Cosmos 3 Super Image to Video · `COSMOS3SUPERI2V` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [fal](https://fal.ai/docs/documentation) | Express · Branching | Enable a supported adapter and check the target deployment before selecting this model. |
| Seedance 1.5 I2V · `SEEDANCEI2V` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Express | Enable a supported adapter and check the target deployment before selecting this model. |
| Seedance 2.0 Image to Video · `SEEDANCE2.0I2V` | Deployment only | [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Express · Branching | Standalone provider-billed I2V. Exact GenBlaze route: seedance-2-0-260128. No Samsar adapter in the setup catalog. |
| Seedance 2.5 Image to Video · `SEEDANCE2.5I2V` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Express | 5, 10 or 15 second 720p scene buckets. Exact GenBlaze route: seedance-2-5-260628. Hosted worker uses GMICloud internally. |
| Kling 3 Pro Image to Video · `KLINGIMGTOVID3PRO` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Express | Enable a supported adapter and check the target deployment before selecting this model. |
| Kling Turbo Image to Video · `KLINGIMGTOVIDTURBO` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Express | Enable a supported adapter and check the target deployment before selecting this model. |
| Kling 1.6 Pro Image to Video · `KLINGIMGTOVIDPRO` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Enable a supported adapter and check the target deployment before selecting this model. |
| Kling 2.1 Master Image to Video · `KLINGIMGTOVID2.1MASTER` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Enable a supported adapter and check the target deployment before selecting this model. |
| Kling 2.1 Pro Image to Video · `KLINGIMGTOVID2.1PRO` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Enable a supported adapter and check the target deployment before selecting this model. |
| Kling 2.1 Standard Image to Video · `KLINGIMGTOVID2.1STANDARD` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Enable a supported adapter and check the target deployment before selecting this model. |
| Hailuo 02 Pro · `HAILUOPRO` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Enable a supported adapter and check the target deployment before selecting this model. |
| Happy Horse 1.1 I2V · `HAPPYHORSEI2V` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [Alibaba Cloud](https://www.alibabacloud.com/help/en/model-studio/) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Express | Stable key currently maps to Happy Horse 1.1 I2V. |
| Custom video endpoint · `CUSTOM_IMAGE_TO_VIDEO` | Deployment only | [Custom endpoint](https://github.com/samsarone/samsar/blob/main/utils/vast-flux2/README.md) | Custom endpoint | Requires a compatible standalone image-to-video adapter and its configured authorization. |

<details>
<summary>Additional video generation entries in the Studio source catalog (11)</summary>

These entries are outside the standalone setup registry. Check the target Studio and its configured provider before using them. They are not added to the Express or branching allowlist by appearing here.

| Model | Catalog key |
| --- | --- |
| Kling 3 Pro Text2Vid | `KLINGTXTTOVID3PRO` |
| SD Video | `SDVIDEO` |
| Haiper 2.0 | `HAIPER2.0` |
| Skyreels-i2v | `SKYREELSI2V` |
| Veo2 | `VEO` |
| Veo2 Img2Vid | `VEOI2V` |
| PixVerseV4.5 | `PIXVERSEI2V` |
| PixVerseV4.5 Fast | `PIXVERSEI2VFAST` |
| Pika2.2 I2V | `PIKA2.2I2V` |
| Magi Distilled | `MAGIDISTILLED` |
| Vidu Img2Vid | `VIDUI2V` |

</details>

<a id="speech"></a>

## Speech

Turn dialogue into narration and voice tracks.

**Request field:** tts_model / provider. [Samsar API reference](https://docs.samsar.one/external-requests#audio).

| Model / request key | Hosted path | Supported deployment adapters | Workflow scope | Notes |
| --- | --- | --- | --- | --- |
| OpenAI Text to Speech · `OPENAI` (setup: `OPENAI_TTS`) | [Samsar.js](https://docs.samsar.one/external-requests#audio) | [Samsar.js](https://docs.samsar.one/external-requests) · [OpenAI](https://platform.openai.com/docs/overview) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) | Modality API / Studio | Use OPENAI in the Express tts_model field. GenBlaze speech is conditional on an exact gpt-4o-mini-tts mapping. |
| Google Text to Speech · `GOOGLE` (setup: `GOOGLE_TTS`) | [Samsar.js](https://docs.samsar.one/external-requests#audio) | [Samsar.js](https://docs.samsar.one/external-requests) · [Google Cloud](https://cloud.google.com/vertex-ai/generative-ai/docs) | Modality API / Studio | Use GOOGLE in the Express tts_model field. |
| ElevenLabs Speech · `ELEVENLABS` | [Samsar.js](https://docs.samsar.one/external-requests#audio) | [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Hosted audio accepts ELEVENLABS. The standalone setup registry enables this speech model through fal only. |
| PlayAI speech · `PLAYAI` | [Samsar.js](https://docs.samsar.one/external-requests#audio) | [Samsar.js](https://docs.samsar.one/external-requests) | Modality API / Studio | Accepted by the hosted audio speech contract. Not advertised by the standalone setup matrix. |

<a id="music"></a>

## Music

Generate a backing track for your video or an audio asset.

**Request field:** backingtrack_model / model. [Samsar API reference](https://docs.samsar.one/external-requests#audio).

| Model / request key | Hosted path | Supported deployment adapters | Workflow scope | Notes |
| --- | --- | --- | --- | --- |
| Lyria 3 · `LYRIA3` | [Samsar.js](https://docs.samsar.one/external-requests#audio) | [Samsar.js](https://docs.samsar.one/external-requests) · [Google Cloud](https://cloud.google.com/vertex-ai/generative-ai/docs) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Google music credential validation can change the runtime order between Google and fal. |
| ElevenLabs Music · `ELEVENLABS_MUSIC` | [Samsar.js](https://docs.samsar.one/external-requests#audio) | [Samsar.js](https://docs.samsar.one/external-requests) · [ElevenLabs](https://elevenlabs.io/docs/overview/intro) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Enable a supported adapter and check the target deployment before selecting this model. |
| Custom music endpoint · `CUSTOM_TEXT_TO_MUSIC` | Deployment only | [Custom endpoint](https://github.com/samsarone/samsar/blob/main/utils/vast-flux2/README.md) | Custom endpoint | Requires a compatible configured text-to-music endpoint. |

<details>
<summary>Additional music entries in the Studio source catalog (2)</summary>

These entries are outside the standalone setup registry. Check the target Studio and its configured provider before using them. They are not added to the Express or branching allowlist by appearing here.

| Model | Catalog key |
| --- | --- |
| AudioCraft | `AUDIOCRAFT` |
| Cassette AI | `CASSETTEAI` |

</details>

<a id="lip-sync"></a>

## Lip sync

Match a visible speaker to a supplied audio track.

**Request field:** lip_sync_model. [Samsar API reference](https://docs.samsar.one/external-requests#video).

| Model / request key | Hosted path | Supported deployment adapters | Workflow scope | Notes |
| --- | --- | --- | --- | --- |
| Sync Lip Sync · `SYNCLIPSYNC` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Enable a supported adapter and check the target deployment before selecting this model. |
| LatentSync · `LATENTSYNC` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Enable a supported adapter and check the target deployment before selecting this model. |
| Kling Lip Sync · `KLINGLIPSYNC` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Enable a supported adapter and check the target deployment before selecting this model. |
| Hummingbird Lip Sync · `HUMMINGBIRDLIPSYNC` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Enable a supported adapter and check the target deployment before selecting this model. |
| Creatify Lip Sync · `CREATIFYLIPSYNC` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Enable a supported adapter and check the target deployment before selecting this model. |

<a id="sound"></a>

## Sound effects

Add sound to an existing video or generate an audio effect.

**Request field:** sound_effect_model. [Samsar API reference](https://docs.samsar.one/external-requests#video).

| Model / request key | Hosted path | Supported deployment adapters | Workflow scope | Notes |
| --- | --- | --- | --- | --- |
| MMAudio V2 · `MMAUDIOV2` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Video-conditioned sound. This is separate from the audio-only SDAUDIO route. |
| Mirelo AI · `MIRELOAI` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Video-conditioned sound. Provide a video URL and the desired sound prompt. |
| Audio sound effects · `SDAUDIO` | [Samsar.js](https://docs.samsar.one/external-requests#audio) | [Samsar.js](https://docs.samsar.one/external-requests) | Modality API / Studio | Hosted text-to-sound-effect audio route. Different from video-conditioned MMAudio and Mirelo. |

<a id="embeddings"></a>

## Embeddings & search

Index content for semantic search and recommendations.

**Request field:** Managed embedding model. [Samsar API reference](https://docs.samsar.one/chat-api#post-chatcreate_embedding).

| Model / request key | Hosted path | Supported deployment adapters | Workflow scope | Notes |
| --- | --- | --- | --- | --- |
| OpenAI embeddings · `text-embedding-3-large` | [Samsar.js](https://docs.samsar.one/chat-api#post-chatcreate_embedding) | [Samsar.js](https://docs.samsar.one/external-requests) · [OpenAI](https://platform.openai.com/docs/overview) | Modality API / Studio | Hosted search is accessed through Samsar.js. Local indexing still requires OPENAI_API_KEY; crawling URLs also requires FIRECRAWL_API_KEY. |

<a id="transcription"></a>

## Transcription

Align speech with text for transcripts and subtitles.

**Request field:** Managed transcription model. [Samsar API reference](https://docs.samsar.one/external-requests#audio).

| Model / request key | Hosted path | Supported deployment adapters | Workflow scope | Notes |
| --- | --- | --- | --- | --- |
| Whisper transcript alignment · `whisper-1` | [Samsar.js](https://docs.samsar.one/external-requests#audio) | [Samsar.js](https://docs.samsar.one/external-requests) · [OpenAI](https://platform.openai.com/docs/overview) | Modality API / Studio | Managed transcript-alignment route; not a freely selectable Express inference model. |

## Check your deployment

For hosted Express workflows, inspect `await samsar.getSupportedTextToVideoModels()`. For a standalone installation, query the same route on your processor:

```bash
curl http://localhost:3002/v1/video/supported_models
```

This endpoint describes Express workflows; it is not the complete Studio or audio catalog. Review `runtime/config/available-models.json` and **Settings → Model Adapters** for your local installation. GenBlaze routes additionally depend on the exact validated credential catalog.

The stable setup key `KIMIK3` is submitted as `kimi-k3` in inference requests. Older setup records may use `gpt-5.6-sol`; the processor normalizes that selection to `gpt-6-astra`. Stable media keys can retain their spelling when the underlying provider model is upgraded.

## Catalog maintenance

This page is generated from the setup registry, processor model catalogs, Express allowlist and branching allowlist, with explanations in `docs/model-catalog.mjs`. It does not query providers or submit paid jobs.

```bash
node scripts/generate-model-docs.mjs
node scripts/generate-model-docs.mjs --check
```

Maintainers working in the parent workspace can also refresh the docs website snapshot with `node scripts/generate-model-docs.mjs --docs-site ../samsar-docs`. The docs website builds from that committed snapshot and does not require a sibling checkout.
