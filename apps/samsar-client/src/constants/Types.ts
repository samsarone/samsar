import { translateText as uiText } from '../utils/localization.js';
import { ELEVENLABS_TTS } from './ElevenLabs.jsx';
import { PLAY_SPEAKER_TYPES } from './PlayAI.jsx';
import { QWEN_IMAGE_3_PRO_MODEL_KEY } from '../utils/imageModelAvailability.mjs';

export const CURRENT_TOOLBAR_VIEW = {
  SHOW_DEFAULT_DISPLAY: 'SHOW_DEFAULT_DISPLAY',
  SHOW_GENERATE_DISPLAY: 'SHOW_GENERATE_DISPLAY',
  SHOW_TEMPLATES_DISPLAY: 'SHOW_TEMPLATES_DISPLAY',
  SHOW_EDIT_MASK_DISPLAY: 'SHOW_EDIT_MASK_DISPLAY',
  SHOW_EDIT_DISPLAY: 'SHOW_EDIT_DISPLAY',

  SHOW_ADD_TEXT_DISPLAY: 'SHOW_ADD_TEXT_DISPLAY',
  SHOW_LAYERS_DISPLAY: 'SHOW_LAYERS_DISPLAY',

  SHOW_CURSOR_SELECT_DISPLAY: 'SHOW_CURSOR_SELECT_DISPLAY',
  SHOW_ANIMATE_DISPLAY: 'SHOW_ANIMATE_DISPLAY',
  SHOW_OBJECT_SELECT_DISPLAY: 'SHOW_OBJECT_SELECT_DISPLAY',
  SHOW_ACTIONS_DISPLAY: 'SHOW_ACTIONS_DISPLAY',
  SHOW_SELECT_DISPLAY: 'SHOW_SELECT_DISPLAY',

  SHOW_ADD_SHAPE_DISPLAY: 'SHOW_ADD_SHAPE_DISPLAY',
  SHOW_UPLOAD_DISPLAY: 'SHOW_UPLOAD_DISPLAY',
  SHOW_AUDIO_DISPLAY: 'SHOW_AUDIO_DISPLAY',
  SHOW_RECORDING_FACECAM_DISPLAY: 'SHOW_RECORDING_FACECAM_DISPLAY',

  SHOW_SET_DEFAULTS_DISPLAY: 'SHOW_SET_DEFAULTS_DISPLAY',

  SHOW_GENERATE_VIDEO_DISPLAY: 'SHOW_GENERATE_VIDEO_DISPLAY',

}

export const TOOLBAR_ACTION_VIEW = {
  SHOW_DEFAULT_DISPLAY: 'SHOW_DEFAULT_DISPLAY',


  SHOW_ERASER_DISPLAY: 'SHOW_ERASER_DISPLAY',
  SHOW_PENCIL_DISPLAY: 'SHOW_PENCIL_DISPLAY',

  SHOW_SELECT_LAYER_DISPLAY: 'SHOW_SELECT_LAYER_DISPLAY',
  SHOW_SELECT_SHAPE_DISPLAY: 'SHOW_SELECT_SHAPE_DISPLAY',

  SHOW_SELECT_OBJECT_DISPLAY: 'SHOW_SELECT_OBJECT_DISPLAY',

  SHOW_MUSIC_GENERATE_DISPLAY: 'SHOW_MUSIC_GENERATE_DISPLAY',
  SHOW_SPEECH_GENERATE_DISPLAY: 'SHOW_SPEECH_GENERATE_DISPLAY',
  SHOW_SOUND_GENERATE_DISPLAY: 'SHOW_SOUND_GENERATE_DISPLAY',

  SHOW_PREVIEW_MUSIC_DISPLAY: 'SHOW_PREVIEW_MUSIC_DISPLAY',
  SHOW_PREVIEW_SPEECH_DISPLAY: 'SHOW_PREVIEW_SPEECH_DISPLAY',
  SHOW_PREVIEW_SPEECH_LAYERED_DISPLAY: 'SHOW_PREVIEW_SPEECH_LAYERED_DISPLAY',
  SHOW_PREVIEW_SOUND_DISPLAY: 'SHOW_PREVIEW_SOUND_DISPLAY',

  SHOW_LIBRARY_DISPLAY: 'SHOW_LIBRARY_DISPLAY',
  SHOW_SMART_SELECT_DISPLAY: 'SHOW_SMART_SELECT_DISPLAY',

  SHOW_SUBTITLES_DISPLAY: 'SHOW_SUBTITLES_DISPLAY',
}


