import { getAssigneeContributionRatio, getTransactionReferenceDateKey, isVisibleForUser } from './reconciliation';
import { formatLocalDate } from './simulationDate';
import { isTransactionWithinTallyDateRange } from './tallyCycle';

export function normalizeFirebaseTransaction(id, tx) {
  const amount = Number(tx.amount) || 0;
  return {
    id,
    desc: tx.merchant || tx.desc || 'Untitled transaction',
    amount,
    date: tx.date || null,
    isPending: Boolean(tx.isPending) || !tx.date,
    isRefund: Boolean(tx.isRefund) || amount < 0,
    uploadedDate: tx.uploadedDate || null,
    uploadedDay: tx.uploadedDay || null,
    category: tx.category || null,
    source: tx.source || 'image',
    raw: tx,
  };
}

function groupTransactionsByDate(transactions) {
  return transactions.reduce((groups, transaction) => {
    const key = transaction.date || 'undated';
    if (!groups[key]) groups[key] = [];
    groups[key].push(transaction);
    return groups;
  }, {});
}

function sortDateKeys(keys) {
  return [...keys].sort((left, right) => {
    if (left === 'undated') return 1;
    if (right === 'undated') return -1;

    const leftTime = new Date(left).getTime();
    const rightTime = new Date(right).getTime();
    if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime) && leftTime !== rightTime) {
      return rightTime - leftTime;
    }

    return String(right).localeCompare(String(left));
  });
}

function getLocalDateKey(dateLike) {
  if (!dateLike) return null;
  if (typeof dateLike === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateLike)) return dateLike;
  const parsed = new Date(dateLike);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatLocalDate(parsed);
}

export function formatRelativeDayLabel(dateStr, referenceDate) {
  const parsedKey = getLocalDateKey(dateStr);
  if (!parsedKey) return dateStr || 'Unknown';

  const referenceKey = formatLocalDate(referenceDate);
  const referenceMs = Date.parse(`${referenceKey}T00:00:00Z`);
  const parsedMs = Date.parse(`${parsedKey}T00:00:00Z`);
  const diffDays = Math.round((referenceMs - parsedMs) / 86400000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays > 1) return `${diffDays}D Ago`;
  if (diffDays === -1) return 'Tomorrow';
  return `${Math.abs(diffDays)}D Ahead`;
}

export function formatShortDate(dateStr) {
  const parsed = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateStr || '';

  return parsed.toLocaleDateString('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function buildTransactionSections({
  transactions,
  submissions,
  currentUser,
  referenceDateKey,
  simulatedNow,
}) {
  const pending = [];
  const agedPendingGroups = {};
  const datedTransactions = [];

  transactions.forEach((transaction) => {
    const visible = isVisibleForUser(transaction, submissions, currentUser, referenceDateKey);
    if (!visible) return;

    const isPending = transaction.isPending || !transaction.date;
    if (isPending) {
      const pendingKey = getTransactionReferenceDateKey(transaction, referenceDateKey);
      if (pendingKey === referenceDateKey) {
        pending.push(transaction);
      } else {
        if (!agedPendingGroups[pendingKey]) agedPendingGroups[pendingKey] = [];
        agedPendingGroups[pendingKey].push(transaction);
      }
      return;
    }

    datedTransactions.push(transaction);
  });

  const datedGroups = groupTransactionsByDate(datedTransactions);
  const datedKeys = sortDateKeys(Object.keys(datedGroups));
  const agedPendingKeys = sortDateKeys(Object.keys(agedPendingGroups));
  const sections = [];

  if (pending.length > 0) {
    sections.push({
      key: 'pending',
      title: 'Pending',
      date: '',
      txs: pending,
    });
  }

  agedPendingKeys.forEach((dateKey) => {
    const txs = agedPendingGroups[dateKey] || [];
    if (txs.length === 0) return;
    sections.push({
      key: `pending-${dateKey}`,
      title: formatRelativeDayLabel(dateKey, simulatedNow),
      txs,
    });
  });

  datedKeys.forEach((dateKey) => {
    const txs = datedGroups[dateKey] || [];
    if (txs.length === 0) return;
    sections.push({
      key: dateKey,
      title: formatRelativeDayLabel(dateKey, simulatedNow),
      txs,
    });
  });

  return sections;
}

