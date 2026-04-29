import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const matcherPath = path.join(rootDir, 'utils', 'assignmentMatcher.js');

const source = fs
  .readFileSync(matcherPath, 'utf8')
  .replace(/export function /g, 'function ');

const loadMatcher = new Function(
  `${source}\nreturn { buildResolvedAssignmentPool, matchAssignmentsToParsedTransactions };`
);
const { buildResolvedAssignmentPool, matchAssignmentsToParsedTransactions } = loadMatcher();

function resolved(value) {
  return {
    Tony: { value },
    Nugs: { value },
  };
}

function run(name, fn) {
  fn();
  console.log(`ok - ${name}`);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label || 'value'}: expected ${expected}, got ${actual}`);
  }
}

run('matches an exact-date assignment', () => {
  const pool = buildResolvedAssignmentPool(
    [
      {
        id: 'exact-aldi',
        date: '2026-04-03',
        amount: 25.58,
        desc: 'ALDI STORES WEST FOOTSCRA',
        isPending: false,
      },
    ],
    {
      'exact-aldi': resolved('Tony'),
    }
  );

  const [match] = matchAssignmentsToParsedTransactions(
    [
      {
        date: '2026-04-03',
        amount: 25.58,
        description: 'ALDI STORES WEST FOOTSCRA AUS',
      },
    ],
    pool
  );

  assertEqual(match.code, 't', 'sheet code');
  assertEqual(match.matchType, 'exact_date', 'match type');
});

run('matches pending assignments inside the settlement window', () => {
  const pool = buildResolvedAssignmentPool(
    [
      {
        id: 'pending-coles',
        date: '2026-04-01',
        uploadedDay: '2026-04-01',
        amount: 89.5,
        desc: 'COLES Footscray',
        isPending: true,
      },
    ],
    {
      'pending-coles': resolved('Macquarie'),
    }
  );

  const [match] = matchAssignmentsToParsedTransactions(
    [
      {
        date: '2026-04-04',
        amount: 89.5,
        description: 'COLES SUPERMARKET FOOTSCRAY',
      },
    ],
    pool
  );

  assertEqual(match.code, 'macq', 'sheet code');
  assertEqual(match.matchType, 'pending_settlement_window', 'match type');
  assertEqual(match.dateMatch.dayOffset, 3, 'day offset');
});

run('does not match pending assignments outside the settlement window', () => {
  const pool = buildResolvedAssignmentPool(
    [
      {
        id: 'old-coles',
        date: '2026-04-01',
        uploadedDay: '2026-04-01',
        amount: 89.5,
        desc: 'COLES Footscray',
        isPending: true,
      },
    ],
    {
      'old-coles': resolved('Macquarie'),
    }
  );

  const [match] = matchAssignmentsToParsedTransactions(
    [
      {
        date: '2026-04-08',
        amount: 89.5,
        description: 'COLES Footscray',
      },
    ],
    pool
  );

  assertEqual(match.code, '', 'sheet code');
  assertEqual(match.matchType, 'low_confidence', 'match type');
  assertEqual(match.dateMatch.type, 'outside_pending_window', 'date match type');
});

run('holds ambiguous same-amount pending matches for review', () => {
  const pool = buildResolvedAssignmentPool(
    [
      {
        id: 'coles-macq',
        date: '2026-04-01',
        uploadedDay: '2026-04-01',
        amount: 42.8,
        desc: 'COLES Footscray',
        isPending: true,
      },
      {
        id: 'coles-tony',
        date: '2026-04-02',
        uploadedDay: '2026-04-02',
        amount: 42.8,
        desc: 'COLES Footscray',
        isPending: true,
      },
    ],
    {
      'coles-macq': resolved('Macquarie'),
      'coles-tony': resolved('Tony'),
    }
  );

  const [match] = matchAssignmentsToParsedTransactions(
    [
      {
        date: '2026-04-03',
        amount: 42.8,
        description: 'COLES Footscray',
      },
    ],
    pool
  );

  assertEqual(match.code, '', 'sheet code');
  assertEqual(match.matchType, 'ambiguous', 'match type');
});

run('requires amount to match exactly', () => {
  const pool = buildResolvedAssignmentPool(
    [
      {
        id: 'amount-check',
        date: '2026-04-03',
        amount: 25.58,
        desc: 'ALDI STORES WEST FOOTSCRA',
        isPending: false,
      },
    ],
    {
      'amount-check': resolved('Tony'),
    }
  );

  const [match] = matchAssignmentsToParsedTransactions(
    [
      {
        date: '2026-04-03',
        amount: 25.59,
        description: 'ALDI STORES WEST FOOTSCRA AUS',
      },
    ],
    pool
  );

  assertEqual(match.code, '', 'sheet code');
  assertEqual(match.matchType, 'no_candidate', 'match type');
});

console.log('assignment matcher verification passed');
