# Samsar Studio Client

![Samsar Studio overview](./docs/screenshots/overview.png)

![React](https://img.shields.io/badge/React-18-20232a?style=for-the-badge&logo=react&logoColor=61dafb)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![Konva](https://img.shields.io/badge/Konva-Canvas-FF6F00?style=for-the-badge&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-4-38B2AC?style=for-the-badge&logo=tailwindcss&logoColor=white)
![React Router](https://img.shields.io/badge/React_Router-6-CA4245?style=for-the-badge&logo=react-router&logoColor=white)

Samsar Studio Client is the React and Vite application behind SamsarOne's video, image, and audio creation workspace. It gives a beginner a simple "type a story, render a video" path through VidGenie, while still giving an advanced editor frame-level timeline controls, model routing, audio automation, inpainting, AI video post-processing, custom adapters, JSON request mode, and publish/export workflows.

The project is best understood as three connected creation surfaces:

| Surface | Route | Best for | User level |
| --- | --- | --- | --- |
| **VidGenie** | `/vidgenie/:id` | One-shot text-to-video and image-list-to-video creation | Beginner to API power user |
| **Studio** | `/video/:id` | Full video editing, render control, scene/layer/timeline finishing | Intermediate to advanced |
| **Image Studio** | `/image/studio/:id` | Standalone image generation, edit, upload, canvas, layer, and export workflows | Beginner to advanced |

Hosted app: [app.samsar.one](https://app.samsar.one)<br>
Product/API docs: [docs.samsar.one](https://docs.samsar.one)

## Quick Mental Model

Samsar builds a video as a structured session. A session contains scenes, visual layers, video layers, audio layers, text/subtitle items, hints, render settings, and generated media artifacts. VidGenie creates that session quickly. Studio opens the same session for detailed editing.

For beginners, this means:

1. Open VidGenie.
2. Choose `T2V` or `I2V`.
3. Enter a prompt or upload images.
4. Render.
5. Open the result in Studio if it needs refinement.

For advanced users, the same flow exposes:

1. JSON request mode with validated request bodies.
2. One-step or two-step generation checkpoints.
3. Detailed status polling and timeline previews while the render is still running.
4. Scene-level and layer-level post-processing in Studio.
5. Render cancellation, frame regeneration, checkpoint restarts, publish, download, and clone workflows.

## Product Tour

### VidGenie

![VidGenie timeline preview](./docs/screenshots/vidgenie-text-to-video.png)

VidGenie is the fast creator. It supports two creation modes:

| Mode | What the user gives | What Samsar creates |
| --- | --- | --- |
| `T2V` | A text prompt, image model, video model, aspect ratio, duration, language, subtitles, and optional advanced settings | A complete multi-stage video session |
| `I2V` | One or more image URLs or uploaded images, optional titles, per-image text, video model, aspect ratio, language, subtitles, and optional advanced settings | A video sequence driven by the supplied images |

Key VidGenie features:

- **Wizard mode** for non-technical users.
- **Audio-language selection for both T2V and I2V**, with an independent optional subtitle language when subtitles are enabled.
- **JSON mode** for exact API-shaped requests, validation, inline syntax errors, automatic repair of common JSON-like input mistakes, and copyable request bodies.
- **Voice prompt capture** with browser speech recognition or realtime transcription fallback.
- **One-step generation** for fully automatic rendering.
- **Two-step generation** for human review after image creation and before image-to-video processing.
- **Timeline preview during render**, including generated images, AI video clips, speech, music, and audio lanes as soon as they become available.
- **Manual continue checkpoint** in two-step mode through `/v2/video/step/:requestId/process_next`.
- **Direct Studio handoff** with `View in Studio`.
- **Publishing and unpublishing** after a successful render.
- **Assistant panel** attached to the current session.
- **Advanced options** for tone, narrator handling, metadata, CTA outros, footer metadata, and custom adapters.

#### VidGenie Advanced Options

VidGenie is intentionally simple on the surface, but the advanced panel carries production controls:

- `tone`: `grounded` or `cinematic` for text-to-video.
- `limit_single_narrator`: keeps narration constrained to one voice in image-list workflows.
- `add_narrator_avatar`: requests narrator avatar generation and implies single-narrator mode.
- `metadata`: project-level JSON metadata for image-list workflows.
- `image_item_metadata`: per-image JSON metadata merged into individual `image_urls` entries.
- `generate_outro_image`: adds a CTA outro when paired with a valid `cta_url`.
- `cta_url`, `cta_text_top`, `cta_text_bottom`, `cta_logo`: CTA/QR outro inputs.
- `footer_metadata`: array of footer items used for animated footer treatment.
- `configuration.custom_adapters`: optional user-configured external operation endpoints for text-to-image, image-to-video, text-to-speech, music, and sound effects.

#### VidGenie Request Structure

VidGenie submits all generation through the step API:

| Flow | Endpoint |
| --- | --- |
| Text to video | `POST /v2/video/step/text_to_video` |
| Image list to video | `POST /v2/video/step/image_to_video` |
| Detailed status | `GET /v2/video/step/:requestId/status_detailed` |
| Fallback detailed status | `GET /v2/status_detailed?request_id=:requestId` |
| Continue after manual checkpoint | `POST /v2/video/step/:requestId/process_next` |
| Upload I2V images | `POST /v2/upload_image_data` |

The request always includes a session id and step-control fields:

```json
{
  "auto_render_full_video": true,
  "autoRenderFullVideo": true,
  "manual_step_stages": [],
  "manualStepStages": [],
  "input": {
    "session_id": "current-vidgenie-session-id"
  }
}
```

For two-step mode, VidGenie flips those controls:

```json
{
  "auto_render_full_video": false,
  "autoRenderFullVideo": false,
  "manual_step_stages": ["ai_video_generation"],
  "manualStepStages": ["ai_video_generation"]
}
```

That means image generation can complete first, the preview can be inspected, and the user can choose when to continue into AI video generation.

#### Text-to-Video JSON Example

```json
{
  "input": {
    "session_id": "SESSION_ID",
    "prompt": "A 30 second launch teaser for a new travel app",
    "image_model": "GPTIMAGE2",
    "video_model": "RUNWAYML",
    "duration": 30,
    "tone": "grounded",
    "aspect_ratio": "16:9",
    "language": "en",
    "font_key": "Poppins",
    "enable_subtitles": true,
    "subtitle_language": "es"
  },
  "auto_render_full_video": true,
  "manual_step_stages": []
}
```

Accepted `T2V` JSON fields include `prompt`, `image_model`, `video_model`, `duration`, `video_model_sub_type`, `image_style`, `tone`, `aspect_ratio`, `language`, `font_key`, `enable_subtitles`, `subtitle_language`, CTA fields, footer metadata, and custom adapter configuration.

`subtitle_language` is optional and only applies when `enable_subtitles` is `true`. When omitted, subtitles follow the concrete speech language (including when `language` is `auto`). Set it to a different supported two-letter language code to translate only the subtitle text while keeping the original audio unchanged; if the detected speech already uses that language, the normal aligned subtitle path is retained.

#### Image-List-to-Video JSON Example

```json
{
  "input": {
    "session_id": "SESSION_ID",
    "image_urls": [
      {
        "image_url": "https://cdn.example.com/frame-1.png",
        "title": "Opening frame",
        "image_text": "Describe the first scene."
      },
      {
        "image_url": "https://cdn.example.com/frame-2.png",
        "title": "Second frame",
        "image_text": "Describe the second scene."
      }
    ],
    "prompt": "Create a polished short video from these images.",
    "video_model": "RUNWAYML",
    "aspect_ratio": "16:9",
    "language": "en",
    "font_key": "Poppins",
    "enable_subtitles": true,
    "subtitle_language": "es",
    "limit_single_narrator": false,
    "add_narrator_avatar": false,
    "metadata": {
      "project": "launch_trailer"
    }
  },
  "auto_render_full_video": false,
  "manual_step_stages": ["ai_video_generation"]
}
```

Each image entry can be a URL string or an object with `image_url`, `imageUrl`, `url`, `src`, `enhanced_url`, or `enhancedUrl`. Object entries may also carry titles, scene text, and metadata.

#### Status Response Shape

The detailed status response is intentionally flexible because it supports several backend generations. The client reads these fields:

```json
{
  "status": "PROCESSING",
  "request_id": "request-id",
  "session_id": "session-id",
  "current_step": "ai_video_generation",
  "current_step_label": "Generating video clips",
  "requires_user_action": false,
  "can_process_next": false,
  "expressGenerationStatus": {
    "prompt_generation": "COMPLETED",
    "image_generation": "COMPLETED",
    "speech_generation": "PROCESSING"
  },
  "session": {
    "duration": 60,
    "aspectRatio": "9:16",
    "previewStage": "audio_generation",
    "completedStages": ["prompt_generation", "image_generation"],
    "layers": [],
    "audioLayers": [],
    "globalAudioLayers": [],
    "globalVideos": []
  },
  "result_url": "https://..."
}
```

The preview panel uses `session.layers`, `session.audioLayers`, `session.globalAudioLayers`, and `session.globalVideos` to build a scrub-able timeline before the final MP4 is ready. Visual segments can be generated images, AI videos, lip-synced videos, sound-effect videos, user videos, or generic preview assets. Audio segments can be speech, voiceover, music, effects, and global tracks. Music is ducked during preview when speech or voiceover is active.

#### Mid-Render Control

VidGenie and Studio share a checkpoint-oriented render model:

- VidGenie two-step mode pauses at `ai_video_generation` and waits for `process_next`.
- VidGenie one-step mode automatically continues when the backend reports `can_process_next`.
- Studio exposes `Cancel render` for pending renders through `POST /video_sessions/cancel_pending_render`.
- Studio exposes express checkpoint restarts after images, after AI video, and after frames through `POST /video_sessions/restart_express_pipeline`.
- Studio lets editors rerender after staged timeline changes, regenerate frames before render, or restart only the part of the express pipeline that needs a reroll.

### Studio

![Studio workspace](./docs/screenshots/studio-workspace.png)

Studio is the full editorial workspace. It combines a Konva canvas, scene list, frame/timeline toolbar, left/right control panels, model-powered generation, audio tooling, and final render controls.

The visible top bar exposes project dimensions, total duration, render speed/mode, canvas zoom, playback, render/download, new project, account, credits, upgrade, and settings. The editor itself is organized around scenes. Each scene can carry an image, AI video, uploaded video, lip-sync layer, sound-effect video, text items, shapes, masks, animations, and audio relationships.

#### Left Panel: Core Studio Tools

The Studio side panel can be collapsed for quick work or expanded for detailed controls. Current tool groups:

| Tool | What it does |
| --- | --- |
| **Defaults** | Updates default scene duration, basic text theme, parent/derived JSON theme, and advanced session theme settings. |
| **Generate Image** | Generates or recreates scene imagery using configured image models and prompt workflows. |
| **Edit Image** | Applies prompt edits or inpaint-style edits to the current image layer. |
| **Generate Video** | Creates AI video for the selected scene with model, duration, subtype, start/end frame, combine-layers, clip-to-AI-video, prompt optimizer, and native-audio options where supported. |
| **Generate Audio** | Generates speech, layered speech, music, and sound effects. |
| **Facecam & Voiceover** | Records audio or facecam, creates avatar voiceovers, generates avatar images, generates speech from hints, generates avatar video, accepts/rejects/saves generated avatar assets. |
| **Actions** | Pencil, eraser, optional grid-snap eraser, and combine-current-layer operations. |
| **Select** | Selects layers or shape regions with rectangle/circle tools. |
| **Animate** | Applies fade, slide, zoom, or rotate to selected layers, or to all layers. |
| **Upload/Library** | Uploads user media or imports image/video/audio assets from library. |
| **Text** | Adds text and subtitle-style text elements. |
| **Shape** | Adds rectangles, circles, polygons, and dialogue bubbles with geometry and styling controls. |
| **Layers** | Reorders and manages scene/layer composition. |

#### Expanded Studio Timeline

The expanded timeline is where advanced users spend most of their time. It has dedicated tabs:

| Expanded tab | Advanced controls |
| --- | --- |
| **Audio** | Layer/global audio placement, drag-to-trim, waveform or spectrogram visualization, volume automation points, enabled/disabled lanes, speech/music/effect timing, and audio ducking. |
| **Video** | AI video, user video, lip-sync video, and sound-effect video tracks. Editors can select exact frame ranges, stage multiple non-overlapping operations, and apply speed or clip edits to a generated video layer. |
| **Global videos** | Adds timeline-wide video overlays with start/end time, x/y position, dimensions, and shape overlay options such as circle, oval, rectangle, and rounded rectangle. |
| **Image** | Adjusts visual item timing and deletes selected visual items. |
| **Text** | Edits text timing, selected subtitle/text lanes, and text animation timing. |
| **Hints** | Uploads `.json`, `.txt`, or `.srt` hint files, imports transcript hints, adds new timeline hints, edits hint text/start/end/duration, saves hints, and removes selected/all hints. |
| **Settings** | Shows scene count, timeline duration, render status, cancel render, scene transitions, timeline grid, scene quick editor, layer waveforms, audio ducking, regenerate frames before render, legacy actions, FPS, and render availability. |

The **Video** tab is the fine-grained post-processing path for generated agent/video renders. Select a video track, choose a local range, stage a `SPEED` operation or `REMOVE` operation, and apply one or more staged edits. Operations are stored as timestamped ranges:

```json
{
  "sessionId": "SESSION_ID",
  "layerId": "LAYER_ID",
  "operations": [
    {
      "id": "video_edit_...",
      "type": "SPEED",
      "startTime": 12.4,
      "endTime": 18.9,
      "speedMultiplier": 2
    },
    {
      "id": "video_edit_...",
      "type": "REMOVE",
      "startTime": 44.0,
      "endTime": 46.6,
      "speedMultiplier": 1
    }
  ]
}
```

The client derives these ranges from frame selections at 30 display frames per second, so an editor can post-process long renders at a minute-level workflow while still placing changes at sub-second precision.

#### Studio Render Control

Studio can render, rerender, cancel, restart from express checkpoints, publish, unpublish, and download:

- `Render` queues the current session.
- `Download` appears when the current rendered MP4 is available.
- `Render again` appears when an existing render can be replaced.
- `Cancel render` appears while a render is pending.
- `Regenerate frames before render` refreshes layer frames before queueing a new video render.
- `Enable audio ducking` lowers background music during narration or speech.
- Scene transitions can be set to `None`, `Fade`, or `Dissolve`.
- Express sessions can restart after `after_images`, `after_ai_video`, or `after_frames`.

### Image Studio

![Image Studio](./docs/screenshots/image-studio.png)

Image Studio is the focused image workspace. It uses the same image generation/editing infrastructure as Studio, but removes the video timeline around it.

It supports:

- Image generation from prompts.
- Prompt-based image editing.
- Inpaint-style edit flows with mask previews.
- Upload and library import.
- Layers and canvas layout.
- Canvas presets, custom dimensions, and aspect-ratio selection.
- Simple and advanced downloads.

### Generations, Account, And Publishing

The client also includes supporting surfaces:

- `/generations`: gallery/home for user generation history.
- `/my_sessions`: video session list.
- `/image_sessions`: image session list.
- `/publication/:id`: public/published session view.
- `/account/*`: settings, images, music, API keys, billing, usage, and user publications.
- `/external/studio`: external user dashboard.
- `/create_payment`, `/payment_success`, `/payment_cancel`: credit and payment flows.

## Models And Providers

The client-side model inventory lives primarily in `src/constants/Types.ts` and `src/constants/ModelPrices.jsx`.

### Image Generation

| Model | Key | Express |
| --- | --- | --- |
| GPT Image 2 | `GPTIMAGE2` | Yes |
| Seedream | `SEEDREAM` | Yes |
| NanoBanana 2 | `NANOBANANA2` | Yes |
| NanoBanana Pro | `NANOBANANAPRO` | Yes |

### Image Editing

| Model | Key | Edit type |
| --- | --- | --- |
| NanoBanana 2 Edit | `NANOBANANA2EDIT` | Prompt edit |
| GPT Image 2 Edit | `GPTIMAGE2EDIT` | Inpaint |

### Video Generation

| Model | Key | Express | T2V | I2V | Ratios |
| --- | --- | --- | --- | --- | --- |
| RunwayML Gen 4.5 | `RUNWAYML` | Yes | Yes | Yes | `16:9`, `9:16` |
| Sora 2 | `SORA2` | No | Yes | Yes | `16:9`, `9:16` |
| Sora 2 Pro | `SORA2PRO` | No | Yes | Yes | `16:9`, `9:16` |
| Custom Image to Video | `CUSTOM_IMAGE_TO_VIDEO` | Yes | No | Yes | `1:1`, `16:9`, `9:16` |
| Kling 3 Pro Img2Vid | `KLINGIMGTOVID3PRO` | Yes | No | Yes | `1:1`, `16:9`, `9:16` |
| Kling 3 Pro Text2Vid | `KLINGTXTTOVID3PRO` | No | Yes | No | `1:1`, `16:9`, `9:16` |
| Hailuo O2 Standard | `HAILUO` | No | Yes | Yes | `16:9` |
| Hailuo O2 Pro | `HAILUOPRO` | No | Yes | Yes | `16:9` |
| Seedance 1.5 | `SEEDANCEI2V` | Yes | No | Yes | `16:9`, `9:16` |
| Seedance 2.0 I2V | `SEEDANCE2.0I2V` | No | No | Yes | `16:9`, `9:16` |
| Seedance 2.0 T2V | `SEEDANCE2.0T2V` | No | Yes | No | `16:9`, `9:16` |
| Veo 3.1 Text2Vid | `VEO3.1` | No | Yes | No | `16:9`, `9:16` |
| Veo 3.1 Fast Text2Vid | `VEO3.1FAST` | No | Yes | No | `16:9`, `9:16` |
| Veo 3.1 Img2Vid | `VEO3.1I2V` | Yes | No | Yes | `16:9`, `9:16` |
| Veo 3.1 Frame to Video | `VEO3.1FLIV` | No | No | Yes | `16:9`, `9:16` |
| Veo 3.1 Fast Img2Vid | `VEO3.1I2VFAST` | Yes | No | Yes | `16:9`, `9:16` |

### VidGenie Model Subset

VidGenie intentionally exposes a smaller express-first subset:

- Image models: `GPTIMAGE2`, `NANOBANANA2`, `NANOBANANAPRO`, `SEEDREAM`.
- Text/video and image/video models: `RUNWAYML`, `VEO3.1I2V`, `VEO3.1I2VFAST`, `SEEDANCEI2V`, `KLINGIMGTOVID3PRO`.
- JSON mode validates the supported image/video model keys for the selected workflow.
- Aspect ratios: `16:9` and `9:16`.
- Wizard durations: `10`, `30`, `60`, `90`, `120`, and `180` seconds.
- JSON `duration` validation: `10` to `240` seconds for text-to-video.

### Audio, Voice, Music, And Post-Processing

| Capability | Providers/models |
| --- | --- |
| TTS and speech | OpenAI voices, Play.ht voices, ElevenLabs voices, custom TTS |
| Music | CassetteAI, AudioCraft, Lyria 3, ElevenLabs Music, custom text-to-music |
| Lip sync | HummingBird Lip Sync, Latent Sync, Sync Lip Sync, Kling Lip Sync, Creatify Lip Sync |
| Synced sound effects | MMAudio V2, Mirelo AI |
| Avatar voiceover | Avatar image generation, Runway avatar generation, speech from hints, avatar video generation |

## Credit Pricing Snapshot

Credit pricing is defined in `src/constants/ModelPrices.jsx` and `src/constants/pricing/ExpressVideoPricingDistribution.js`.

Express video pricing is calculated per second:

| Model | Credits/sec |
| --- | ---: |
| `RUNWAYML` | 30 |
| `SEEDANCEI2V` | 30 |
| `KLINGIMGTOVID3PRO` | 36 |
| `VEO3.1I2VFAST` | 36 |
| `VEO3.1I2V` | 60 |

Each express video second includes fixed pipeline components:

| Component | Credits/sec |
| --- | ---: |
| Pipeline | 4 |
| Inference | 4 |
| Image gen/edit | 2 |
| Speech | 2 |
| Music | 2 |
| Effects and lip sync | 2 |

The remaining credits are attributed to the selected video model.

## Route Map

| Route | Component |
| --- | --- |
| `/` | Landing or redirect to generations |
| `/generations` | `GenerationsHome` |
| `/video` | Studio landing |
| `/video/:id` | Desktop or mobile Studio |
| `/vidgenie`, `/vidgenie/:id` | VidGenie |
| `/vidgpt`, `/vidgpt/:id`, `/videogpt`, `/videogpt/:id` | Legacy aliases for VidGenie |
| `/quick_video`, `/quick_video/:id` | Quick editor or mobile VidGenie-style editor |
| `/image/studio`, `/image/studio/:id` | Image Studio |
| `/my_sessions` | Video sessions |
| `/image_sessions` | Image sessions |
| `/publication/:id` | Published video page |
| `/account/*` | Account, billing, usage, API keys, library panels |
| `/external/studio` | External Studio dashboard |

## Codebase Guide

| Area | Files |
| --- | --- |
| App shell and routes | `src/App.jsx`, `src/components/landing/Home.tsx` |
| VidGenie | `src/components/oneshot_editor/OneshotEditor.jsx`, `src/components/oneshot_editor/ProgressIndicator.jsx` |
| Studio root | `src/components/video/VideoHome.jsx`, `src/components/video/VideoEditorContainer.jsx` |
| Studio canvas | `src/components/video/editor/VideoCanvas.jsx`, `src/components/video/editor/VideoCanvasContainer.jsx` |
| Studio side panel | `src/components/video/toolbars/VideoEditorToolbar.jsx` |
| Studio timeline | `src/components/video/toolbars/frame_toolbar/index.jsx` |
| Fine-grained video edits | `src/components/video/toolbars/frame_toolbar/video_toolbar/*` |
| Audio tools | `src/components/video/toolbars/audio/*`, `src/components/video/util/audioPreviewDucking.js` |
| Image Studio | `src/components/image/ImageStudioHome.jsx`, `src/components/image/ImageEditorToolbar.jsx` |
| Models and prices | `src/constants/Types.ts`, `src/constants/ModelPrices.jsx` |
| Languages and localization | `src/constants/supportedLanguages.js`, `src/constants/translations.js`, `src/contexts/LocalizationContext.jsx` |

## Local Development

### Prerequisites

- Node.js compatible with the project dependencies.
- Yarn.
- Access to Samsar API credentials or an existing authenticated browser session for full product workflows.

### Environment

Create a local environment file:

```sh
cp .env.example .env
```

Default example values:

```env
VITE_PROCESSOR_API=https://api.samsar.one
VITE_CLIENT_URL=http://localhost:3000
VITE_CURRENT_ENV=production
VITE_STATIC_CDN_URL=https://static.samsar.one
```

The dev server is pinned to port `3000`:

```sh
yarn install
yarn start
```

Build for production:

```sh
yarn build
```

Preview a production build:

```sh
yarn preview
```

## Implementation Notes For Advanced Contributors

- Authentication headers are resolved through `src/utils/web.jsx`.
- VidGenie creates blank sessions through `POST /vidgenie/create_blank`.
- VidGenie session details are read from `GET /quick_session/details?sessionId=:id`.
- Studio session details are read through video session APIs and kept synchronized across canvas, timeline, audio, and render state.
- Render polling in Studio uses `POST /video_sessions/get_render_video_status` on a repeating timer.
- Layer polling updates image, AI video, lip-sync, sound-effect, and uploaded-video state without requiring a page refresh.
- The expanded timeline stores visual, audio, text, hint, and video edit state separately so each surface can be manipulated without forcing unrelated UI updates.
- User edits are debounced where appropriate, and canvas history supports undo/redo for active item list changes.
- Mobile Studio and desktop Studio share session data but route through different components for layout.

## Community

- Discord: [discord.gg/2tbhKwRy](https://discord.gg/2tbhKwRy)
- Gallery: [youtube.com/@samsar_one](https://www.youtube.com/@samsar_one)
- X: [x.com/samsar_one](https://x.com/samsar_one)
- Threads: [threads.net/@samsar_one_videos](https://www.threads.net/@samsar_one_videos)

Contributions and pull requests are welcome. If you are new to the codebase, start with VidGenie for the clearest request/response flow, then move into Studio's `VideoHome`, `VideoEditorContainer`, and expanded frame toolbar once you need the full editing model.
