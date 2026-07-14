import {
  PROFILE_NAMES,
  getSubmissionStatus,
  getTransactionReferenceDateKey,
  isVisibleForUser,
} from './reconciliation.js';
import { buildDashboardMetrics } from './creditCardAppData.js';
import {
  MACQUARIE_EXCESS_THRESHOLD,
  getMacquarieExcessAmount,
  getMacquarieExcessShare,
} from './macquarieExcess.js';
import { SIMULATED_TIME_ZONE } from './simulationDate.js';
import { DEFAULT_APP_URL } from '../config/emailNotifications.js';
import {
  buildTallyDateRange,
  DEFAULT_TALLY_CYCLE_SETTINGS,
  formatTallyDateRangeLabel,
  isTransactionWithinTallyDateRange,
  normalizeTallyCycleSettings,
} from './tallyCycle.js';

export const PRESENCE_TTL_MS = 12000;
export { MACQUARIE_EXCESS_THRESHOLD };

function dateToMs(dateKey) {
  if (!dateKey) return null;
  const ms = Date.parse(`${dateKey}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
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

const DASHBOARD_ASSIGNEES = ['Macquarie', 'Macqbill'];

export function buildProfileEmailReports(
  transactions,
  submissions,
  todayKey,
  tallyCycleSettings = DEFAULT_TALLY_CYCLE_SETTINGS
) {
  const normalizedTallyCycleSettings = normalizeTallyCycleSettings(tallyCycleSettings);
  const tallyDateRange = buildTallyDateRange(todayKey, normalizedTallyCycleSettings);
  const statementCycleLabel = formatTallyDateRangeLabel(tallyDateRange);
  const cycleTransactions = transactions.filter((transaction) =>
    isTransactionWithinTallyDateRange(transaction, tallyDateRange)
  );

  return PROFILE_NAMES.map((profileName) => {
    const dashboardMetrics = buildDashboardMetrics({
      transactions: cycleTransactions,
      submissions,
      currentUser: profileName,
      users: PROFILE_NAMES,
      referenceDateKey: todayKey,
      simulatedNow: new Date(`${todayKey}T00:00:00Z`),
      assignees: DASHBOARD_ASSIGNEES,
      tallyDateRange,
      includeUnassignedHistorical: true,
    });
    const cycleAssignedTotal = dashboardMetrics.userTallies[profileName] || 0;
    const macquarieTotal = dashboardMetrics.assigneeTotals.Macquarie || 0;
    const macquarieExcessAmount = getMacquarieExcessAmount(macquarieTotal);

    // The statement cycle limits financial totals, not work needing attention.
    // A conflict or unsure can remain unresolved across a cycle boundary, and
    // a daily email must continue to surface it until it is resolved.
    const bucketCounts = transactions.reduce(
      (counts, transaction) => {
        const submission = submissions[transaction.id] || {};
        const liveStatus = getSubmissionStatus(submission, PROFILE_NAMES);
        const isVisible = isVisibleForUser(
          transaction,
          submissions,
          profileName,
          todayKey,
          PROFILE_NAMES,
          { includeUnassignedHistorical: true }
        );
        const referenceDay = getTransactionReferenceDateKey(transaction, todayKey);
        const isCurrentDayPending =
          (transaction.isPending || !transaction.date) && referenceDay === todayKey;

        // Current-day choices are intentionally hidden in the interactive
        // reconciliation list, but must not hide a newly created conflict or
        // unsure from the 11pm email.
        if (liveStatus.conflict) {
          counts.conflictsCount += 1;
          return counts;
        }

        if (liveStatus.unsure) {
          counts.unsuresCount += 1;
          return counts;
        }

        if (!isVisible) {
          return counts;
        }

        if (isCurrentDayPending) {
          counts.pendingCount += 1;
          return counts;
        }

        counts.outstandingCount += 1;
        return counts;
      },
      {
        pendingCount: 0,
        outstandingCount: 0,
        conflictsCount: 0,
        unsuresCount: 0,
      }
    );
    const remainingCount =
      bucketCounts.pendingCount +
      bucketCounts.outstandingCount +
      bucketCounts.conflictsCount +
      bucketCounts.unsuresCount;

    return {
      profileName,
      subject: `${profileName} profile summary - ${todayKey}`,
      appUrl: DEFAULT_APP_URL,
      statementCycleLabel,
      stats: {
        remainingCount,
        totalSpend: cycleAssignedTotal,
        cycleAssignedTotal,
        pendingCount: bucketCounts.pendingCount,
        outstandingCount: bucketCounts.outstandingCount,
        conflictsCount: bucketCounts.conflictsCount,
        unsuresCount: bucketCounts.unsuresCount,
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
