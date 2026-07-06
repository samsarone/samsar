import { writeFile } from 'fs/promises';
import path from 'path';

export async function setupDockerEnvironment(payload) {
  const envVars = {
    OPENAI_API_KEY: payload.openaiKey,
    AZURE_API_KEY: payload.azureKey,
    FAL_API_KEY: payload.falKey,
    RUNWAY_API_KEY: payload.runwayKey,
    S3_URL: payload.s3Url,
    MONGO_URL: payload.mongoUrl,
    ADMIN_EMAIL: payload.adminEmail,
    ADMIN_PASSWORD: payload.adminPassword
  };

  const lines = Object.entries(envVars)
    .filter(([_, val]) => val != null) // Skip null/undefined values
    .map(([key, val]) => `${key}=${val}`);

  const envContent = lines.join('\n');

  const envPath = path.resolve('.env.docker');

  await writeFile(envPath, envContent, 'utf-8');
}
