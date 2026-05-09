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
    "import { findProcessedLogMatch } from './importFingerprint';",
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

run('imports selected duplicates from the same OCR batch', () => {
  const result = mergeTransactions(
    [
      transaction({ merchant: 'Parking Meter', amount: 4.2 }),
      transaction({ merchant: 'Parking Meter', amount: 4.2, adminReviewApproved: true }),
    ],
    [],
    {}
  );

  assertEqual(result.toAdd.length, 2, 'added count');
  assertEqual(result.skipped.length, 0, 'skipped count');
  assertEqual(result.decisions[1].reasonCode, 'manual_review_override', 'decision reason');
  assertEqual(result.decisions[1].overrideReasonCode, 'duplicate_in_upload', 'override reason');
});

console.log('transaction merger verification passed');
