import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reconciliationPath = path.join(rootDir, 'utils', 'reconciliation.js');

const source = fs
  .readFileSync(reconciliationPath, 'utf8')
  .replace("import { formatLocalDate } from './simulationDate';", 'const formatLocalDate = (date) => date.toISOString().slice(0, 10);')
  .replace(/export const PROFILE_NAMES = /, 'const PROFILE_NAMES = ')
  .replace(/export function /g, 'function ');

const loadReconciliation = new Function(
  `${source}\nreturn { isVisibleForUser, getSurfacedSubmissionStatus, getSubmissionStatus };`
);
const { isVisibleForUser } = loadReconciliation();

function run(name, fn) {
  fn();
  console.log(`ok - ${name}`);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label || 'value'}: expected ${expected}, got ${actual}`);
  }
}

const transaction = {
  id: 'shared-note',
  uploadedDay: '2026-04-28',
  isPending: true,
};

run('keeps surfaced conflicts visible to both profiles', () => {
  const submissions = {
    'shared-note': {
      Tony: {
        value: 'Tony',
        comment: 'Tony note',
        dateKey: '2026-04-28',
      },
      Nugs: {
        value: 'Nugs',
        comment: 'Nugs note',
        dateKey: '2026-04-28',
      },
    },
  };

  assertEqual(isVisibleForUser(transaction, submissions, 'Tony', '2026-04-29'), true, 'Tony visibility');
  assertEqual(isVisibleForUser(transaction, submissions, 'Nugs', '2026-04-29'), true, 'Nugs visibility');
});

run('keeps live conflicts visible after one profile re-picks', () => {
  const submissions = {
    'shared-note': {
      Tony: {
        value: 'Macquarie',
        comment: 'Tony changed their mind',
        dateKey: '2026-04-29',
      },
      Nugs: {
        value: 'Nugs',
        comment: 'Nugs note',
        dateKey: '2026-04-28',
      },
    },
  };

  assertEqual(isVisibleForUser(transaction, submissions, 'Tony', '2026-04-29'), true, 'Tony visibility');
  assertEqual(isVisibleForUser(transaction, submissions, 'Nugs', '2026-04-29'), true, 'Nugs visibility');
});

run('still hides resolved assignments after both profiles agree', () => {
  const submissions = {
    'shared-note': {
      Tony: {
        value: 'Tony',
        comment: 'Tony note',
        dateKey: '2026-04-28',
      },
      Nugs: {
        value: 'Tony',
        comment: 'Nugs note',
        dateKey: '2026-04-28',
      },
    },
  };

  assertEqual(isVisibleForUser(transaction, submissions, 'Tony', '2026-04-29'), false, 'Tony visibility');
  assertEqual(isVisibleForUser(transaction, submissions, 'Nugs', '2026-04-29'), false, 'Nugs visibility');
});

console.log('reconciliation verification passed');
