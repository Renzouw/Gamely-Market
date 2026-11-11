// Keeps the Gamely server running on Windows, where nothing restarts a background
// process that stops (macOS and Linux do it themselves: launchd KeepAlive, systemd Restart).
//
//   node scripts/supervise.mjs <serverDir> <dataDir> <node args for the server...>
//
// Started by the auto-start launcher (scripts/autostart.mjs). If the server stops for any
// reason, it's started again after a short wait, and the reason goes to server.err.log:
// a crash like running out of memory writes nowhere else.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, openSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [, , serverDir, dataDir, ...nodeArgs] = process.argv;
const pidFile = join(dataDir, 'supervisor.pid');
const errLog = join(dataDir, 'server.err.log');
const logFile = join(dataDir, 'server.log');

writeFileSync(pidFile, String(process.pid));
process.on('exit', () => rmSync(pidFile, { force: true }));

// Keep the error log small: start afresh past 1 MB
if (existsSync(errLog) && statSync(errLog).size > 1_000_000) writeFileSync(errLog, '');

const FIRST_WAIT = 5_000;
let wait = FIRST_WAIT;

function start() {
  const started = Date.now();
  const err = openSync(errLog, 'a');
  const child = spawn(process.execPath, nodeArgs, { cwd: serverDir, stdio: ['ignore', 'ignore', err], windowsHide: true });
  child.on('exit', (code, signal) => {
    const minutes = Math.round((Date.now() - started) / 60_000);
    // A server that ran a while gets the short wait again; one that keeps failing waits longer each time
    if (Date.now() - started > 10 * 60_000) wait = FIRST_WAIT;
    appendFileSync(logFile, `${new Date().toISOString()} server stopped (exit ${code ?? signal}) after ${minutes} min; starting it again in ${wait / 1000}s. The reason, if any, is in server.err.log\n`);
    setTimeout(start, wait);
    wait = Math.min(wait * 2, 5 * 60_000);
  });
}

start();
