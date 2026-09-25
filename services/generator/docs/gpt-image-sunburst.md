# GPTImage 2.5 Sunburst adapters

Use `GPTIMAGE2.5` for generation and `GPTIMAGE2.5EDIT` for editing.
The retired `GPTIMAGE2` and `GPTIMAGE2EDIT` keys return an HTTP 400 Invalid model
validation error for new API requests. Saved sessions and queued jobs can still
be read using their historical keys. Legacy `GPTIMAGE1`/`GPTIMAGE1EDIT` native
handlers share the same upstream model.

| Adapter | New requests |
| --- | --- |
| OpenAI | `gpt-image-2.5-sunburst`, for generation and editing |
| Fal | `openai/gpt-image-2.5/sunburst/text-to-image`, for generation |
| Samsar | Existing application identifiers are forwarded to the hosted API; its generator must run this update to use Sunburst |
| GMICloud / GenBlaze | Excluded from new GPT Image requests until Sunburst identifiers and request compatibility are verified |

Production generation defaults to OpenAI directly. Standalone installations
retain their configured order among supported adapters. Existing submitted Fal
and GMICloud requests keep their provider so they can finish.

New Fal submissions persist `gptImageFalEndpoint`; polling uses that endpoint.
Older Fal requests without the field still use `fal-ai/gpt-image-2`.

Image dimensions, `high` quality, PNG output, and one image per request are
unchanged. No deployment or live generation is performed by this source change.

Documentation checked September 21, 2026:

- [OpenAI Sunburst model](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst)
- [OpenAI image generation and output settings](https://developers.openai.com/api/docs/guides/image-generation)
- [Fal Sunburst generation schema](https://fal.ai/models/openai/gpt-image-2.5/sunburst/text-to-image/api)
- [GMICloud documentation index](https://docs.gmicloud.ai/llms.txt): lists GPT Image 2 generation/editing but no Sunburst model; the authenticated model catalog could not be verified without a configured GMICloud key.
