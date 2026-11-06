// Build the installable app in Expo's cloud (free plan works), then install it from the link it prints.
//   npm run build:android   an APK you install from a link on your phone
//   npm run build:ios       needs a paid Apple Developer account
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] === 'ios' ? 'ios' : 'android';
const eas = (args, opts = {}) =>
  spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', 'eas-cli@latest', ...args], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', ...opts });

console.log('\n> Checking your Expo account');
if (eas(['whoami'], { stdio: 'ignore' }).status !== 0) {
  console.log('Log in (or create a free account at expo.dev):');
  if (eas(['login']).status !== 0) process.exit(1);
}

const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'));
if (!app.expo?.extra?.eas?.projectId) {
  console.log('\n> Linking this project to your Expo account (one time)');
  if (eas(['init']).status !== 0) process.exit(1);
}

if (target === 'ios') {
  console.log('\n> Registering your iPhone (one time; follow the link on the phone)');
  eas(['device:create']);
}

console.log(`\n> Building the ${target === 'ios' ? 'iPhone' : 'Android'} app in Expo's cloud. This takes 10 to 20 minutes.`);
const r = eas(['build', '--profile', 'preview', '--platform', target]);
if (r.status === 0) {
  console.log(`
✓ Done. Open the link above on your phone to install Gamely.
  In the app, go to Settings > Gamely server and enter your PC's address
  (shown by "npm run setup"). Without it, the app runs in phone-only mode.`);
}
process.exit(r.status ?? 1);
