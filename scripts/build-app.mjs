// Build the installable app in Expo's cloud (free plan works), then install it from the link it prints.
//   npm run build:android   an APK you install from a link on your phone
//   npm run build:ios       needs a paid Apple Developer account
import { applyLocalConfig } from './local-config.mjs';
import { run } from './run.mjs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] === 'ios' ? 'ios' : 'android';
const eas = (args, opts = {}) =>
  run('npx', ['--yes', 'eas-cli@latest', ...args], { cwd: root, stdio: 'inherit', ...opts });

console.log('\n> Checking your Expo account');
if (eas(['whoami'], { stdio: 'ignore' }).status !== 0) {
  console.log('Log in (or create a free account at expo.dev):');
  if (eas(['login']).status !== 0) process.exit(1);
}

applyLocalConfig({ quiet: true }); // puts back a project link saved earlier
const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'));
if (!app.expo?.extra?.eas?.projectId) {
  console.log('\n> Linking this project to your Expo account (one time)');
  if (eas(['init']).status !== 0) process.exit(1);
}

// Saves the project link from eas init, and turns on Android push if google-services.json is here
const { hasFirebase } = applyLocalConfig();
if (target === 'android' && !hasFirebase) {
  console.log('\n(No google-services.json in this folder, so this build can\'t get push notifications on Android.\n Everything else works. See "Push notifications on Android" in README.md to add it.)');
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
