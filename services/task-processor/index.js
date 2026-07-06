import 'dotenv/config';
import { runScheduledTasks } from './src/TaskProcessor.js';

runScheduledTasks()
  .then(() => {
    console.log("Node.js script executed at " + new Date().toISOString());
  })
  .catch((error) => {
    console.error('Node.js script failed at ' + new Date().toISOString(), error);
    process.exit(1);
  });
