import { formatLocalDate } from './simulationDate.js';
import { isTransactionWithinTallyDateRange } from './tallyCycle.js';

export const PROFILE_NAMES = ['Tony', 'Nugs'];
export const ASSIGNMENT_RULES_VERSION = 2;

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

function buildSubmissionStatus(entries, expectedCount) {
  const populatedEntries = entries.filter((entry) => entry?.value);
  const values = populatedEntries.map((entry) => entry.value);
  const hasUnsure = values.includes('Unsure');
  const usesCurrentRules = populatedEntries.some(
    (entry) => Number(entry.rulesVersion || 0) >= ASSIGNMENT_RULES_VERSION
  );
  const allPicked = values.length === expectedCount;
  const allPickedOnSameDay =
    allPicked &&
    populatedEntries.every((entry) => entry.dateKey) &&
    new Set(populatedEntries.map((entry) => entry.dateKey)).size === 1;
  const valuesMatch = allPicked && new Set(values).size === 1;
  const resolved =
    allPicked &&
    !hasUnsure &&
    valuesMatch &&
    (!usesCurrentRules || allPickedOnSameDay);
  const conflict = allPicked && !hasUnsure && !valuesMatch;

  return {
    resolved,
    conflict,
    unsure:
      hasUnsure ||
      (usesCurrentRules && values.length > 0 && !resolved && !conflict),
    anyPicked: values.length > 0,
  };
}

export function getSubmissionStatus(submission, users = PROFILE_NAMES) {
  return buildSubmissionStatus(
    users.map((user) => ({
      value: getSubmissionValue(submission, user),
      dateKey: getSubmissionDateKey(submission, user),
      rulesVersion: submission?.[user]?.rulesVersion,
    })),
    users.length
  );
}

export function getLocalDateKey(dateLike) {
  if (!dateLike) return null;
  if (typeof dateLike === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateLike)) return dateLike;
  const parsed = new Date(dateLike);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatLocalDate(parsed);
}

export function getTransactionReferenceDateKey(transaction, referenceDateKey) {
  return getLocalDateKey(transaction?.date || transaction?.uploadedDate) || transaction?.uploadedDay || referenceDateKey;
}

function isRecentUpload(transaction, referenceDateKey) {
  const uploadedDateKey = getLocalDateKey(transaction?.uploadedDate) || transaction?.uploadedDay || null;
  if (!uploadedDateKey) return false;
  if (uploadedDateKey === referenceDateKey) return true;

  const referenceDate = new Date(`${referenceDateKey}T00:00:00Z`);
  if (Number.isNaN(referenceDate.getTime())) return false;

  referenceDate.setUTCDate(referenceDate.getUTCDate() - 1);
  const previousDateKey = formatLocalDate(referenceDate);
  return uploadedDateKey === previousDateKey;
}

export function getSurfacedSubmissionValue(submission, user, referenceDateKey) {
  const entry = submission?.[user];
  const submittedDateKey = getSubmissionDateKeyEntry(entry);
  if (!submittedDateKey) return null;
  if (submittedDateKey >= referenceDateKey) {
    const previousDateKey = entry?.previousDateKey;
    if (previousDateKey && previousDateKey < referenceDateKey) {
      return entry?.previousValue ?? null;
    }
    return null;
  }
  return entry?.value ?? null;
}

export function getSurfacedSubmissionStatus(submission, referenceDateKey, users = PROFILE_NAMES) {
  return buildSubmissionStatus(
    users.map((user) => {
      const entry = submission?.[user];
      const submittedDateKey = getSubmissionDateKeyEntry(entry);
      const usesPreviousValue =
        submittedDateKey >= referenceDateKey &&
        entry?.previousDateKey &&
        entry.previousDateKey < referenceDateKey;

      return {
        value: getSurfacedSubmissionValue(submission, user, referenceDateKey),
        dateKey: usesPreviousValue ? entry.previousDateKey : submittedDateKey,
        rulesVersion: usesPreviousValue ? entry.previousRulesVersion : entry?.rulesVersion,
      };
    }),
    users.length
  );
}

