import { formatLocalDate } from './simulationDate';

export const PROFILE_NAMES = ['Tony', 'Nugs'];

export function getOtherUser(user, users = PROFILE_NAMES) {
  return users.find((candidate) => candidate !== user) || null;
}

export function getSubmissionValue(submission, user) {
  return submission?.[user]?.value ?? null;
}

export function getSubmissionDateKeyEntry(entry) {
  const explicitDateKey = entry?.dateKey;
  if (explicitDateKey) return explicitDateKey;

  const ts = Number(entry?.ts);
  if (!Number.isFinite(ts)) return null;
  return formatLocalDate(new Date(ts));
}

export function getSubmissionDateKey(submission, user) {
  return getSubmissionDateKeyEntry(submission?.[user]);
}

export function hasSubmissionOnDate(submission, user, referenceDateKey) {
  return getSubmissionDateKey(submission, user) === referenceDateKey;
}

export function getSubmissionStatus(submission, users = PROFILE_NAMES) {
  const values = users.map((user) => getSubmissionValue(submission, user)).filter(Boolean);
  const hasUnsure = values.includes('Unsure');
  const allPicked = values.length === users.length;

  return {
    resolved: allPicked && !hasUnsure && new Set(values).size === 1,
    conflict: allPicked && !hasUnsure && new Set(values).size > 1,
    unsure: hasUnsure,
    anyPicked: values.length > 0,
  };
}

export function getLocalDateKey(dateLike) {
  if (!dateLike) return null;
  if (typeof dateLike === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateLike)) return dateLike;
  const parsed = new Date(dateLike);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatLocalDate(parsed);
}

export function getTransactionReferenceDateKey(transaction, referenceDateKey) {
  return transaction?.uploadedDay || getLocalDateKey(transaction?.uploadedDate || transaction?.date) || referenceDateKey;
}

export function getSurfacedSubmissionValue(submission, user, referenceDateKey) {
  const submittedDateKey = getSubmissionDateKey(submission, user);
  if (!submittedDateKey || submittedDateKey >= referenceDateKey) return null;
  return getSubmissionValue(submission, user);
}

export function getSurfacedSubmissionStatus(submission, referenceDateKey, users = PROFILE_NAMES) {
  const values = users
    .map((user) => getSurfacedSubmissionValue(submission, user, referenceDateKey))
    .filter(Boolean);
  const hasUnsure = values.includes('Unsure');
  const allPicked = values.length === users.length;

  return {
    resolved: allPicked && !hasUnsure && new Set(values).size === 1,
    conflict: allPicked && !hasUnsure && new Set(values).size > 1,
    unsure: hasUnsure,
    anyPicked: values.length > 0,
  };
}

function getAssignmentContributionRatio(value, assignee) {
  if (value === 'Split') {
    if (assignee === 'Tony') return 2 / 3;
    if (assignee === 'Nugs') return 1 / 3;
    return 0;
  }

  return value === assignee ? 1 : 0;
}

export function isVisibleForUser(transaction, submissions, user, referenceDateKey, users = PROFILE_NAMES) {
  if (!user) return true;

  const submission = submissions[transaction.id] || {};
  const { resolved } = getSurfacedSubmissionStatus(submission, referenceDateKey, users);
  const submittedDateKey = getSubmissionDateKey(submission, user);
  const transactionReferenceDateKey = getTransactionReferenceDateKey(transaction, referenceDateKey);
  const submittedForThisTransaction =
    submittedDateKey !== null &&
    transactionReferenceDateKey !== null &&
    submittedDateKey >= transactionReferenceDateKey;

  return !resolved && !submittedForThisTransaction;
}

export function getAssigneeContributionRatio(submission, assignee, referenceDateKey, users = PROFILE_NAMES) {
  const hasCurrentDaySubmission = users.some((user) => hasSubmissionOnDate(submission, user, referenceDateKey));
  if (hasCurrentDaySubmission) {
    const liveValues = [
      ...new Set(
        users
          .map((user) => getSubmissionValue(submission, user))
          .filter((value) => value && value !== 'Unsure')
      ),
    ];
    return liveValues.reduce(
      (maxRatio, value) => Math.max(maxRatio, getAssignmentContributionRatio(value, assignee)),
      0
    );
  }

  const status = getSurfacedSubmissionStatus(submission, referenceDateKey, users);
  if (!status.resolved) return 0;

  const values = users
    .map((user) => getSurfacedSubmissionValue(submission, user, referenceDateKey))
    .filter(Boolean);
  return getAssignmentContributionRatio(values[0], assignee);
}

export function shouldCountForAssignee(submission, assignee, referenceDateKey, users = PROFILE_NAMES) {
  return getAssigneeContributionRatio(submission, assignee, referenceDateKey, users) > 0;
}

export function getTallyBreakdownEntries(submissions, transactionsById, assignee, referenceDateKey, users = PROFILE_NAMES) {
  return Object.entries(submissions)
    .map(([transactionId, submission]) => {
      const transaction = transactionsById[transactionId];
      const contributionRatio = getAssigneeContributionRatio(submission, assignee, referenceDateKey, users);
      if (!transaction || contributionRatio <= 0) {
        return null;
      }

      const hasCurrentDaySubmission = users.some((user) =>
        hasSubmissionOnDate(submission, user, referenceDateKey)
      );

      return {
        ...transaction,
        countedAmount: Number(transaction.amount || 0) * contributionRatio,
        contributionRatio,
        assignmentState: hasCurrentDaySubmission ? 'Today' : 'Locked',
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (right.amount !== left.amount) return right.amount - left.amount;
      return String(left.desc).localeCompare(String(right.desc));
    });
}
