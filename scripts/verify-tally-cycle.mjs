import assert from 'node:assert/strict';

import {
  buildTallyDateRange,
  formatTallyDateRangeLabel,
} from '../utils/tallyCycle.js';

function run(name, fn) {
  fn();
  console.log(`ok - ${name}`);
}

run('rolls the current cycle forward even when startMonth is set', () => {
  const range = buildTallyDateRange('2026-06-14', {
    startDay: 13,
    startMonth: 5,
  });

  assert.deepEqual(range, {
    startKey: '2026-06-13',
    endKey: '2026-07-12',
    startDay: 13,
    startMonth: 5,
  });
  assert.equal(formatTallyDateRangeLabel(range), '13 June 2026 - 12 July 2026');
});

run('keeps the auto cycle window stable for the current month', () => {
  const range = buildTallyDateRange('2026-06-12', {
    startDay: 13,
    startMonth: null,
  });

  assert.deepEqual(range, {
    startKey: '2026-05-13',
    endKey: '2026-06-12',
    startDay: 13,
    startMonth: null,
  });
});
