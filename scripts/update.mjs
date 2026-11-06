// Pull the latest changes from GitHub into this folder, safely.
//   npm run update        update now and show what changed
//   (npm run autoupdate turns on a background check every 30 minutes)
//
// It only ever fast-forwards: if you've edited project files yourself, or
// made your own commits, it leaves everything alone and says why. Your own
// settings (.env files, your Expo project link, google-services.json, the
// server's database) are never touched.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyLocalConfig } from './local-config.mjs';
import { run } from './run.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'server', 'data');
const logFile = join(dataDir, 'update.log');
// --background: started by the scheduler. Writes to update.log instead of the console,
// and only when something happened, so the log doesn't fill up with "nothing new".
const background = process.argv.includes('--background');

function log(msg) {
  if (!background) return console.log(msg);
  mkdirSync(dataDir, { recursive: true });
  try {
    if (statSync(logFile).size > 1_000_000) renameSync(logFile, `${logFile}.old`);
  } catch {
    // no log yet
  }
  appendFileSync(logFile, `${new Date().toISOString()} ${msg}\n`);
}

function done(msg, code = 0) {
  if (msg) log(msg);
  process.exit(code);
}

// Never wait for a password prompt in the background
const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
function git(...args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: gitEnv, timeout: 120_000 });
  if (r.error?.code === 'ENOENT') done('Git is not installed or not on the PATH, so updates are off.', 1);
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

const branch = git('rev-parse', '--abbrev-ref', 'HEAD').out;
if (!branch || branch === 'HEAD') done('This folder is not on a branch, so there is nothing to update from.', 1);

const fetched = git('fetch', '--quiet', 'origin', branch);
if (!fetched.ok) done(`Couldn't reach GitHub (${fetched.err.split('\n')[0] || 'no details'}). Will try again later.`, 1);

const upstream = `origin/${branch}`;
const behind = Number(git('rev-list', '--count', `HEAD..${upstream}`).out) || 0;
const ahead = Number(git('rev-list', '--count', `${upstream}..HEAD`).out) || 0;
if (behind === 0) done(background ? undefined : '✓ Already up to date.');
if (ahead > 0) {
  done(`Skipped: this folder has ${ahead} commit(s) of its own that aren't on GitHub, so updating could lose them. Push them, or run "git reset --hard ${upstream}" if you don't need them.`, 1);
}

// Remember the Expo project link before app.json is refreshed
applyLocalConfig({ quiet: true });

// app.json is rewritten from .gamely-local.json after the update. Any other edited file means
// someone changed the code here on purpose, so stop rather than overwrite their work.
const dirty = git('diff', '--name-only', 'HEAD').out.split('\n').filter(Boolean);
const blocking = dirty.filter((f) => f !== 'app.json');
if (blocking.length) {
  done(`Skipped: these files were changed in this folder, and updating could overwrite them: ${blocking.join(', ')}. Undo them with "git checkout -- ." (or keep them and update by hand).`, 1);
}
if (dirty.includes('app.json')) git('checkout', '--', 'app.json');

const before = git('rev-parse', 'HEAD').out;
const merged = git('merge', '--ff-only', '--quiet', upstream);
if (!merged.ok) {
  applyLocalConfig({ quiet: true });
  done(`Update failed: ${merged.err.split('\n')[0]}`, 1);
}
applyLocalConfig({ quiet: true });

const changed = git('diff', '--name-only', before, 'HEAD').out.split('\n').filter(Boolean);
const subjects = git('log', '--format=%s', `${before}..HEAD`).out.split('\n').filter(Boolean);
log(`✓ Updated with ${subjects.length} new change(s):\n${subjects.map((s) => `    - ${s}`).join('\n')}`);

const opts = { stdio: background ? 'ignore' : 'inherit' };
const has = (re) => changed.some((f) => re.test(f));

if (has(/^package(-lock)?\.json$/)) {
  log('  Installing new app packages');
  if (run('npm', ['install', '--no-fund', '--no-audit'], { cwd: root, ...opts }).status !== 0) log('  ✖ App package install failed. Run "npm install" here to see why.');
}
if (has(/^server\/package(-lock)?\.json$/)) {
  log('  Installing new server packages');
  if (run('npm', ['install', '--no-fund', '--no-audit'], { cwd: join(root, 'server'), ...opts }).status !== 0) {
    done('  ✖ Server package install failed. Run "npm install" in the server folder to see why. The server keeps running the old version.', 1);
  }
}
if (has(/^(server|shared)\//)) {
  log('  Server code changed: rebuilding and restarting it');
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'autostart.mjs'), 'restart'], { cwd: root, encoding: 'utf8' });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  log(r.status === 0 ? `  ${out.split('\n').pop()}` : `  ✖ Restart failed:\n${out}`);
}
if (has(/^(src|shared|assets)\/|^app\.json$/)) {
  log('  The app changed too. If "npm start" is running it reloads by itself; the installed APK needs "npm run build:android".');
}
done();
