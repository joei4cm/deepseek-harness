/** The flock entry must load its addon without building a diagnostic report. */
import { closeSync, openSync } from 'node:fs';

// This process exists to run the flock entry once, so the stub needs no
// restoration: the process exits with the fixture.
process.report.getReport = () => { throw new Error('the flock entry built a diagnostic report'); };

const { tryLockExclusive } = await import('../../packages/entry/lib/flock.js');
const fd = openSync(process.argv[2], 'a+', 0o600);
try {
  await tryLockExclusive(fd);
} finally {
  closeSync(fd);
}

await new Promise((resolve, reject) => {
  process.send({ type: 'ready' }, (error) => error ? reject(error) : resolve());
});
process.disconnect();
