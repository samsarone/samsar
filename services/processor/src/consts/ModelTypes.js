export const FLITE_IMAGE_STYLES = [
  'standard',
  'texture',
];


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


export const IDEOGRAM_IMAGE_STYLES = [
  'AUTO', 'GENERAL', 'REALISTIC', 'DESIGN'
];







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

export const FRAME_TOOLBAR_VIEW = {
  DEFAULT: 'DEFAULT',
  AUDIO: 'AUDIO',
  EXPANDED: 'EXPANDED'
}

export const CURRENT_EDITOR_VIEW = {
  'VIEW': 'VIEW',
  'EDIT': 'EDIT',
}


export const IMAGE_GENERAITON_MODEL_TYPES = [

  {
    name: 'GPT Image 2',
    key: 'GPTIMAGE2',
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
    name: 'F-Lite',
    key: 'FLITE',
    isExpressModel: false,
    imageStyles: FLITE_IMAGE_STYLES,
  },
  {
    name: 'Google Imagen3',
    key: 'IMAGEN3',
    isExpressModel: false,
  },
  {
    name: 'Flux-1.1 Pro',
    key: 'FLUX1.1PRO',
    isExpressModel: false,
  },
  {
    name: 'Dall-E 3',
    key: 'DALLE3'
  },

  {
    name: 'Flux-1 Pro',
    key: 'FLUX1PRO'
  },
  {
    name: 'Flux 1.1 Ultra',
    key: 'FLUX1.1ULTRA'
  },

  {
    name: 'Flux-1 Dev',
    key: 'FLUX1DEV'
  },

  {
    name: 'Recraft V3',
    key: 'RECRAFTV3',
    imageStyles: RECRAFT_IMAGE_STYLES,
  },

  {
    name: 'Stable Diffusion V3.5',
    key: 'SDV3.5'
  },

  {
    name: 'Sana 4.5B',
    key: 'SANA4.5B',
    isExpressModel: false,
  },
  {
    name: 'Sana Sprint',
    key: 'SANASPRINT',
    isExpressModel: false,
  },
  {
    name: 'Recraft 20B',
    key: 'RECRAFT20B',
    imageStyles: RECRAFT_IMAGE_STYLES,
  },
  {
    name: 'Lumalabs Photon',
    key: 'PHOTON'
  },
  {
    name: 'Lumalabs Photon Flash',
    key: 'PHOTONFLASH'
  },
  {
    name: 'Lumina V2',
    key: 'LUMINAV2',
    isExpressModel: false,
  },
  {
    name: 'Ideogram V3',
    key: 'IDEOGRAMV3',
    isExpressModel: false,
    imageStyles: IDEOGRAM_IMAGE_STYLES,
  },

  {
    name: 'HiDream I1',
    key: 'HIDREAMI1',
    isExpressModel: false,
  },

  {
    name: 'NanoBanana 2',
    key: 'NANOBANANA2',
    isExpressModel: false,
    isBranchedImageModel: false,
  },
  {
    name: 'NanoBanana Pro',
    key: 'NANOBANANAPRO',
    isExpressModel: true,
    isBranchedImageModel: true,
  },
  {
    name: 'Qwen Image 3.0 Pro',
    key: 'QWENIMAGE3PRO',
    isExpressModel: true,
    isBranchedImageModel: false,
    standaloneOnly: true,
    providerBilled: true,
    supportedAspectRatios: ['1:1', '16:9', '9:16'],
  },
  {
    name: 'Wan2.7 Pro',
    key: 'WAN2.7PRO',
    isExpressModel: true,
    isBranchedImageModel: false,
    supportedAspectRatios: ['1:1', '16:9', '9:16'],
  }


];