export const RECRAFT_IMAGE_STYLES = [
  "realistic_image",
  "digital_illustration",
  "vector_illustration",
  "realistic_image/b_and_w",
  "realistic_image/hard_flash",
  "realistic_image/hdr",
  "realistic_image/natural_light",
  "realistic_image/studio_portrait",
  "realistic_image/enterprise",
  "realistic_image/motion_blur",
  "digital_illustration/pixel_art",
  "digital_illustration/hand_drawn",
  "digital_illustration/grain",
  "digital_illustration/infantile_sketch",
  "digital_illustration/2d_art_poster",
  "digital_illustration/handmade_3d",
  "digital_illustration/hand_drawn_outline",
  "digital_illustration/engraving_color",
  "digital_illustration/2d_art_poster_2",
  "vector_illustration/engraving",
  "vector_illustration/line_art",
  "vector_illustration/line_circuit",
  "vector_illustration/linocut"
];


export const FRAME_TOOLBAR_VIEW = {
  DEFAULT: 'DEFAULT',
  AUDIO: 'AUDIO',
  EXPANDED: 'EXPANDED'
}


export const IDEOGRAM_IMAGE_STYLES = [
  'AUTO', 'GENERAL', 'REALISTIC', 'DESIGN'
];



export const CURRENT_EDITOR_VIEW = {
  'VIEW': 'VIEW',
  'EDIT': 'EDIT',
}

export const IMAGE_GENERAITON_MODEL_TYPES = [
  {
    name: 'GPTImage 2.6',
    key: 'GPTIMAGE2.5',
    isExpressModel: true,
    isBranchedImageModel: true,
  },
  {
    name: 'Seedream',
    key: 'SEEDREAM',
    isExpressModel: true,
    isBranchedImageModel: false,
  },
  {
    name: 'NanoBanana 2',
    key: 'NANOBANANA2',
    isExpressModel: false,
  },
  {
    name: 'NanoBanana Pro',
    key: 'NANOBANANAPRO',
    isExpressModel: true,
    isBranchedImageModel: true,
  },
  {
    name: 'Wan2.7 Pro',
    key: 'WAN2.7PRO',
    isExpressModel: true,
    isBranchedImageModel: false,
    supportedAspectRatios: ['1:1', '16:9', '9:16'],
  },
  {
    name: 'Qwen Image 3.0 Pro',
    key: QWEN_IMAGE_3_PRO_MODEL_KEY,
    isExpressModel: true,
    isBranchedImageModel: false,
    supportedAspectRatios: ['1:1', '16:9', '9:16'],
  },
];

export function imageGenerationModelSupportsAspectRatio(model, aspectRatio) {
  if (!Array.isArray(model?.supportedAspectRatios) || !model.supportedAspectRatios.length) {
    return true;
  }
  if (typeof aspectRatio !== 'string' || !aspectRatio.trim()) {
    return true;
  }
  return model.supportedAspectRatios.includes(aspectRatio.trim());
}