function getAssignmentContributionRatio(value, assignee) {
  if (value === 'Split') {
    if (assignee === 'Tony') return 2 / 3;
    if (assignee === 'Nugs') return 1 / 3;
    return 0;
  }

  return value === assignee ? 1 : 0;
}

const TALLY_MERCHANT_STOP_WORDS = new Set([
  'au',
  'aud',
  'australia',
  'aed',
  'card',
  'category',
  'com',
  'credit',
  'debit',
  'eur',
  'gbp',
  'in',
  'ltd',
  'notau',
  'online',
  'pending',
  'pos',
  'posted',
  'progress',
  'pty',
  'the',
  'usd',
  'www',
]);

function normalizeTallyMerchantText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[0]/g, 'o')
    .replace(/[1!|]/g, 'l')
    .replace(/[5$]/g, 's')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getTallyMerchantTokenDetails(value) {
  return String(value || '')
    .match(/[A-Za-z0-9!|$]+/g)
    ?.map((raw) => ({
      raw,
      normalized: normalizeTallyMerchantText(raw),
    }))
    .filter((token) => token.normalized.length > 1 && !TALLY_MERCHANT_STOP_WORDS.has(token.normalized)) || [];
}

function getTallyMerchantTokens(value) {
  return getTallyMerchantTokenDetails(value).map((token) => token.normalized);
}

function getEditDistance(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  const rows = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i += 1) rows[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) rows[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + cost
      );
    }
  }

  return rows[a.length][b.length];
}

function tallyMerchantTokensLookSimilar(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;

  const minLength = Math.min(left.length, right.length);
  const maxLength = Math.max(left.length, right.length);

  if (minLength >= 5 && (left.includes(right) || right.includes(left))) return true;
  if (maxLength <= 4) return false;

  const editDistance = getEditDistance(left, right);
  if (maxLength <= 8) return editDistance <= 1;
  if (maxLength <= 12) return editDistance <= 2;
  return editDistance / maxLength <= 0.18;
}

function tallyMerchantsLookSimilar(left, right) {
  const normalizedLeft = normalizeTallyMerchantText(left);
  const normalizedRight = normalizeTallyMerchantText(right);

  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;

  const leftTokens = getTallyMerchantTokens(left);
  const rightTokens = getTallyMerchantTokens(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    const maxLength = Math.max(normalizedLeft.length, normalizedRight.length);
    return maxLength > 4 && getEditDistance(normalizedLeft, normalizedRight) / maxLength <= 0.16;
  }

  const leftPrimary = leftTokens[0];
  const rightPrimary = rightTokens[0];
  if (
    Math.max(leftPrimary.length, rightPrimary.length) >= 5 &&
    tallyMerchantTokensLookSimilar(leftPrimary, rightPrimary)
  ) {
    return true;
  }

  const sharedTokens = leftTokens.filter((leftToken) =>
    rightTokens.some((rightToken) => tallyMerchantTokensLookSimilar(leftToken, rightToken))
  );
  const shorterTokenCount = Math.min(leftTokens.length, rightTokens.length);

  if (sharedTokens.length >= 2 && sharedTokens.length >= Math.ceil(shorterTokenCount * 0.66)) {
    return true;
  }

  if (
    shorterTokenCount === 1 &&
    sharedTokens.length === 1 &&
    Math.max(leftTokens[0].length, rightTokens[0].length) >= 5
  ) {
    return true;
  }

  const leftKey = leftTokens.join(' ');
  const rightKey = rightTokens.join(' ');
  const minKeyLength = Math.min(leftKey.length, rightKey.length);
  if (minKeyLength >= 5 && (leftKey.includes(rightKey) || rightKey.includes(leftKey))) {
    return true;
  }

  const maxKeyLength = Math.max(leftKey.length, rightKey.length);
  if (maxKeyLength <= 4) return false;
  return getEditDistance(leftKey, rightKey) / maxKeyLength <= 0.16;
}

