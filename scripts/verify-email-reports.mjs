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
