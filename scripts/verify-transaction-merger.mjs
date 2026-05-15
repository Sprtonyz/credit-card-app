import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mergerPath = path.join(rootDir, 'utils', 'transactionMerger.js');

const source = fs
  .readFileSync(mergerPath, 'utf8')
  .replace(
    "import { getTodayDate } from '../services/firebaseService';",
    "const getTodayDate = () => '2026-05-09';"
  )
  .replace(
    /import \{[\s\S]*?\} from '\.\/importTrust';/,
    `const buildDecisionTrace = (transaction, decision) => ({
      existingMatch: decision.existingMatch || null,
      duplicateEvaluation: decision.duplicateMatch || null,
      finalDecision: {
        outcome: decision.outcome || null,
        reasonCode: decision.reasonCode || null,
        overrideReasonCode: decision.overrideReasonCode || null,
      },
    });
    const formatDecisionExplanation = (decision) => decision.reasonCode === 'manual_review_override'
      ? \`manual override for \${decision.overrideReasonCode}\`
      : decision.reasonCode;
    const scoreTransactionConfidence = () => ({ score: 100, level: 'high', signals: [], summary: [] });
    const summarizeDecisionCounts = (decisions = []) => decisions.reduce(
      (acc, decision) => {
        acc.total += 1;
        acc.byOutcome[decision.outcome] = (acc.byOutcome[decision.outcome] || 0) + 1;
        acc.byReason[decision.reasonCode] = (acc.byReason[decision.reasonCode] || 0) + 1;
        return acc;
      },
      { total: 0, byOutcome: {}, byReason: {} }
    );`
  )
  .replace(
    /import \{[\s\S]*?\} from '\.\/commonReoccurrence';/,
    `const getCommonKey = (transaction = {}) => {
      const amount = Number.parseFloat(transaction.amount);
      if (!Number.isFinite(amount)) return null;
      const merchant = String(transaction.merchant || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(/\\s+/)
        .filter((token) => token && !['au', 'notau', 'australia', 'pending', 'posted', 'category', 'in', 'progress'].includes(token))
        .join('_');
      return merchant ? \`\${Math.abs(amount).toFixed(2).replace('.', '')}_\${merchant}\` : null;
    };
    const isCommonReoccurrenceTransaction = (transaction = {}, rules = []) => {
      const key = getCommonKey(transaction);
      return Boolean(key && rules.some((rule) => rule.enabled !== false && rule.key === key));
    };`
  )
  .replace(
    /import \{[\s\S]*?findProcessedLogMatch[\s\S]*?\} from '\.\/importFingerprint';/,
    `const findProcessedLogMatch = (transaction = {}, processedLogs = {}) => {
      if (transaction.imageHash && processedLogs[transaction.imageHash]) {
        return {
          key: transaction.imageHash,
          log: processedLogs[transaction.imageHash],
          matchType: 'hash',
        };
      }
      return null;
    };`
    + `
    const findProcessedRowMatch = () => null;`
  )
  .replace(
    "import { shiftDateKey } from './simulationDate';",
    `const shiftDateKey = (dateKey, days) => {
      const date = new Date(\`\${dateKey}T00:00:00Z\`);
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    };`
  )
  .replace(/export function /g, 'function ');

const loadMerger = new Function(`${source}\nreturn { mergeTransactions };`);
const { mergeTransactions } = loadMerger();

