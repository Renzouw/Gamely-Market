import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from './api/app';
import { bumpVersion } from './api/listings';
import { config } from './config';
import { openDb } from './db';
import { createJobs, startScheduler } from './jobs';
import { logToFile } from './logfile';

// --log-file=<path> (used by auto-start) or LOG_FILE sends logs to a file instead of a console
const logArg = process.argv.find((a) => a.startsWith('--log-file='))?.slice('--log-file='.length);
if (logArg || process.env.LOG_FILE) logToFile((logArg || process.env.LOG_FILE)!);

// A background server should keep going through one bad request or job
process.on('uncaughtException', (e) => console.error(new Date().toISOString(), 'uncaught:', e));
process.on('unhandledRejection', (e) => console.error(new Date().toISOString(), 'unhandled:', e));

const db = openDb(config.dbPath);
const app = createApp(db, { onPricesChanged: bumpVersion });

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Gamely API listening on :${info.port}${config.runJobs ? ' (jobs running)' : ''}`);
  // Lets "npm run autostart:off" stop this process cleanly
  if (config.dbPath !== ':memory:') {
    const pidFile = join(dirname(config.dbPath), 'server.pid');
    mkdirSync(dirname(pidFile), { recursive: true });
    writeFileSync(pidFile, String(process.pid));
    const cleanup = () => rmSync(pidFile, { force: true });
    process.on('exit', cleanup);
    for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => process.exit(0));
  }
  if (config.runJobs) startScheduler(createJobs(db, bumpVersion));
});

server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') {
    console.error(
      `Port ${config.port} is already in use. If you set up auto-start, your Gamely server is probably already running, so you don't need to start it again. Check with "npm run autostart:status".`,
    );
    process.exit(1);
  }
  throw e;
});
