import { calculateAssistantCreditsFromUsage } from '../models/api/AssistantBilling.js';
import { normalizeKlingModelKey, KLING_V4_DURATION_SECONDS, KLING_V4_STUDIO_CREDITS_PER_SECOND } from '../utils/KlingModel.js';
// ModelPrices.js

import {
  EXPRESS_VIDEO_CREDITS_PER_SECOND_BY_MODEL,
  getExpressVideoPricingDistributionPerSecond,
} from './pricing/ExpressVideoPricingDistribution.js';
import { isStandaloneEdition } from '../utils/EnvironmentUtils.js';

const IS_STANDALONE_DEPLOYMENT = isStandaloneEdition();
const QWEN_IMAGE_3_PRO_CREDITS = IS_STANDALONE_DEPLOYMENT ? 0 : 46;

export const COSMOS3_SUPER_MODEL_KEY = 'COSMOS3SUPERI2V';
export const COSMOS3_SUPER_MAX_FRAMES = 189;
export const COSMOS3_SUPER_SHORT_DURATION_SECONDS = 5;
export const COSMOS3_SUPER_TARGET_MAX_DURATION_SECONDS = 8;
export const DEFAULT_COSMOS3_SUPER_FRAMES_PER_SECOND = 24;

const DURATION_UNIT_EPSILON = 0.0001;

export function getCosmos3SuperMaxDurationSeconds(framesPerSecond = DEFAULT_COSMOS3_SUPER_FRAMES_PER_SECOND) {
  const parsedFramesPerSecond = Number(framesPerSecond);
  const normalizedFramesPerSecond = Number.isFinite(parsedFramesPerSecond) && parsedFramesPerSecond > 0
    ? Math.round(parsedFramesPerSecond)
    : DEFAULT_COSMOS3_SUPER_FRAMES_PER_SECOND;
  return Math.min(COSMOS3_SUPER_TARGET_MAX_DURATION_SECONDS, COSMOS3_SUPER_MAX_FRAMES / normalizedFramesPerSecond);
}

export function formatVideoDurationSeconds(durationSeconds) {
  const parsedDuration = Number(durationSeconds);
  if (!Number.isFinite(parsedDuration)) {
    return '';
  }
  return Number.isInteger(parsedDuration)
    ? String(parsedDuration)
    : String(Number(parsedDuration.toFixed(3)));
}

export function getVideoModelDurationUnitsForFramesPerSecond(modelKey, framesPerSecond) {
  const modelType = VIDEO_MODEL_PRICES.find((model) => model.key === normalizeKlingModelKey(modelKey));
  const rawUnits = Array.isArray(modelType?.baseUnits) && modelType.baseUnits.length > 0
    ? modelType.baseUnits
    : modelType?.units;
  const sanitizedUnits = (Array.isArray(rawUnits) ? rawUnits : [5])
    .map((unit) => Number(unit))
    .filter((unit) => Number.isFinite(unit) && unit > 0);

  if (modelKey !== COSMOS3_SUPER_MODEL_KEY) {
    return [...new Set(sanitizedUnits.length > 0 ? sanitizedUnits : [5])].sort((a, b) => a - b);
  }

  const maxDurationSeconds = getCosmos3SuperMaxDurationSeconds(framesPerSecond);
  const cappedUnits = [COSMOS3_SUPER_SHORT_DURATION_SECONDS];
  if (Math.abs(maxDurationSeconds - COSMOS3_SUPER_SHORT_DURATION_SECONDS) > DURATION_UNIT_EPSILON) {
    cappedUnits.push(maxDurationSeconds);
  }

  return [...new Set(cappedUnits)].sort((a, b) => a - b);
}

