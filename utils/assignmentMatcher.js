function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const PENDING_STATEMENT_DAYS_BEFORE_UPLOAD = 1;
const PENDING_STATEMENT_DAYS_AFTER_UPLOAD = 4;
const EXACT_DATE_SCORE_BONUS = 0.35;
const PENDING_WINDOW_SCORE_BONUS = 0.28;
const AMBIGUOUS_SCORE_GAP = 0.08;

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
  if (value === 'Split') return 'split';
  if (value === 'Macqbill') return 'macqbill';
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
        uploadedDay: transaction.uploadedDay || transaction.raw?.uploadedDay || null,
        isPending: Boolean(transaction.isPending),
        amount: Math.abs(Number(transaction.amount || 0)),
        description: transaction.merchant || transaction.desc || '',
        assignment: resolvedValue,
        sheetCode: mapAssignmentToSheetCode(resolvedValue),
      };
    })
    .filter((item) => item && item.sheetCode);
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function dateKeyToMs(value) {
  if (!isDateKey(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

function getSignedDayOffset(referenceDate, statementDate) {
  const referenceMs = dateKeyToMs(referenceDate);
  const statementMs = dateKeyToMs(statementDate);
  if (referenceMs === null || statementMs === null) return null;
  return Math.round((statementMs - referenceMs) / 86400000);
}

function getCandidateReferenceDate(candidate) {
  return candidate.uploadedDay || candidate.date || null;
}

function formatDayOffsetLabel(dayOffset) {
  if (dayOffset === 0) return 'same day';
  if (dayOffset > 0) return `+${dayOffset}d`;
  return `${dayOffset}d`;
}

function getDateMatch(parsedTransaction, candidate) {
  const statementDate = parsedTransaction.date || null;
  const candidateDate = candidate.date || null;
  const referenceDate = getCandidateReferenceDate(candidate);

  if (!statementDate || !referenceDate) {
    return {
      type: 'date_unavailable',
      bonus: 0,
      dayOffset: null,
      referenceDate,
      label: 'date unavailable',
    };
  }

  if (candidateDate && statementDate === candidateDate) {
    return {
      type: 'exact_date',
      bonus: EXACT_DATE_SCORE_BONUS,
      dayOffset: 0,
      referenceDate,
      label: 'same date',
    };
  }

  const dayOffset = getSignedDayOffset(referenceDate, statementDate);
  const inPendingWindow =
    candidate.isPending &&
    dayOffset !== null &&
    dayOffset >= -PENDING_STATEMENT_DAYS_BEFORE_UPLOAD &&
    dayOffset <= PENDING_STATEMENT_DAYS_AFTER_UPLOAD;

  if (inPendingWindow) {
    const penalty = Math.min(0.12, Math.max(0, Math.abs(dayOffset) - 1) * 0.03);
    return {
      type: 'pending_settlement_window',
      bonus: Number((PENDING_WINDOW_SCORE_BONUS - penalty).toFixed(3)),
      dayOffset,
      referenceDate,
      label: `pending ${formatDayOffsetLabel(dayOffset)}`,
    };
  }

  return {
    type: candidate.isPending ? 'outside_pending_window' : 'different_date',
    bonus: 0,
    dayOffset,
    referenceDate,
    label:
      dayOffset === null
        ? 'date mismatch'
        : `${candidate.isPending ? 'outside pending window' : 'different date'} ${formatDayOffsetLabel(dayOffset)}`,
  };
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
  const dateMatch = getDateMatch(parsedTransaction, candidate);
  const sameDate = dateMatch.type === 'exact_date';
  const score = descriptionScore + dateMatch.bonus;

  return {
    candidate,
    score,
    sameDate,
    dateMatch,
    descriptionScore,
  };
}

function isConfidentCandidate(candidateScore) {
  if (!candidateScore) return false;

  if (
    candidateScore.dateMatch.type === 'outside_pending_window' ||
    candidateScore.dateMatch.type === 'different_date'
  ) {
    return false;
  }

  if (candidateScore.dateMatch.type === 'exact_date') {
    return candidateScore.descriptionScore >= 0.45;
  }

  if (candidateScore.dateMatch.type === 'pending_settlement_window') {
    return candidateScore.descriptionScore >= 0.6;
  }

  return candidateScore.descriptionScore >= 0.82;
}

function isAmbiguousCandidate(best, nextBest) {
  if (!best || !nextBest) return false;
  if (!isConfidentCandidate(nextBest)) return false;
  if (best.score - nextBest.score > AMBIGUOUS_SCORE_GAP) return false;
  return best.candidate.sheetCode !== nextBest.candidate.sheetCode;
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
    const nextBest = candidates[1];
    if (!best) {
      return {
        code: '',
        confidence: 0,
        matched: null,
        matchType: 'no_candidate',
      };
    }

    if (!isConfidentCandidate(best)) {
      return {
        code: '',
        confidence: Number(best.score.toFixed(3)),
        matched: null,
        matchType: 'low_confidence',
        dateMatch: best.dateMatch,
        bestCandidate: best.candidate,
        descriptionScore: Number(best.descriptionScore.toFixed(3)),
      };
    }

    if (isAmbiguousCandidate(best, nextBest)) {
      return {
        code: '',
        confidence: Number(best.score.toFixed(3)),
        matched: null,
        matchType: 'ambiguous',
        dateMatch: best.dateMatch,
        bestCandidate: best.candidate,
        alternateCandidate: nextBest.candidate,
        descriptionScore: Number(best.descriptionScore.toFixed(3)),
      };
    }

    matchedCandidateIds.add(best.candidate.id);
    return {
      code: best.candidate.sheetCode,
      confidence: Number(best.score.toFixed(3)),
      matched: best.candidate,
      matchType: best.dateMatch.type,
      dateMatch: best.dateMatch,
      descriptionScore: Number(best.descriptionScore.toFixed(3)),
    };
  });
}
