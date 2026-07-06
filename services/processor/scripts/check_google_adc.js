import '../src/config/loadEnv.js';
import { getGoogleADCStatusWithTimeout } from '../src/inference/GoogleADC.js';

const timeoutMs = Number.parseInt(process.env.GOOGLE_ADC_HEALTH_TIMEOUT_MS || '5000', 10);
const status = await getGoogleADCStatusWithTimeout({ timeoutMs });

console.log(JSON.stringify({
  status: status.ok ? 'ready' : 'not_ready',
  googleADC: status,
}, null, 2));

process.exit(status.ok ? 0 : 1);
