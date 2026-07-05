import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reconciliationPath = path.join(rootDir, 'utils', 'reconciliation.js');

const source = fs
  .readFileSync(reconciliationPath, 'utf8')
  .replace(
    /import\s+\{\s*formatLocalDate\s*\}\s+from\s+'\.\/simulationDate(?:\.js)?';/,
    'const formatLocalDate = (date) => date.toISOString().slice(0, 10);'
  )
  .replace(
    /import\s+\{\s*isTransactionWithinTallyDateRange\s*\}\s+from\s+'\.\/tallyCycle(?:\.js)?';/,
    'const isTransactionWithinTallyDateRange = () => true;'
  )
  .replace(/export const PROFILE_NAMES = /, 'const PROFILE_NAMES = ')
  .replace(/export const ASSIGNMENT_RULES_VERSION = /, 'const ASSIGNMENT_RULES_VERSION = ')
  .replace(/export function /g, 'function ');

const loadReconciliation = new Function(
  `${source}\nreturn { isVisibleForUser, getAssigneeContributionRatio, getSurfacedSubmissionStatus, getSubmissionStatus, groupTallyBreakdownEntries, getGroupedTallyBreakdownEntries };`
);
const {
  isVisibleForUser,
  getAssigneeContributionRatio,
  getSurfacedSubmissionStatus,
  getSubmissionStatus,
  groupTallyBreakdownEntries,
  getGroupedTallyBreakdownEntries,
} = loadReconciliation();

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

run('keeps a row visible to the user who has not acted today', () => {
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

  assertEqual(isVisibleForUser(transaction, submissions, 'Tony', '2026-04-29'), true, 'Tony visibility');
  assertEqual(isVisibleForUser(transaction, submissions, 'Nugs', '2026-04-29'), false, 'Nugs visibility');
});

run('returns a one-sided assignment as unsure on the next day', () => {
  const submissions = {
    'shared-note': {
      Tony: {
        value: 'Tony',
        dateKey: '2026-04-28',
        rulesVersion: 2,
      },
    },
  };

  const status = getSurfacedSubmissionStatus(submissions['shared-note'], '2026-04-29');
  assertEqual(status.unsure, true, 'surfaced unsure status');
  assertEqual(status.conflict, false, 'surfaced conflict status');
  assertEqual(status.resolved, false, 'surfaced resolved status');
  assertEqual(isVisibleForUser(transaction, submissions, 'Tony', '2026-04-29'), true, 'Tony visibility');
  assertEqual(isVisibleForUser(transaction, submissions, 'Nugs', '2026-04-29'), true, 'Nugs visibility');
});

run('grandfathers one-sided assignments created before the new rules', () => {
  const submissions = {
    'shared-note': {
      Tony: {
        value: 'Tony',
        dateKey: '2026-04-28',
      },
    },
  };

  const status = getSurfacedSubmissionStatus(submissions['shared-note'], '2026-04-29');
  assertEqual(status.unsure, false, 'legacy surfaced unsure status');
  assertEqual(status.resolved, false, 'legacy surfaced resolved status');
  assertEqual(isVisibleForUser(transaction, submissions, 'Tony', '2026-04-29'), true, 'Tony visibility');
  assertEqual(isVisibleForUser(transaction, submissions, 'Nugs', '2026-04-29'), true, 'Nugs visibility');
});

