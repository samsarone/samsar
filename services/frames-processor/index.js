import { checkPendingFramesAndProcess,  } from './src/main.js';
import { installStructuredLogger } from './src/utils/StructuredLogger.js';

installStructuredLogger({
  serviceName: process.env.SERVICE_NAME || 'samsar_frames_processor',
  component: 'frame_processor_entry',
});

checkPendingFramesAndProcess().catch((error) => {
  console.error('Frames processor failed to start', error);
  process.exit(1);
});