export const VIDEO_GENERATION_MODEL_TYPES = [
  {
    name: 'RunwayML Gen 4.5',
    key: 'RUNWAYML',
    isExpressModel: true,
    isBranchedVideoModel: false,
    isTransitionModel: false,
    isImageToVideoModel: true,
    isTextToVideoModel: true,
    supportedAspectRatios: [
      '16:9', '9:16'
    ]
  },
  {
    name: 'Sora 2',
    key: 'SORA2',
    isExpressModel: false,
    isTransitionModel: false,
    isImageToVideoModel: true,
    isTextToVideoModel: true,
    supportedAspectRatios: [
      '16:9', '9:16'
    ]
  },
  {
    name: 'Sora 2 Pro',
    key: 'SORA2PRO',
    isExpressModel: false,
    isTransitionModel: false,
    isImageToVideoModel: true,
    isTextToVideoModel: true,
    supportedAspectRatios: [
      '16:9', '9:16'
    ]
  },
  {
    get name() { return uiText('Custom Image to Video'); },
    key: 'CUSTOM_IMAGE_TO_VIDEO',
    isExpressModel: true,
    isBranchedVideoModel: false,
    isTransitionModel: false,
    isImageToVideoModel: true,
    isTextToVideoModel: false,
    supportedAspectRatios: [
      '16:9', '9:16', '1:1',
    ]
  },
  {
    name: 'Kling 4 Img2Vid',
    key: 'KLINGIMGTOVID4',
    isExpressModel: true,
    isBranchedVideoModel: false,
    isImageToVideoModel: true,
    isTextToVideoModel: false,
    supportedAspectRatios: [
      '16:9', '9:16', '1:1',
    ]
  },
  {
    name: 'Happy Horse 1.1 I2V',
    key: 'HAPPYHORSEI2V',
    isExpressModel: true,
    isBranchedVideoModel: false,
    isImageToVideoModel: true,
    isTextToVideoModel: false,
    supportedAspectRatios: [
      '16:9', '9:16', '1:1',
    ]
  },
  {
    name: 'Kling 4 Text2Vid',
    key: 'KLINGTXTTOVID4',
    isExpressModel: false,
    isImageToVideoModel: false,
    isTextToVideoModel: true,
    supportedAspectRatios: [
      '16:9', '9:16', '1:1',
    ]
  },
  {
    name: 'Hailuo O2 Standard',
    key: 'HAILUO',
    isImageToVideoModel: true,
    isTextToVideoModel: true,
    supportedAspectRatios: [
      '16:9'
    ],
    isExpressModel: false,
  },
  {
    name: 'Hailuo O2 Pro',
    key: 'HAILUOPRO',
    isImageToVideoModel: true,
    isTextToVideoModel: true,
    supportedAspectRatios: [
      '16:9'
    ],
    isExpressModel: false,
  },
  {
    name: 'Seedance 1.5',
    key: 'SEEDANCEI2V',
    isImageToVideoModel: true,
    isTextToVideoModel: false,
    isExpressModel: true,
    isBranchedVideoModel: false,
    supportedAspectRatios: [
      '16:9', '9:16',
    ]
  },
  {
    name: 'Seedance 2.0 I2V',
    key: 'SEEDANCE2.0I2V',
    isImageToVideoModel: true,
    isTextToVideoModel: false,
    isExpressModel: true,
    isBranchedVideoModel: true,
    supportedAspectRatios: [
      '16:9', '9:16',
    ]
  },
  {
    name: 'Seedance 2.5 I2V',
    key: 'SEEDANCE2.5I2V',
    isImageToVideoModel: true,
    isTextToVideoModel: false,
    isExpressModel: true,
    isBranchedVideoModel: false,
    supportedAspectRatios: [
      '16:9', '9:16',
    ]
  },
  {
    name: 'VEO3.1 Text2Vid',
    key: 'VEO3.1',
    isImageToVideoModel: false,
    isExpressModel: false,
    isTextToVideoModel: true,
    supportedAspectRatios: [
      '16:9',
      '9:16'
    ]
  },
  {
    name: 'VEO3.1 Fast Text2Vid',
    key: 'VEO3.1FAST',
    isImageToVideoModel: false,
    isExpressModel: false,
    isTextToVideoModel: true,
    supportedAspectRatios: [
      '16:9',
      '9:16'
    ]
  },
  {
    name: 'VEO3.1 Img2Vid',
    key: 'VEO3.1I2V',
    isImageToVideoModel: true,
    isExpressModel: true,
    isBranchedVideoModel: true,
    isTextToVideoModel: false,
    supportedAspectRatios: [
      '16:9',
      '9:16'
    ]
  },
  {
    name: 'VEO3.1 Frame to Video',
    key: 'VEO3.1FLIV',
    isImageToVideoModel: true,
    isFirstLastFrameToVideoModel: true,
    isExpressModel: false,
    isTextToVideoModel: false,
    supportedAspectRatios: [
      '16:9',
      '9:16'
    ]
  },
  {
    name: 'VEO3.1 Fast Img2Vid',
    key: 'VEO3.1I2VFAST',
    isImageToVideoModel: true,
    isExpressModel: true,
    isBranchedVideoModel: true,
    isTextToVideoModel: false,
    supportedAspectRatios: [
      '16:9',
      '9:16'
    ]
  },
  {
    name: 'Nvidia Cosmos 3',
    key: 'COSMOS3SUPERI2V',
    isImageToVideoModel: true,
    isExpressModel: true,
    isBranchedVideoModel: true,
    isTextToVideoModel: false,
    supportedAspectRatios: [
      '16:9',
      '9:16'
    ]
  },
];







