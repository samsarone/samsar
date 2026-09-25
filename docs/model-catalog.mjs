// Documentation metadata. Runtime support is read from the registries below.
import {
  DOCKER_MODEL_PROVIDER_PRIORITY_BY_MODEL as providerMap,
  DOCKER_MODEL_ACTIONS_BY_MODEL as actions,
  getDockerModelDisplayName,
} from '../apps/setup-wizard/src/constants/dockerModelAvailability.js';
import {
  IMAGE_GENERAITON_MODEL_TYPES, IMAGE_EDIT_MODEL_TYPES, VIDEO_GENERATION_MODEL_TYPES,
  MUSIC_PROVIDERS,
} from '../services/processor/src/consts/ModelTypes.js';
import { INFERENCE_MODEL_OPTIONS } from '../services/processor/src/consts/InferenceModels.js';
import { EXPRESS_VIDEO_IMAGE_MODEL_KEYS, EXPRESS_VIDEO_VIDEO_MODEL_KEYS } from '../services/processor/src/consts/ExpressVideoModelOptions.js';
import { BRANCHED_IMAGE_MODEL_KEYS, BRANCHED_VIDEO_MODEL_KEYS } from '../services/processor/src/consts/BranchedModelOptions.js';

export const providers = {
  samsar: { label: 'Samsar.js', url: 'https://docs.samsar.one/external-requests', credential: 'SAMSAR_API_KEY', note: 'Call the hosted Samsar service using Samsar credits. The samsar-js client is the common entry point.' },
  openai: { label: 'OpenAI', url: 'https://platform.openai.com/docs/overview', credential: 'OPENAI_API_KEY', note: 'Native GPT inference, image and speech adapters; also required for local embedding indexes.' },
  anthropic: { label: 'Anthropic', url: 'https://platform.claude.com/docs/en/api/overview', credential: 'ANTHROPIC_API_KEY', note: 'Native Claude inference and assistant adapter.' },
  googleCloud: { label: 'Google Cloud', url: 'https://cloud.google.com/vertex-ai/generative-ai/docs', credential: 'Google service account / configured Google credentials', note: 'Gemini, Nano Banana, Veo, Google speech and Lyria. Music credentials and model access are validated separately.' },
  kimi: { label: 'Kimi', url: 'https://platform.kimi.ai/docs/overview', credential: 'KIMI_K3_API_KEY', note: 'Native Kimi text, vision and structured output; Samsar is the supported alternative.' },
  alibabaCloud: { label: 'Alibaba Cloud', url: 'https://www.alibabacloud.com/help/en/model-studio/', credential: 'ALIBABA_API_KEY', note: 'Native Qwen inference in Docker, Qwen Image, Wan and Happy Horse. Qwen Image requires standard pay-as-you-go access.' },
  gmicloud: { label: 'GMICloud via GenBlaze', url: 'https://docs.gmicloud.ai/', adapterUrl: 'https://github.com/backblaze-labs/genblaze', credential: 'GMI_API_KEY', note: 'Only exact model and operation mappings validated for your credential are enabled by the local GenBlaze gateway.' },
  fal: { label: 'fal', url: 'https://fal.ai/docs/documentation', credential: 'FAL_API_KEY', note: 'Supported media, speech, music, lip-sync and sound-effect adapters.' },
  openrouter: { label: 'OpenRouter', url: 'https://openrouter.ai/docs/quickstart', credential: 'OPENROUTER_API_KEY', note: 'Supported inference and vision routes. This does not enable image, video or audio generation.' },
  elevenlabs: { label: 'ElevenLabs', url: 'https://elevenlabs.io/docs/overview/intro', credential: 'ELEVENLABS_API_KEY', note: 'Direct music adapter. Speech is enabled through fal in the setup registry; do not assume a direct key enables every speech route.' },
  runway: { label: 'Runway', url: 'https://docs.dev.runwayml.com/', credential: 'RUNWAY_API_KEY', note: 'Native Runway video adapter.' },
  custom: { label: 'Custom endpoint', url: 'https://github.com/samsarone/samsar/blob/main/utils/vast-flux2/README.md', credential: 'Adapter URL and server-side authorization', note: 'Register a compatible endpoint in your standalone deployment. Available only after configuration.' },
};

