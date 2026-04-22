import { getTodayDate } from '../services/firebaseService';
import { shiftDateKey } from './simulationDate';

function transactionExists(newTx, existingTxs) {
  return existingTxs.some((existing) => {
    if (Math.abs(parseFloat(newTx.amount) - parseFloat(existing.amount)) > 0.01) {
      return false;
    }

    const newMerchant = (newTx.merchant || '').toUpperCase();
    const existingMerchant = (existing.merchant || '').toUpperCase();
    if (newMerchant !== existingMerchant) {
      return false;
    }

    if (newTx.date !== existing.date) {
      return false;
    }

    return true;
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

  for (const tx of newTransactions) {
    const txWithDate = {
      ...tx,
      date: tx.date || today,
      isPending: !tx.date,
    };

    const imageHash = tx.imageHash;
    if (imageHash && processedLog[imageHash]) {
      skipped.push({
        transaction: txWithDate,
        reason: 'already_processed',
        processedDate: processedLog[imageHash].uploadDate,
      });
      continue;
    }

    if (transactionExists(txWithDate, existingTransactions)) {
      skipped.push({
        transaction: txWithDate,
        reason: 'already_exists',
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
        already_exists: skipped.filter((s) => s.reason === 'already_exists').length,
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
