import { startMcpServer } from './server.js';

startMcpServer().catch((err) => {
  console.error(err);
  process.exit(1);
});