function formatTallyMerchantDisplayToken(rawToken) {
  return String(rawToken || '')
    .replace(/0/g, 'O')
    .replace(/[1!|]/g, 'L')
    .replace(/[5$]/g, 'S')
    .toUpperCase();
}

function dedupeSimilarTallyMerchantTokens(tokens) {
  return tokens.reduce((deduped, token) => {
    const previous = deduped[deduped.length - 1];
    if (previous && tallyMerchantTokensLookSimilar(previous.normalized, token.normalized)) {
      if (token.normalized.length > previous.normalized.length) {
        deduped[deduped.length - 1] = token;
      }
      return deduped;
    }

    deduped.push(token);
    return deduped;
  }, []);
}

function getCommonTallyMerchantTokenRun(items, representativeTokens) {
  let bestRun = [];

  representativeTokens.forEach((_, startIndex) => {
    const run = [];

    for (let index = startIndex; index < representativeTokens.length; index += 1) {
      const token = representativeTokens[index];
      const isCommon = items.every((item) =>
        getTallyMerchantTokens(item.desc).some((candidate) =>
          tallyMerchantTokensLookSimilar(token.normalized, candidate)
        )
      );

      if (!isCommon) break;
      run.push(token);
    }

    const dedupedRun = dedupeSimilarTallyMerchantTokens(run);
    const runLength = dedupedRun.reduce((sum, token) => sum + token.normalized.length, 0);
    const bestLength = bestRun.reduce((sum, token) => sum + token.normalized.length, 0);

    if (
      dedupedRun.length > bestRun.length ||
      (dedupedRun.length === bestRun.length && runLength > bestLength)
    ) {
      bestRun = dedupedRun;
    }
  });

  return bestRun;
}

