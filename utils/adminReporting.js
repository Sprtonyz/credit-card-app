import {
  PROFILE_NAMES,
  getAssigneeContributionRatio,
  getSurfacedSubmissionStatus,
  getTransactionReferenceDateKey,
  isVisibleForUser,
} from './reconciliation';
import {
  MACQUARIE_EXCESS_THRESHOLD,
  getMacquarieExcessAmount,
  getMacquarieExcessShare,
} from './macquarieExcess';
import { SIMULATED_TIME_ZONE } from './simulationDate';
import { DEFAULT_APP_URL } from '../config/emailNotifications';

export const PRESENCE_TTL_MS = 12000;
export { MACQUARIE_EXCESS_THRESHOLD };

function dateToMs(dateKey) {
  if (!dateKey) return null;
  const ms = Date.parse(`${dateKey}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

function daysBetween(olderKey, newerKey) {
  const olderMs = dateToMs(olderKey);
  const newerMs = dateToMs(newerKey);
  if (olderMs === null || newerMs === null) return null;
  return Math.floor((newerMs - olderMs) / 86400000);
}

function getLatestSubmissionEntryForUser(submissions = {}, user) {
  return Object.entries(submissions).reduce((latest, [txId, submission]) => {
    const entry = submission?.[user];
    const ts = Number(entry?.ts);

    if (!Number.isFinite(ts)) return latest;
    if (!latest || ts > latest.ts) {
      return {
        txId,
        ts,
        value: entry?.value || null,
        dateKey: entry?.dateKey || null,
      };
    }

    return latest;
  }, null);
}

function getAssigneeTotal(transactions, submissions, assignee, todayKey) {
  return Object.entries(submissions).reduce((acc, [transactionId, submission]) => {
    const transaction = transactions.find((item) => item.id === transactionId);
    const contributionRatio = getAssigneeContributionRatio(submission, assignee, todayKey);
    if (!transaction || contributionRatio <= 0) return acc;
    return acc + Number(transaction.amount || 0) * contributionRatio;
  }, 0);
}

export function buildProfileEmailReports(transactions, submissions, todayKey) {
  const macquarieTotal = getAssigneeTotal(transactions, submissions, 'Macquarie', todayKey);
  const macquarieExcessAmount = getMacquarieExcessAmount(macquarieTotal);

  return PROFILE_NAMES.map((profileName) => {
    const visibleTransactions = transactions.filter((transaction) =>
      isVisibleForUser(transaction, submissions, profileName, todayKey)
    );

    const totalSpend = getAssigneeTotal(transactions, submissions, profileName, todayKey);

    const pendingTransactions = visibleTransactions.filter((transaction) => {
      if (!(transaction.isPending || !transaction.date)) return false;
      const referenceDay = getTransactionReferenceDateKey(transaction, todayKey);
      return referenceDay === todayKey;
    });

    const outstandingTransactions = visibleTransactions.filter((transaction) => {
      if (!(transaction.isPending || !transaction.date)) return false;
      const referenceDay = getTransactionReferenceDateKey(transaction, todayKey);
      if (!referenceDay) return false;
      const age = daysBetween(referenceDay, todayKey);
      return age !== null && age > 1;
    });

    const conflictsCount = visibleTransactions.filter((transaction) => {
      const status = getSurfacedSubmissionStatus(submissions[transaction.id] || {}, todayKey);
      return status.conflict;
    }).length;

    const unsuresCount = visibleTransactions.filter((transaction) => {
      const status = getSurfacedSubmissionStatus(submissions[transaction.id] || {}, todayKey);
      return status.unsure;
    }).length;

    return {
      profileName,
      subject: `${profileName} profile summary - ${todayKey}`,
      appUrl: DEFAULT_APP_URL,
      stats: {
        totalSpend,
        pendingCount: pendingTransactions.length,
        outstandingCount: outstandingTransactions.length,
        conflictsCount,
        unsuresCount,
        macquarieTotal,
        macquarieExcessAmount,
        macquarieExcessShare: getMacquarieExcessShare(profileName, macquarieTotal),
      },
    };
  });
}

export function buildProcessedBatches(processedLogs = {}) {
  return Object.entries(processedLogs)
    .map(([imageHash, log]) => ({
      imageHash,
      imageName: log?.imageName || 'Unknown image',
      uploadDate: log?.uploadDate || null,
      uploadDay: log?.uploadDay || null,
      extractedCount: Number(log?.extractedCount || 0),
      transactionIds: Array.isArray(log?.transactions) ? log.transactions.filter(Boolean) : [],
    }))
    .sort((left, right) => {
      const leftTime = Date.parse(left.uploadDate || '') || 0;
      const rightTime = Date.parse(right.uploadDate || '') || 0;
      return rightTime - leftTime;
    });
}

export function buildImportAuditHistory(entries = []) {
  return [...entries]
    .map((entry) => ({
      id: entry.id,
      type: entry.type || 'unknown',
      createdAt: entry.createdAt || null,
      createdDay: entry.createdDay || null,
      summary: entry.summary || null,
      images: Array.isArray(entry.images) ? entry.images : [],
      decisions: Array.isArray(entry.decisions) ? entry.decisions : [],
      actionLabel:
        entry.type === 'undo_batch'
          ? 'Undo'
          : entry.type === 'delete_batch'
            ? 'Delete'
            : 'Import',
    }))
    .sort((left, right) => {
      const leftTime = Date.parse(left.createdAt || '') || 0;
      const rightTime = Date.parse(right.createdAt || '') || 0;
      return rightTime - leftTime;
    });
}

export function formatDateKeyForDisplay(dateKey) {
  const match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateKey || 'n/a';
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function formatActivityTimestamp(ts) {
  const value = Number(ts);
  if (!Number.isFinite(value) || value <= 0) return 'No activity yet';
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: SIMULATED_TIME_ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(new Date(value));
}

function getUserActivityTimestamp(userActivityEntries = {}, user) {
  const directEntry = userActivityEntries?.[user];
  const matchingEntries = Object.values(userActivityEntries || {}).filter(
    (entry) => entry && typeof entry === 'object' && entry.user === user
  );
  const candidates = [directEntry, ...matchingEntries].filter(Boolean);

  return candidates.reduce((latest, entry) => {
    const ts = Number(entry?.lastSeen || entry?.lastLogin || entry?.ts);
    if (!Number.isFinite(ts)) return latest;
    return ts > latest ? ts : latest;
  }, 0);
}

export function buildAdminActivityLog(
  presenceEntries = {},
  submissions = {},
  userActivityEntries = {},
  now = Date.now()
) {
  return PROFILE_NAMES.map((user) => {
    const userPresenceEntries = Object.values(presenceEntries || {}).filter(
      (entry) => entry && typeof entry === 'object' && entry.user === user
    );
    const latestLivePresenceTs = userPresenceEntries.reduce((latest, entry) => {
      const ts = Number(entry?.ts);
      if (!Number.isFinite(ts)) return latest;
      return Number.isFinite(ts) && ts > latest ? ts : latest;
    }, 0);
    const latestSubmission = getLatestSubmissionEntryForUser(submissions, user);
    const latestPresenceTs = Math.max(
      latestLivePresenceTs,
      getUserActivityTimestamp(userActivityEntries, user),
      Number(latestSubmission?.ts) || 0
    );
    const hasActivePresence = userPresenceEntries.some((entry) => {
      const ts = Number(entry?.ts);
      return Number.isFinite(ts) && now - ts <= PRESENCE_TTL_MS;
    });

    return {
      user,
      isOnline: hasActivePresence,
      latestPresenceTs: latestPresenceTs || null,
      latestSubmission,
    };
  });
}
