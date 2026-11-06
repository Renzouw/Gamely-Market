import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { format } from 'node:util';

/**
 * When LOG_FILE is set (the auto-start setup does this), logs go to that
 * file instead of a console window. It's rotated at 5 MB, keeping one old
 * copy, so it never grows without limit.
 */
export function logToFile(path: string, maxBytes = 5 * 1024 * 1024) {
  mkdirSync(dirname(path), { recursive: true });
  let writes = 0;
  const rotate = () => {
    try {
      if (existsSync(path) && statSync(path).size > maxBytes) renameSync(path, `${path}.old`);
    } catch {
      // Not worth crashing over
    }
  };
  rotate();
  const write = (...args: unknown[]) => {
    if (++writes % 200 === 0) rotate();
    try {
      appendFileSync(path, format(...args) + '\n');
    } catch {
      // Disk full or file locked: drop the line rather than stop the server
    }
  };
  console.log = write;
  console.info = write;
  console.warn = write;
  console.error = write;
}
