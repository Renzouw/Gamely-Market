import { serve } from '@hono/node-server';
import { createApp } from './api/app';
import { bumpVersion } from './api/listings';
import { config } from './config';
import { openDb } from './db';
import { createJobs, startScheduler } from './jobs';

const db = openDb(config.dbPath);
const app = createApp(db, { onPricesChanged: bumpVersion });

if (config.runJobs) startScheduler(createJobs(db, bumpVersion));

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Gamely API listening on :${info.port}${config.runJobs ? ' (jobs running)' : ''}`);
});