export function buildDashboardMetrics({
  transactions = [],
  submissions = {},
  currentUser,
  users = [],
  referenceDateKey,
  simulatedNow,
  assignees = [],
  tallyDateRange = null,
}) {
  const activeUsers = users.length ? users : [];
  const remainingByUser = Object.fromEntries(activeUsers.map((user) => [user, 0]));
  const pending = [];
  const agedPendingGroups = {};
  const datedGroups = {};

  transactions.forEach((transaction) => {
    activeUsers.forEach((user) => {
      if (isVisibleForUser(transaction, submissions, user, referenceDateKey, activeUsers)) {
        remainingByUser[user] += 1;
      }
    });

    if (!isVisibleForUser(transaction, submissions, currentUser, referenceDateKey, activeUsers)) {
      return;
    }

    const isPending = transaction.isPending || !transaction.date;
    if (isPending) {
      const pendingKey = getTransactionReferenceDateKey(transaction, referenceDateKey);
      if (pendingKey === referenceDateKey) {
        pending.push(transaction);
      } else {
        if (!agedPendingGroups[pendingKey]) agedPendingGroups[pendingKey] = [];
        agedPendingGroups[pendingKey].push(transaction);
      }
      return;
    }

    const dateKey = transaction.date || 'undated';
    if (!datedGroups[dateKey]) datedGroups[dateKey] = [];
    datedGroups[dateKey].push(transaction);
  });

  const datedKeys = sortDateKeys(Object.keys(datedGroups));
  const agedPendingKeys = sortDateKeys(Object.keys(agedPendingGroups));
  const sections = [];

  if (pending.length > 0) {
    sections.push({
      key: 'pending',
      title: 'Pending',
      date: '',
      txs: pending,
    });
  }

  agedPendingKeys.forEach((dateKey) => {
    const txs = agedPendingGroups[dateKey] || [];
    if (txs.length === 0) return;
    sections.push({
      key: `pending-${dateKey}`,
      title: formatRelativeDayLabel(dateKey, simulatedNow),
      txs,
    });
  });

  datedKeys.forEach((dateKey) => {
    const txs = datedGroups[dateKey] || [];
    if (txs.length === 0) return;
    sections.push({
      key: dateKey,
      title: formatRelativeDayLabel(dateKey, simulatedNow),
      txs,
    });
  });

  const transactionsById = Object.fromEntries((transactions || []).map((tx) => [tx.id, tx]));
  const userTallies = Object.fromEntries(activeUsers.map((user) => [user, 0]));
  const assigneeTotals = Object.fromEntries((assignees || []).map((assignee) => [assignee, 0]));
  const tallyTargets = [...new Set([...activeUsers, ...(assignees || [])])];

  Object.entries(submissions || {}).forEach(([transactionId, submission]) => {
    const transaction = transactionsById[transactionId];
    if (!transaction || !isTransactionWithinTallyDateRange(transaction, tallyDateRange)) return;

    tallyTargets.forEach((target) => {
      const contributionRatio = getAssigneeContributionRatio(submission, target, referenceDateKey, activeUsers);
      if (contributionRatio <= 0) return;

      const amount = Number(transaction.amount || 0) * contributionRatio;
      if (activeUsers.includes(target)) {
        userTallies[target] = (userTallies[target] || 0) + amount;
      } else {
        assigneeTotals[target] = (assigneeTotals[target] || 0) + amount;
      }
    });
  });

  return {
    sections,
    anyVisible: sections.some((section) => section.txs.length > 0),
    remainingByUser,
    userTallies,
    assigneeTotals,
  };
}

export function countVisibleTransactions(transactions, submissions, user, referenceDateKey) {
  return transactions.filter((transaction) => isVisibleForUser(transaction, submissions, user, referenceDateKey)).length;
}

function sumAssignedTransactions(submissions, transactionsById, assignee, referenceDateKey, tallyDateRange = null) {
  return Object.entries(submissions).reduce((acc, [transactionId, submission]) => {
    const transaction = transactionsById[transactionId];
    const contributionRatio = getAssigneeContributionRatio(submission, assignee, referenceDateKey);
    if (
      !transaction ||
      contributionRatio <= 0 ||
      !isTransactionWithinTallyDateRange(transaction, tallyDateRange)
    ) {
      return acc;
    }
    return acc + Number(transaction.amount || 0) * contributionRatio;
  }, 0);
}

export function buildUserTallies(users, submissions, transactionsById, referenceDateKey, tallyDateRange = null) {
  return Object.fromEntries(
    users.map((user) => [
      user,
      sumAssignedTransactions(submissions, transactionsById, user, referenceDateKey, tallyDateRange),
    ])
  );
}

export function buildAssigneeTotal(submissions, transactionsById, assignee, referenceDateKey, tallyDateRange = null) {
  return sumAssignedTransactions(submissions, transactionsById, assignee, referenceDateKey, tallyDateRange);
}
