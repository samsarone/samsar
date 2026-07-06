import { listenToPendingGenerations } from './src/ExpressListener.js';
import { installStructuredLogger } from './src/utils/StructuredLogger.js';

installStructuredLogger({
  serviceName: process.env.SERVICE_NAME || 'samsar_express_video_listener',
  component: 'express_listener_entry',
});

listenToPendingGenerations().catch((error) => {
  console.error('Express video listener failed to start', error);
  process.exit(1);
});
