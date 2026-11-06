// One-time setup for push notifications on Android: npm run setup:push
//
// Does everything it can by itself: links Expo, creates (or reuses) a free
// Firebase project and its Android app, and puts google-services.json in this
// folder. The only things left to you are logging in, one click in the
// Firebase console to create the push key, and a few menu picks in Expo's tool.
// The push key is secret: it goes straight to Expo and is deleted from here.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { applyLocalConfig } from './local-config.mjs';
import { eas, ensureExpoProject, root } from './eas.mjs';
import { run } from './run.mjs';

const pkg = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo.android.package;
const servicesFile = join(root, 'google-services.json');
const startedAt = Date.now();

const step = (m) => console.log(`\n> ${m}`);
const fail = (m) => {
  console.error(`\n✖ ${m}\n`);
  process.exit(1);
};

async function ask(question, fallback = '') {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(question)).trim();
  rl.close();
  return answer || fallback;
}
const yes = async (q, def = true) => /^y/i.test(await ask(`${q} ${def ? '(Y/n)' : '(y/N)'} `, def ? 'y' : 'n'));

const firebase = (args, opts = {}) => run('npx', ['--yes', 'firebase-tools@15', ...args], { cwd: root, stdio: 'inherit', ...opts });
/** Runs a firebase command with --json and returns its result, or undefined if it failed. */
function firebaseJson(args) {
  const r = firebase([...args, '--json'], { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] });
  const out = r.stdout ?? '';
  try {
    const parsed = JSON.parse(out.slice(out.indexOf('{')));
    if (parsed.status === 'success') return parsed.result;
    console.error(parsed.error ?? out);
  } catch {
    console.error(out);
  }
  return undefined;
}

function openInBrowser(url) {
  const [cmd, args] = platform() === 'win32' ? ['explorer.exe', [url]] : platform() === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  } catch {
    // the link is printed too
  }
}

function isKeyFor(path, projectId) {
  try {
    const k = JSON.parse(readFileSync(path, 'utf8'));
    return k.type === 'service_account' && k.project_id === projectId && !!k.private_key;
  } catch {
    return false;
  }
}

