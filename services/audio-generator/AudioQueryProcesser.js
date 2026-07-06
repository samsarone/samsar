// startListeners.js

import { fork } from 'child_process';
import path from 'path';
import { installStructuredLogger } from './src/utils/StructuredLogger.js';

installStructuredLogger({
  serviceName: process.env.SERVICE_NAME || 'samsar_audio_generator',
  component: 'audio_query_parent',
});

function startProcess(filePath) {
  const process = fork(filePath);
  process.on('error', (err) => {
    console.error(`Error in process ${process.pid}:`, err);
  });

  process.on('exit', (code, signal) => {
  });

  return process;
}

// Path to the script that contains the processPendingAudioRequests function
const scriptPath = path.resolve('./src/MusicGenerator.js');

// Start two parallel listeners
const listener1 = startProcess(scriptPath);
