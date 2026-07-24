# Samsar Setup Wizard

The setup wizard is the browser UI and local server used to configure a Samsar Docker deployment. Start it from the monorepo root with:

```bash
npm run setup-wizard
```

The wizard collects provider credentials, selects services, configures mail and data storage, optionally enables a reverse proxy, and prepares the initial admin login. It writes the deployment files under `runtime/` and starts the selected Compose profiles.

## Inference Providers

Step 1 presents native OpenAI, Gemini, Kimi K3, and Alibaba inference providers alongside the optional OpenRouter and Samsar fallback providers. OpenRouter enables these supported inference selections through one credential:

| Stable model | OpenRouter coverage |
| --- | --- |
| `gpt-5.6-sol` | Text, assistant, and corresponding vision-input calls. |
| `gemini-3.1-pro` | Text, assistant, and corresponding vision-input calls; defaults to OpenRouter model `google/gemini-3.1-pro-preview`. |
| `QWEN3.7` | Text and assistant inference using Alibaba-native Qwen 3.7 Max, vision-input analysis using Alibaba-native Qwen 3.7 Plus, or Qwen 3.7 Plus through OpenRouter. |

`KIMIK3` is available from the native Kimi K3 credential or the Samsar universal fallback; it is intentionally not routed through OpenRouter. The native route uses the exact `kimi-k3` model for text, assistants, strict structured output, and vision, with high reasoning on every request.

For the local Docker runtime configured by this wizard, GPT, Gemini, and Qwen provider priority is direct native credential, OpenRouter, then the Samsar universal fallback. Kimi priority is the native Kimi API, then Samsar. Set `SAMSAR_QWEN_OPENROUTER_ONLY=true` to force Docker Qwen requests through OpenRouter. Hosted production and external-production always apply that OpenRouter-only Qwen policy; a saved native or deployed authorization cannot override it. Other provider keys continue to enable their media, audio, and direct inference families independently.

OpenRouter inference defaults to high reasoning for Qwen and Gemini and `xhigh` for GPT, with a 65,536-token completion allowance and a 10-minute minimum request timeout. Kimi K3 always uses high reasoning. Transient provider errors, including HTTP 429 responses, receive up to three backoff retries and honor `Retry-After` when supplied.

## Secret Handling

The browser does not persist Kimi, OpenRouter, or Alibaba keys or their one-time validation tokens in local storage. Kimi validation uses the processor provider-validation API and is re-requested if setup resumes after the browser field was redacted. OpenRouter validation uses authenticated key metadata and rejects management-only keys that cannot run inference. Alibaba validation accepts pay-as-you-go, Token Plan, and Coding Plan credentials. Token Plan endpoints show a non-blocking production-suitability warning. After validation, the setup server writes the Kimi key to the protected mode-`0600` runtime config and writes accepted OpenRouter/Alibaba credentials plus their classified key/endpoint type to mode-`0600` `runtime/secrets/provider.credentials.json`. Runtime rendering creates mode-`0600` `runtime/secrets/root.env`, where Kimi appears as `KIMI_K3_API_KEY`.

Every backend service in `deploy/compose/docker-compose.yml` inherits that shared env file. The Kimi key is therefore available to the processor, generator, audio generator, AI video layer generator, assistant query processor, and express video listener without duplicating it per container. Do not commit `runtime/` or expose provider keys through `VITE_*` client variables.

## Development

```bash
npm install
npm run build
npm run lint
```

The Vite application lives in `src/`; `server.mjs` serves the built UI and performs the local deployment operations. Full setup behavior and runtime files are documented in [Setup Wizard](../../pages/setup-wizard.md) and [Providers and Models](../../pages/providers-and-models.md).