function getTallyBreakdownAmount(item) {
  const amount = Number(item?.countedAmount ?? item?.amount ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function sortTallyBreakdownItems(left, right) {
  const amountDiff = getTallyBreakdownAmount(right) - getTallyBreakdownAmount(left);
  if (amountDiff !== 0) return amountDiff;

  const leftDate = left.date || left.uploadedDay || '';
  const rightDate = right.date || right.uploadedDay || '';
  if (rightDate !== leftDate) return String(rightDate).localeCompare(String(leftDate));

  return String(left.desc).localeCompare(String(right.desc));
}

function getTallyBreakdownGroupTitle(items) {
  const sortedItems = [...items].sort(sortTallyBreakdownItems);
  const representative = sortedItems[0];
  if (!representative) return 'Untitled transaction';

  const normalizedFullDescriptions = new Set(
    sortedItems.map((item) => normalizeTallyMerchantText(item.desc)).filter(Boolean)
  );
  if (normalizedFullDescriptions.size <= 1) return representative.desc || 'Untitled transaction';

  const representativeTokens = getTallyMerchantTokenDetails(representative.desc);
  const commonRun = getCommonTallyMerchantTokenRun(sortedItems, representativeTokens);
  const hasUsefulRun =
    commonRun.length > 1 || commonRun.some((token) => token.normalized.length >= 4);

  return hasUsefulRun
    ? commonRun.map((token) => formatTallyMerchantDisplayToken(token.raw)).join(' ')
    : representative.desc || 'Untitled transaction';
}

function buildTallyBreakdownGroupKey(title, items, fallbackIndex) {
  const titleKey = getTallyMerchantTokens(title).join('-') || normalizeTallyMerchantText(title) || 'group';
  const itemKey = items
    .map((item) => item.id || `${item.desc || 'item'}-${item.date || item.uploadedDay || ''}`)
    .sort()
    .join('-');

  return `${titleKey}-${itemKey || fallbackIndex}`;
}

function getManualTallyUngroupRecords(manualUngroups = {}, assignee = null) {
  const records = Array.isArray(manualUngroups)
    ? manualUngroups
    : Object.values(manualUngroups || {});

  return records.filter((record) => {
    if (!record || typeof record !== 'object') return false;
    if (!record.txId) return false;
    if (record.deletedAt) return false;
    if (assignee && record.assignee && record.assignee !== assignee) return false;
    return true;
  });
}

export function isVisibleForUser(
  transaction,
  submissions,
  user,
  referenceDateKey,
  users = PROFILE_NAMES,
  options = {}
) {
  if (!user) return true;

  const submission = submissions[transaction.id] || {};
  const submissionStatus = getSubmissionStatus(submission, users);
  const surfacedStatus = getSurfacedSubmissionStatus(submission, referenceDateKey, users);
  const submittedDateKey = getSubmissionDateKey(submission, user);
  const submittedToday = submittedDateKey === referenceDateKey;
  const transactionReferenceDateKey = getTransactionReferenceDateKey(transaction, referenceDateKey);

  if (!submissionStatus.anyPicked) {
    return (
      transactionReferenceDateKey === referenceDateKey ||
      (Boolean(options.includeUnassignedHistorical) && isRecentUpload(transaction, referenceDateKey))
    );
  }

  if (surfacedStatus.conflict || surfacedStatus.unsure) {
    return !submittedToday;
  }

  return !surfacedStatus.resolved && !submittedToday;
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

export function getTallyBreakdownEntries(
  submissions,
  transactionsById,
  assignee,
  referenceDateKey,
  users = PROFILE_NAMES,
  tallyDateRange = null
) {
  return Object.entries(submissions)
    .map(([transactionId, submission]) => {
      const transaction = transactionsById[transactionId];
      const contributionRatio = getAssigneeContributionRatio(submission, assignee, referenceDateKey, users);
      if (
        !transaction ||
        contributionRatio <= 0 ||
        !isTransactionWithinTallyDateRange(transaction, tallyDateRange)
      ) {
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
    .sort(sortTallyBreakdownItems);
}

export function groupTallyBreakdownEntries(items = [], manualUngroups = {}, assignee = null) {
  const groups = [];
  const manuallyUngroupedTxIds = new Set(
    getManualTallyUngroupRecords(manualUngroups, assignee).map((record) => String(record.txId))
  );

  items.forEach((item) => {
    if (manuallyUngroupedTxIds.has(String(item.id))) {
      groups.push({ items: [item], manuallyUngrouped: true });
      return;
    }

    const existingGroup = groups.find((group) =>
      !group.manuallyUngrouped &&
      group.items.some((candidate) => tallyMerchantsLookSimilar(candidate.desc, item.desc))
    );

    if (existingGroup) {
      existingGroup.items.push(item);
    } else {
      groups.push({ items: [item] });
    }
  });

  return groups
    .map((group, index) => {
      const sortedItems = [...group.items].sort(sortTallyBreakdownItems);
      const totalAmount = sortedItems.reduce((sum, item) => sum + getTallyBreakdownAmount(item), 0);
      const title = getTallyBreakdownGroupTitle(sortedItems);

      return {
        key: buildTallyBreakdownGroupKey(title, sortedItems, index),
        desc: title,
        amount: totalAmount,
        countedAmount: totalAmount,
        itemCount: sortedItems.length,
        items: sortedItems,
        manuallyUngrouped: Boolean(group.manuallyUngrouped),
      };
    })
    .sort((left, right) => {
      if (right.countedAmount !== left.countedAmount) return right.countedAmount - left.countedAmount;
      if (right.itemCount !== left.itemCount) return right.itemCount - left.itemCount;
      return String(left.desc).localeCompare(String(right.desc));
    });
}

export function getGroupedTallyBreakdownEntries(
  submissions,
  transactionsById,
  assignee,
  referenceDateKey,
  users = PROFILE_NAMES,
  manualUngroups = {},
  tallyDateRange = null
) {
  return groupTallyBreakdownEntries(
    getTallyBreakdownEntries(
      submissions,
      transactionsById,
      assignee,
      referenceDateKey,
      users,
      tallyDateRange
    ),
    manualUngroups,
    assignee
  );
}
