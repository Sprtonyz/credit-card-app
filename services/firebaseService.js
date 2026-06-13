import { db } from '../config/firebase.js';
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
} from '../utils/simulationDate.js';
import {
  AUTOMATED_NOTIFICATION_EVENTS_ROOT,
  AUTOMATED_NOTIFICATION_SETTINGS_ROOT,
  DEFAULT_AUTOMATED_EMAIL_TIME,
  DEFAULT_AUTOMATED_EMAIL_TIME_ZONE,
  DEFAULT_AUTOMATED_EMAIL_WINDOW_MINUTES,
} from '../config/emailNotifications.js';
import { normalizeScheduleWindowMinutes } from '../utils/emailSchedule.js';
import {
  buildCommonReoccurrenceRule,
  normalizeCommonReoccurrenceRules,
} from '../utils/commonReoccurrence.js';
import {
  DEFAULT_TALLY_CYCLE_SETTINGS,
  TALLY_CYCLE_SETTINGS_ROOT,
  normalizeTallyCycleSettings,
} from '../utils/tallyCycle.js';

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
        imageFingerprint: tx.imageFingerprint || null,
        orderedImageFingerprint: tx.orderedImageFingerprint || null,
        imageName: tx.imageName || null,
        rowFingerprint: tx.rowFingerprint || null,
        sequenceIndex:
          tx.sequenceIndex !== null && tx.sequenceIndex !== undefined && Number.isFinite(Number(tx.sequenceIndex))
            ? Number(tx.sequenceIndex)
            : null,
        lineIndex:
          tx.lineIndex !== null && tx.lineIndex !== undefined && Number.isFinite(Number(tx.lineIndex))
            ? Number(tx.lineIndex)
            : null,
        lineBbox: tx.lineBbox || null,
        dedupeNeighbors: tx.dedupeNeighbors || null,
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

export async function getPresenceEntries() {
  try {
    const snapshot = await get(ref(db, 'cc_v5_presence'));

    if (!snapshot.exists()) {
      return {};
    }

    return snapshot.val();
  } catch (error) {
    console.error('Error getting presence entries:', error);
    throw error;
  }
}

