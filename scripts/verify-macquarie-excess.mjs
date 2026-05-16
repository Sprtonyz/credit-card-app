import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const macquarieExcessPath = path.join(rootDir, 'utils', 'macquarieExcess.js');

const source = fs
  .readFileSync(macquarieExcessPath, 'utf8')
  .replace(/export const /g, 'const ')
  .replace(/export function /g, 'function ');

const loadMacquarieExcess = new Function(
  `${source}\nreturn { MACQUARIE_EXCESS_THRESHOLD, getMacquarieExcessAmount, getMacquarieExcessShare, buildMacquarieExcessShares, buildMacquarieExcessEntryShares };`
);
const {
  MACQUARIE_EXCESS_THRESHOLD,
  getMacquarieExcessAmount,
  getMacquarieExcessShare,
  buildMacquarieExcessShares,
  buildMacquarieExcessEntryShares,
} = loadMacquarieExcess();

function run(name, fn) {
  fn();
  console.log(`ok - ${name}`);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label || 'value'}: expected ${expected}, got ${actual}`);
  }
}

function assertNear(actual, expected, label) {
  if (Math.abs(actual - expected) > 0.000001) {
    throw new Error(`${label || 'value'}: expected ${expected}, got ${actual}`);
  }
}

run('uses an 800 Macquarie threshold', () => {
  assertEqual(MACQUARIE_EXCESS_THRESHOLD, 800, 'threshold');
  assertEqual(getMacquarieExcessAmount(800), 0, 'threshold amount');
  assertEqual(getMacquarieExcessAmount(799.99), 0, 'below threshold amount');
});

run('splits only the excess two-thirds to Tony and one-third to Nugs', () => {
  assertNear(getMacquarieExcessAmount(899.99), 99.99, 'excess');
  assertNear(getMacquarieExcessShare('Tony', 899.99), 66.66, 'Tony share');
  assertNear(getMacquarieExcessShare('Nugs', 899.99), 33.33, 'Nugs share');
});

run('builds display shares for the profiles', () => {
  const shares = buildMacquarieExcessShares(['Tony', 'Nugs'], 950);

  assertNear(shares.Tony, 100, 'Tony display share');
  assertNear(shares.Nugs, 50, 'Nugs display share');
});

run('builds item-level shares from only the Macquarie excess', () => {
  const shares = buildMacquarieExcessEntryShares(
    [
      { id: 'small', desc: 'Small Mac item', countedAmount: 50 },
      { id: 'large', desc: 'Large Mac item', countedAmount: 150 },
      { id: 'refund', desc: 'Refund', countedAmount: -20 },
    ],
    'Tony',
    1000
  );

  assertEqual(shares.length, 2, 'share item count');
  assertEqual(shares[0].id, 'large', 'highest Macquarie item first');
  assertNear(shares[0].macquarieExcessAmount, 150, 'first excess amount');
  assertNear(shares[0].countedAmount, 100, 'first Tony share');
  assertEqual(shares[1].id, 'small', 'remaining item second');
  assertNear(shares[1].macquarieExcessAmount, 50, 'second excess amount');
  assertNear(shares[1].countedAmount, 100 / 3, 'second Tony share');
});

console.log('macquarie excess verification passed');
