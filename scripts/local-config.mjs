// Settings that belong to your copy of the project, not to the shared code:
// your Expo project link and your Firebase file. They're kept in a small
// local file (.gamely-local.json, not uploaded to GitHub) and written back
// into app.json after every update, so updates never undo them.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appJsonPath = join(root, 'app.json');
const localPath = join(root, '.gamely-local.json');
const googleServices = join(root, 'google-services.json');

export function applyLocalConfig({ quiet = false } = {}) {
  const say = (m) => !quiet && console.log(m);
  const app = JSON.parse(readFileSync(appJsonPath, 'utf8'));
  const local = existsSync(localPath) ? JSON.parse(readFileSync(localPath, 'utf8')) : {};
  const expo = app.expo;
  let changedApp = false;
  let changedLocal = false;

  // Expo project link: remember it the first time `eas init` writes it, restore it after updates
  const projectId = expo.extra?.eas?.projectId;
  if (projectId && local.projectId !== projectId) {
    local.projectId = projectId;
    changedLocal = true;
  } else if (!projectId && local.projectId) {
    expo.extra = { ...expo.extra, eas: { ...expo.extra?.eas, projectId: local.projectId } };
    changedApp = true;
  }
  if (expo.owner && local.owner !== expo.owner) {
    local.owner = expo.owner;
    changedLocal = true;
  } else if (!expo.owner && local.owner) {
    expo.owner = local.owner;
    changedApp = true;
  }

  // Firebase (Android push): used automatically when google-services.json is in the project folder
  const hasFirebase = existsSync(googleServices);
  if (hasFirebase && expo.android?.googleServicesFile !== './google-services.json') {
    expo.android = { ...expo.android, googleServicesFile: './google-services.json' };
    changedApp = true;
    say('✓ Found google-services.json: Android push is set up for the next build');
  } else if (!hasFirebase && expo.android?.googleServicesFile) {
    delete expo.android.googleServicesFile;
    changedApp = true;
  }

  if (changedApp) writeFileSync(appJsonPath, JSON.stringify(app, null, 2) + '\n');
  if (changedLocal) writeFileSync(localPath, JSON.stringify(local, null, 2) + '\n');
  return { projectId: projectId ?? local.projectId, hasFirebase };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) applyLocalConfig();
