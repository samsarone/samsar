# Samsar Setup Wizard

The setup wizard is the browser UI and local server used to configure a Samsar Docker deployment. Start it from the monorepo root with:

```bash
npm run setup-wizard
```

The wizard collects provider credentials, selects services, configures mail and data storage, optionally enables a reverse proxy, and prepares the initial admin login. It writes the deployment files under `runtime/` and starts the selected Compose profiles.

## Inference Providers

Step 1 presents the Samsar API key first for access to supported models using Samsar credits. Below it, “Or add model or adapter keys to enable specific capabilities” introduces the inference, GMICloud, and media options. Inference options include native OpenAI, Anthropic, Gemini, Kimi K3, and Alibaba alongside OpenRouter.

Provider cards use a shared neutral style, a **Get API key** action, and a **Models** tooltip that opens on hover, keyboard focus, or click. The tooltip uses the setup catalog and credential-specific validation results; GMICloud models appear after discovery. Category links jump to and expand the relevant group. **Continue** is highlighted when the entered combination covers inference, images, video, speech, music, lip sync, and sound effects. This is a capability preview; clicking Continue still validates the credentials before proceeding.

OpenRouter enables these supported inference selections through one credential:

| Stable model | OpenRouter coverage |
| --- | --- |
| `gpt-6-astra`, `gpt-6.1-sol` | Text, assistant, and corresponding vision-input calls; High or XHigh effort. |
| `claude-opus-5.5`, `claude-fable-5.1` | Native Anthropic, OpenRouter, or Samsar text, assistant, and vision calls; High or XHigh effort. |
| `gemini-4-argon` | Text, assistant, and corresponding vision-input calls; defaults to OpenRouter model `google/gemini-4-argon`. |
| `QWEN3.8` | Qwen 3.8 Max text, assistant, and vision inference through Alibaba Cloud, OpenRouter, GMICloud, or Samsar. |

Gemini 4 Argon is configured automatically when OpenRouter, Samsar API, or native Google Cloud credentials are supplied, either directly or through environment references. The wizard saves the OpenRouter model as `google/gemini-4-argon` and the native Google model as `gemini-4-argon`; runtime rendering shares the corresponding model settings with every inference worker. A music-only Gemini API key enables Lyria without enabling Gemini inference. Run `npm run test:argon-migration` to verify the wizard, generated configuration, and text/vision adapter contracts without paid inference calls.

`KIMIK3` is available from the native Kimi K3 credential or the Samsar universal fallback; it is intentionally not routed through OpenRouter. The native route uses the exact `kimi-k3` model for text, assistants, strict structured output, and vision, with high reasoning on every request.

For the local Docker runtime configured by this wizard, GPT, Gemini, and Qwen provider priority is direct native credential, OpenRouter, then the Samsar universal fallback. Kimi priority is the native Kimi API, then Samsar. Set `SAMSAR_QWEN_OPENROUTER_ONLY=true` to force Docker Qwen requests through OpenRouter. Hosted production and external-production always apply that OpenRouter-only Qwen policy; a saved native or deployed authorization cannot override it. Other provider keys continue to enable their media, audio, and direct inference families independently.

OpenRouter inference defaults to high reasoning; GPT Astra/Sol and Claude Opus/Fable also accept `xhigh`, with a 65,536-token completion allowance and a 10-minute minimum request timeout. Kimi K3 always uses high reasoning. Retry behavior depends on the caller: billed assistant requests disable hidden SDK retries and retain ambiguous provider outcomes for reconciliation; other inference callers use their configured retry policies.

### Assistant billing

Hosted assistant and public chat/assistant API requests, including calls made through `samsar-js`, use the [final input, output, and cached-input token prices](../../pages/assistant-billing.md#final-token-prices) for the listed model and adapter routes. Production agent pipeline inference keeps its flat stage pricing. The standalone Studio queued assistant worker retains its local-credit waiver; providers and a hosted Samsar adapter still charge their own accounts.

Reuse one SDK `idempotencyKey` or `client_request_id` for retries of a logical request. Requests awaiting billing confirmation or completion after a timeout can remain pending; keep the same key while checking completion. See [Assistant billing and retries](../../pages/assistant-billing.md).

## Secret Handling

Providers can use direct browser entry (the default) or references to exported Bash variables. In Bash environment mode, enter `$VARIABLE_NAME` or `${VARIABLE_NAME}`; the setup server resolves the forwarded variable without returning its value to the browser. Standard provider names such as `OPENAI_API_KEY`, `FAL_API_KEY`, and `SAMSAR_API_KEY` are forwarded automatically. Custom names must be explicitly allowlisted when launching, for example `SAMSAR_SETUP_PROVIDER_ENV_NAMES=LIVE_DEMO_KEY ./setup.sh`.

Mail & Data has the same source choice for sensitive configuration. Remote MongoDB URLs, SMTP passwords, SES credentials, S3 or Backblaze credentials and endpoints, and CloudFront private keys can reference exported Bash variables. Runtime names such as `MONGO_URL`, `SMTP_PASSWORD`, `AWS_SES_SECRET_ACCESS_KEY`, `AWS_SECRET_ACCESS_KEY`, `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_HOST`, and `CLOUDFRONT_PRIVATE_KEY` are forwarded automatically. Backblaze fields use the `B2_*` names; the `AWS_*` storage names apply only to generic S3. The setup service resolves them only for validation and deployment, and the existing runtime renderer writes the resolved values to the protected container env files. Non-sensitive region, bucket, email, and domain fields remain normal browser inputs. The Domain step has no secret-bearing field, so it does not show a secret-source selector.

The browser does not persist Kimi, OpenRouter, or Alibaba keys or their one-time validation tokens in local storage. Kimi validation uses the processor provider-validation API and is re-requested if setup resumes after the browser field was redacted. OpenRouter validation uses authenticated key metadata and rejects management-only keys that cannot run inference. Alibaba validation accepts pay-as-you-go, Token Plan, and Coding Plan credentials. Token Plan endpoints show a non-blocking production-suitability warning. After validation, the setup server writes the Kimi key to the protected mode-`0600` runtime config and writes accepted OpenRouter/Alibaba credentials plus their classified key/endpoint type to mode-`0600` `runtime/secrets/provider.credentials.json`. Runtime rendering creates mode-`0600` `runtime/secrets/root.env`, where Kimi appears as `KIMI_K3_API_KEY`.

Every backend service in `deploy/compose/docker-compose.yml` inherits that shared env file. The Kimi key is therefore available to the processor, generator, audio generator, AI video layer generator, assistant query processor, and express video listener without duplicating it per container. Do not commit `runtime/` or expose provider keys through `VITE_*` client variables.

## Development

```bash
npm install
npm run build
npm run lint
```

The Vite application lives in `src/`; `server.mjs` serves the built UI and performs the local deployment operations. Full setup behavior and runtime files are documented in [Setup Wizard](../../pages/setup-wizard.md) and [Providers and Models](../../pages/providers-and-models.md).