/** The push key Firebase just downloaded: the newest matching file in Downloads, or a path you type. */
async function findKey(projectId) {
  const downloads = join(homedir(), 'Downloads');
  const fresh = existsSync(downloads)
    ? readdirSync(downloads)
        .filter((f) => /\.json$/i.test(f))
        .map((f) => join(downloads, f))
        .filter((p) => statSync(p).mtimeMs >= startedAt - 60_000 && isKeyFor(p, projectId))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    : [];
  if (fresh[0]) {
    console.log(`✓ Found the key: ${fresh[0]}`);
    return fresh[0];
  }
  for (;;) {
    const typed = (await ask("Couldn't find it in your Downloads folder. Drag the file into this window (or type its path) and press Enter: ")).replace(/^["']|["']$/g, '');
    if (typed && isKeyFor(typed, projectId)) return typed;
    console.log(`That isn't a Firebase private key for the project "${projectId}". It's the file from "Generate new private key".`);
  }
}

// 1. Expo
const { projectId: expoProject } = ensureExpoProject();
if (!expoProject) fail('The project is not linked to Expo yet.');

// 2. Firebase login (opens your browser the first time)
step('Logging in to Firebase with your Google account (your browser opens the first time)');
if (firebase(['login']).status !== 0) fail('Firebase login did not finish. Run "npm run setup:push" again to retry.');

// 3. The Firebase project: reuse one, or make a new free one
step('Choosing a Firebase project');
const projects = firebaseJson(['projects:list']) ?? [];
let projectId = process.argv.find((a) => a.startsWith('--project='))?.slice('--project='.length);
if (!projectId && projects.length) {
  console.log('Your Firebase projects:');
  projects.forEach((p, i) => console.log(`  ${i + 1}) ${p.displayName ?? p.projectId} (${p.projectId})`));
  console.log(`  ${projects.length + 1}) Create a new project for Gamely`);
  const def = String(projects.findIndex((p) => /gamely/i.test(`${p.projectId} ${p.displayName}`)) + 1 || projects.length + 1);
  const pick = Number(await ask(`Pick one [${def}]: `, def));
  projectId = projects[pick - 1]?.projectId;
}
if (!projectId) {
  projectId = `gamely-${Math.random().toString(36).slice(2, 8)}`;
  step(`Creating the Firebase project "${projectId}" (free plan, takes about a minute)`);
  if (firebase(['projects:create', projectId, '--display-name', 'Gamely']).status !== 0) {
    fail(`Firebase didn't let this tool create a project. That usually means your Google account hasn't accepted Firebase's terms yet.
  1. Open https://console.firebase.google.com and create a project named Gamely (you can turn Google Analytics off).
  2. Run "npm run setup:push" again and pick that project.`);
  }
}
console.log(`✓ Using Firebase project ${projectId}`);

// 4. The Android app inside it, and its google-services.json
step(`Registering the Android app (${pkg})`);
const apps = firebaseJson(['apps:list', 'ANDROID', '--project', projectId]) ?? [];
let appId = apps.find((a) => a.packageName === pkg)?.appId;
if (!appId) {
  appId = firebaseJson(['apps:create', 'ANDROID', 'Gamely', '--package-name', pkg, '--project', projectId])?.appId;
  if (!appId) fail('Firebase could not create the Android app. Check the message above, then run "npm run setup:push" again.');
}
rmSync(servicesFile, { force: true });
if (firebase(['apps:sdkconfig', 'ANDROID', appId, '--project', projectId, '--out', servicesFile], { stdio: ['inherit', 'ignore', 'inherit'] }).status !== 0 || !existsSync(servicesFile)) {
  fail('Could not download google-services.json. Run "npm run setup:push" again.');
}
applyLocalConfig({ quiet: true });
console.log('✓ google-services.json is in the project folder, and the next build will use it');

// 5. The push key: one click in Firebase, then straight to Expo
step('Giving Expo permission to send pushes through Firebase');
if (!(await yes('Have you already uploaded a Firebase push key to Expo for this app?', false))) {
  const url = `https://console.firebase.google.com/project/${projectId}/settings/serviceaccounts/adminsdk`;
  console.log(`
Your browser is opening Firebase's service account page. If it doesn't, open:
  ${url}

There, click "Generate new private key", then "Generate key". Leave the file in your Downloads folder.`);
  openInBrowser(url);
  await ask('\nPress Enter once it has downloaded. ');
  const key = await findKey(projectId);
  // Expo's tool picks the key up from the project folder by itself. It only sits here while that runs.
  const temp = join(root, basename(key).includes('firebase-adminsdk') ? basename(key) : `${projectId}-firebase-adminsdk-key.json`);
  if (temp !== key) copyFileSync(key, temp);
  console.log(`
Expo's credentials tool opens next. Choose these:
  Which build profile?        preview
  What do you want to do?     Google Service Account
  Then                        Manage your Google Service Account Key for Push Notifications (FCM V1)
  Then                        Set up a Google Service Account Key for Push Notifications (FCM V1)
  (if it asks which key)      [Upload a new service account key]
  "Would you like to use this file?"   Yes
When it says "Google Service Account Key assigned", pick Go back, then Exit.
`);
  await ask('Press Enter to open it. ');
  let ok;
  try {
    ok = eas(['credentials', '-p', 'android']).status === 0;
  } finally {
    if (temp !== key) rmSync(temp, { force: true });
  }
  if (!ok) console.log('\nExpo\'s tool exited with an error. If the key wasn\'t uploaded, run "npm run setup:push" again.');
  if (await yes(`\nDelete the key from your Downloads folder? Expo keeps its own copy, and it's safer not to leave it lying around.\n  ${key}\n`)) {
    rmSync(key, { force: true });
    console.log('✓ Deleted');
  }
}

console.log(`
✓ Push is set up. The APK on your phone was built without Firebase, so it needs a rebuild:
    npm run build:android`);
if (await yes('Start the build now?')) {
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'build-app.mjs'), 'android'], { cwd: root, stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
