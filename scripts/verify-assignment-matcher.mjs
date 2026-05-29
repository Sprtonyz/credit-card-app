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

run('falls back to merchant match when OCR amount drift is small', () => {
  const pool = buildResolvedAssignmentPool(
    [
      {
        id: 'komiko-reference',
        date: '2026-05-23',
        amount: 15.0,
        desc: 'KOMIKO.APP SAN FRANCIS USA',
        isPending: false,
      },
    ],
    {
      'komiko-reference': resolved('Tony'),
    }
  );

  const [match] = matchAssignmentsToParsedTransactions(
    [
      {
        date: '2026-04-21',
        amount: 14.91,
        description: 'KOMIKO.APP SAN FRANCISCO USA',
      },
    ],
    pool
  );

  assertEqual(match.code, 't', 'sheet code');
  assertEqual(match.matchType, 'merchant_fallback', 'match type');
});

run('does not fallback when merchant-near matches disagree on assignee', () => {
  const pool = buildResolvedAssignmentPool(
    [
      {
        id: 'lemonsqueez-tony',
        date: '2026-04-22',
        amount: 22.45,
        desc: 'PAYPAL *LEMONSQUEEZ',
        isPending: true,
      },
      {
        id: 'lemonsqueez-nugs',
        date: '2026-04-22',
        amount: 22.6,
        desc: 'PAYPAL *LEMONSQUEEZ',
        isPending: true,
      },
    ],
    {
      'lemonsqueez-tony': resolved('Tony'),
      'lemonsqueez-nugs': resolved('Nugs'),
    }
  );

  const [match] = matchAssignmentsToParsedTransactions(
    [
      {
        date: '2026-04-21',
        amount: 23.12,
        description: 'PAYPAL *LEMONSQUEEZ 4029357733',
      },
    ],
    pool
  );

  assertEqual(match.code, '', 'sheet code');
  assertEqual(match.matchType, 'no_candidate', 'match type');
});

run('reuses strong exact-amount merchant history for repeats', () => {
  const pool = buildResolvedAssignmentPool(
    [
      {
        id: 'gravity-known',
        date: '2026-04-29',
        amount: 20.51,
        desc: 'GRAVITY GAME VISION LI KWUN TONG HKG',
        isPending: false,
      },
    ],
    {
      'gravity-known': resolved('Tony'),
    }
  );

  const [first, second] = matchAssignmentsToParsedTransactions(
    [
      {
        date: '2026-04-29',
        amount: 20.51,
        description: 'Gravity Game Vision Li Kwun Tong',
      },
      {
        date: '2026-04-30',
        amount: 20.51,
        description: 'Gravity Game Vision Li Kwun Tong',
      },
    ],
    pool
  );

  assertEqual(first.code, 't', 'first sheet code');
  assertEqual(first.matchType, 'exact_date', 'first match type');
  assertEqual(second.code, 't', 'second sheet code');
  assertEqual(second.matchType, 'consensus_fallback', 'second match type');
  assertEqual(Boolean(second.reusedConsumedCandidate), true, 'second reused consumed candidate');
});

run('does not use consensus fallback when exact-amount history conflicts', () => {
  const pool = buildResolvedAssignmentPool(
    [
      {
        id: 'lemonsqueez-tony-exact',
        date: '2026-04-22',
        amount: 22.45,
        desc: 'PAYPAL *LEMONSQUEEZ',
        isPending: false,
      },
      {
        id: 'lemonsqueez-nugs-exact',
        date: '2026-04-23',
        amount: 22.45,
        desc: 'PAYPAL *LEMONSQUEEZ',
        isPending: false,
      },
    ],
    {
      'lemonsqueez-tony-exact': resolved('Tony'),
      'lemonsqueez-nugs-exact': resolved('Nugs'),
    }
  );

  const [, , third] = matchAssignmentsToParsedTransactions(
    [
      {
        date: '2026-04-22',
        amount: 22.45,
        description: 'PAYPAL *LEMONSQUEEZ',
      },
      {
        date: '2026-04-23',
        amount: 22.45,
        description: 'PAYPAL *LEMONSQUEEZ',
      },
      {
        date: '2026-04-24',
        amount: 22.45,
        description: 'PAYPAL *LEMONSQUEEZ 4029357733',
      },
    ],
    pool
  );

  assertEqual(third.code, '', 'third sheet code');
  assertEqual(third.matchType, 'no_candidate', 'third match type');
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
