// Shared helpers for talking to Expo's build service (EAS) from the setup scripts.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyLocalConfig } from './local-config.mjs';
import { run } from './run.mjs';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const eas = (args, opts = {}) => run('npx', ['--yes', 'eas-cli@latest', ...args], { cwd: root, stdio: 'inherit', ...opts });

/** Logs in to Expo if needed and links this folder to an Expo project (once). */
export function ensureExpoProject() {
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
  return applyLocalConfig();
}