export async function getUserActivityEntries() {
  try {
    const snapshot = await get(ref(db, 'cc_v5_app_state/userActivity'));

    if (!snapshot.exists()) {
      return {};
    }

    return snapshot.val();
  } catch (error) {
    console.error('Error getting user activity entries:', error);
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

export async function saveProcessedLog(imageHash, transactionIds, imageName, imageFingerprint = null, metadata = {}) {
  try {
    const processedRef = ref(db, `processedTransactions/${imageHash}`);
    await set(processedRef, {
      uploadDate: getSimulatedISOString(),
      uploadDay: getTodayDate(),
      extractedCount: transactionIds.length,
      transactions: transactionIds,
      imageName: imageName,
      imageFingerprint: imageFingerprint || null,
      orderedImageFingerprint: metadata.orderedImageFingerprint || null,
      rowContexts: metadata.rowContexts || [],
    });
  } catch (error) {
    console.error('Error saving processed log:', error);
    throw error;
  }
}

export async function appendImportAuditEntry(entry = {}) {
  try {
    const auditRef = ref(db, 'importAuditLog');
    const auditEntryRef = push(auditRef);
    await set(auditEntryRef, {
      ...entry,
      createdAt: entry.createdAt || getSimulatedISOString(),
      createdDay: entry.createdDay || getTodayDate(),
    });
    return auditEntryRef.key;
  } catch (error) {
    console.error('Error saving import audit entry:', error);
    throw error;
  }
}

export async function getImportAuditEntries() {
  try {
    const snapshot = await get(ref(db, 'importAuditLog'));

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

    return results.sort((left, right) => {
      const leftTime = Date.parse(left.createdAt || '') || 0;
      const rightTime = Date.parse(right.createdAt || '') || 0;
      return rightTime - leftTime;
    });
  } catch (error) {
    console.error('Error getting import audit entries:', error);
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

export async function getCommonReoccurrenceRules() {
  try {
    const snapshot = await get(ref(db, 'commonReoccurrences'));

    if (!snapshot.exists()) {
      return [];
    }

    return normalizeCommonReoccurrenceRules(snapshot.val());
  } catch (error) {
    console.error('Error getting common reoccurrence rules:', error);
    throw error;
  }
}

export async function saveCommonReoccurrenceRule(transaction) {
  try {
    const rule = buildCommonReoccurrenceRule(transaction);
    if (!rule?.key) {
      throw new Error('Could not create a common reoccurrence rule for this transaction.');
    }

    const savedRule = {
      ...rule,
      updatedAt: getSimulatedISOString(),
    };

    await set(ref(db, `commonReoccurrences/${rule.key}`), savedRule);
    return savedRule;
  } catch (error) {
    console.error('Error saving common reoccurrence rule:', error);
    throw error;
  }
}

export async function deleteCommonReoccurrenceRule(ruleKey) {
  try {
    if (!ruleKey) return;
    await remove(ref(db, `commonReoccurrences/${ruleKey}`));
  } catch (error) {
    console.error('Error deleting common reoccurrence rule:', error);
    throw error;
  }
}

export async function getNotificationAutomationSettings() {
  try {
    const snapshot = await get(ref(db, AUTOMATED_NOTIFICATION_SETTINGS_ROOT));

    if (!snapshot.exists()) {
      return {
        time: DEFAULT_AUTOMATED_EMAIL_TIME,
        timeZone: DEFAULT_AUTOMATED_EMAIL_TIME_ZONE,
        windowMinutes: DEFAULT_AUTOMATED_EMAIL_WINDOW_MINUTES,
      };
    }

    return {
      time: snapshot.val()?.time || DEFAULT_AUTOMATED_EMAIL_TIME,
      timeZone: snapshot.val()?.timeZone || DEFAULT_AUTOMATED_EMAIL_TIME_ZONE,
      windowMinutes: normalizeScheduleWindowMinutes(
        snapshot.val()?.windowMinutes || DEFAULT_AUTOMATED_EMAIL_WINDOW_MINUTES
      ),
      updatedAt: snapshot.val()?.updatedAt || null,
    };
  } catch (error) {
    console.error('Error getting notification automation settings:', error);
    throw error;
  }
}

export async function saveNotificationAutomationSettings(settings = {}) {
  try {
    const nextSettings = {
      time: settings.time || DEFAULT_AUTOMATED_EMAIL_TIME,
      timeZone: settings.timeZone || DEFAULT_AUTOMATED_EMAIL_TIME_ZONE,
      windowMinutes: normalizeScheduleWindowMinutes(
        settings.windowMinutes || DEFAULT_AUTOMATED_EMAIL_WINDOW_MINUTES
      ),
      updatedAt: getSimulatedISOString(),
    };

    await set(ref(db, AUTOMATED_NOTIFICATION_SETTINGS_ROOT), nextSettings);
    return nextSettings;
  } catch (error) {
    console.error('Error saving notification automation settings:', error);
    throw error;
  }
}

export async function getNotificationAutomationEvents() {
  try {
    const snapshot = await get(ref(db, AUTOMATED_NOTIFICATION_EVENTS_ROOT));

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

    return results.sort((left, right) => {
      const leftTime = Date.parse(left.createdAt || '') || 0;
      const rightTime = Date.parse(right.createdAt || '') || 0;
      return rightTime - leftTime;
    });
  } catch (error) {
    console.error('Error getting notification automation events:', error);
    throw error;
  }
}

export async function getTallyCycleSettings() {
  try {
    const snapshot = await get(ref(db, TALLY_CYCLE_SETTINGS_ROOT));

    if (!snapshot.exists()) {
      return {
        ...DEFAULT_TALLY_CYCLE_SETTINGS,
        updatedAt: null,
      };
    }

    const normalized = normalizeTallyCycleSettings(snapshot.val() || {});
    return {
      ...normalized,
      updatedAt: snapshot.val()?.updatedAt || null,
    };
  } catch (error) {
    console.error('Error getting tally cycle settings:', error);
    throw error;
  }
}

export async function saveTallyCycleSettings(settings = {}) {
  try {
    const normalized = normalizeTallyCycleSettings(settings);
    const nextSettings = {
      ...normalized,
      updatedAt: getSimulatedISOString(),
    };

    await set(ref(db, TALLY_CYCLE_SETTINGS_ROOT), nextSettings);
    return nextSettings;
  } catch (error) {
    console.error('Error saving tally cycle settings:', error);
    throw error;
  }
}