function run(name, fn) {
  fn();
  console.log(`ok - ${name}`);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label || 'value'}: expected ${expected}, got ${actual}`);
  }
}

function transaction(overrides = {}) {
  return {
    merchant: 'Coffee House',
    amount: 12.5,
    date: '2026-05-09',
    rawParsed: {
      date: '9 May 2026',
    },
    ...overrides,
  };
}

function pendingTransaction(overrides = {}) {
  return transaction({
    date: null,
    isPending: true,
    rawParsed: {
      date: null,
    },
    ...overrides,
  });
}

const existingCoffee = {
  id: 'existing-coffee',
  merchant: 'Coffee House',
  amount: 12.5,
  date: '2026-05-09',
};

run('keeps legacy existing-match skip when not approved', () => {
  const result = mergeTransactions([transaction()], [existingCoffee], {});

  assertEqual(result.toAdd.length, 0, 'added count');
  assertEqual(result.skipped.length, 1, 'skipped count');
  assertEqual(result.skipped[0].reason, 'already_exists_overlap', 'skip reason');
});

run('skips matching transactions that occurred within the last five days', () => {
  const result = mergeTransactions(
    [transaction()],
    [
      {
        id: 'recent-coffee',
        merchant: 'Coffee House',
        amount: 12.5,
        date: '2026-05-06',
      },
    ],
    {}
  );

  assertEqual(result.toAdd.length, 0, 'added count');
  assertEqual(result.skipped.length, 1, 'skipped count');
  assertEqual(result.skipped[0].reason, 'already_exists_recent', 'skip reason');
});

run('imports recent matching transactions marked as common reoccurrences', () => {
  const result = mergeTransactions(
    [transaction()],
    [
      {
        id: 'recent-coffee',
        merchant: 'Coffee House',
        amount: 12.5,
        date: '2026-05-06',
      },
    ],
    {},
    {
      commonReoccurrenceRules: [
        {
          key: '1250_coffee_house',
          enabled: true,
        },
      ],
    }
  );

  assertEqual(result.toAdd.length, 1, 'added count');
  assertEqual(result.skipped.length, 0, 'skipped count');
  assertEqual(result.decisions[0].reasonCode, 'ready_to_import', 'decision reason');
});

run('keeps recent matching transactions outside the five-day window', () => {
  const result = mergeTransactions(
    [transaction()],
    [
      {
        id: 'older-coffee',
        merchant: 'Coffee House',
        amount: 12.5,
        date: '2026-05-03',
      },
    ],
    {}
  );

  assertEqual(result.toAdd.length, 1, 'added count');
  assertEqual(result.skipped.length, 0, 'skipped count');
});

run('imports an existing-match row after admin review approval', () => {
  const result = mergeTransactions(
    [transaction({ adminReviewApproved: true })],
    [existingCoffee],
    {}
  );

  assertEqual(result.toAdd.length, 1, 'added count');
  assertEqual(result.skipped.length, 0, 'skipped count');
  assertEqual(result.decisions[0].reasonCode, 'manual_review_override', 'decision reason');
  assertEqual(result.decisions[0].overrideReasonCode, 'already_exists_overlap', 'override reason');
});

run('imports an already-processed screenshot row after admin review approval', () => {
  const result = mergeTransactions(
    [transaction({ imageHash: 'hash-1', adminReviewApproved: true })],
    [],
    {
      'hash-1': {
        uploadDay: '2026-05-08',
        uploadDate: '2026-05-08T12:00:00.000Z',
      },
    }
  );

  assertEqual(result.toAdd.length, 1, 'added count');
  assertEqual(result.skipped.length, 0, 'skipped count');
  assertEqual(result.decisions[0].reasonCode, 'manual_review_override', 'decision reason');
  assertEqual(result.decisions[0].overrideReasonCode, 'already_processed', 'override reason');
});

run('imports repeated same-merchant charges from the same OCR batch by default', () => {
  const result = mergeTransactions(
    [
      transaction({ merchant: 'Parking Meter', amount: 4.2 }),
      transaction({ merchant: 'Parking Meter', amount: 4.2 }),
    ],
    [],
    {}
  );

  assertEqual(result.toAdd.length, 2, 'added count');
  assertEqual(result.skipped.length, 0, 'skipped count');
  assertEqual(result.decisions[1].reasonCode, 'ready_to_import', 'decision reason');
});

run('skips rows explicitly marked as screenshot-overlap duplicates', () => {
  const result = mergeTransactions(
    [
      transaction({ merchant: 'Parking Meter', amount: 4.2 }),
      transaction({
        merchant: 'Parking Meter',
        amount: 4.2,
        duplicateAction: 'skip',
        duplicateMatch: {
          classification: 'screenshot_overlap',
          reason: 'ordered_screenshot_overlap',
          merchantSimilarity: 100,
          overlapLength: 3,
        },
      }),
    ],
    [],
    {}
  );

  assertEqual(result.toAdd.length, 1, 'added count');
  assertEqual(result.skipped.length, 1, 'skipped count');
  assertEqual(result.skipped[0].reason, 'duplicate_in_upload', 'skip reason');
});

run('skips ordered overlaps against earlier processed screenshots', () => {
  const result = mergeTransactions(
    [
      transaction({
        merchant: 'Parking Meter',
        amount: 4.2,
        duplicateAction: 'skip',
        duplicateMatch: {
          classification: 'screenshot_overlap',
          reason: 'processed_screenshot_overlap',
          merchantSimilarity: 100,
          overlapLength: 2,
          processedDay: '2026-05-08',
        },
      }),
    ],
    [],
    {}
  );

  assertEqual(result.toAdd.length, 0, 'added count');
  assertEqual(result.skipped.length, 1, 'skipped count');
  assertEqual(result.skipped[0].reason, 'already_processed', 'skip reason');
  assertEqual(result.skipped[0].processedDay, '2026-05-08', 'processed day');
});

run('skips gap-tolerant ordered overlaps against earlier processed screenshots', () => {
  const result = mergeTransactions(
    [
      transaction({
        merchant: 'SecureParking Sydney',
        amount: 20.2,
        duplicateAction: 'skip',
        duplicateMatch: {
          classification: 'screenshot_overlap',
          reason: 'processed_ordered_subsequence_overlap',
          merchantSimilarity: 100,
          overlapLength: 2,
          processedDay: '2026-05-08',
          requiresReview: true,
        },
      }),
    ],
    [],
    {}
  );

  assertEqual(result.toAdd.length, 0, 'added count');
  assertEqual(result.skipped.length, 1, 'skipped count');
  assertEqual(result.skipped[0].reason, 'already_processed', 'skip reason');
});

run('keeps the new parking amount but skips carried-forward old parking rows', () => {
  const existingParking = [
    {
      id: 'old-parking-1',
      merchant: 'SecureParking Sydney AU',
      amount: 20.2,
      date: '2026-05-08',
      uploadedDay: '2026-05-08',
      isPending: true,
    },
    {
      id: 'old-parking-2',
      merchant: 'SecureParking Sydney AU',
      amount: 20.2,
      date: '2026-05-08',
      uploadedDay: '2026-05-08',
      isPending: true,
    },
  ];

  const result = mergeTransactions(
    [
      pendingTransaction({ merchant: 'SecureParking Sydney AU', amount: 22.22 }),
      pendingTransaction({ merchant: 'SecureParking Sydney AU', amount: 20.2 }),
      pendingTransaction({ merchant: 'SecureParking Sydney AU', amount: 20.2 }),
    ],
    existingParking,
    {}
  );

  assertEqual(result.toAdd.length, 1, 'added count');
  assertEqual(result.toAdd[0].amount, 22.22, 'new parking amount');
  assertEqual(result.skipped.length, 2, 'skipped count');
  assertEqual(result.skipped[0].reason, 'already_exists_pending_carry_forward', 'first skip reason');
  assertEqual(result.skipped[1].reason, 'already_exists_pending_carry_forward', 'second skip reason');
});

console.log('transaction merger verification passed');
