/**
 * Keyless entry-package tests — run on every host, no kernel or binary
 * required. Cover the JavaScript API's pure surface: grant-argv construction, the
 * resolution contract (platform package → fallback), probe verdicts over fake
 * launchers, and the libc family the flock addon is chosen for. Requires built
 * `lib/` (`pnpm build:ts`).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  LAUNCHER_BIN,
  LAUNCHER_FAILURE_EXIT,
  grantArgs,
  launcherPath,
  probe,
} from '@deepseek-ai/node-addon-system/landlock-run';
import { classifyLinuxLibc, resolveLinuxLibc } from '../packages/entry/lib/libc.js';

await assert.rejects(import('@deepseek-ai/node-addon-system'), {
  code: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
});

// --- constants are part of the CLI contract ---
assert.equal(LAUNCHER_BIN, 'landlock-run');
assert.equal(LAUNCHER_FAILURE_EXIT, 125);

// --- grantArgs: flag spelling, ordering, and empty grants ---
assert.deepEqual(grantArgs({}), []);
assert.deepEqual(grantArgs({ readOnly: ['/'] }), ['--ro', '/']);
assert.deepEqual(
  grantArgs({ readOnly: ['/', '/opt'], readWrite: ['/tmp/work'] }),
  ['--ro', '/', '--ro', '/opt', '--rw', '/tmp/work'],
);
assert.deepEqual(grantArgs({ readWrite: ['/a'], readOnly: ['/b'] }), ['--ro', '/b', '--rw', '/a']);

// --- launcherPath: resolves the platform package next to its package.json ---
const platformPackage = `@deepseek-ai/node-addon-system-${process.platform}-${process.arch}`;
const resolvedViaSeam = launcherPath((specifier) => {
  assert.equal(specifier, `${platformPackage}/package.json`);
  return path.join('/fake-install', specifier);
});
assert.equal(resolvedViaSeam, path.join('/fake-install', platformPackage, 'bin', LAUNCHER_BIN));

// --- launcherPath: unresolvable package falls back to an absolute, package-boundary path ---
const fallback = launcherPath(() => {
  throw new Error('not installed');
});
assert.ok(path.isAbsolute(fallback), 'fallback path must be absolute');
assert.ok(
  fallback.includes(path.join('node_modules', ...platformPackage.split('/'), 'bin', LAUNCHER_BIN)),
  `fallback must point at the platform package layout: ${fallback}`,
);

// --- launcherPath: default resolution agrees with this workspace's layout ---
const defaultPath = launcherPath();
assert.ok(path.isAbsolute(defaultPath));
assert.ok(defaultPath.endsWith(path.join('bin', LAUNCHER_BIN)), defaultPath);

// --- probe: a missing launcher is unusable, indistinguishable from an unenforcing kernel ---
assert.equal(probe(path.join(os.tmpdir(), 'nalr-no-such-launcher')), 'unusable');

// --- probe: verdict parsing over fake launchers (POSIX shells only) ---
if (process.platform !== 'win32') {
  const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nalr-fake-launcher-'));
  const fake = (name, script) => {
    const file = path.join(fakeDir, name);
    fs.writeFileSync(file, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
    return file;
  };

  assert.equal(probe(fake('full', 'echo "landlock: fully enforced"; exit 0')), 'full');
  assert.equal(probe(fake('partial', 'echo "landlock: partially enforced (older ABI)"; exit 0')), 'partial');
  assert.equal(probe(fake('failing', `exit ${LAUNCHER_FAILURE_EXIT}`)), 'unusable');
  assert.equal(probe(fake('hanging', 'sleep 10'), { timeoutMs: 200 }), 'unusable');

  fs.rmSync(fakeDir, { recursive: true, force: true });
}

// --- the libc family comes from the process's own memory maps ---
const glibcMaps = [
  '7f2465c00000-7f2465c28000 r--p 00000000 103:02 29509851 /usr/lib/x86_64-linux-gnu/libc.so.6',
  '7f2466455000-7f2466456000 r--p 00000000 103:02 29509847 /usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2',
].join('\n');
const muslMaps = [
  '7f9d1a000000-7f9d1a022000 r--p 00000000 08:02 1234 /lib/ld-musl-x86_64.so.1',
].join('\n');

assert.equal(classifyLinuxLibc(glibcMaps), 'glibc');
assert.equal(classifyLinuxLibc(muslMaps), 'musl');
// A musl program under a glibc compatibility layer maps both libraries.
assert.equal(classifyLinuxLibc(`${muslMaps}\n${glibcMaps}`), 'musl');
assert.equal(classifyLinuxLibc(''), undefined);
assert.equal(classifyLinuxLibc('7f9d1a000000-7f9d1a022000 r--p 00000000 00:00 0 [heap]'), undefined);

// The memory maps decide; the report is read only when they are unavailable.
let reportReads = 0;
const readReport = () => { reportReads += 1; return '2.43'; };
assert.equal(resolveLinuxLibc({ procMaps: glibcMaps, readReportGlibcVersion: readReport }), 'glibc');
assert.equal(reportReads, 0);
assert.equal(resolveLinuxLibc({ procMaps: muslMaps, readReportGlibcVersion: readReport }), 'musl');
assert.equal(reportReads, 0);
assert.equal(resolveLinuxLibc({ procMaps: undefined, readReportGlibcVersion: readReport }), 'glibc');
assert.equal(reportReads, 1);
// A report that names no glibc version means a musl Node.
assert.equal(resolveLinuxLibc({ procMaps: undefined, readReportGlibcVersion: () => undefined }), 'musl');

console.log('entry.test: ok');
