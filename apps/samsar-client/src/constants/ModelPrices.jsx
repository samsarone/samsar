// ModelPrices.js

import {
  EXPRESS_VIDEO_CREDITS_PER_SECOND_BY_MODEL,
  getExpressVideoPricingDistributionPerSecond,
} from './pricing/ExpressVideoPricingDistribution.js';

export const COSMOS3_SUPER_MODEL_KEY = 'COSMOS3SUPERI2V';
const COSMOS3_SUPER_MAX_FRAMES = 189;
const COSMOS3_SUPER_SHORT_DURATION_SECONDS = 5;
const COSMOS3_SUPER_TARGET_MAX_DURATION_SECONDS = 8;
const DEFAULT_COSMOS3_SUPER_FRAMES_PER_SECOND = 24;

const DURATION_UNIT_EPSILON = 0.0001;

function getCosmos3SuperMaxDurationSeconds(framesPerSecond = DEFAULT_COSMOS3_SUPER_FRAMES_PER_SECOND) {
  const parsedFramesPerSecond = Number(framesPerSecond);
  const normalizedFramesPerSecond = Number.isFinite(parsedFramesPerSecond) && parsedFramesPerSecond > 0
    ? Math.round(parsedFramesPerSecond)
    : DEFAULT_COSMOS3_SUPER_FRAMES_PER_SECOND;
  return Math.min(COSMOS3_SUPER_TARGET_MAX_DURATION_SECONDS, COSMOS3_SUPER_MAX_FRAMES / normalizedFramesPerSecond);
}

function formatVideoDurationSeconds(durationSeconds) {
  const parsedDuration = Number(durationSeconds);
  if (!Number.isFinite(parsedDuration)) {
    return '';
  }
  return Number.isInteger(parsedDuration)
    ? String(parsedDuration)
    : String(Number(parsedDuration.toFixed(3)));
}

export function formatVideoDurationLabel(durationSeconds) {
  const parsedDuration = Number(durationSeconds);
  if (!Number.isFinite(parsedDuration)) {
    return '';
  }
  const roundedDuration = Math.round(parsedDuration);
  if (Math.abs(parsedDuration - roundedDuration) <= 0.15) {
    return String(roundedDuration);
  }
  return formatVideoDurationSeconds(parsedDuration);
}

export function getVideoModelDurationUnitsForFramesPerSecond(modelKey, framesPerSecond) {
  const modelType = VIDEO_MODEL_PRICES.find((model) => model.key === modelKey);
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
    key: 'GPTIMAGE2',
    isExpressModel: true,
    prices: [
      { aspectRatio: '1:1', price: 46 },
      { aspectRatio: '16:9', price: 46 },
      { aspectRatio: '9:16', price: 46 },
    ],
  },
  {
    key: 'SEEDREAM',
    isExpressModel: true,
    prices: [
      { aspectRatio: '1:1', price: 15 },
      { aspectRatio: '16:9', price: 23 },
      { aspectRatio: '9:16', price: 23 },
    ],
  },
  {
    key: 'NANOBANANA2',
    isExpressModel: false,
    prices: [
      { aspectRatio: '1:1', price: 23 },
      { aspectRatio: '16:9', price: 23 },
      { aspectRatio: '9:16', price: 23 },
    ],
  },
  {
    key: 'NANOBANANAPRO',
    isExpressModel: true,
    prices: [
      { aspectRatio: '1:1', price: 15 },
      { aspectRatio: '16:9', price: 15 },
      { aspectRatio: '9:16', price: 15 },
    ],
  },
  {
    key: 'WAN2.7PRO',
    isExpressModel: true,
    prices: [
      { aspectRatio: '1:1', price: 15 },
      { aspectRatio: '16:9', price: 15 },
      { aspectRatio: '9:16', price: 15 },
    ],
  },
]


