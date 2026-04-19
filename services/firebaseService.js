import { db } from '../config/firebase';
import {
  ref,
  push,
  query,
  orderByChild,
  equalTo,
  get,
  set,
} from 'firebase/database';

export async function addTransactions(transactions) {
  try {
    const transactionsRef = ref(db, 'transactions');
    const addedIds = [];

    for (const tx of transactions) {
      const newTxRef = push(transactionsRef);
      await set(newTxRef, {
        merchant: tx.merchant,
        amount: tx.amount,
        category: tx.category || null,
        date: tx.date,
        isPending: !tx.date || tx.isPending,
        source: tx.source || 'image',
        uploadedDate: new Date().toISOString(),
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
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().split('T')[0];
}

export function getTodayDate() {
  return new Date().toISOString().split('T')[0];
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
      uploadDate: new Date().toISOString(),
      extractedCount: transactionIds.length,
      transactions: transactionIds,
      imageName: imageName,
    });
  } catch (error) {
    console.error('Error saving processed log:', error);
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
