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

run('does not create current-day remaining from a first live disagreement', () => {
  const submissions = {
    'shared-note': {
      Tony: {
        value: 'Split',
        comment: 'Tony note',
        dateKey: '2026-04-28',
      },
      Nugs: {
        value: 'Nugs',
        comment: 'Nugs first pick',
        dateKey: '2026-04-29',
      },
    },
  };

  assertEqual(isVisibleForUser(transaction, submissions, 'Tony', '2026-04-29'), false, 'Tony visibility');
  assertEqual(isVisibleForUser(transaction, submissions, 'Nugs', '2026-04-29'), false, 'Nugs visibility');
});

run('keeps the other profile pending during same-day conflict correction', () => {
  const submissions = {
    'shared-note': {
      Tony: {
        value: 'Nugs',
        previousValue: 'Tony',
        previousDateKey: '2026-04-28',
        dateKey: '2026-04-29',
      },
      Nugs: {
        value: 'Nugs',
        dateKey: '2026-04-28',
      },
    },
  };

  assertEqual(isVisibleForUser(transaction, submissions, 'Tony', '2026-04-29'), false, 'Tony visibility');
  assertEqual(isVisibleForUser(transaction, submissions, 'Nugs', '2026-04-29'), true, 'Nugs visibility');
});

run('hides surfaced conflict for both profiles after both re-pick today', () => {
  const submissions = {
    'shared-note': {
      Tony: {
        value: 'Nugs',
        previousValue: 'Tony',
        previousDateKey: '2026-04-28',
        dateKey: '2026-04-29',
      },
      Nugs: {
        value: 'Nugs',
        previousValue: 'Nugs',
        previousDateKey: '2026-04-28',
        dateKey: '2026-04-29',
      },
    },
  };

  assertEqual(isVisibleForUser(transaction, submissions, 'Tony', '2026-04-29'), false, 'Tony visibility');
  assertEqual(isVisibleForUser(transaction, submissions, 'Nugs', '2026-04-29'), false, 'Nugs visibility');
  assertEqual(isVisibleForUser(transaction, submissions, 'Tony', '2026-04-30'), false, 'Tony next-day visibility');
  assertEqual(isVisibleForUser(transaction, submissions, 'Nugs', '2026-04-30'), false, 'Nugs next-day visibility');
});

run('resurfaces corrected conflict next day when re-picks still disagree', () => {
  const submissions = {
    'shared-note': {
      Tony: {
        value: 'Tony',
        previousValue: 'Tony',
        previousDateKey: '2026-04-28',
        dateKey: '2026-04-29',
      },
      Nugs: {
        value: 'Nugs',
        previousValue: 'Nugs',
        previousDateKey: '2026-04-28',
        dateKey: '2026-04-29',
      },
    },
  };

  assertEqual(isVisibleForUser(transaction, submissions, 'Tony', '2026-04-29'), false, 'Tony same-day visibility');
  assertEqual(isVisibleForUser(transaction, submissions, 'Nugs', '2026-04-29'), false, 'Nugs same-day visibility');
  assertEqual(isVisibleForUser(transaction, submissions, 'Tony', '2026-04-30'), true, 'Tony next-day visibility');
  assertEqual(isVisibleForUser(transaction, submissions, 'Nugs', '2026-04-30'), true, 'Nugs next-day visibility');
});

run('keeps the other profile pending during same-day unsure correction', () => {
  const submissions = {
    'shared-note': {
      Tony: {
        value: 'Nugs',
        previousValue: 'Unsure',
        previousDateKey: '2026-04-28',
        dateKey: '2026-04-29',
      },
      Nugs: {
        value: 'Nugs',
        dateKey: '2026-04-28',
      },
    },
  };

  assertEqual(isVisibleForUser(transaction, submissions, 'Tony', '2026-04-29'), false, 'Tony visibility');
  assertEqual(isVisibleForUser(transaction, submissions, 'Nugs', '2026-04-29'), true, 'Nugs visibility');
});

run('hides same-day disagreements after both profiles have picked', () => {
  const newTransaction = {
    id: 'today-note',
    uploadedDay: '2026-04-29',
    isPending: true,
  };
  const submissions = {
    'today-note': {
      Tony: {
        value: 'Split',
        dateKey: '2026-04-29',
      },
      Nugs: {
        value: 'Nugs',
        dateKey: '2026-04-29',
      },
    },
  };

  assertEqual(isVisibleForUser(newTransaction, submissions, 'Tony', '2026-04-29'), false, 'Tony visibility');
  assertEqual(isVisibleForUser(newTransaction, submissions, 'Nugs', '2026-04-29'), false, 'Nugs visibility');
});

run('surfaces same-day disagreements on the next day', () => {
  const newTransaction = {
    id: 'today-note',
    uploadedDay: '2026-04-29',
    isPending: true,
  };
  const submissions = {
    'today-note': {
      Tony: {
        value: 'Split',
        dateKey: '2026-04-29',
      },
      Nugs: {
        value: 'Nugs',
        dateKey: '2026-04-29',
      },
    },
  };

  assertEqual(isVisibleForUser(newTransaction, submissions, 'Tony', '2026-04-30'), true, 'Tony visibility');
  assertEqual(isVisibleForUser(newTransaction, submissions, 'Nugs', '2026-04-30'), true, 'Nugs visibility');
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
