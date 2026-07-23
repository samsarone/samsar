// startListeners.js

import 'dotenv/config';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installStructuredLogger } from './src/utils/StructuredLogger.js';
import {
  getAvailableCpuCount,
  resolveCpuUpperBound,
} from './src/utils/CpuResources.js';

installStructuredLogger({
  serviceName: process.env.SERVICE_NAME || 'samsar_audio_generator',
  component: 'audio_listener_parent',
});

function startProcess(filePath, cpuBudget) {
  const childProcess = fork(filePath, [], {
    env: {
      ...process.env,
      SAMSAR_PROCESS_CPU_BUDGET: String(cpuBudget),
    },
  });
  childProcess.on('error', (err) => {
    console.error(`Error in process ${childProcess.pid}:`, err);
  });

  childProcess.on('exit', (code, signal) => {
  });

  return childProcess;
}

// Path to the script that contains the processPendingAudioRequests function
const scriptPath = fileURLToPath(new URL('./src/MusicGenerator.js', import.meta.url));

const availableCpuCount = getAvailableCpuCount();
const maxListenerProcesses = resolveCpuUpperBound(
  process.env.SAMSAR_AUDIO_MAX_WORKERS,
  2,
  { availableCpuCount },
);
const baseCpuBudgetPerListener = Math.max(1, Math.floor(availableCpuCount / maxListenerProcesses));
const extraCpuBudgets = availableCpuCount % maxListenerProcesses;

console.info('Audio generator CPU limits resolved', {
  availableCpuCount,
  configuredMaxWorkers: process.env.SAMSAR_AUDIO_MAX_WORKERS || 2,
  effectiveWorkers: maxListenerProcesses,
  baseCpuBudgetPerWorker: baseCpuBudgetPerListener,
  workersWithOneExtraCpu: extraCpuBudgets,
});

for (let listenerIndex = 0; listenerIndex < maxListenerProcesses; listenerIndex += 1) {
  const listenerCpuBudget = baseCpuBudgetPerListener + (listenerIndex < extraCpuBudgets ? 1 : 0);
  startProcess(scriptPath, listenerCpuBudget);
}
