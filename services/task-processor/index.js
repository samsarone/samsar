import 'dotenv/config';
import { runScheduledTasks } from './src/TaskProcessor.js';
import { runTaskProcessorSchedule } from './src/TaskScheduler.js';

runTaskProcessorSchedule({ runTask: runScheduledTasks })
  .catch((error) => {
    console.error('Node.js script failed at ' + new Date().toISOString(), error);
    process.exit(1);
  });