run('keeps explicit unsure authoritative regardless of the other assignment', () => {
  const submission = {
    Tony: {
      value: 'Unsure',
      dateKey: '2026-04-28',
    },
    Nugs: {
      value: 'Nugs',
      dateKey: '2026-04-28',
    },
  };

  const status = getSurfacedSubmissionStatus(submission, '2026-04-29');
  assertEqual(status.unsure, true, 'surfaced unsure status');
  assertEqual(status.conflict, false, 'surfaced conflict status');
  assertEqual(status.resolved, false, 'surfaced resolved status');
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

run('keeps untouched current-day transactions visible', () => {
  const newTransaction = {
    id: 'today-only',
    uploadedDay: '2026-04-29',
    isPending: true,
  };

  assertEqual(isVisibleForUser(newTransaction, {}, 'Tony', '2026-04-29'), true, 'Tony visibility');
  assertEqual(isVisibleForUser(newTransaction, {}, 'Nugs', '2026-04-29'), true, 'Nugs visibility');
});

run('hides untouched historical transactions by default', () => {
  const oldTransaction = {
    id: 'old-only',
    uploadedDay: '2026-04-28',
    isPending: true,
  };

  assertEqual(isVisibleForUser(oldTransaction, {}, 'Tony', '2026-04-29'), false, 'Tony visibility');
  assertEqual(isVisibleForUser(oldTransaction, {}, 'Nugs', '2026-04-29'), false, 'Nugs visibility');
});

run('can keep untouched historical transactions visible for the dashboard', () => {
  const oldTransaction = {
    id: 'old-only',
    uploadedDay: '2026-04-28',
    isPending: true,
  };

  assertEqual(
    isVisibleForUser(oldTransaction, {}, 'Tony', '2026-04-29', undefined, {
      includeUnassignedHistorical: true,
    }),
    true,
    'Tony visibility'
  );
  assertEqual(
    isVisibleForUser(oldTransaction, {}, 'Nugs', '2026-04-29', undefined, {
      includeUnassignedHistorical: true,
    }),
    true,
    'Nugs visibility'
  );
});

run('does not resurface old historical transactions from weeks ago', () => {
  const staleTransaction = {
    id: 'stale-only',
    uploadedDay: '2026-04-10',
    isPending: true,
  };

  assertEqual(
    isVisibleForUser(staleTransaction, {}, 'Tony', '2026-04-29', undefined, {
      includeUnassignedHistorical: true,
    }),
    false,
    'Tony visibility'
  );
  assertEqual(
    isVisibleForUser(staleTransaction, {}, 'Nugs', '2026-04-29', undefined, {
      includeUnassignedHistorical: true,
    }),
    false,
    'Nugs visibility'
  );
});

run('keeps resolved assignments hidden after midnight', () => {
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
  assertEqual(isVisibleForUser(transaction, submissions, 'Tony', '2026-04-30'), false, 'Tony next-day visibility');
  assertEqual(isVisibleForUser(transaction, submissions, 'Nugs', '2026-04-30'), false, 'Nugs next-day visibility');
});

run('keeps post-fix matching assignments from different days open as unsure', () => {
  const submissions = {
    'shared-note': {
      Tony: {
        value: 'Nugs',
        dateKey: '2026-07-01',
      },
      Nugs: {
        value: 'Nugs',
        dateKey: '2026-07-02',
        rulesVersion: 2,
      },
    },
  };

  const liveStatus = getSubmissionStatus(submissions['shared-note']);
  const surfacedStatus = getSurfacedSubmissionStatus(submissions['shared-note'], '2026-07-03');
  assertEqual(liveStatus.unsure, true, 'live unsure status');
  assertEqual(surfacedStatus.unsure, true, 'surfaced unsure status');
  assertEqual(isVisibleForUser(transaction, submissions, 'Tony', '2026-07-03'), true, 'Tony visibility');
  assertEqual(isVisibleForUser(transaction, submissions, 'Nugs', '2026-07-03'), true, 'Nugs visibility');
  assertEqual(
    getAssigneeContributionRatio(submissions['shared-note'], 'Nugs', '2026-07-03'),
    0,
    'Nugs tally contribution'
  );
  assertEqual(
    getAssigneeContributionRatio(submissions['shared-note'], 'Tony', '2026-07-03'),
    0,
    'Tony tally contribution'
  );
});

run('grandfathers matching cross-day assignments created before the new rules', () => {
  const submissions = {
    'shared-note': {
      Tony: {
        value: 'Nugs',
        dateKey: '2026-07-01',
      },
      Nugs: {
        value: 'Nugs',
        dateKey: '2026-07-02',
      },
    },
  };

  const status = getSurfacedSubmissionStatus(submissions['shared-note'], '2026-07-03');
  assertEqual(status.resolved, true, 'legacy resolved status');
  assertEqual(status.unsure, false, 'legacy unsure status');
  assertEqual(isVisibleForUser(transaction, submissions, 'Tony', '2026-07-03'), false, 'Tony visibility');
  assertEqual(isVisibleForUser(transaction, submissions, 'Nugs', '2026-07-03'), false, 'Nugs visibility');
  assertEqual(
    getAssigneeContributionRatio(submissions['shared-note'], 'Nugs', '2026-07-03'),
    1,
    'Nugs tally contribution'
  );
});

run('groups OCR-similar tally breakdown rows by merchant total', () => {
  const groups = groupTallyBreakdownEntries([
    {
      id: 'uniqlo-a',
      desc: 'UNIQLO MELBOURNE',
      countedAmount: 40,
      date: '2026-04-28',
      assignmentState: 'Locked',
    },
    {
      id: 'apple',
      desc: 'APPLE.COM/BILL',
      countedAmount: 70,
      date: '2026-04-28',
      assignmentState: 'Locked',
    },
    {
      id: 'uniqlo-b',
      desc: 'UNIQ1O SYDNEY',
      countedAmount: 35,
      date: '2026-04-29',
      assignmentState: 'Today',
    },
    {
      id: 'coles',
      desc: 'COLES',
      countedAmount: 10,
      date: '2026-04-29',
      assignmentState: 'Today',
    },
  ]);

  assertEqual(groups.length, 3, 'group count');
  assertEqual(groups[0].desc, 'UNIQLO', 'first group title');
  assertEqual(groups[0].itemCount, 2, 'first group item count');
  assertEqual(groups[0].countedAmount, 75, 'first group total');
  assertEqual(groups[1].desc, 'APPLE.COM/BILL', 'second group title');
});

run('builds grouped tally breakdowns from assignment submissions', () => {
  const grouped = getGroupedTallyBreakdownEntries(
    {
      'tx-1': {
        Tony: { value: 'Tony', dateKey: '2026-04-29' },
      },
      'tx-2': {
        Tony: { value: 'Tony', dateKey: '2026-04-29' },
      },
      'tx-3': {
        Tony: { value: 'Tony', dateKey: '2026-04-29' },
      },
    },
    {
      'tx-1': { id: 'tx-1', desc: 'UNIQLO MELBOURNE', amount: 22, date: '2026-04-29' },
      'tx-2': { id: 'tx-2', desc: 'UNIQ1O ONLINE', amount: 44, date: '2026-04-29' },
      'tx-3': { id: 'tx-3', desc: 'COLES', amount: 90, date: '2026-04-29' },
    },
    'Tony',
    '2026-04-29',
    ['Tony', 'Nugs']
  );

  assertEqual(grouped[0].desc, 'COLES', 'highest total is first');
  assertEqual(grouped[1].desc, 'UNIQLO', 'fuzzy merchant group is second');
  assertEqual(grouped[1].countedAmount, 66, 'fuzzy group total');
});

run('keeps manually ungrouped tally rows out of fuzzy groups', () => {
  const grouped = getGroupedTallyBreakdownEntries(
    {
      'tx-1': {
        Tony: { value: 'Tony', dateKey: '2026-04-29' },
      },
      'tx-2': {
        Tony: { value: 'Tony', dateKey: '2026-04-29' },
      },
      'tx-3': {
        Tony: { value: 'Tony', dateKey: '2026-04-29' },
      },
    },
    {
      'tx-1': { id: 'tx-1', desc: 'UNIQLO MELBOURNE', amount: 22, date: '2026-04-29' },
      'tx-2': { id: 'tx-2', desc: 'UNIQ1O ONLINE', amount: 44, date: '2026-04-29' },
      'tx-3': { id: 'tx-3', desc: 'UNIQLO SYDNEY', amount: 11, date: '2026-04-29' },
    },
    'Tony',
    '2026-04-29',
    ['Tony', 'Nugs'],
    {
      'Tony__tx-2': {
        txId: 'tx-2',
        assignee: 'Tony',
        itemDesc: 'UNIQ1O ONLINE',
        createdAt: 1777420800000,
        createdBy: 'Tony',
      },
    }
  );

  assertEqual(grouped.length, 2, 'group count');
  assertEqual(grouped[0].desc, 'UNIQ1O ONLINE', 'ungrouped row stands alone');
  assertEqual(grouped[0].itemCount, 1, 'ungrouped item count');
  assertEqual(grouped[0].manuallyUngrouped, true, 'ungrouped flag');
  assertEqual(grouped[1].desc, 'UNIQLO', 'remaining fuzzy group title');
  assertEqual(grouped[1].itemCount, 2, 'remaining group count');
});

console.log('reconciliation verification passed');
