# Samsar Setup Wizard

The setup wizard is the browser UI and local server used to configure a Samsar Docker deployment. Start it from the monorepo root with:

```bash
npm run setup-wizard
```

The wizard collects provider credentials, selects services, configures mail and data storage, optionally enables a reverse proxy, and prepares the initial admin login. It writes the deployment files under `runtime/` and starts the selected Compose profiles.

## Inference Providers

Step 1 places **Inference Router** above the direct-provider and Samsar fallback sections. Its optional OpenRouter key enables the supported inference selections through one credential:

| Stable model | OpenRouter coverage |
| --- | --- |
| `gpt-5.6-sol` | Text, assistant, and corresponding vision-input calls. |
| `gemini-3.1-pro` | Text, assistant, and corresponding vision-input calls; defaults to OpenRouter model `google/gemini-3.1-pro-preview`. |
| `QWEN3.7` | Text, assistant, image, and video-input analysis using the configured text/vision model mapping. |

For the local Docker runtime configured by this wizard, provider priority is direct native credential, OpenRouter, then the Samsar universal fallback. Set `SAMSAR_QWEN_OPENROUTER_ONLY=true` to force Docker Qwen requests through OpenRouter. Hosted production and external-production always apply that OpenRouter-only Qwen policy; a saved native or deployed authorization cannot override it. Other provider keys continue to enable their media, audio, and direct inference families independently.

## Secret Handling

The browser does not persist OpenRouter or Alibaba keys or their one-time validation tokens in local storage. OpenRouter validation uses authenticated key metadata and rejects management-only keys that cannot run inference. After validation, the setup server writes accepted credentials to mode-`0600` `runtime/secrets/provider.credentials.json`. Runtime rendering creates mode-`0600` `runtime/secrets/root.env`, where the single OpenRouter key appears as `OPENROUTER_API_KEY`.

Every backend service in `deploy/compose/docker-compose.yml` inherits that shared env file. The key is therefore available to the processor, generator, audio generator, assistant query processor, express video listener, and other inference workers without duplicating it per container. Do not commit `runtime/` or expose provider keys through `VITE_*` client variables.

## Development

```bash
npm install
npm run build
npm run lint
```

The Vite application lives in `src/`; `server.mjs` serves the built UI and performs the local deployment operations. Full setup behavior and runtime files are documented in [Setup Wizard](../../pages/setup-wizard.md) and [Providers and Models](../../pages/providers-and-models.md).