export const VIDEO_GENERATION_MODEL_TYPES = [

  {
    name: 'Runway Gen-4',
    key: 'RUNWAYML',
    isExpressModel: true,
    isBranchedVideoModel: false,
    isTransitionModel: false,
    isImgToVidModel: true,
    isTextToVidModel: true,
    supportedAspectRatios: [
      '16:9', '9:16'
    ]
  },
  {
    name: 'Custom Image to Video',
    key: 'CUSTOM_IMAGE_TO_VIDEO',
    isExpressModel: true,
    isBranchedVideoModel: false,
    isTransitionModel: false,
    isImgToVidModel: true,
    isTextToVidModel: false,
    supportedAspectRatios: [
      '16:9', '9:16', '1:1'
    ]
  },
  {
    name: 'Kling 2.1 Master',
    key: 'KLINGIMGTOVID2.1MASTER',
    isExpressModel: false,
    isImgToVidModel: true,
    supportedAspectRatios: [
      '16:9', '9:16', '1:1',
    ]
  },
  {
    name: 'Kling 2.1 Pro',
    key: 'KLINGIMGTOVID2.1PRO',
    isExpressModel: false,
    isImgToVidModel: true,
    supportedAspectRatios: [
      '16:9', '9:16', '1:1',
    ]
  },
  {
    name: 'Kling 2.1 Standard',
    key: 'KLINGIMGTOVID2.1STANDARD',
    isImgToVidModel: false,
    supportedAspectRatios: [
      '16:9', '9:16', '1:1',
    ]
  },
  {
    name: 'Kling 1.6 Pro',
    key: 'KLINGIMGTOVIDPRO',
    isExpressModel: false,
    isImgToVidModel: true,
    supportedAspectRatios: [
      '16:9', '9:16', '1:1',
    ]
  },

  {
    name: 'Kling 3 Pro Img2Vid',
    key: 'KLINGIMGTOVID3PRO',
    isExpressModel: true,
    isBranchedVideoModel: false,
    isImgToVidModel: true,
    isTextToVidModel: true,
    supportedAspectRatios: [
      '16:9', '9:16', '1:1',
    ]
  },
  {
    name: 'Kling 3 Turbo Img2Vid',
    key: 'KLINGIMGTOVIDTURBO',
    isExpressModel: true,
    isBranchedVideoModel: false,
    isImgToVidModel: true,
    isTextToVidModel: true,
    supportedAspectRatios: [
      '16:9', '9:16', '1:1',
    ]
  },
  {
    name: 'Happy Horse 1.1 I2V',
    key: 'HAPPYHORSEI2V',
    isExpressModel: true,
    isBranchedVideoModel: false,
    isImgToVidModel: true,
    isTextToVidModel: false,
    supportedAspectRatios: [
      '16:9', '9:16', '1:1',
    ]
  },
  {
    name: 'Kling 3 Pro Text2Vid',
    key: 'KLINGTXTTOVID3PRO',
    isExpressModel: false,
    isImgToVidModel: false,
    isTextToVidModel: true,
    supportedAspectRatios: [
      '16:9', '9:16', '1:1',
    ]
  },


  {
    name: 'SD Video',
    key: 'SDVIDEO',
    isImgToVidModel: true,
  },
  {
    name: 'Hailuo O2 Pro',
    key: 'HAILUOPRO',
    isImgToVidModel: true,
    isTextToVidModel: true,
    supportedAspectRatios: [
      '16:9'
    ],
    isExpressModel: false,
  },

  {
    name: 'Haiper 2.0',
    key: 'HAIPER2.0',
    isImgToVidModel: true,
  },

  {
    name: 'Skyreels-i2v',
    key: 'SKYREELSI2V',
    isTextToVidModel: false,
    isImgToVidModel: true,
  },

  {
    name: 'Veo2',
    key: 'VEO',
    isTextToVidModel: true,
    isImgToVidModel: false,

  },

  {
    name: 'Veo2 Img2Vid',
    key: 'VEOI2V',
    isTextToVidModel: false,
    isImgToVidModel: true,
    isExpressModel: false,
    supportedAspectRatios: [
      '16:9', '9:16'
    ]
  },

  {
    name: 'Veo3.1',
    key: 'VEO3.1',
    isImgToVidModel: false,
    isExpressModel: false,
    isTextToVidModel: true,
    supportedAspectRatios: [
      '16:9', '9:16',
    ]

  },

    {
    name: 'Veo3.1 Fast',
    key: 'VEO3.1FAST',
    isImgToVidModel: false,
    isExpressModel: false,
    isTextToVidModel: true,
    supportedAspectRatios: [
      '16:9', '9:16',
    ]

  },

  {
    name: 'PixVerseV4.5',
    key: 'PIXVERSEI2V',
    isImgToVidModel: true,
    isExpressModel: false,
    supportedAspectRatios: [
      '16:9', '9:16'
    ]
  },
  {
    name: 'PixVerseV4.5 Fast',
    key: 'PIXVERSEI2VFAST',
    isImgToVidModel: true,
    supportedAspectRatios: [
      '16:9', '9:16'
    ]
  },

  {
    name: 'Pika2.2 I2V',
    key: 'PIKA2.2I2V',
    isImgToVidModel: true,
    isExpressModel: false,
    isTextToVidModel: false,
    supportedAspectRatios: [
      '16:9', '9:16'
    ]
  },


  {
    name: 'Magi Distilled',
    key: 'MAGIDISTILLED',
    isImgToVidModel: true,
    isExpressModel: false,
    isTextToVidModel: true,
    supportedAspectRatios: [
      '16:9', '9:16', '1:1'
    ]
  },

  {
    name: 'Vidu Img2Vid',
    key: 'VIDUI2V',
    isImgToVidModel: true,
    isExpressModel: false,
    isTextToVidModel: false,
    supportedAspectRatios: [
      '16:9', '9:16',
      '1:1'
    ]

  },

  {
    name: 'Seedance 1.5',
    key: 'SEEDANCEI2V',
    isImgToVidModel: true,
    isTextToVidModel: false,
    isExpressModel: true,
    isBranchedVideoModel: false,
    supportedAspectRatios: [
      '16:9', '9:16',

    ]
  },
  {
    name: 'Seedance 2.0 I2V',
    key: 'SEEDANCE2.0I2V',
    isImgToVidModel: true,
    isTextToVidModel: false,
    isExpressModel: true,
    isBranchedVideoModel: true,
    standaloneOnly: true,
    supportedAspectRatios: [
      '16:9', '9:16',
    ]
  },
  {
    name: 'Seedance 2.5 I2V',
    key: 'SEEDANCE2.5I2V',
    isImgToVidModel: true,
    isTextToVidModel: false,
    isExpressModel: true,
    isBranchedVideoModel: false,
    supportedAspectRatios: [
      '16:9', '9:16',
    ]
  },
  {
    name: 'VEO3.1 Img2Vid',
    key: 'VEO3.1I2V',
    isImgToVidModel: true,
    isExpressModel: true,
    isBranchedVideoModel: true,
    isTextToVidModel: false,
    supportedAspectRatios: [
      '16:9', '9:16'
    ]
  },
  {
    name: 'VEO3.1 Frame to Video',
    key: 'VEO3.1FLIV',
    isImgToVidModel: true,
    isFirstLastFrameToVideoModel: true,
    isExpressModel: false,
    isTextToVidModel: false,
    supportedAspectRatios: [
      '16:9', '9:16'
    ]
  },

  {
    name: 'VEO3.1 Fast Img2Vid',
    key: 'VEO3.1I2VFAST',
    isImgToVidModel: true,
    isExpressModel: true,
    isBranchedVideoModel: true,
    isTextToVidModel: false,
    supportedAspectRatios: [
      '16:9', '9:16'
    ]
  },
  {
    name: 'Nvidia Cosmos 3',
    key: 'COSMOS3SUPERI2V',
    isImgToVidModel: true,
    isExpressModel: true,
    isBranchedVideoModel: true,
    isTextToVidModel: false,
    supportedAspectRatios: [
      '16:9', '9:16'
    ]
  },


];



