# Image Billing and Retries

Studio image generation, edits, enhancements, external image endpoints, and reroll image requests are charged when each image-model call completes. See the [final image token and output prices](https://docs.samsar.one/pricing#image-models) for the listed model, adapter, and configuration.

Production agent pipelines retain their flat stage pricing. Standalone Docker does not debit local image credits. When its image adapter uses Samsar.js, each hosted image request is billed by the hosted image endpoint; the local worker does not add another debit.

## Final image token prices

Credits per one million tokens on the named native adapter. Generation and the listed edit keys share these rates. A dash means that token category is not offered on that route.

| Model | Adapter | Token category | Input | Cached input | Output |
| --- | --- | --- | --- | --- | --- |
| `GPTIMAGE2.5 / GPTIMAGE2.5EDIT` | OpenAI | Text tokens | 600 | — | — |
| `GPTIMAGE2.5 / GPTIMAGE2.5EDIT` | OpenAI | Image tokens | 960 | — | 3,600 |
| `NANOBANANA2 / NANOBANANA2EDIT` | Google global | Text tokens | 60 | 6 | 360 |
| `NANOBANANA2 / NANOBANANA2EDIT` | Google global | Image tokens | 60 | 6 | 7,200 |
| `NANOBANANA2 / NANOBANANA2EDIT` | Google regional | Text tokens | 66 | 6.6 | 396 |
| `NANOBANANA2 / NANOBANANA2EDIT` | Google regional | Image tokens | 66 | 6.6 | 7,920 |
| `NANOBANANAPRO / NANOBANANAPROEDIT` | Google global | Text tokens | 240 | 24 | 1,440 |
| `NANOBANANAPRO / NANOBANANAPROEDIT` | Google global | Image tokens | 240 | 24 | 14,400 |
| `NANOBANANAPRO / NANOBANANAPROEDIT` | Google regional | Text tokens | 264 | 26.4 | 1,584 |
| `NANOBANANAPRO / NANOBANANAPROEDIT` | Google regional | Image tokens | 264 | 26.4 | 15,840 |

Text output includes reasoning tokens when reported. The direct OpenAI Images API has no cached-input price.

## Final output image prices

Credits per generated image on the listed native adapter and configuration.

| Model | Adapter | Configuration | Credits / output image |
| --- | --- | --- | --- |
| `DALLE3` | OpenAI | Standard · 1024×1024 | 4.8 |
| `DALLE3` | OpenAI | Standard · 1792×1024 or 1024×1792 | 9.6 |
| `IMAGEN3` | Google | Standard generation | 4.8 |
| `IMAGEN3FLASH` | Google | Fast generation | 2.4 |
| `WAN2.7PRO` | Alibaba international | 1K | 9 |
| `QWENIMAGE3PRO` | Alibaba international | 1K | 4.8 |
| `QWENIMAGE3PRO` | Alibaba international | 2K | 9 |
| `WAN2.7PRO` | Alibaba China / global | 1K | 8.25132 |
| `QWENIMAGE3PRO` | Alibaba China / global | 1K | 4.1256 |
| `QWENIMAGE3PRO` | Alibaba China / global | 2K | 8.25132 |

Supported Fal image models have separate [final model-call rates](https://docs.samsar.one/pricing#image-models). Some model/configuration routes lack verified tariffs and stop before a new paid submission; this does not disable those keys on other adapters or fixed-price agent workflows. Other adapter routes report their configuration-specific charge in the completion receipt.

## Completion receipts

Image API submissions return zero credits charged and a pending billing status. Poll the image status endpoint for the final `creditsCharged`, `remainingCredits`, `x-credits-charged`, and `x-credits-remaining` values. Rerolls settle image, AI-video, lip-sync and video sound-effect model calls individually on completion; the quote does not prepay those calls.

Use one SDK `idempotencyKey` per logical image submission and reuse it after a lost response. The same key and payload reuse the job and its original charge. Changing the payload under that key returns `409`. Polling does not create another image call or debit.

Requests awaiting billing confirmation remain pending. Keep the original request key and continue polling.

## Deployment Configuration

Hosted direct Fal image completion uses the saved, checked-in model tariff and does not call Billing Events or a pricing endpoint. A model or option without a verified tariff stops before a new paid Fal submission under that billing policy. Existing saved results remain available for idempotent billing recovery.

## Verification

```bash
npm run test:image-billing --workspace services/processor
npm test --workspace services/generator
```

Regression coverage includes final image charges, native token categories, concurrent completions, settlement recovery, zero-charge results, image request keys, standalone routing, and protection for existing prepaid jobs and production agent stages.
