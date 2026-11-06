// One-time local setup: `npm run setup`
// Installs packages, finds this computer's address on your Wi-Fi, and writes
// the config files so the app on your phone can reach the server on this PC.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const step = (msg) => console.log(`\n> ${msg}`);
const fail = (msg) => {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
};

// 1. Node version: the server uses Node's built-in SQLite
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  fail(`Node ${process.versions.node} is too old. Install Node 22.13 or newer from https://nodejs.org and run this again.`);
}
console.log(`✓ Node ${process.versions.node}`);

// 2. Packages for the app and the server
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
for (const [label, cwd] of [['app', root], ['server', join(root, 'server')]]) {
  step(`Installing ${label} packages (this can take a few minutes the first time)`);
  const r = spawnSync(npm, ['install', '--no-fund', '--no-audit'], { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) fail(`Installing ${label} packages failed. Check the messages above, fix the problem, then run "npm run setup" again.`);
}

// 3. This PC's address on the local network, so the phone can find the server
function lanAddress() {
  const candidates = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      // Skip virtual adapters (WSL, Hyper-V, Docker, VPNs) when we can tell
      const virtual = /vethernet|wsl|docker|vbox|virtual|vmware|hyper-v|tailscale|zerotier|utun|tun|loopback/i.test(name);
      const privateRange = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address);
      candidates.push({ address: a.address, score: (privateRange ? 2 : 0) + (virtual ? -3 : 0) + (a.address.startsWith('192.168.') ? 1 : 0) });
    }
  }
  candidates.sort((x, y) => y.score - x.score);
  return candidates[0]?.address;
}
const ip = lanAddress();
const apiUrl = ip ? `http://${ip}:8787` : 'http://localhost:8787';

// 4. App config: where the app finds the server
step('Writing app settings (.env)');
const appEnv = join(root, '.env');
const appLine = `EXPO_PUBLIC_API_URL=${apiUrl}`;
if (existsSync(appEnv)) {
  const current = readFileSync(appEnv, 'utf8');
  const updated = /^EXPO_PUBLIC_API_URL=.*$/m.test(current) ? current.replace(/^EXPO_PUBLIC_API_URL=.*$/m, appLine) : `${current.trimEnd()}\n${appLine}\n`;
  writeFileSync(appEnv, updated);
} else {
  writeFileSync(appEnv, `# Where the app finds the Gamely server. Written by "npm run setup".\n${appLine}\n`);
}
console.log(`✓ ${appLine}`);

// 5. Server config: copied from the example once, never overwritten
step('Writing server settings (server/.env)');
const serverEnv = join(root, 'server', '.env');
if (!existsSync(serverEnv)) {
  copyFileSync(join(root, 'server', '.env.example'), serverEnv);
  console.log('✓ Created server/.env from server/.env.example');
} else {
  console.log('✓ server/.env already exists, left as it is');
}

console.log(`
✓ Setup done.

Next:

  1. Start the server whenever you log in (recommended):
       npm run autostart
     or run it just for now:  npm run server
     The first catalog sync takes a few minutes.

  2. Try the app:        npm start
     then scan the QR code with Expo Go on your phone.
     Or build the installable app:  npm run build:android

In the app, Settings > Gamely server takes this address: ${apiUrl}
When your PC is off, the app keeps working in phone-only mode.

Your phone must be on the same Wi-Fi as this PC.${ip ? '' : `

⚠ Couldn't find this PC's Wi-Fi address, so the app is set to localhost, which
  a phone can't reach. Find your IPv4 address (Windows: ipconfig, Mac: System
  Settings > Wi-Fi > Details) and put it in .env, e.g.
  EXPO_PUBLIC_API_URL=http://192.168.1.20:8787`}
If Windows asks whether to allow Node.js on networks, allow it on private networks.
Run "npm run setup" again any time your PC's address changes.
`);
