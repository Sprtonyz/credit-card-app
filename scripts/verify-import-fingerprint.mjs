import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fingerprintPath = path.join(rootDir, 'utils', 'importFingerprint.js');

const source = fs
  .readFileSync(fingerprintPath, 'utf8')
  .replace(/export function /g, 'function ');

const loadFingerprints = new Function(
  `${source}\nreturn { buildTransactionFingerprint, buildTransactionRowFingerprint, buildImageRowContexts };`
);
const {
  buildTransactionFingerprint,
  buildTransactionRowFingerprint,
  buildImageRowContexts,
} = loadFingerprints();

function run(name, fn) {
  fn();
  console.log(`ok - ${name}`);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label || 'value'}: expected ${expected}, got ${actual}`);
  }
}

const pendingFromOcr = {
  merchant: 'SecureParking Sydney AU',
  amount: 20.2,
  date: null,
  isPending: true,
};

const pendingRecoveredFromFirebase = {
  merchant: 'SecureParking Sydney AU',
  amount: 20.2,
  date: '2026-05-08',
  uploadedDay: '2026-05-08',
  isPending: true,
};

run('pending row fingerprints ignore upload date', () => {
  assertEqual(
    buildTransactionRowFingerprint(pendingFromOcr),
    buildTransactionRowFingerprint(pendingRecoveredFromFirebase),
    'row fingerprint'
  );
});

run('pending image fingerprints ignore upload date', () => {
  assertEqual(
    buildTransactionFingerprint(pendingFromOcr),
    buildTransactionFingerprint(pendingRecoveredFromFirebase),
    'transaction fingerprint'
  );
});

run('row contexts keep repeated pending rows distinct by position', () => {
  const contexts = buildImageRowContexts([
    { merchant: 'DoorDash Melbourne AU', amount: 39.9, isPending: true },
    pendingFromOcr,
    pendingFromOcr,
  ]);

  assertEqual(contexts.length, 3, 'context count');
  assertEqual(contexts[1].sequenceIndex, 1, 'first parking position');
  assertEqual(contexts[2].sequenceIndex, 2, 'second parking position');
});

console.log('import fingerprint verification passed');