export const IMAGE_EDIT_MODEL_TYPES = [

  {
    name: 'Flux-1 Pro Fill',
    key: 'FLUX1PROFILL',
    editType: 'inpaint'
  },


  {
    name: 'Flux-1.1 Pro Ultra Redux',
    key: 'FLUX1.1PROULTRAREDUX',
    editType: 'prompt'
  },


  {
    name: 'Flux-1.1 Pro Redux',
    key: 'FLUX1.1PROREDUX',
    editType: 'prompt'
  },


  {
    name: 'Bria Eraser',
    key: 'BRIA_ERASER',
    editType: 'inpaint'
  },
  {
    name: 'Bria GenFill',
    key: 'BRIA_GENFILL',
    editType: 'inpaint'

  },
  {
    name: 'NanoBanana 2 Edit',
    key: 'NANOBANANA2EDIT',
    editType: 'prompt'
  },
  {
    name: 'NanoBanana Pro Edit',
    key: 'NANOBANANAPROEDIT',
    editType: 'prompt'
  },


]


export const CANVAS_ACTION = {
  MOVE: 'MOVE',
  EDIT: 'EDIT',
  RESIZE: 'RESIZE',
  DEFAULT: 'DEFAULT',
}


export const SPEAKER_TYPES = [
  'alloy',
  'echo',
  'fable',
  'onyx',
  'nova',
  'shimmer'
];



export const SPEECH_SELECT_TYPES = {
  SPEECH_LAYER: 'SPEECH_LAYER',
  SPEECH_PER_SCENE: 'SPEECH_PER_SCENE',
};


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
    label: 'Qwen 3.8 Max',
    value: 'QWEN3.8',
  },
  {
    label: 'Kimi K3',
    value: 'kimi-k3',
  },
];


export const INFERENCE_MODEL_TYPES = [
  {
    label: 'gpt-5.6-sol',
    value: 'gpt-5.6-sol',
    isBranchedInferenceModel: true,
  },
  {
    label: 'Gemini 3.1 Pro',
    value: 'gemini-3.1-pro',
    isBranchedInferenceModel: false,
  },
  {
    label: 'Qwen 3.8 Max',
    value: 'QWEN3.8',
    isBranchedInferenceModel: false,
  },
  {
    label: 'Kimi K3',
    value: 'kimi-k3',
    isBranchedInferenceModel: false,
  },

]




export const TTS_PROVIDERS = [
  { value: 'OPENAI', label: 'OpenAI' },
  { value: 'PLAYHT', label: 'Play.ht' },
  { value: 'GOOGLE', label: 'Google TTS' },
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
];



export const MUSIC_PROVIDERS = [
  {
    name: 'AudioCraft',
    key: 'AUDIOCRAFT'
  },
  {
    name: 'Cassette AI',
    key: 'CASSETTEAI'
  },
  {
    name: 'Lyria 3',
    key: 'LYRIA3'
  },
  {
    name: 'ElevenLabs Music',
    key: 'ELEVENLABS_MUSIC'
  },
  {
    name: 'Custom Text to Music',
    key: 'CUSTOM_TEXT_TO_MUSIC'
  }
];
