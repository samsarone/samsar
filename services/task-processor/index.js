import 'dotenv/config';
import {
  cleanupCompletedSessionFramesTask,
  isTaskProcessorFileCleanupEnabled,
  runScheduledTasks,
} from './src/TaskProcessor.js';
import { runTaskProcessorMaintenance } from './src/TaskScheduler.js';

runTaskProcessorMaintenance({
  runTask: runScheduledTasks,
  runFrameCleanup: cleanupCompletedSessionFramesTask,
  fileCleanupEnabled: isTaskProcessorFileCleanupEnabled(),
})
  .catch((error) => {
    console.error('Node.js script failed at ' + new Date().toISOString(), error);
    process.exit(1);
  });
