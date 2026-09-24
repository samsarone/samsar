# Audio and performance

Start with **[hosted Samsar.js](https://docs.samsar.one/external-requests#samsar-js)** to generate narration, music and sound, or to match a visible speaker to recorded dialogue. Then use the [model matrix](model-matrix.md) to explore supported standalone adapters.

## Choose the operation

| I need… | Hosted route | Model choices | Reference |
| --- | --- | --- | --- |
| Narration from text | `POST /v2/external/audio/text_to_speech` | `OPENAI`, `GOOGLE`, `ELEVENLABS`, `PLAYAI` in the hosted audio contract | [Speech matrix](model-matrix.md#speech) · [Audio docs](https://docs.samsar.one/external-requests#audio) |
| A backing track | `POST /v2/external/audio/text_to_music` | `LYRIA3`, `ELEVENLABS_MUSIC` | [Music matrix](model-matrix.md#music) · [Audio docs](https://docs.samsar.one/external-requests#audio) |
| An audio-only effect | `POST /v2/external/audio/text_to_sound_effect` | `SDAUDIO` and configured aliases | [Audio docs](https://docs.samsar.one/external-requests#audio) |
| Sound matched to a video | `POST /v2/external/video/sound_effect` | `MMAUDIOV2`, `MIRELOAI` | [Sound matrix](model-matrix.md#sound) · [Video docs](https://docs.samsar.one/external-requests#video) |
| Lip motion matched to dialogue | `POST /v2/external/video/lip_sync` | `SYNCLIPSYNC`, `LATENTSYNC`, `KLINGLIPSYNC`, `HUMMINGBIRDLIPSYNC`, `CREATIFYLIPSYNC` | [Lip-sync matrix](model-matrix.md#lip-sync) · [Video docs](https://docs.samsar.one/external-requests#video) |
| Transcript alignment | `POST /v2/external/audio/transcript_align` | Managed OpenAI `whisper-1` | [Transcription matrix](model-matrix.md#transcription) · [Audio docs](https://docs.samsar.one/external-requests#audio) |

## Generate with Samsar.js

```js
import SamsarClient from 'samsar-js';

const samsar = new SamsarClient({ apiKey: process.env.SAMSAR_API_KEY });
const music = await samsar.createExternalTextToMusicAudio({
  prompt: 'Warm acoustic backing music for a peaceful travel film.',
  model: 'LYRIA3',
  duration: 30,
});
console.log(music.data.request_id);
```

Save the returned request ID and follow the [audio status contract](https://docs.samsar.one/external-requests#audio). `getExternalAudioStatus(requestId)` polls audio work; video operations use `getExternalVideoStatus(requestId)`. A successful submission does not mean generation has completed.

<details>
<summary><strong>Match a speaker to an existing voice track</strong></summary>

```js
const performance = await samsar.createExternalLipSyncVideo({
  video_url: 'https://example.com/presenter.mp4',
  audio_url: 'https://example.com/dialogue.wav',
  lip_sync_model: 'SYNCLIPSYNC',
  duration: 8,
});
console.log(performance.data.request_id);
```

Replace example URLs with public media you control. See the [video operation contract](https://docs.samsar.one/external-requests#video) for required inputs, supported request shape and status handling.

</details>

## Use audio inside a video workflow

Express video combines several independent stages. Set `tts_model` to `OPENAI`, `GOOGLE` or `ELEVENLABS`, and `backingtrack_model` to `LYRIA3` or `ELEVENLABS_MUSIC`. Speaker choices belong to the selected speech provider. See the [Video API](https://docs.samsar.one/video) for voice and optional stage settings.

`OPENAI_TTS` and `GOOGLE_TTS` are setup model identifiers. They are not the values for Express `tts_model`. Audio-only sound generation, video-conditioned sound, lip sync and transcript alignment are different operations with different payloads.

## Expand to standalone adapters

| Capability | Start with | Supported local alternatives / constraints |
| --- | --- | --- |
| OpenAI speech | Samsar.js | Native OpenAI; conditional exact GenBlaze mapping where validated. |
| Google speech | Samsar.js | Native Google Cloud. |
| ElevenLabs speech | Hosted Samsar.js | Setup advertises fal for this speech model. A direct ElevenLabs music key does not imply setup speech availability. |
| Lyria 3 | Samsar.js | Google Cloud or fal; validated music credentials affect runtime ordering. |
| ElevenLabs Music | Samsar.js | ElevenLabs or fal. |
| Lip sync and video sound | Samsar.js | fal for the model-specific routes in the matrix. |
| Custom music | Configured native endpoint | Register a compatible `CUSTOM_TEXT_TO_MUSIC` endpoint in standalone. |

**Studio catalog entries** such as AudioCraft and Cassette AI are identified separately in the matrix; catalog presence alone does not establish a working hosted or standalone route. For deployment configuration, use [Providers and Models](providers-and-models.md).

## Billing and delivery

Use [hosted pricing](https://docs.samsar.one/pricing) and response credit headers for managed requests. Direct provider adapters bill through their configured provider account. Persist request IDs, poll the matching audio or video status endpoint, and store the completed output URL after terminal success.
