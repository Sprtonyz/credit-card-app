import assert from 'node:assert/strict';

import { buildProfileEmailReports } from '../utils/adminReporting.js';
import { buildEmailContent } from '../services/emailNotificationService.js';

function run(name, fn) {
  fn();
  console.log(`ok - ${name}`);
}

const transactions = [
  {
    id: 'old-item',
    amount: 100,
    date: '2026-05-31',
    isPending: false,
  },
  {
    id: 'current-item',
    amount: 20,
    date: '2026-06-13',
    isPending: false,
  },
];

const conflictTransaction = {
  id: 'conflict-item',
  amount: 30,
  date: '2026-06-13',
  isPending: false,
};
const conflictSubmissions = {
  'conflict-item': {
    Tony: { value: 'Tony', dateKey: '2026-06-13', ts: 1 },
    Nugs: { value: 'Nugs', dateKey: '2026-06-13', ts: 2 },
  },
};

const carriedForwardTransaction = {
  id: 'carried-forward-item',
  amount: 40,
  date: null,
  uploadedDay: '2026-06-13',
  uploadedDate: '2026-06-13T22:30:00+10:00',
  isPending: true,
};

run('builds dashboard-aligned email summaries', () => {
  const [tonyReport] = buildProfileEmailReports(
    [...transactions, conflictTransaction, carriedForwardTransaction],
    conflictSubmissions,
    '2026-06-14',
    {
      startDay: 13,
      startMonth: 5,
    }
  );

  assert.equal(tonyReport.statementCycleLabel, '13 June 2026 - 12 July 2026');
  assert.equal(tonyReport.stats.remainingCount, 2);
  assert.equal(tonyReport.stats.pendingCount, 0);
  assert.equal(tonyReport.stats.outstandingCount, 1);
  assert.equal(tonyReport.stats.conflictsCount, 1);
  assert.equal(tonyReport.stats.unsuresCount, 0);
  assert.equal(
    tonyReport.stats.pendingCount +
      tonyReport.stats.outstandingCount +
      tonyReport.stats.conflictsCount +
      tonyReport.stats.unsuresCount,
    tonyReport.stats.remainingCount
  );
  assert.equal(tonyReport.stats.cycleAssignedTotal, 0);
  assert.equal(tonyReport.stats.totalSpend, 0);

  const content = buildEmailContent(tonyReport);
  assert.match(content.text, /Items to review: 2/);
  assert.doesNotMatch(content.text, /Nothing to action/);
});

run('keeps cross-cycle conflicts and same-day unsures in daily email actions', () => {
  const reports = buildProfileEmailReports(
    [
      {
        id: 'previous-cycle-conflict',
        amount: 50,
        date: '2026-07-12',
        isPending: false,
      },
      {
        id: 'same-day-unsure',
        amount: 25,
        date: '2026-07-14',
        isPending: false,
      },
      {
        id: 'same-day-pending',
        amount: 15,
        date: null,
        uploadedDay: '2026-07-14',
        uploadedDate: '2026-07-14T21:00:00+10:00',
        isPending: true,
      },
    ],
    {
      'previous-cycle-conflict': {
        Tony: { value: 'Tony', dateKey: '2026-07-12', ts: 1 },
        Nugs: { value: 'Nugs', dateKey: '2026-07-12', ts: 2 },
      },
      'same-day-unsure': {
        Tony: { value: 'Unsure', dateKey: '2026-07-14', ts: 3, rulesVersion: 2 },
      },
    },
    '2026-07-14',
    { startDay: 13, startMonth: 7 }
  );

  for (const report of reports) {
    assert.equal(report.stats.pendingCount, 1);
    assert.equal(report.stats.outstandingCount, 0);
    assert.equal(report.stats.conflictsCount, 1);
    assert.equal(report.stats.unsuresCount, 1);
    assert.equal(report.stats.remainingCount, 3);
    assert.equal(report.stats.cycleAssignedTotal, 0);

    const content = buildEmailContent(report);
    assert.match(content.text, /Items to review: 3/);
    assert.match(content.text, /New pending: 1/);
    assert.match(content.text, /Conflicts: 1/);
    assert.match(content.text, /Unsures: 1/);
    assert.doesNotMatch(content.text, /Nothing to action/);
  }
});

run('never renders an all-clear email when displayed action categories are non-zero', () => {
  const content = buildEmailContent({
    profileName: 'Tony',
    stats: {
      remainingCount: 0,
      pendingCount: 1,
      outstandingCount: 0,
      conflictsCount: 1,
      unsuresCount: 1,
    },
  });

  assert.match(content.text, /Items to review: 3/);
  assert.doesNotMatch(content.text, /Nothing to action/);
});
