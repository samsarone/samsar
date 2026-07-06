// ModelPrices.js

export const IMAGE_MODEL_PRICES = [
  {
    key: 'DALLE3',
    prices: [
      {
        aspectRatio: '1:1',
        price: 10
      },
      {
        aspectRatio: '16:9',
        price: 15
      },
      {
        aspectRatio: '9:16',
        price: 15
      },
    ]
  },
  {
    key: 'DALLE3HD',
    prices: [
      {
        aspectRatio: '1:1',
        price: 15
      },
      {
        aspectRatio: '16:9',
        price: 18
      },
      {
        aspectRatio: '9:16',
        price: 18
      },
    ]
  },
  {
    key: 'FLUX1PRO',
    prices: [
      {
        aspectRatio: '1:1',
        price: 10
      },
      {
        aspectRatio: '16:9',
        price: 15
      },
      {
        aspectRatio: '9:16',
        price: 15
      },
    ]
  },
  {
    key: 'FLUX1.1PRO',
    prices: [
      {
        aspectRatio: '1:1',
        price: 10
      },
      {
        aspectRatio: '16:9',
        price: 15
      },
      {
        aspectRatio: '9:16',
        price: 15
      },
    ]
  },
  {
    key: 'FLUX1DEV',
    prices: [
      {
        aspectRatio: '1:1',
        price: 5
      },
      {
        aspectRatio: '16:9',
        price: 10
      },
      {
        aspectRatio: '9:16',
        price: 10
      },
    ]
  }
]

export const VIDEO_MODEL_PRICES = [
  {
    key: 'LUMA',
    prices: [
      {
        aspectRatio: '1:1',
        price: 60
      },
      {
        aspectRatio: '16:9',
        price: 60
      },
      {
        aspectRatio: '9:16',
        price: 60
      },
    ]
  },


  {
    key: 'KLINGTXTTOVIDSTANDARD',
    prices: [
      {
        aspectRatio: '1:1',
        price: 60
      },
      {
        aspectRatio: '16:9',
        price: 60
      },
      {
        aspectRatio: '9:16',
        price: 60
      },
    ]
  },
  {
    key: 'KLINGIMGTOVIDSTANDARD',
    prices: [
      {
        aspectRatio: '1:1',
        price: 60
      },
      {
        aspectRatio: '16:9',
        price: 60
      },
      {
        aspectRatio: '9:16',
        price: 60
      },
    ]
  },
  {
    key: 'KLINGTXTTOVIDPRO',
    prices: [
      {
        aspectRatio: '1:1',
        price: 100
      },
      {
        aspectRatio: '16:9',
        price: 100
      },
      {
        aspectRatio: '9:16',
        price: 100
      },
    ]
  },
  {
    key: 'KLINGIMGTOVIDPRO',
    prices: [
      {
        aspectRatio: '1:1',
        price: 100
      },
      {
        aspectRatio: '16:9',
        price: 100
      },
      {
        aspectRatio: '9:16',
        price: 100
      },
    ]
  },

  {
    key: 'RUNWAYML',
    prices: [
      {
        aspectRatio: '1:1',
        price: 50
      },
      {
        aspectRatio: '16:9',
        price: 50
      },
      {
        aspectRatio: '9:16',
        price: 50
      },
    ]
  },
  {
    key: 'SDVIDEO',
    prices: [
      {
        aspectRatio: '1:1',
        price: 15
      },
      {
        aspectRatio: '16:9',
        price: 15
      },
      {
        aspectRatio: '9:16',
        price: 15
      },
    ]
  },
  {
    key: 'HAILUO',
    prices: [

      {
        aspectRatio: '16:9',
        price: 80
      },
    ]
  }
]



// to update all of thse

export const ASSISTANT_MODEL_PRICES = [
  {
    key: "gpt-5.5",
    prices: [
      {
        operationType: "words",
        tokens: 1000,
        price: 1
      },
    ]
  },
  {
    key: "gemini-3.1-pro",
    prices: [
      {
        operationType: "words",
        tokens: 1000,
        price: 1
      },
    ]
  }
]

export const THEME_MODEL_PRICES = [
  {
    prices: [
      {
        operationType: "query",
        tokens: 1,
        price: 1
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
        price: 1
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
        price: 1
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
        price: 1
      },
    ]
  },
  {
    key: "TTSHD",
    prices: [
      {
        operationType: "words",
        tokens: 400,
        price: 1
      },
    ]
  },
];


export const MUSIC_MODEL_PRICES = [];
