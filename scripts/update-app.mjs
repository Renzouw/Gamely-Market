// Send app changes to phones over the air, without a new APK.
//   npm run update:app                  uses the latest commit message as the note
//   npm run update:app -- "Fixed X"      your own note
// The phone downloads it in the background when Gamely opens, and uses it
// the next time Gamely is closed and opened again.
//
// Only JavaScript, screens and images can go this way. A new native library,
// an Expo SDK upgrade or a plugin change in app.json needs a new APK: raise
// "version" in app.json, then run "npm run build:android".
import { ensureExpoProject, eas, root } from './eas.mjs';
import { run } from './run.mjs';

const platform = process.argv.includes('--ios') ? 'ios' : 'android';
const note =
  process.argv.slice(2).find((a) => !a.startsWith('--')) ||
  run('git', ['log', '-1', '--pretty=%s'], { cwd: root, encoding: 'utf8' }).stdout?.trim() ||
  'Gamely update';

ensureExpoProject();
console.log(`\n> Sending the update to phones: "${note}"`);
// The note also goes into the app itself, which shows it once as "Gamely updated: ..." when the new version starts
const r = eas(['update', '--channel', 'preview', '--environment', 'preview', '--platform', platform, '--message', note], {
  env: { ...process.env, EXPO_PUBLIC_UPDATE_NOTE: note },
});
if (r.status === 0) {
  console.log(`
✓ Sent. On the phone, open Gamely, wait a few seconds, close it fully, and
  open it again. The new version is in use from then on.`);
}
process.exit(r.status ?? 1);