export const IMAGE_MODEL_PRICES = [
  {
    key: 'GPTIMAGE2.5',
    isExpressModel: true,
    isBranchedImageModel: true,
    prices: [
      { aspectRatio: '1:1', price: 46 },
      { aspectRatio: '16:9', price: 46 },
      { aspectRatio: '9:16', price: 46 },
    ],
  },
  {
    key: 'SEEDREAM',
    isExpressModel: true,
    isBranchedImageModel: false,
    prices: [
      { aspectRatio: '1:1', price: 15 },
      { aspectRatio: '16:9', price: 23 },
      { aspectRatio: '9:16', price: 23 },
    ],
  },
  {
    key: 'NANOBANANA2',
    isExpressModel: false,
    isBranchedImageModel: false,
    prices: [
      { aspectRatio: '1:1', price: 23 },
      { aspectRatio: '16:9', price: 23 },
      { aspectRatio: '9:16', price: 23 },
    ],
  },
  {
    key: 'NANOBANANAPRO',
    name: 'NanoBanana Pro',
    isExpressModel: true,
    isBranchedImageModel: true,
    prices: [
      { aspectRatio: '1:1', price: 15 },
      { aspectRatio: '16:9', price: 15 },
      { aspectRatio: '9:16', price: 15 },
    ],
  },
  {
    key: 'QWENIMAGE3PRO',
    name: 'Qwen Image 3.0 Pro',
    isExpressModel: true,
    isBranchedImageModel: false,
    providerBilled: IS_STANDALONE_DEPLOYMENT,
    prices: [
      { aspectRatio: '1:1', price: QWEN_IMAGE_3_PRO_CREDITS },
      { aspectRatio: '16:9', price: QWEN_IMAGE_3_PRO_CREDITS },
      { aspectRatio: '9:16', price: QWEN_IMAGE_3_PRO_CREDITS },
    ],
  },
  {
    key: 'WAN2.7PRO',
    name: 'Wan2.7 Pro',
    isExpressModel: true,
    isBranchedImageModel: false,
    prices: [
      { aspectRatio: '1:1', price: 15 },
      { aspectRatio: '16:9', price: 15 },
      { aspectRatio: '9:16', price: 15 },
    ],
  },
]


export const IMAGE_EDIT_MODEL_PRICES = [
  {
    key: 'NANOBANANA2EDIT',
    prices: [
      { aspectRatio: '1:1', price: 45 },
      { aspectRatio: '16:9', price: 45 },
      { aspectRatio: '9:16', price: 45 },
    ],
  },
  {
    key: 'NANOBANANAPROEDIT',
    prices: [
      { aspectRatio: '1:1', price: 45 },
      { aspectRatio: '16:9', price: 45 },
      { aspectRatio: '9:16', price: 45 },
    ],
  },
  {
    key: 'GPTIMAGE2.5EDIT',
    prices: [
      { aspectRatio: '1:1', price: 45 },
      { aspectRatio: '16:9', price: 45 },
      { aspectRatio: '9:16', price: 45 },
    ],
  },
]


