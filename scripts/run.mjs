import { spawnSync } from 'node:child_process';

/**
 * Run npm/npx (or any command) and wait for it. On Windows these are .cmd
 * files, which need a shell. Passing one ready-made command string, instead
 * of a list of arguments plus `shell: true`, is the form Node 24 accepts
 * without a security warning.
 */
export function run(cmd, args, opts = {}) {
  if (process.platform !== 'win32') return spawnSync(cmd, args, opts);
  const quote = (a) => (/^[\w@./:=-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`);
  return spawnSync([cmd, ...args].map(quote).join(' '), { ...opts, shell: true });
}
