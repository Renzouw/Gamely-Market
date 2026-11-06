// Keep this folder up to date with GitHub automatically.
//   npm run autoupdate          check every 30 minutes (and shortly after you log in)
//   npm run autoupdate:off      stop checking
//   npm run autoupdate:status   is it on, and what did it last do?
//
// Each check runs "npm run update" in the background with no window: it pulls
// new changes, installs new packages if needed, and restarts the server when
// server code changed. No admin rights needed.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'scripts', 'update.mjs');
const logFile = join(root, 'server', 'data', 'update.log');
const node = process.execPath;
const os = platform();
const action = process.argv[2] ?? 'status';
const EVERY_MINUTES = 30;

const say = (m) => console.log(m);
const fail = (m) => {
  console.error(`\n✖ ${m}\n`);
  process.exit(1);
};

const TASK = 'Gamely Update';
const winLauncher = join(process.env.LOCALAPPDATA ?? homedir(), 'Gamely', 'Gamely Update.vbs');
const macPlist = join(homedir(), 'Library', 'LaunchAgents', 'com.gamely.update.plist');
const linuxDir = join(homedir(), '.config', 'systemd', 'user');
const linuxService = join(linuxDir, 'gamely-update.service');
const linuxTimer = join(linuxDir, 'gamely-update.timer');
const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function checkGit() {
  const r = spawnSync('git', ['rev-parse', '--abbrev-ref', '@{u}'], { cwd: root, encoding: 'utf8' });
  if (r.error) fail('Git is not installed (or not on the PATH). Install it from https://git-scm.com and try again.');
  if (r.status !== 0) fail('This folder is not a git clone that tracks a GitHub branch, so there is nothing to update from.');
}

function on() {
  checkGit();
  if (os === 'win32') {
    const cmd = `"${node}" "${script}" --background`;
    const vbs = [
      "' Checks GitHub for Gamely updates in the background. Remove with: npm run autoupdate:off",
      'Set sh = CreateObject("WScript.Shell")',
      `sh.CurrentDirectory = "${root}"`,
      `sh.Run "${cmd.replace(/"/g, '""')}", 0, True`,
      '',
    ].join('\r\n');
    mkdirSync(dirname(winLauncher), { recursive: true });
    writeFileSync(winLauncher, vbs);
    const tr = `wscript.exe "${winLauncher}"`;
    try {
      execFileSync('schtasks', ['/Create', '/F', '/TN', TASK, '/SC', 'MINUTE', '/MO', String(EVERY_MINUTES), '/TR', tr], { stdio: 'pipe' });
    } catch (e) {
      rmSync(winLauncher, { force: true });
      fail(`Windows Task Scheduler refused the task: ${String(e.stderr ?? e.message).trim()}`);
    }
    say(`✓ Added a scheduled task "${TASK}" (Task Scheduler, runs every ${EVERY_MINUTES} minutes while you're logged in)`);
  } else if (os === 'darwin') {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.gamely.update</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(node)}</string>
    <string>${xml(script)}</string>
    <string>--background</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(process.env.PATH ?? '/usr/bin:/bin')}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>${EVERY_MINUTES * 60}</integer>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
`;
    mkdirSync(dirname(macPlist), { recursive: true });
    spawnSync('launchctl', ['unload', macPlist], { stdio: 'ignore' });
    writeFileSync(macPlist, plist);
    if (spawnSync('launchctl', ['load', '-w', macPlist], { stdio: 'inherit' }).status !== 0) fail('launchctl could not load the LaunchAgent.');
    say(`✓ Added a LaunchAgent:\n  ${macPlist}`);
  } else {
    mkdirSync(linuxDir, { recursive: true });
    writeFileSync(
      linuxService,
      `[Unit]
Description=Check GitHub for Gamely updates

[Service]
Type=oneshot
WorkingDirectory=${root}
Environment="PATH=${process.env.PATH ?? '/usr/bin:/bin'}"
ExecStart="${node}" "${script}" --background
Nice=10
`,
    );
    writeFileSync(
      linuxTimer,
      `[Unit]
Description=Check GitHub for Gamely updates every ${EVERY_MINUTES} minutes

[Timer]
OnStartupSec=3min
OnUnitActiveSec=${EVERY_MINUTES}min

[Install]
WantedBy=timers.target
`,
    );
    try {
      execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' });
      execFileSync('systemctl', ['--user', 'enable', '--now', 'gamely-update.timer'], { stdio: 'inherit' });
    } catch {
      rmSync(linuxService, { force: true });
      rmSync(linuxTimer, { force: true });
      fail('systemctl --user failed. Is systemd running for your user?');
    }
    say(`✓ Added a systemd user timer:\n  ${linuxTimer}`);
  }
  say(`
✓ This folder now updates itself from GitHub every ${EVERY_MINUTES} minutes.
  What it did: ${logFile}
  Status:      npm run autoupdate:status
  Turn off:    npm run autoupdate:off

Checking now...`);
  spawnSync(node, [script], { cwd: root, stdio: 'inherit' });
}

function off() {
  if (os === 'win32') {
    spawnSync('schtasks', ['/Delete', '/F', '/TN', TASK], { stdio: 'ignore' });
    rmSync(winLauncher, { force: true });
  } else if (os === 'darwin') {
    spawnSync('launchctl', ['unload', '-w', macPlist], { stdio: 'ignore' });
    rmSync(macPlist, { force: true });
  } else {
    spawnSync('systemctl', ['--user', 'disable', '--now', 'gamely-update.timer'], { stdio: 'ignore' });
    rmSync(linuxTimer, { force: true });
    rmSync(linuxService, { force: true });
    spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
  }
  say('✓ Auto-update is off. Update by hand any time with "npm run update".');
}

function status() {
  const installed =
    os === 'win32'
      ? spawnSync('schtasks', ['/Query', '/TN', TASK], { stdio: 'ignore' }).status === 0
      : existsSync(os === 'darwin' ? macPlist : linuxTimer);
  say(`Auto-update: ${installed ? `on, every ${EVERY_MINUTES} minutes` : 'off'}`);
  if (existsSync(logFile)) {
    const lines = readFileSync(logFile, 'utf8').trimEnd().split('\n').slice(-8);
    say(`\nLast updates (${logFile}):\n${lines.map((l) => `  ${l}`).join('\n')}`);
  } else {
    say('No updates have been pulled in yet.');
  }
}

if (action === 'on') on();
else if (action === 'off') off();
else status();
