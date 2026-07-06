import { getPendingVideoRequestsAndProcess } from './src/GenerationProcessor.js';
import { installStructuredLogger } from './src/utils/StructuredLogger.js';

installStructuredLogger({
  serviceName: process.env.SERVICE_NAME || 'samsar_video_generator',
  component: 'generation_processor_entry',
});

export async function processPendingVideoGenerations() 
{
  await getPendingVideoRequestsAndProcess();    
}

processPendingVideoGenerations().catch((error) => {
  console.error('Video generator failed to start', error);
  process.exit(1);
});
