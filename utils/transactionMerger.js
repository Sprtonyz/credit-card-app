import { getTodayDate } from '../services/firebaseService';
import { shiftDateKey } from './simulationDate';

const MERCHANT_STOP_WORDS = new Set([
  'au',
  'notau',
  'australia',
  'pending',
  'posted',
  'category',
  'in',
  'progress',
]);

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeMerchant(value) {
  return normalizeText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token && !MERCHANT_STOP_WORDS.has(token));
}

function normalizeAmountKey(value) {
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) return null;
  return Math.abs(amount).toFixed(2);
}

function normalizeMerchantKey(value) {
  const tokens = tokenizeMerchant(value);
  if (tokens.length === 0) return normalizeText(value);
  return tokens.join(' ');
}

function buildTransactionKey(tx) {
  const amountKey = normalizeAmountKey(tx.amount);
  const merchantKey = normalizeMerchantKey(tx.merchant);
  const dateKey = tx.date || null;

  if (!amountKey || !merchantKey || !dateKey) return null;

  return [dateKey, amountKey, merchantKey].join('|');
}

function haveComparableDates(newTx, existingTx) {
  // Pending rows are stored with the upload day, so exact date equality is not
  // a reliable overlap signal across separate screenshot uploads.
  if (newTx.isPending || existingTx.isPending) {
    return true;
  }

  if (newTx.date && existingTx.date) {
    return newTx.date === existingTx.date;
  }

  return false;
}

function merchantLooksSame(newTx, existingTx) {
  const newMerchant = normalizeMerchantKey(newTx.merchant);
  const existingMerchant = normalizeMerchantKey(existingTx.merchant);

  if (!newMerchant || !existingMerchant) return false;
  if (newMerchant === existingMerchant) return true;
  if (newMerchant.includes(existingMerchant) || existingMerchant.includes(newMerchant)) return true;

  const newTokens = tokenizeMerchant(newTx.merchant);
  const existingTokens = tokenizeMerchant(existingTx.merchant);
  if (newTokens.length === 0 || existingTokens.length === 0) return false;

  const sharedTokens = newTokens.filter((token) => existingTokens.includes(token));
  const shorterLength = Math.min(newTokens.length, existingTokens.length);

  return sharedTokens.length >= 2 && sharedTokens.length >= shorterLength - 1;
}

function transactionExists(newTx, existingTxs) {
  const newAmountKey = normalizeAmountKey(newTx.amount);
  if (!newAmountKey) return false;

  return existingTxs.some((existing) => {
    const existingAmountKey = normalizeAmountKey(existing.amount);
    if (!existingAmountKey || existingAmountKey !== newAmountKey) return false;
    if (!haveComparableDates(newTx, existing)) return false;
    return merchantLooksSame(newTx, existing);
  });
}

export function mergeTransactions(
  newTransactions,
  existingTransactions = [],
  processedLog = {}
) {
  const toAdd = [];
  const skipped = [];
  const today = getTodayDate();
  const batchKeys = new Set();

  for (const tx of newTransactions) {
    const txWithDate = {
      ...tx,
      date: tx.date || today,
      isPending: !tx.date,
    };
    const txKey = buildTransactionKey(txWithDate);

    const imageHash = tx.imageHash;
    if (imageHash && processedLog[imageHash]) {
      skipped.push({
        transaction: txWithDate,
        reason: 'already_processed',
        processedDate: processedLog[imageHash].uploadDate,
      });
      continue;
    }

    if (txKey && batchKeys.has(txKey)) {
      skipped.push({
        transaction: txWithDate,
        reason: 'duplicate_in_upload',
      });
      continue;
    }

    if (transactionExists(txWithDate, existingTransactions)) {
      skipped.push({
        transaction: txWithDate,
        reason: 'already_exists_overlap',
      });
      continue;
    }

    if (txWithDate.isPending) {
      const yesterdayStr = shiftDateKey(today, -1);

      if (txWithDate.date === yesterdayStr) {
        const existsYesterday = existingTransactions.some(
          (existing) =>
            existing.date === yesterdayStr &&
            Math.abs(parseFloat(txWithDate.amount) - parseFloat(existing.amount)) < 0.01 &&
            (existing.merchant || '').toUpperCase() === (txWithDate.merchant || '').toUpperCase()
        );

        if (existsYesterday) {
          skipped.push({
            transaction: txWithDate,
            reason: 'already_exists_yesterday',
          });
          continue;
        }
      }
    }

    if (txKey) {
      batchKeys.add(txKey);
    }
    toAdd.push(txWithDate);
  }

  return {
    toAdd,
    skipped,
    summary: {
      newTransactions: newTransactions.length,
      toAdd: toAdd.length,
      skipped: skipped.length,
      skippedByReason: {
        already_processed: skipped.filter((s) => s.reason === 'already_processed').length,
        duplicate_in_upload: skipped.filter((s) => s.reason === 'duplicate_in_upload').length,
        already_exists_overlap: skipped.filter((s) => s.reason === 'already_exists_overlap').length,
        already_exists_yesterday: skipped.filter((s) => s.reason === 'already_exists_yesterday').length,
      },
    },
  };
}

export function filterYesterdaysDuplicates(transactions, yesterdaysPending = []) {
  if (!yesterdaysPending || yesterdaysPending.length === 0) {
    return transactions;
  }

  return transactions.filter((tx) => {
    if (tx.date && tx.date !== getTodayDate()) {
      return true;
    }

    const matchesYesterday = yesterdaysPending.some(
      (yesterday) =>
        Math.abs(parseFloat(tx.amount) - parseFloat(yesterday.amount)) < 0.01 &&
        (tx.merchant || '').toUpperCase() === (yesterday.merchant || '').toUpperCase()
    );

    return !matchesYesterday;
  });
}

export function prepareForFirebase(transactions, source = 'image') {
  return transactions.map((tx) => ({
    merchant: tx.merchant,
    amount: tx.amount,
    category: tx.category || null,
    date: tx.date,
    isPending: tx.isPending || false,
    isRefund: Boolean(tx.isRefund) || Number(tx.amount) < 0,
    source: source,
    imageHash: tx.imageHash || null,
  }));
}
