import { ELEVENLABS_TTS } from './ElevenLabs.jsx';
import { PLAY_SPEAKER_TYPES } from './PlayAI.jsx';

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
    name: 'GPT Image 2',
    key: 'GPTIMAGE2',
    isExpressModel: true,
  },
  {
    name: 'Seedream',
    key: 'SEEDREAM',
    isExpressModel: true,
  },
  {
    name: 'NanoBanana 2',
    key: 'NANOBANANA2',
    isExpressModel: true,
  },
  {
    name: 'NanoBanana Pro',
    key: 'NANOBANANAPRO',
    isExpressModel: true,
  },
  {
    name: 'Wan2.7 Pro',
    key: 'WAN2.7PRO',
    isExpressModel: true,
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
    name: 'Custom Image to Video',
    key: 'CUSTOM_IMAGE_TO_VIDEO',
    isExpressModel: true,
    isTransitionModel: false,
    isImageToVideoModel: true,
    isTextToVideoModel: false,
    supportedAspectRatios: [
      '16:9', '9:16', '1:1',
    ]
  },
  {
    name: 'Kling 3 Pro Img2Vid',
    key: 'KLINGIMGTOVID3PRO',
    isExpressModel: true,
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
    isImageToVideoModel: true,
    isTextToVideoModel: false,
    supportedAspectRatios: [
      '16:9', '9:16', '1:1',
    ]
  },
  {
    name: 'Kling 3 Pro Text2Vid',
    key: 'KLINGTXTTOVID3PRO',
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
    supportedAspectRatios: [
      '16:9', '9:16',
    ]
  },
  {
    name: 'Seedance 2.0 I2V',
    key: 'SEEDANCE2.0I2V',
    isImageToVideoModel: true,
    isTextToVideoModel: false,
    isExpressModel: false,
    supportedAspectRatios: [
      '16:9', '9:16',
    ]
  },
  {
    name: 'Seedance 2.0 T2V',
    key: 'SEEDANCE2.0T2V',
    isImageToVideoModel: false,
    isTextToVideoModel: true,
    isExpressModel: false,
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
    name: 'GPT Image 2 Edit',
    key: 'GPTIMAGE2EDIT',
    editType: 'inpaint',
    isPromptEnabled: true,
  },

]



export const ASSISTANT_MODEL_TYPES = [
  {
    label: 'GPT 5.6 Sol',
    value: 'gpt-5.6-sol',
  },
  {
    label: 'Gemini 3.1 Pro',
    value: 'gemini-3.1-pro',
  },
  {
    label: 'Qwen 3.7',
    value: 'QWEN3.7',
  },


];

export const INFERENCE_MODEL_TYPES = [


  {
    label: 'GPT 5.6 Sol',
    value: 'gpt-5.6-sol',
  },
  {
    label: 'Gemini 3.1 Pro',
    value: 'gemini-3.1-pro',
  },
  {
    label: 'Qwen 3.7',
    value: 'QWEN3.7',
  },


]








export const PIXVERRSE_VIDEO_STYLES = [
  'anime', '3d_animation', 'clay', 'comic', 'cyberpunk'
];




export const OPENAI_SPEAKER_TYPES = [
  {
    value: 'alloy',
    label: 'Alloy',
    provider: 'OPENAI',
    "Gender": "F",
    previewURL: "https://cdn.openai.com/API/docs/audio/alloy.wav"
  },
  {
    value: 'echo',
    label: 'Echo',
    provider: 'OPENAI',
    "Gender": "M",
    previewURL: "https://cdn.openai.com/API/docs/audio/echo.wav"
  },
  {
    value: 'fable', label: 'Fable', provider: 'OPENAI',
    "Gender": "M",
    previewURL: "https://cdn.openai.com/API/docs/audio/fable.wav"
  },
  {
    value: 'onyx', label: 'Onyx', provider: 'OPENAI',
    "Gender": "M",
    previewURL: "https://cdn.openai.com/API/docs/audio/onyx.wav"
  },
  {
    value: 'nova', label: 'Nova', provider: 'OPENAI',
    "Gender": "F",
    previewURL: "https://cdn.openai.com/API/docs/audio/nova.wav"
  },
  {
    value: 'shimmer', label: 'Shimmer', provider: 'OPENAI',
    "Gender": "F",
    previewURL: "https://cdn.openai.com/API/docs/audio/shimmer.wav"
  },

  {
    value: 'ash', label: 'Ash', provider: 'OPENAI',
    "Gender": "M",
    previewURL: "https://cdn.openai.com/API/docs/audio/ash.wav"
  },
  {
    value: 'coral', label: 'Coral', provider: 'OPENAI',
    "Gender": "F",
    previewURL: "https://cdn.openai.com/API/docs/audio/coral.wav"
  },
  {
    value: 'sage', label: 'Sage', provider: 'OPENAI',
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
    name: 'ElevenLabs Music',
    key: 'ELEVENLABS_MUSIC',
    minDurationSeconds: 3,
    maxDurationSeconds: 600,
    supportsLyrics: true,
    locksInstrumental: false,
  },
  {
    name: 'Custom Text to Music',
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
    label: 'Custom Voice',
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
