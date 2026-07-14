import { validateAlibabaCloudCredential } from '../src/inference/AlibabaEndpointValidator.js';

const result = await validateAlibabaCloudCredential({
  apiKey: process.env.SAMSAR_VALIDATION_ALIBABA_API_KEY,
  apiHost: process.env.SAMSAR_VALIDATION_ALIBABA_API_HOST,
});

process.stdout.write(JSON.stringify(result));