export const VIDEO_MODEL_PRICES = [
  {
    key: 'RUNWAYML',
    isExpressModel: true,
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
    key: 'SORA2',
    isExpressModel: false,
    isImageToVideoModel: true,
    isTextToVideoModel: true,
    prices: [
      { aspectRatio: '16:9', price: 100 },
      { aspectRatio: '9:16', price: 100 },
    ],
    units: [8],
  },
  {
    key: 'SORA2PRO',
    isExpressModel: false,
    isImageToVideoModel: true,
    isTextToVideoModel: true,
    prices: [
      { aspectRatio: '16:9', price: 300 },
      { aspectRatio: '9:16', price: 300 },
    ],
    units: [8],
  },
  {
    key: 'CUSTOM_IMAGE_TO_VIDEO',
    isExpressModel: true,
    isImageToVideoModel: true,
    isTextToVideoModel: false,
    prices: [],
    units: [5, 10],
  },
  {
    key: 'KLINGIMGTOVID3PRO',
    isExpressModel: true,
    isImageToVideoModel: true,
    isTextToVideoModel: false,
    prices: [
      { aspectRatio: '1:1', price: EXPRESS_VIDEO_CREDITS_PER_SECOND_BY_MODEL.KLINGIMGTOVID3PRO },
      { aspectRatio: '16:9', price: EXPRESS_VIDEO_CREDITS_PER_SECOND_BY_MODEL.KLINGIMGTOVID3PRO },
      { aspectRatio: '9:16', price: EXPRESS_VIDEO_CREDITS_PER_SECOND_BY_MODEL.KLINGIMGTOVID3PRO },
    ],
    pricingDistribution: getExpressVideoPricingDistributionPerSecond('KLINGIMGTOVID3PRO'),
    units: [5, 10],
  },
  {
    key: 'HAPPYHORSEI2V',
    name: 'Happy Horse 1.1 I2V',
    isExpressModel: true,
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
    key: 'KLINGTXTTOVID3PRO',
    isExpressModel: false,
    isImageToVideoModel: false,
    isTextToVideoModel: true,
    prices: [
      { aspectRatio: '1:1', price: 60 },
      { aspectRatio: '16:9', price: 60 },
      { aspectRatio: '9:16', price: 60 },
    ],
    units: [5, 10, 15],
  },
  {
    key: 'HAILUO',
    isExpressModel: false,
    isImageToVideoModel: true,
    isTextToVideoModel: true,
    prices: [
      { aspectRatio: '16:9', price: 60 },
    ],
    units: [6, 10],
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
    isExpressModel: false,
    isImageToVideoModel: true,
    isTextToVideoModel: false,
    prices: [
      { aspectRatio: '16:9', price: 437.5 },
      { aspectRatio: '9:16', price: 437.5 },
    ],
    units: [5, 10, 15],
  },
  {
    key: 'SEEDANCE2.0T2V',
    name: 'Seedance 2.0 T2V',
    isExpressModel: false,
    isImageToVideoModel: false,
    isTextToVideoModel: true,
    prices: [
      { aspectRatio: '16:9', price: 437.5 },
      { aspectRatio: '9:16', price: 437.5 },
    ],
    units: [5, 10, 15],
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
    isImageToVideoModel: true,
    isTextToVideoModel: false,
    prices: [
      { aspectRatio: '16:9', price: 60 },
      { aspectRatio: '9:16', price: 60 },
    ],
    units: [4, 6, 8],
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
    isImageToVideoModel: true,
    isTextToVideoModel: false,
    prices: [
      { aspectRatio: '16:9', price: EXPRESS_VIDEO_CREDITS_PER_SECOND_BY_MODEL['VEO3.1I2VFAST'] },
      { aspectRatio: '9:16', price: EXPRESS_VIDEO_CREDITS_PER_SECOND_BY_MODEL['VEO3.1I2VFAST'] },
    ],
    pricingDistribution: getExpressVideoPricingDistributionPerSecond('VEO3.1I2VFAST'),
    units: [4, 6, 8],
  },
  {
    key: COSMOS3_SUPER_MODEL_KEY,
    name: 'Nvidia Cosmos 3',
    isExpressModel: true,
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

  // AI post-processing models still used in studio workflows
  {
    key: 'SYNCLIPSYNC',
    prices: [
      { aspectRatio: '1:1', price: 15 },
      { aspectRatio: '16:9', price: 15 },
      { aspectRatio: '9:16', price: 15 },
    ],
  },
  {
    key: 'LATENTSYNC',
    prices: [
      { aspectRatio: '1:1', price: 15 },
      { aspectRatio: '16:9', price: 15 },
      { aspectRatio: '9:16', price: 15 },
    ],
  },
  {
    key: 'KLINGLIPSYNC',
    prices: [
      { aspectRatio: '1:1', price: 15 },
      { aspectRatio: '16:9', price: 15 },
      { aspectRatio: '9:16', price: 15 },
    ],
  },
  {
    key: 'HUMMINGBIRDLIPSYNC',
    prices: [
      { aspectRatio: '1:1', price: 15 },
      { aspectRatio: '16:9', price: 15 },
      { aspectRatio: '9:16', price: 15 },
    ],
  },
  {
    key: 'CREATIFYLIPSYNC',
    prices: [
      { aspectRatio: '1:1', price: 15 },
      { aspectRatio: '16:9', price: 15 },
      { aspectRatio: '9:16', price: 15 },
    ],
  },
  {
    key: 'MMAUDIOV2',
    prices: [
      { aspectRatio: '1:1', price: 15 },
      { aspectRatio: '16:9', price: 15 },
      { aspectRatio: '9:16', price: 15 },
    ],
    units: [5, 10],
  },
  {
    key: 'MIRELOAI',
    prices: [
      { aspectRatio: '1:1', price: 15 },
      { aspectRatio: '16:9', price: 15 },
      { aspectRatio: '9:16', price: 15 },
    ],
    units: [5, 10],
  },
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