export const IMAGE_EDIT_MODEL_TYPES = [
  {
    name: 'NanoBanana 2 Edit',
    key: 'NANOBANANA2EDIT',
    editType: 'prompt',
    isPromptEnabled: true
  },
  {
    name: 'GPTImage 2.6 Edit',
    key: 'GPTIMAGE2.5EDIT',
    editType: 'inpaint',
    isPromptEnabled: true,
  },

]



export const ASSISTANT_MODEL_TYPES = [
  { get label() { return uiText("Claude Opus 5.5 High"); }, value: 'claude-opus-5.5' },
  { get label() { return uiText("Claude Fable 5.1 High"); }, value: 'claude-fable-5.1' },
  { get label() { return uiText("GPT 6.1 Sol High"); }, value: 'gpt-6.1-sol' },
  {
    get label() { return uiText("GPT 6 Astra High"); },
    value: 'gpt-6-astra',
  },
  {
    get label() { return uiText("Gemini 4 Argon"); },
    value: 'gemini-4-argon',
  },
  {
    get label() { return uiText("Qwen 3.8 Max"); },
    value: 'QWEN3.8',
  },
  {
    get label() { return uiText("Kimi K3"); },
    value: 'kimi-k3',
  },


  { get label() { return uiText("Claude Fable 5.1 XHigh"); }, value: 'claude-fable-5.1-xhigh' },
  { get label() { return uiText("Claude Opus 5.5 XHigh"); }, value: 'claude-opus-5.5-xhigh' },
  { get label() { return uiText("GPT 6.1 Sol XHigh"); }, value: 'gpt-6.1-sol-xhigh' },
  { get label() { return uiText("GPT 6 Astra XHigh"); }, value: 'gpt-6-astra-xhigh' },
];


export const INFERENCE_MODEL_TYPES = [
  { get label() { return uiText("Claude Opus 5.5"); }, value: 'claude-opus-5.5', isBranchedInferenceModel: true },
  { get label() { return uiText("Claude Fable 5.1"); }, value: 'claude-fable-5.1', isBranchedInferenceModel: true },
  { get label() { return uiText("GPT 6.1 Sol"); }, value: 'gpt-6.1-sol', isBranchedInferenceModel: true },


  {
    get label() { return uiText("GPT 6 Astra"); },
    value: 'gpt-6-astra',
    isBranchedInferenceModel: true,
  },
  {
    get label() { return uiText("Gemini 4 Argon"); },
    value: 'gemini-4-argon',
    isBranchedInferenceModel: false,
  },
  {
    get label() { return uiText("Qwen 3.8 Max"); },
    value: 'QWEN3.8',
    isBranchedInferenceModel: false,
  },
  {
    get label() { return uiText("Kimi K3"); },
    value: 'kimi-k3',
    isBranchedInferenceModel: false,
  },


]

export const INFERENCE_EFFORT_OPTIONS = [
  {
    get label() { return uiText("high"); },
    value: 'high',
    get description() { return uiText("Faster and recommended for most use cases."); },
  },
  {
    get label() { return uiText("xhigh"); },
    value: 'xhigh',
    get description() { return uiText("Deeper analysis for technical concepts; slower inference."); },
  },
];








