const SPLIT_ASSIGNMENT_CODE = 'split';
const MERCHANT_GROUP_STOP_WORDS = new Set([
  'au',
  'aud',
  'australia',
  'card',
  'com',
  'ltd',
  'online',
  'pty',
  'the',
  'www',
]);
const DEFAULT_OWNER_SUMMARY_CONFIG = [
  {
    code: 't',
    title: 'Corrected Top Spendings - Tony',
    totalLabel: 'Tony Total',
  },
  {
    code: 'n',
    title: 'Corrected Top Spendings - Nugs',
    totalLabel: 'Nugs Total',
  },
];

function normalizeAssignmentCode(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeMerchant(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeMerchantForGrouping(value) {
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

function tokenizeMerchantForGrouping(value) {
  return normalizeMerchantForGrouping(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !MERCHANT_GROUP_STOP_WORDS.has(token));
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

function merchantTokensLookSimilar(left, right) {
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

function merchantsLookSimilar(left, right) {
  const normalizedLeft = normalizeMerchantForGrouping(left);
  const normalizedRight = normalizeMerchantForGrouping(right);

  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;

  const leftTokens = tokenizeMerchantForGrouping(left);
  const rightTokens = tokenizeMerchantForGrouping(right);

  if (leftTokens.length === 0 || rightTokens.length === 0) {
    const maxLength = Math.max(normalizedLeft.length, normalizedRight.length);
    return maxLength > 4 && getEditDistance(normalizedLeft, normalizedRight) / maxLength <= 0.16;
  }

  const leftPrimary = leftTokens[0];
  const rightPrimary = rightTokens[0];
  if (
    Math.max(leftPrimary.length, rightPrimary.length) >= 5 &&
    merchantTokensLookSimilar(leftPrimary, rightPrimary)
  ) {
    return true;
  }

  const sharedTokens = leftTokens.filter((leftToken) =>
    rightTokens.some((rightToken) => merchantTokensLookSimilar(leftToken, rightToken))
  );
  const shorterTokenCount = Math.min(leftTokens.length, rightTokens.length);
  if (sharedTokens.length >= 2 && sharedTokens.length >= Math.ceil(shorterTokenCount * 0.66)) {
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

function roundCurrency(value) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) return 0;
  return Number(numericValue.toFixed(2));
}

function buildOwnerRows(transactions = [], assignmentCodes = [], ownerCode = '') {
  const normalizedOwnerCode = normalizeAssignmentCode(ownerCode);
  if (!normalizedOwnerCode) return [];

  const groupedRows = [];

  for (let index = 0; index < transactions.length; index += 1) {
    const transaction = transactions[index];
    const assignmentCode = normalizeAssignmentCode(assignmentCodes[index]);
    const amount = Number(transaction?.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const isDirectOwnerCharge = assignmentCode === normalizedOwnerCode;
    const isSplitCharge = assignmentCode === SPLIT_ASSIGNMENT_CODE;
    if (!isDirectOwnerCharge && !isSplitCharge) continue;

    const merchant = normalizeMerchant(
      transaction?.description || transaction?.rawDescription || 'Unknown merchant'
    );
    const shareAmount = isSplitCharge ? amount / 2 : amount;

    const current =
      groupedRows.find((row) => row.aliases.some((alias) => merchantsLookSimilar(alias, merchant))) ||
      null;

    if (!current) {
      groupedRows.push({
        aliases: [merchant],
        aliasTotals: new Map([[merchant, shareAmount]]),
        total: shareAmount,
        directCount: isDirectOwnerCharge ? 1 : 0,
        splitCount: isSplitCharge ? 1 : 0,
      });
      continue;
    }

    current.total += shareAmount;
    current.directCount += isDirectOwnerCharge ? 1 : 0;
    current.splitCount += isSplitCharge ? 1 : 0;
    current.aliases.push(merchant);
    current.aliasTotals.set(merchant, (current.aliasTotals.get(merchant) || 0) + shareAmount);
  }

  const getRepresentativeMerchant = (entry) =>
    Array.from(entry.aliasTotals.entries()).sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      if (right[0].length !== left[0].length) return right[0].length - left[0].length;
      return left[0].localeCompare(right[0]);
    })[0]?.[0] || entry.aliases[0] || 'Unknown merchant';

  return groupedRows
    .map((entry) => {
      const representativeMerchant = getRepresentativeMerchant(entry);
      return {
        merchant:
          entry.directCount === 0 && entry.splitCount > 0
            ? `${representativeMerchant} (split rows only)`
            : representativeMerchant,
        total: roundCurrency(entry.total),
        sortKey: representativeMerchant,
      };
    })
    .filter((entry) => entry.total > 0)
    .sort((left, right) => {
      if (left.total !== right.total) return right.total - left.total;
      return left.sortKey.localeCompare(right.sortKey);
    })
    .map(({ merchant, total }) => ({ merchant, total }));
}

export function buildTopSpendingsSummary(
  transactions = [],
  assignmentCodes = [],
  options = {}
) {
  const ownerConfig = Array.isArray(options.ownerConfig) && options.ownerConfig.length > 0
    ? options.ownerConfig
    : DEFAULT_OWNER_SUMMARY_CONFIG;
  const maxRowsPerOwner = Number.isInteger(options.maxRowsPerOwner) && options.maxRowsPerOwner > 0
    ? options.maxRowsPerOwner
    : 10;

  return ownerConfig.map((owner) => ({
    ...owner,
    rows: buildOwnerRows(transactions, assignmentCodes, owner.code).slice(0, maxRowsPerOwner),
  }));
}