export const modalities = [
  { id: 'inference', label: 'Inference & vision', docs: '/external-requests#chat', field: 'inference_model (workflow) / model (chat)', description: 'Plan scenes, understand images, write copy and build assistants.' },
  { id: 'image', label: 'Image generation', docs: '/image-api#post-imagetext_to_image', field: 'image_model (workflow) / model (image)', description: 'Create scene images, illustrations and reusable visual assets.' },
  { id: 'image-edit', label: 'Image editing', docs: '/v2#v2-image-edit-routes', field: 'Route-specific edit model', description: 'Edit reference images, remove objects and fill selected regions.' },
  { id: 'video', label: 'Video generation', docs: '/external-requests#video', field: 'video_model', description: 'Generate motion from text, an image or first and last frames.' },
  { id: 'speech', label: 'Speech', docs: '/external-requests#audio', field: 'tts_model / provider', description: 'Turn dialogue into narration and voice tracks.' },
  { id: 'music', label: 'Music', docs: '/external-requests#audio', field: 'backingtrack_model / model', description: 'Generate a backing track for your video or an audio asset.' },
  { id: 'lip-sync', label: 'Lip sync', docs: '/external-requests#video', field: 'lip_sync_model', description: 'Match a visible speaker to a supplied audio track.' },
  { id: 'sound', label: 'Sound effects', docs: '/external-requests#video', field: 'sound_effect_model', description: 'Add sound to an existing video or generate an audio effect.' },
  { id: 'embeddings', label: 'Embeddings & search', docs: '/chat-api#post-chatcreate_embedding', field: 'Managed embedding model', description: 'Index content for semantic search and recommendations.' },
  { id: 'transcription', label: 'Transcription', docs: '/external-requests#audio', field: 'Managed transcription model', description: 'Align speech with text for transcripts and subtitles.' },
];

const inference = new Map(INFERENCE_MODEL_OPTIONS.filter(row => row.exposeInCatalog !== false).map(row => [row.availabilityModel, row]));
const native = { 'gpt-6-astra': 'openai', 'claude-opus-5.5': 'anthropic', 'gemini-3.1-pro': 'googleCloud', KIMIK3: 'kimi', 'QWEN3.8': 'alibabaCloud' };
const notes = {
  'gpt-6-astra': 'Current public key. Older setup files may contain gpt-5.6-sol; the processor normalizes that alias. GenBlaze still requires an exact validated mapping.',
  KIMIK3: 'Setup key KIMIK3; inference requests use kimi-k3. Native Kimi first, then Samsar; OpenRouter is not in this chain.',
  'QWEN3.8': 'Native Alibaba is a Docker option. Hosted Qwen uses OpenRouter internally; callers still use Samsar.js.',
  'GPTIMAGE2.5': 'Versioned Samsar key for GPTImage 2.5. Legacy GenBlaze GPT Image 2 routes are excluded from this model.',
  'GPTIMAGE2.5EDIT': 'Versioned Samsar key for GPTImage 2.5 editing. Legacy GenBlaze routes are excluded.',
  QWENIMAGE3PRO: 'Standalone native adapter only. Requires Alibaba standard pay-as-you-go credentials; Token Plan credentials do not enable it.',
  SEEDREAM: 'Stable key currently maps to Seedream 5 Pro.',
  NANOBANANA2: 'Image generation catalog model; not in the current Express image allowlist.',
  NANOBANANA2EDIT: 'Used by image enhancement and branding removal. Multi-output image-set jobs bypass GenBlaze.',
  NANOBANANAPROEDIT: 'Required by VidGenie image-list mode. Multi-output image-set jobs bypass GenBlaze.',
  RUNWAYML: 'Express turns planned scene images into motion. This is different from a raw text-to-video model call.',
  'VEO3.1': 'Text-to-video model; the I2V variants have separate keys.',
  'VEO3.1FAST': 'Fast text-to-video model; use VEO3.1I2VFAST for Express scene animation.',
  'VEO3.1FLIV': 'First/last-frame generation; not an Express video selection.',
  'SEEDANCE2.0I2V': 'Standalone provider-billed I2V. Exact GenBlaze route: seedance-2-0-260128. No Samsar adapter in the setup catalog.',
  'SEEDANCE2.5I2V': '5, 10 or 15 second 720p scene buckets. Exact GenBlaze route: seedance-2-5-260628. Hosted worker uses GMICloud internally.',
  HAPPYHORSEI2V: 'Stable key currently maps to Happy Horse 1.1 I2V.',
  ELEVENLABS: 'Hosted audio accepts ELEVENLABS. The standalone setup registry enables this speech model through fal only.',
  OPENAI_TTS: 'Use OPENAI in the Express tts_model field. GenBlaze speech is conditional on an exact gpt-4o-mini-tts mapping.',
  GOOGLE_TTS: 'Use GOOGLE in the Express tts_model field.',
  LYRIA3: 'Google music credential validation can change the runtime order between Google and fal.',
  MMAUDIOV2: 'Video-conditioned sound. This is separate from the audio-only SDAUDIO route.',
  MIRELOAI: 'Video-conditioned sound. Provide a video URL and the desired sound prompt.',
};

function modalityFor(key) {
  if (native[key]) return 'inference';
  if (['OPENAI_TTS', 'GOOGLE_TTS', 'ELEVENLABS'].includes(key)) return 'speech';
  if (['LYRIA3', 'ELEVENLABS_MUSIC'].includes(key)) return 'music';
  const action = actions[key]?.[0];
  return ({ image: 'image', image_edit: 'image-edit', video: 'video', lip_sync: 'lip-sync', sound_effect: 'sound' })[action];
}

