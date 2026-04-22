import { db } from '../config/firebase';
import {
  ref,
  push,
  query,
  orderByChild,
  equalTo,
  get,
  remove,
  set,
} from 'firebase/database';
import {
  formatLocalDate,
  getSimulatedISOString,
  getSimulatedTodayDate,
  shiftDateKey,
} from '../utils/simulationDate';

export async function addTransactions(transactions) {
  try {
    const transactionsRef = ref(db, 'transactions');
    const addedIds = [];

    for (const tx of transactions) {
      const newTxRef = push(transactionsRef);
      const simulatedUploadDay = getTodayDate();
      await set(newTxRef, {
        merchant: tx.merchant,
        amount: tx.amount,
        category: tx.category || null,
        date: tx.date || formatLocalDate(getSimulatedTodayDate()),
        isPending: !tx.date || tx.isPending,
        isRefund: Boolean(tx.isRefund) || Number(tx.amount) < 0,
        source: tx.source || 'image',
        uploadedDate: getSimulatedISOString(),
        uploadedDay: simulatedUploadDay,
        imageHash: tx.imageHash || null,
        owner: null,
      });
      addedIds.push(newTxRef.key);
    }

    return addedIds;
  } catch (error) {
    console.error('Error adding transactions:', error);
    throw error;
  }
}

export async function queryTransactionsByDate(date) {
  try {
    const transactionsRef = ref(db, 'transactions');
    const q = query(transactionsRef, orderByChild('date'), equalTo(date));
    const snapshot = await get(q);

    if (!snapshot.exists()) {
      return [];
    }

    const results = [];
    snapshot.forEach((child) => {
      results.push({
        id: child.key,
        ...child.val(),
      });
    });

    return results;
  } catch (error) {
    console.error('Error querying transactions by date:', error);
    throw error;
  }
}

function getYesterdayDate() {
  return shiftDateKey(formatLocalDate(getSimulatedTodayDate()), -1);
}

export function getTodayDate() {
  return formatLocalDate(getSimulatedTodayDate());
}

export async function getYesterdaysPending() {
  try {
    const yesterdayDate = getYesterdayDate();
    const yesterdayTransactions = await queryTransactionsByDate(yesterdayDate);
    return yesterdayTransactions.filter((tx) => tx.isPending);
  } catch (error) {
    console.error("Error getting yesterday's pending transactions:", error);
    throw error;
  }
}

export async function getAllTransactions() {
  try {
    const snapshot = await get(ref(db, 'transactions'));

    if (!snapshot.exists()) {
      return [];
    }

    const results = [];
    snapshot.forEach((child) => {
      results.push({
        id: child.key,
        ...child.val(),
      });
    });

    return results;
  } catch (error) {
    console.error('Error getting all transactions:', error);
    throw error;
  }
}

export async function getAllSubmissions() {
  try {
    const snapshot = await get(ref(db, 'submissions'));

    if (!snapshot.exists()) {
      return {};
    }

    return snapshot.val();
  } catch (error) {
    console.error('Error getting all submissions:', error);
    throw error;
  }
}

export async function checkIfProcessed(imageHash) {
  try {
    const processedRef = ref(db, `processedTransactions/${imageHash}`);
    const snapshot = await get(processedRef);
    return snapshot.exists();
  } catch (error) {
    console.error('Error checking if image was processed:', error);
    throw error;
  }
}

export async function saveProcessedLog(imageHash, transactionIds, imageName) {
  try {
    const processedRef = ref(db, `processedTransactions/${imageHash}`);
    await set(processedRef, {
      uploadDate: getSimulatedISOString(),
      uploadDay: getTodayDate(),
      extractedCount: transactionIds.length,
      transactions: transactionIds,
      imageName: imageName,
    });
  } catch (error) {
    console.error('Error saving processed log:', error);
    throw error;
  }
}

export async function deleteTransactionsByIds(transactionIds = []) {
  try {
    await Promise.all(
      transactionIds.filter(Boolean).map((transactionId) => remove(ref(db, `transactions/${transactionId}`)))
    );
  } catch (error) {
    console.error('Error deleting transactions:', error);
    throw error;
  }
}

export async function deleteProcessedLogs(imageHashes = []) {
  try {
    await Promise.all(
      imageHashes.filter(Boolean).map((imageHash) => remove(ref(db, `processedTransactions/${imageHash}`)))
    );
  } catch (error) {
    console.error('Error deleting processed logs:', error);
    throw error;
  }
}

export async function getAllProcessedLogs() {
  try {
    const snapshot = await get(ref(db, 'processedTransactions'));

    if (!snapshot.exists()) {
      return {};
    }

    return snapshot.val();
  } catch (error) {
    console.error('Error getting processed logs:', error);
    throw error;
  }
}

export async function clearUploadedData() {
  try {
    await Promise.all([
      set(ref(db, 'transactions'), null),
      set(ref(db, 'processedTransactions'), null),
      set(ref(db, 'submissions'), null),
    ]);
  } catch (error) {
    console.error('Error clearing uploaded data:', error);
    throw error;
  }
}
