// Build the installable app in Expo's cloud (free plan works), then install it from the link it prints.
//   npm run build:android   an APK you install from a link on your phone
//   npm run build:ios       needs a paid Apple Developer account
import { ensureExpoProject, eas } from './eas.mjs';

const target = process.argv[2] === 'ios' ? 'ios' : 'android';

const { hasFirebase } = ensureExpoProject();
if (target === 'android' && !hasFirebase) {
  console.log('\n(No google-services.json in this folder, so this build can\'t get push notifications on Android.\n Everything else works. Run "npm run setup:push" first to add it.)');
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
