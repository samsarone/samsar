# Google ADC Setup for `samsar_processor`

`samsar_processor` uses Google Application Default Credentials (ADC) for Google Cloud API access. Regular Gemini 4 Carbon requests in explicitly configured production deployments can instead use the native Gemini Developer API with a server API key, as described below.

This is separate from `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, which are only for Samsar user login with Google OAuth.

## Runtime Configuration

Set these non-secret values in local `.env`, Cloud Run environment variables, or your production process manager:

```sh
GOOGLE_CLOUD_PROJECT=your-gcp-project-id
GOOGLE_CLOUD_LOCATION=us-central1
GOOGLE_CLOUD_SCOPES=https://www.googleapis.com/auth/cloud-platform
```

`GOOGLE_CLOUD_SCOPES` is optional. If omitted, the processor uses the cloud-platform scope.

## Production Gemini 4 Carbon

Set `SAMSAR_DEPLOYMENT_EDITION=production` and provide the existing Gemini API key through the server's secret configuration as `GOOGLE_GEMINI_API_KEY`. `GEMINI_API_KEY` is also supported; the dedicated `GOOGLE_GEMINI_API_KEY` takes precedence when both are present. Do not put keys in source, request payloads, URLs, or logs.

This selects `generativelanguage.googleapis.com/v1beta` for regular Carbon inference and assistant streaming. Requests authenticate with the `x-goog-api-key` header and do not require an ADC credential or Google Cloud project. Generation payloads, JSON schemas, media inputs, reasoning settings, streaming, and token accounting use the same native Google adapter. Completion billing metadata identifies this route as Google, region `global`, API `developer`.

The key transport applies only to regular Carbon models in the production edition. Carbon Cyber, other models, standalone Docker deployments, and deployments without either key alias retain their existing Vertex AI route. A failed Developer API request returns its error without falling back to Vertex. Production deployment preflight must require a key in every inference service to avoid restoring the legacy Vertex eligibility issue. ADC health checks continue to describe ADC and do not validate Developer API key access.

## Render moderation

Production always uses native OpenAI moderation at `https://api.openai.com/v1/moderations`, including production running in Docker and renders using Gemini or other inference models. Configure the server's `OPENAI_API_KEY`; Google, OpenRouter, Alibaba, and Samsar credentials are not moderation fallbacks. Moderation does not inherit an `OPENAI_BASE_URL` override configured for inference.

Sandbox/standalone installations run OpenAI moderation only when a nonblank `OPENAI_API_KEY` is configured. Otherwise they skip moderation immediately without provider requests or retries. Sandbox detection follows the existing deployment edition: `SAMSAR_DEPLOYMENT_EDITION=standalone`, `SAMSAR_EDITION=standalone`, or legacy `CURRENT_ENV=docker`. An explicit production edition takes precedence over the Docker runtime.

Legacy `SAMSAR_MODERATION_PROVIDER`, `MODERATION_PROVIDER`, and `CONTENT_MODERATION_PROVIDER` settings do not override this policy, including old `google`, `samsar`, or `disabled` selections. Google API-key and ADC configuration above applies to inference and assistant requests; it does not select the render moderation provider.

OpenAI moderation defaults and optional decision thresholds:

```sh
OPENAI_MODERATION_MODEL=omni-moderation-latest
OPENAI_MODERATION_REJECT_SCORE_THRESHOLD=0.95
NARRATIVE_VIOLENCE_REJECT_SCORE_THRESHOLD=0.99
```

Moderation rejects category scores at or above `0.95` by default. Broad `violence` in narrative moderation uses a more permissive `0.99` cutoff; other narrative categories retain the general cutoff. `OPENAI_MODERATION_REJECT_SCORE_THRESHOLD` overrides `MODERATION_REJECT_SCORE_THRESHOLD`; the narrative violence variable overrides its separate default. Thresholds are read when the processor starts. Existing bounded retries, timeout/error bypass behavior, and unsafe-result decisions are unchanged.

The processor applies these numerical cutoffs even when a provider marks a category as flagged. A flag with a valid score below its cutoff can pass; provider flags and scores remain unchanged in the external API response, and `decision` reports the processor's outcome. If any result is rejected, the whole response is rejected. Flagged categories with missing or unusable scores and uncategorized flags still reject conservatively.

## Local Development

1. Install the Google Cloud CLI.
2. Initialize the CLI:

   ```sh
   gcloud init
   ```

3. Select the project used for the hackathon integration:

   ```sh
   gcloud config set project PROJECT_ID
   ```

4. Enable the Google APIs the processor will call. For Gemini or Vertex AI work, start with:

   ```sh
   gcloud services enable aiplatform.googleapis.com --project PROJECT_ID
   ```

5. Create local ADC credentials:

   ```sh
   gcloud auth application-default login
   ```

6. Set the quota project for local ADC:

   ```sh
   gcloud auth application-default set-quota-project PROJECT_ID
   ```

7. Set `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION` in your local environment.
8. Verify the processor can resolve ADC:

   ```sh
   npm run google:auth:check
   ```

   Or, with the server running:

   ```sh
   curl http://localhost:3002/v1/health/google-adc
   ```

## Local Service Account Impersonation

Use this when local behavior should match production service-account permissions:

1. Create or choose a runtime service account.
2. Grant your user `roles/iam.serviceAccountTokenCreator` on that service account.
3. Login to ADC by impersonating it:

   ```sh
   gcloud auth application-default login \
     --impersonate-service-account=samsar-processor@PROJECT_ID.iam.gserviceaccount.com
   ```

4. Run `npm run google:auth:check`.

## Production on Google Cloud

Use an attached service account. Do not ship service account JSON keys in the image and do not set `GOOGLE_APPLICATION_CREDENTIALS` to a key file in production.

1. Create a runtime service account:

   ```sh
   gcloud iam service-accounts create samsar-processor \
     --project PROJECT_ID
   ```

2. Grant least-privilege roles required by the Google APIs being used. For Vertex AI/Gemini calls, this usually starts with:

   ```sh
   gcloud projects add-iam-policy-binding PROJECT_ID \
     --member="serviceAccount:samsar-processor@PROJECT_ID.iam.gserviceaccount.com" \
     --role="roles/aiplatform.user"
   ```

3. Attach the service account to the runtime. Example for Cloud Run:

   ```sh
   gcloud run services update samsar-processor \
     --project PROJECT_ID \
     --region REGION \
     --service-account samsar-processor@PROJECT_ID.iam.gserviceaccount.com \
     --set-env-vars GOOGLE_CLOUD_PROJECT=PROJECT_ID,GOOGLE_CLOUD_LOCATION=REGION
   ```

4. Verify the deployed service:

   ```sh
   curl https://YOUR_PROCESSOR_HOST/v1/health/google-adc
   ```

## Production Outside Google Cloud

For company hardware, another cloud, or any non-Google Cloud production environment, prefer Workload Identity Federation instead of service account key files. Configure the federation credential file as the ADC credential configuration, then point `GOOGLE_APPLICATION_CREDENTIALS` at that federation config file. Do not use long-lived service account private keys unless there is no other option.

## Failure Checklist

- `credentialsAvailable=false`: run `gcloud auth application-default login` locally, or check the attached service account / workload identity config in production.
- `projectConfigured=false`: set `GOOGLE_CLOUD_PROJECT`, or configure the ADC/default project.
- Quota or billing errors locally: run `gcloud auth application-default set-quota-project PROJECT_ID`.
- Permission errors: grant the runtime service account the specific IAM role for the API being called. Avoid Owner, Editor, or Viewer in production.
