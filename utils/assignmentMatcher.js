function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean);
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

function similarityScore(left, right) {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);

  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;
  if (
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  ) {
    return 0.96;
  }

  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  const sharedTokens = leftTokens.filter((token) => rightTokens.includes(token));
  const tokenScore =
    Math.max(leftTokens.length, rightTokens.length) > 0
      ? sharedTokens.length / Math.max(leftTokens.length, rightTokens.length)
      : 0;

  const editDistance = getEditDistance(normalizedLeft, normalizedRight);
  const editScore = 1 - editDistance / Math.max(normalizedLeft.length, normalizedRight.length, 1);

  return Math.max(tokenScore, editScore);
}

function valuesAgree(values = []) {
  const filtered = values.filter((value) => value && value !== 'Unsure');
  return filtered.length === 2 && new Set(filtered).size === 1 ? filtered[0] : null;
}

function mapAssignmentToSheetCode(value) {
  if (value === 'Tony') return 't';
  if (value === 'Nugs') return 'n';
  if (value === 'Macquarie') return 'macq';
  return '';
}

export function buildResolvedAssignmentPool(transactions = [], submissions = {}) {
  return transactions
    .map((transaction) => {
      const submission = submissions[transaction.id] || {};
      const resolvedValue = valuesAgree([
        submission?.Tony?.value,
        submission?.Nugs?.value,
      ]);

      if (!resolvedValue) return null;

      return {
        id: transaction.id,
        date: transaction.date || null,
        amount: Math.abs(Number(transaction.amount || 0)),
        description: transaction.merchant || transaction.desc || '',
        assignment: resolvedValue,
        sheetCode: mapAssignmentToSheetCode(resolvedValue),
      };
    })
    .filter((item) => item && item.sheetCode);
}

function scoreCandidate(parsedTransaction, candidate) {
  const parsedAmount = Math.abs(Number(parsedTransaction.amount || 0));
  const candidateAmount = Math.abs(Number(candidate.amount || 0));
  const amountDiff = Math.abs(parsedAmount - candidateAmount);

  if (amountDiff > 0.01) return null;

  const descriptionScore = similarityScore(
    parsedTransaction.description,
    candidate.description
  );
  const sameDate = Boolean(parsedTransaction.date && candidate.date && parsedTransaction.date === candidate.date);
  const score = descriptionScore + (sameDate ? 0.35 : 0);

  return {
    candidate,
    score,
    sameDate,
    descriptionScore,
  };
}

export function matchAssignmentsToParsedTransactions(parsedTransactions = [], assignmentPool = []) {
  const matchedCandidateIds = new Set();

  return parsedTransactions.map((transaction) => {
    const candidates = assignmentPool
      .filter((candidate) => !matchedCandidateIds.has(candidate.id))
      .map((candidate) => scoreCandidate(transaction, candidate))
      .filter(Boolean)
      .sort((left, right) => right.score - left.score);

    const best = candidates[0];
    if (!best) {
      return {
        code: '',
        confidence: 0,
        matched: null,
      };
    }

    const confidentMatch =
      (best.sameDate && best.descriptionScore >= 0.45) ||
      best.descriptionScore >= 0.82;

    if (!confidentMatch) {
      return {
        code: '',
        confidence: Number(best.score.toFixed(3)),
        matched: null,
      };
    }

    matchedCandidateIds.add(best.candidate.id);
    return {
      code: best.candidate.sheetCode,
      confidence: Number(best.score.toFixed(3)),
      matched: best.candidate,
    };
  });
}
