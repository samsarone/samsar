# Lyria adapters

Lyria automatically selects the newest available model for the configured credentials. Existing logical keys `LYRIA3` and `LYRIA2`
remain accepted so saved projects do not need migration.

- Native Google: Gemini Interactions API, model `lyria-3.5`.
- Fal: `google/lyria-3.5`.
- Pending Fal jobs retain the endpoint recorded when submitted, including
  older Lyria 3 Pro and Lyria 2 requests.

## Docker configuration

Create a Gemini authorization API key in Google AI Studio for a project with
the Generative Language API enabled and Gemini paid-tier billing. Lyria 3.5
has no free API tier. Pass these values to the audio-generator container:

```dotenv
GOOGLE_LYRIA_GEMINI_API_KEY=<Gemini authorization API key>
```

`GEMINI_API_KEY` and `GOOGLE_API_KEY` are also supported. The Lyria-specific key
takes precedence. Existing model overrides remain authoritative; replace old
`GOOGLE_LYRIA_3_MODEL` or `GOOGLE_LYRIA_MODEL` values when upgrading.

For the standalone monorepo deployment, backend containers load
`runtime/secrets/root.env`. The setup wizard’s Google section accepts the optional Gemini key and stores it
in the provider secret store before generating this environment file. Rebuild the image from
the updated source and recreate the audio-generator container. Source changes
alone do not change an already running Docker image.

With Fal selected as the Lyria adapter, an existing `FAL_API_KEY` and funded Fal
account are sufficient; no Google IAM setup is involved. Saved adapter priority
still applies. In automatic Docker routing, Gemini is eligible with a Gemini
key; otherwise Fal can be selected. Cloud service-account credentials alone continue to use Vertex Lyria 3 Pro.
When both Google and Fal are configured, native Gemini 3.5 is preferred, followed
by Fal 3.5, followed by Vertex 3. Saved adapter ordering cannot downgrade a new
Lyria request to version 3 when version 3.5 credentials are available.

## Vertex compatibility

Google Cloud's published Vertex catalog still lists Lyria 3 Pro Preview as of
2026-09-22. Existing Cloud-only installations automatically retain that route. Its model is `lyria-3-pro-preview`, with
existing Cloud service-account authentication. Vertex IAM permissions cannot
establish availability of an undocumented model endpoint.

References:
- https://ai.google.dev/gemini-api/docs/music-generation
- https://ai.google.dev/gemini-api/docs/api-key
- https://ai.google.dev/gemini-api/docs/pricing#lyria-3.5
- https://fal.ai/models/google/lyria-3.5/api
- https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/google-models