export const VIDEO_MODEL_PRICES = [
  {
    key: 'RUNWAYML',
    isExpressModel: true,
    isBranchedVideoModel: false,
    isImageToVideoModel: true,
    isTextToVideoModel: true,
    prices: [
      { aspectRatio: '16:9', price: EXPRESS_VIDEO_CREDITS_PER_SECOND_BY_MODEL.RUNWAYML },
      { aspectRatio: '9:16', price: EXPRESS_VIDEO_CREDITS_PER_SECOND_BY_MODEL.RUNWAYML },
    ],
    pricingDistribution: getExpressVideoPricingDistributionPerSecond('RUNWAYML'),
    units: [5, 10],
  },
  {
    key: 'CUSTOM_IMAGE_TO_VIDEO',
    name: 'Custom Image to Video',
    isExpressModel: true,
    isBranchedVideoModel: false,
    isImageToVideoModel: true,
    isTextToVideoModel: false,
    prices: [],
    units: [5, 10],
  },
  {
    key: 'KLINGIMGTOVID4',
    name: 'Kling 4 Img2Vid',
    isExpressModel: true,
    isBranchedVideoModel: false,
    isImageToVideoModel: true,
    isTextToVideoModel: false,
    isPerSecondPricing: true,
    prices: [
      { aspectRatio: '1:1', price: KLING_V4_STUDIO_CREDITS_PER_SECOND },
      { aspectRatio: '16:9', price: KLING_V4_STUDIO_CREDITS_PER_SECOND },
      { aspectRatio: '9:16', price: KLING_V4_STUDIO_CREDITS_PER_SECOND },
    ],
    pricingDistribution: getExpressVideoPricingDistributionPerSecond('KLINGIMGTOVID4'),
    units: [...KLING_V4_DURATION_SECONDS],
  },
  {
    key: 'HAPPYHORSEI2V',
    name: 'Happy Horse 1.1 I2V',
    isExpressModel: true,
    isBranchedVideoModel: false,
    isImageToVideoModel: true,
    isTextToVideoModel: false,
    prices: [
      { aspectRatio: '1:1', price: EXPRESS_VIDEO_CREDITS_PER_SECOND_BY_MODEL.HAPPYHORSEI2V },
      { aspectRatio: '16:9', price: EXPRESS_VIDEO_CREDITS_PER_SECOND_BY_MODEL.HAPPYHORSEI2V },
      { aspectRatio: '9:16', price: EXPRESS_VIDEO_CREDITS_PER_SECOND_BY_MODEL.HAPPYHORSEI2V },
    ],
    pricingDistribution: getExpressVideoPricingDistributionPerSecond('HAPPYHORSEI2V'),
    units: [5, 10, 15],
  },
  {
    key: 'KLINGTXTTOVID4',
    isExpressModel: false,
    isImageToVideoModel: false,
    isTextToVideoModel: true,
    isPerSecondPricing: true,
    prices: [
      { aspectRatio: '1:1', price: KLING_V4_STUDIO_CREDITS_PER_SECOND },
      { aspectRatio: '16:9', price: KLING_V4_STUDIO_CREDITS_PER_SECOND },
      { aspectRatio: '9:16', price: KLING_V4_STUDIO_CREDITS_PER_SECOND },
    ],
    units: [...KLING_V4_DURATION_SECONDS],
  },
  {
    key: 'HAILUOPRO',
    isExpressModel: false,
    isImageToVideoModel: true,
    isTextToVideoModel: true,
    prices: [
      { aspectRatio: '16:9', price: 100 },
    ],
    units: [6],
  },
  {
    key: 'SEEDANCEI2V',
    name: 'Seedance 1.5',
    isExpressModel: true,
    isBranchedVideoModel: false,
    isImageToVideoModel: true,
    isTextToVideoModel: false,
    prices: [
      { aspectRatio: '16:9', price: EXPRESS_VIDEO_CREDITS_PER_SECOND_BY_MODEL.SEEDANCEI2V },
      { aspectRatio: '9:16', price: EXPRESS_VIDEO_CREDITS_PER_SECOND_BY_MODEL.SEEDANCEI2V },
    ],
    pricingDistribution: getExpressVideoPricingDistributionPerSecond('SEEDANCEI2V'),
    units: [5, 10],
  },
  {
    key: 'SEEDANCE2.0I2V',
    name: 'Seedance 2.0 I2V',
    isExpressModel: true,
    isBranchedVideoModel: true,
    isImageToVideoModel: true,
    isTextToVideoModel: false,
    providerBilled: IS_STANDALONE_DEPLOYMENT,
    isPerSecondPricing: true,
    prices: [
      { aspectRatio: '16:9', price: EXPRESS_VIDEO_CREDITS_PER_SECOND_BY_MODEL['SEEDANCE2.0I2V'] },
      { aspectRatio: '9:16', price: EXPRESS_VIDEO_CREDITS_PER_SECOND_BY_MODEL['SEEDANCE2.0I2V'] },
    ],
    pricingDistribution: getExpressVideoPricingDistributionPerSecond('SEEDANCE2.0I2V'),
    units: [5, 10, 15],
  },
  {
    key: 'SEEDANCE2.5I2V',
    name: 'Seedance 2.5 I2V',
    isExpressModel: true,
    isBranchedVideoModel: false,
    isImageToVideoModel: true,
    isTextToVideoModel: false,
    providerBilled: IS_STANDALONE_DEPLOYMENT,
    isPerSecondPricing: true,
    prices: [
      { aspectRatio: '16:9', price: 50 },
      { aspectRatio: '9:16', price: 50 },
    ],
    pricingDistribution: getExpressVideoPricingDistributionPerSecond('SEEDANCE2.5I2V'),
    units: [5, 10, 15, 20],
  },
  {
    key: 'VEO3.1',
    isExpressModel: false,
    isImageToVideoModel: false,
    isTextToVideoModel: true,
    prices: [
      { aspectRatio: '16:9', price: 700 },
      { aspectRatio: '9:16', price: 700 },
    ],
    units: [4, 6, 8],
  },
  {
    key: 'VEO3.1FAST',
    isExpressModel: false,
    isImageToVideoModel: false,
    isTextToVideoModel: true,
    prices: [
      { aspectRatio: '16:9', price: 300 },
      { aspectRatio: '9:16', price: 300 },
    ],
    units: [4, 6, 8],
  },
  {
    key: 'VEO3.1I2V',
    isExpressModel: true,
    isBranchedVideoModel: true,
    isImageToVideoModel: true,
    isTextToVideoModel: false,
    prices: [
      { aspectRatio: '16:9', price: EXPRESS_VIDEO_CREDITS_PER_SECOND_BY_MODEL['VEO3.1I2V'] },
      { aspectRatio: '9:16', price: EXPRESS_VIDEO_CREDITS_PER_SECOND_BY_MODEL['VEO3.1I2V'] },
    ],
    pricingDistribution: getExpressVideoPricingDistributionPerSecond('VEO3.1I2V'),
    units: [6, 8],
  },
  {
    key: 'VEO3.1FLIV',
    isExpressModel: false,
    isImageToVideoModel: true,
    isFirstLastFrameToVideoModel: true,
    isTextToVideoModel: false,
    prices: [
      { aspectRatio: '16:9', price: 700 },
      { aspectRatio: '9:16', price: 700 },
    ],
    units: [4, 6, 8],
  },
  {
    key: 'VEO3.1I2VFAST',
    isExpressModel: true,
    isBranchedVideoModel: true,
    isImageToVideoModel: true,
    isTextToVideoModel: false,
    prices: [
      { aspectRatio: '16:9', price: EXPRESS_VIDEO_CREDITS_PER_SECOND_BY_MODEL['VEO3.1I2VFAST'] },
      { aspectRatio: '9:16', price: EXPRESS_VIDEO_CREDITS_PER_SECOND_BY_MODEL['VEO3.1I2VFAST'] },
    ],
    pricingDistribution: getExpressVideoPricingDistributionPerSecond('VEO3.1I2VFAST'),
    units: [6, 8],
  },
  {
    key: COSMOS3_SUPER_MODEL_KEY,
    name: 'Nvidia Cosmos 3',
    isExpressModel: true,
    isBranchedVideoModel: true,
    isImageToVideoModel: true,
    isTextToVideoModel: false,
    isPerSecondPricing: true,
    maxFrames: COSMOS3_SUPER_MAX_FRAMES,
    prices: [
      { aspectRatio: '16:9', price: 10 },
      { aspectRatio: '9:16', price: 10 },
    ],
    pricingDistribution: getExpressVideoPricingDistributionPerSecond('COSMOS3SUPERI2V'),
    baseUnits: [COSMOS3_SUPER_SHORT_DURATION_SECONDS, COSMOS3_SUPER_TARGET_MAX_DURATION_SECONDS],
    units: [5, getCosmos3SuperMaxDurationSeconds()],
  },

  // Lip-sync prices depend on the Fal endpoint and its billing unit. The
  // aspect-ratio price list cannot represent minute rates, a 40-second tier,
  // five-second blocks, or the Hummingbird unverified-price fallback.
  {
    key: 'SYNCLIPSYNC',
    providerBilled: true,
    prices: [],
  },
  {
    key: 'LATENTSYNC',
    providerBilled: true,
    prices: [],
  },
  {
    key: 'KLINGLIPSYNC',
    providerBilled: true,
    prices: [],
  },
  {
    key: 'HUMMINGBIRDLIPSYNC',
    providerBilled: true,
    prices: [],
  },
  {
    key: 'CREATIFYLIPSYNC',
    providerBilled: true,
    prices: [],
  },
  {
    key: 'MMAUDIOV2',
    providerBilled: true,
    prices: [],
  },
  {
    key: 'MIRELOAI',
    providerBilled: true,
    prices: [],
  },
]