export const PIXVERRSE_VIDEO_STYLES = [
  'anime', '3d_animation', 'clay', 'comic', 'cyberpunk'
];




export const OPENAI_SPEAKER_TYPES = [
  {
    value: 'alloy',
    get label() { return uiText("Alloy"); },
    provider: 'OPENAI',
    "Gender": "F",
    previewURL: "https://cdn.openai.com/API/docs/audio/alloy.wav"
  },
  {
    value: 'echo',
    get label() { return uiText("Echo"); },
    provider: 'OPENAI',
    "Gender": "M",
    previewURL: "https://cdn.openai.com/API/docs/audio/echo.wav"
  },
  {
    value: 'fable', get label() { return uiText("Fable"); }, provider: 'OPENAI',
    "Gender": "M",
    previewURL: "https://cdn.openai.com/API/docs/audio/fable.wav"
  },
  {
    value: 'onyx', get label() { return uiText("Onyx"); }, provider: 'OPENAI',
    "Gender": "M",
    previewURL: "https://cdn.openai.com/API/docs/audio/onyx.wav"
  },
  {
    value: 'nova', get label() { return uiText("Nova"); }, provider: 'OPENAI',
    "Gender": "F",
    previewURL: "https://cdn.openai.com/API/docs/audio/nova.wav"
  },
  {
    value: 'shimmer', get label() { return uiText("Shimmer"); }, provider: 'OPENAI',
    "Gender": "F",
    previewURL: "https://cdn.openai.com/API/docs/audio/shimmer.wav"
  },

  {
    value: 'ash', get label() { return uiText("Ash"); }, provider: 'OPENAI',
    "Gender": "M",
    previewURL: "https://cdn.openai.com/API/docs/audio/ash.wav"
  },
  {
    value: 'coral', get label() { return uiText("Coral"); }, provider: 'OPENAI',
    "Gender": "F",
    previewURL: "https://cdn.openai.com/API/docs/audio/coral.wav"
  },
  {
    value: 'sage', get label() { return uiText("Sage"); }, provider: 'OPENAI',
    "Gender": "F",
    previewURL: "https://cdn.openai.com/API/docs/audio/sage.wav"
  },

];





export const MUSIC_PROVIDERS = [
  {
    name: 'CassetteAI',
    key: 'CASSETTEAI',
    minDurationSeconds: 1,
    maxDurationSeconds: 180,
    supportsLyrics: false,
    locksInstrumental: false,
  },
  {
    name: 'AudioCraft',
    key: 'AUDIOCRAFT',
    minDurationSeconds: 1,
    maxDurationSeconds: 180,
    supportsLyrics: false,
    locksInstrumental: true,
  },
  {
    name: 'Lyria 3',
    key: 'LYRIA3',
    minDurationSeconds: 1,
    maxDurationSeconds: 180,
    supportsLyrics: false,
    locksInstrumental: false,
  },
  {
    get name() { return uiText('ElevenLabs Music'); },
    key: 'ELEVENLABS_MUSIC',
    minDurationSeconds: 3,
    maxDurationSeconds: 600,
    supportsLyrics: true,
    locksInstrumental: false,
  },
  {
    get name() { return uiText('Custom Text to Music'); },
    key: 'CUSTOM_TEXT_TO_MUSIC',
    minDurationSeconds: 1,
    maxDurationSeconds: 600,
    supportsLyrics: false,
    locksInstrumental: false,
  },
]



// constants/Types.ts
const CUSTOM_TTS_SPEAKER_TYPES = [
  {
    value: 'custom',
    get label() { return uiText("Custom Voice"); },
    provider: 'CUSTOM_TEXT_TO_SPEECH',
    Gender: null,
  },
];

export const TTS_COMBINED_SPEAKER_TYPES = [
  ...OPENAI_SPEAKER_TYPES,
  ...ELEVENLABS_TTS,
  ...PLAY_SPEAKER_TYPES,
  ...CUSTOM_TTS_SPEAKER_TYPES

];



export const CANVAS_ACTION = {
  MOVE: 'MOVE',
  EDIT: 'EDIT',
  RESIZE: 'RESIZE',
  DEFAULT: 'DEFAULT',
}