export const models = Object.entries(providerMap).map(([setupKey, adapters]) => {
  const key = setupKey === 'gpt-5.6-sol' ? 'gpt-6-astra' : setupKey;
  const modality = modalityFor(key);
  const nativeAdapter = native[key];
  // Editorial order is deliberately separate from the runtime priority array.
  const ordered = [...new Set([nativeAdapter, 'samsar', ...adapters].filter(x => x && adapters.includes(x)))];
  const option = inference.get(key);
  return {
    key, setupKey, requestKey: option?.value || ({ KIMIK3: 'kimi-k3', OPENAI_TTS: 'OPENAI', GOOGLE_TTS: 'GOOGLE' })[key] || key,
    label: ({ 'gpt-6-astra': 'GPT 6 Astra', SEEDREAM: 'Seedream 5 Pro', SEEDANCEI2V: 'Seedance 1.5 I2V', HAPPYHORSEI2V: 'Happy Horse 1.1 I2V' })[key] || getDockerModelDisplayName(setupKey),
    modality, adapters: ordered, runtimePriority: adapters, nativeAdapter: nativeAdapter || null,
    hosted: adapters.includes('samsar') || key === 'ELEVENLABS',
    scope: 'deployment',
    express: modality === 'image' ? EXPRESS_VIDEO_IMAGE_MODEL_KEYS.includes(key) : modality === 'video' ? EXPRESS_VIDEO_VIDEO_MODEL_KEYS.includes(key) : false,
    branching: modality === 'inference' ? Boolean(option?.isBranchedInferenceModel) : modality === 'image' ? BRANCHED_IMAGE_MODEL_KEYS.includes(key) : modality === 'video' ? BRANCHED_VIDEO_MODEL_KEYS.includes(key) : false,
    note: notes[key] || 'Enable a supported adapter and check the target deployment before selecting this model.',
  };
});

models.push({ key: 'gpt-6-astra-xhigh', requestKey: 'gpt-6-astra-xhigh', label: 'GPT 6 Astra · extra high reasoning', modality: 'inference', adapters: ['openai', 'samsar', 'openrouter'], nativeAdapter: 'openai', hosted: true, scope: 'option', express: false, branching: true, note: 'Reasoning option on GPT 6 Astra, not a separate provider model. Omitted from the normal runtime catalog.' });

for (const [modality, entries] of [['image', IMAGE_GENERAITON_MODEL_TYPES], ['image-edit', IMAGE_EDIT_MODEL_TYPES], ['video', VIDEO_GENERATION_MODEL_TYPES], ['music', MUSIC_PROVIDERS]]) {
  for (const entry of entries) {
    if (models.some(row => row.key === entry.key) || entry.key.startsWith('CUSTOM_')) continue;
    models.push({ key: entry.key, requestKey: entry.key, label: entry.name, modality, adapters: [], hosted: false, scope: 'studio', express: false, branching: false, note: 'Listed in the Studio source catalog, outside the standalone setup matrix. Presence here does not promise a live hosted route, Express support or deployment availability.' });
  }
}

for (const [key, label, modality, note] of [
  ['CUSTOM_TEXT_TO_IMAGE:<adapter-id>', 'Custom image endpoint', 'image', 'Register a named standalone image adapter; use the exact returned key. Includes the optional Vast.ai FLUX.2 utility.'],
  ['CUSTOM_IMAGE_TO_VIDEO', 'Custom video endpoint', 'video', 'Requires a compatible standalone image-to-video adapter and its configured authorization.'],
  ['CUSTOM_TEXT_TO_MUSIC', 'Custom music endpoint', 'music', 'Requires a compatible configured text-to-music endpoint.'],
]) models.push({ key, requestKey: key, label, modality, adapters: ['custom'], hosted: false, scope: 'custom', express: false, branching: false, note });

for (const [key, label, modality, adapters, note] of [
  ['text-embedding-3-large', 'OpenAI embeddings', 'embeddings', ['samsar', 'openai'], 'Hosted search is accessed through Samsar.js. Local indexing still requires OPENAI_API_KEY; crawling URLs also requires FIRECRAWL_API_KEY.'],
  ['whisper-1', 'Whisper transcript alignment', 'transcription', ['samsar', 'openai'], 'Managed transcript-alignment route; not a freely selectable Express inference model.'],
  ['PLAYAI', 'PlayAI speech', 'speech', ['samsar'], 'Accepted by the hosted audio speech contract. Not advertised by the standalone setup matrix.'],
  ['SDAUDIO', 'Audio sound effects', 'sound', ['samsar'], 'Hosted text-to-sound-effect audio route. Different from video-conditioned MMAudio and Mirelo.'],
]) models.push({ key, requestKey: key, label, modality, adapters, hosted: true, scope: 'service', express: false, branching: false, note, ...(key === 'SDAUDIO' ? { docs: '/external-requests#audio' } : {}) });

export default { version: 1, providers, modalities, models };