export const TTS_TYPES = [
  'OPENAI',
  'PLAYTS',
  'ELEVENLABS',
  'CUSTOM_TEXT_TO_SPEECH',
]

// to update all of thse

export const ASSISTANT_MODEL_PRICES = [
  {
    key: "gpt-6-astra",
    prices: [
      {
        operationType: "words",
        tokens: 1000,
        price: 9
      },
    ]
  },
  {
    key: "gemini-4-carbon",
    billing: "token_usage",
    get prices() {
      return [
        ['input_tokens', { input_tokens: 1_000_000, output_tokens: 0 }],
        ['cached_input_tokens', { input_tokens: 1_000_000, input_tokens_details: { cached_tokens: 1_000_000 }, output_tokens: 0 }],
        ['output_tokens', { input_tokens: 0, output_tokens: 1_000_000 }],
      ].map(([operationType, usage]) => ({
        operationType,
        tokens: 1_000_000,
        price: calculateAssistantCreditsFromUsage({ model: 'gemini-4-carbon', usage }).credits,
      }));
    },
  },

]

export const THEME_MODEL_PRICES = [
  {
    prices: [
      {
        operationType: "query",
        tokens: 1,
        price: 2
      }
    ]
  }
]

export const TRANSLATION_MODEL_PRICES = [
  {
    prices: [
      {
        operationType: "line",
        tokens: 1,
        price: 2
      }
    ]
  }
];


