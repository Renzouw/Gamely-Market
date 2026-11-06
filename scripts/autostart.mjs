// Start the Gamely server automatically when you log in to this computer.
//   npm run autostart          turn it on (and start the server now)
//   npm run autostart:off      turn it off (and stop the server)
//   npm run autostart:status   is it set up, and is it running?
//
// Windows: a hidden launcher in your Startup folder (no console window).
// macOS:   a LaunchAgent that also restarts the server if it crashes.
// Linux:   a systemd user service that also restarts it if it crashes.
// No admin rights needed on any of them.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './run.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = join(root, 'server');
const dataDir = join(serverDir, 'data');
const logFile = join(dataDir, 'server.log');
const pidFile = join(dataDir, 'server.pid');
const node = process.execPath;
const nodeArgs = ['--env-file-if-exists=.env', '--max-old-space-size=256', '--disable-warning=ExperimentalWarning', 'dist/server.mjs', `--log-file=${logFile}`];
const LABEL = 'com.gamely.server';
const action = process.argv[2] ?? 'status';
const os = platform();

const say = (m) => console.log(m);
const fail = (m) => {
  console.error(`\n✖ ${m}\n`);
  process.exit(1);
};

const windowsLauncher = join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Gamely Server.vbs');
const macPlist = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const linuxUnit = join(homedir(), '.config', 'systemd', 'user', 'gamely-server.service');

function runningPid() {
  if (!existsSync(pidFile)) return undefined;
  const pid = Number(readFileSync(pidFile, 'utf8'));
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return undefined;
  }
}

function build() {
  say('> Building the server');
  const r = run('npm', ['run', 'build'], { cwd: serverDir, stdio: 'inherit' });
  if (r.status !== 0) fail('The server build failed. Run "npm run setup" first, then try again.');
}

function stopRunning() {
  const pid = runningPid();
  if (pid) {
    try {
      process.kill(pid);
      say(`✓ Stopped the running server (process ${pid})`);
    } catch {
      // already gone
    }
  }
  rmSync(pidFile, { force: true });
}

const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function on() {
  build();
  mkdirSync(dataDir, { recursive: true });
  stopRunning();
  if (os === 'win32') {
    // A .vbs runs the server with no window. Every argument is quoted, so paths with spaces work.
    const quote = (a) => `"${a}"`;
    const cmd = [quote(node), ...nodeArgs.map(quote)].join(' ');
    const vbs = [
      "' Starts the Gamely price server in the background when you log in.",
      "' Remove with: npm run autostart:off",
      'Set sh = CreateObject("WScript.Shell")',
      `sh.CurrentDirectory = "${serverDir}"`,
      `sh.Run "${cmd.replace(/"/g, '""')}", 0, False`,
      '',
    ].join('\r\n');
    mkdirSync(dirname(windowsLauncher), { recursive: true });
    writeFileSync(windowsLauncher, vbs);
    spawn('wscript.exe', [windowsLauncher], { detached: true, stdio: 'ignore' }).unref();
    say(`✓ Added to your Startup folder:\n  ${windowsLauncher}`);
  } else if (os === 'darwin') {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${[node, ...nodeArgs].map((a) => `    <string>${xml(a)}</string>`).join('\n')}
  </array>
  <key>WorkingDirectory</key><string>${xml(serverDir)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
`;
    mkdirSync(dirname(macPlist), { recursive: true });
    spawnSync('launchctl', ['unload', macPlist], { stdio: 'ignore' });
    writeFileSync(macPlist, plist);
    const r = spawnSync('launchctl', ['load', '-w', macPlist], { stdio: 'inherit' });
    if (r.status !== 0) fail('launchctl could not load the LaunchAgent.');
    say(`✓ Added a LaunchAgent:\n  ${macPlist}`);
  } else {
    const unit = `[Unit]
Description=Gamely price server
After=network-online.target

[Service]
WorkingDirectory=${serverDir}
ExecStart=${[node, ...nodeArgs].map((a) => `"${a}"`).join(' ')}
Restart=on-failure
RestartSec=30
Nice=10

[Install]
WantedBy=default.target
`;
    mkdirSync(dirname(linuxUnit), { recursive: true });
    writeFileSync(linuxUnit, unit);
    try {
      execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' });
      execFileSync('systemctl', ['--user', 'enable', '--now', 'gamely-server.service'], { stdio: 'inherit' });
    } catch {
      rmSync(linuxUnit, { force: true }); // don't leave a half-installed service behind
      fail('systemctl --user failed. Is systemd running for your user?');
    }
    say(`✓ Added a systemd user service:\n  ${linuxUnit}`);
  }
  say(`
✓ The Gamely server now starts when you log in, and it's starting now.
  Logs:     ${logFile}
  Status:   npm run autostart:status
  Turn off: npm run autostart:off

It only runs while your computer is awake. If your PC goes to sleep, alerts
pause until it wakes up; your phone switches to phone-only mode meanwhile.`);
}

function off() {
  if (os === 'win32') {
    rmSync(windowsLauncher, { force: true });
  } else if (os === 'darwin') {
    spawnSync('launchctl', ['unload', '-w', macPlist], { stdio: 'ignore' });
    rmSync(macPlist, { force: true });
  } else {
    spawnSync('systemctl', ['--user', 'disable', '--now', 'gamely-server.service'], { stdio: 'ignore' });
    rmSync(linuxUnit, { force: true });
    spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
  }
  stopRunning();
  say('✓ Auto-start is off. Start the server by hand any time with "npm run server".');
}

function status() {
  const installed = existsSync(os === 'win32' ? windowsLauncher : os === 'darwin' ? macPlist : linuxUnit);
  const pid = runningPid();
  say(`Auto-start: ${installed ? 'on' : 'off'}`);
  say(`Server:     ${pid ? `running (process ${pid})` : 'not running'}`);
  if (existsSync(logFile)) {
    const lines = readFileSync(logFile, 'utf8').trimEnd().split('\n').slice(-5);
    say(`\nLast log lines (${logFile}):\n${lines.map((l) => `  ${l}`).join('\n')}`);
  }
}

if (action === 'on') on();
else if (action === 'off') off();
else status();
