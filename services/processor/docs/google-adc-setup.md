# Google ADC Setup for `samsar_processor`

`samsar_processor` uses Google Application Default Credentials (ADC) for Google Cloud API access. ADC lets the same code run locally and in production without storing service account keys or Google API secrets in `.env`.

This is separate from `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, which are only for Samsar user login with Google OAuth.

## Runtime Configuration

Set these non-secret values in local `.env`, Cloud Run environment variables, or your production process manager:

```sh
GOOGLE_CLOUD_PROJECT=your-gcp-project-id
GOOGLE_CLOUD_LOCATION=us-central1
GOOGLE_CLOUD_SCOPES=https://www.googleapis.com/auth/cloud-platform
```

`GOOGLE_CLOUD_SCOPES` is optional. If omitted, the processor uses the cloud-platform scope.

## Google Moderation

OpenAI remains the default moderation provider. In docker deployments, when the available-models config selects only Google Cloud, moderation routes through the Google Vertex OpenAI-compatible moderation endpoint instead.

Optional overrides:

```sh
SAMSAR_MODERATION_PROVIDER=google
GOOGLE_MODERATION_MODEL=omni-moderation-latest
GOOGLE_MODERATION_LOCATION=global
GOOGLE_MODERATION_TIMEOUT_MS=30000
```

Use `SAMSAR_MODERATION_PROVIDER=openai` to force the existing OpenAI moderation path.

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