export const PROMPT_GENERATION_MODEL_PRICES = [
  {
    prices: [
      {
        operationType: "line",
        tokens: 1,
        price: 2
      }
    ]
  }
]



export const SPEECH_MODEL_PRICES = [

  {
    key: "TTS",
    prices: [
      {
        operationType: "words",
        tokens: 1000,
        price: 2
      },
    ]
  },
  {
    key: "TTSHD",
    prices: [
      {
        operationType: "words",
        tokens: 400,
        price: 2
      },
    ]
  },
];


export const MUSIC_MODEL_PRICES = [
  {
    key: 'AUDIOCRAFT',
    prices: [
      {
        operationType: "generate_song",
        price: 3,
      }
    ]
  },
  {
    key: 'CASSETTEAI',
    prices: [
      {
        operationType: "generate_song",
        price: 8,
      }
    ]
  },
  {
    key: 'LYRIA3',
    prices: [
      {
        operationType: "generate_song",
        price: 3,
      }
    ]
  },
  {
    key: 'ELEVENLABS_MUSIC',
    prices: [
      {
        operationType: "generate_song",
        price: 3,
      }
    ]
  },
  {
    key: 'CUSTOM_TEXT_TO_MUSIC',
    prices: [
      {
        operationType: "generate_song",
        price: 3,
      }
    ]
  },
]
