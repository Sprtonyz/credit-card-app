import { getTodayDate } from '../services/firebaseService';
import {
  buildDecisionTrace,
  formatDecisionExplanation,
  scoreTransactionConfidence,
  summarizeDecisionCounts,
} from './importTrust';
import { findProcessedLogMatch } from './importFingerprint';
import { shiftDateKey } from './simulationDate';

const MERCHANT_STOP_WORDS = new Set([
  'au',
  'notau',
  'australia',
  'pending',
  'posted',
  'category',
  'in',
  'progress',
]);
const RECENT_PENDING_DUPLICATE_DAYS = 3;

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeMerchant(value) {
  return normalizeText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token && !MERCHANT_STOP_WORDS.has(token));
}

function normalizeMerchantToken(token) {
  return String(token || '')
    .toLowerCase()
    .replace(/0/g, 'o')
    .replace(/[1|]/g, 'i')
    .replace(/5/g, 's')
    .replace(/[^a-z0-9]/g, '');
}

function getEditDistance(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  const rows = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));

  for (let i = 0; i <= left.length; i += 1) rows[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) rows[0][j] = j;

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + cost
      );
    }
  }

  return rows[left.length][right.length];
}

function tokensLookSimilar(a, b) {
  const left = normalizeMerchantToken(a);
  const right = normalizeMerchantToken(b);

  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;

  const maxLength = Math.max(left.length, right.length);
  const editDistance = getEditDistance(left, right);

  if (maxLength <= 4) return editDistance === 1;
  if (maxLength <= 8) return editDistance <= 1;
  return editDistance <= 2;
}

function normalizeAmountKey(value) {
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) return null;
  return Math.abs(amount).toFixed(2);
}

function normalizeMerchantKey(value) {
  const tokens = tokenizeMerchant(value);
  if (tokens.length === 0) return normalizeText(value);
  return tokens.join(' ');
}

function calculateMerchantSimilarity(left, right) {
  const normalizedLeft = normalizeMerchantToken(normalizeMerchantKey(left));
  const normalizedRight = normalizeMerchantToken(normalizeMerchantKey(right));

  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 100;
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) return 97;

  const maxLength = Math.max(normalizedLeft.length, normalizedRight.length);
  const editDistance = getEditDistance(normalizedLeft, normalizedRight);
  return Math.max(0, Math.round((1 - editDistance / maxLength) * 100));
}

function buildTransactionKey(tx) {
  const amountKey = normalizeAmountKey(tx.amount);
  const merchantKey = normalizeMerchantKey(tx.merchant);
  const dateKey = tx.date || null;

  if (!amountKey || !merchantKey || !dateKey) return null;

  return [dateKey, amountKey, merchantKey].join('|');
}

function getReferenceDateKey(tx) {
  return tx.uploadedDay || tx.date || null;
}

function dateKeyToMs(value) {
  if (!value) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

function getDateKeyDistance(left, right) {
  const leftMs = dateKeyToMs(left);
  const rightMs = dateKeyToMs(right);
  if (leftMs === null || rightMs === null) return null;
  return Math.abs(Math.round((leftMs - rightMs) / 86400000));
}

function haveComparableDates(newTx, existingTx) {
  // Be conservative with pending rows so recurring merchants with the same
  // amount on different days are not auto-collapsed as duplicates.
  if (newTx.isPending || existingTx.isPending) {
    const newReferenceDate = getReferenceDateKey(newTx);
    const existingReferenceDate = getReferenceDateKey(existingTx);

    if (!newReferenceDate || !existingReferenceDate) return false;
    if (newReferenceDate === existingReferenceDate) return true;

    const newDateWasExplicit = Boolean(newTx.rawParsed?.date || newTx.originalDate);
    const existingDateWasExplicit = Boolean(existingTx.rawParsed?.date || existingTx.originalDate);
    const dayDistance = getDateKeyDistance(newReferenceDate, existingReferenceDate);

    if (dayDistance === null) return false;

    // Pending rows often reappear across a couple of days with no explicit
    // transaction date in the screenshot. Allow a small recent window so the
    // same unresolved pending charge can still be recognized.
    if (!newDateWasExplicit && !existingDateWasExplicit && dayDistance <= RECENT_PENDING_DUPLICATE_DAYS) {
      return true;
    }

    if (!newDateWasExplicit && dayDistance <= 1) {
      return true;
    }

    return false;
  }

  if (newTx.date && existingTx.date) {
    return newTx.date === existingTx.date;
  }

  return false;
}

function merchantLooksSame(newTx, existingTx) {
  const newMerchant = normalizeMerchantKey(newTx.merchant);
  const existingMerchant = normalizeMerchantKey(existingTx.merchant);

  if (!newMerchant || !existingMerchant) return false;
  if (newMerchant === existingMerchant) return true;
  if (newMerchant.includes(existingMerchant) || existingMerchant.includes(newMerchant)) return true;

  const newTokens = tokenizeMerchant(newTx.merchant);
  const existingTokens = tokenizeMerchant(existingTx.merchant);
  if (newTokens.length === 0 || existingTokens.length === 0) return false;

  const sharedTokens = newTokens.filter((token) =>
    existingTokens.some((existingToken) => tokensLookSimilar(token, existingToken))
  );
  const shorterLength = Math.min(newTokens.length, existingTokens.length);

  if (sharedTokens.length >= 2 && sharedTokens.length >= shorterLength - 1) {
    return true;
  }

  const normalizedNew = normalizeMerchantToken(newMerchant);
  const normalizedExisting = normalizeMerchantToken(existingMerchant);
  if (!normalizedNew || !normalizedExisting) return false;

  const maxLength = Math.max(normalizedNew.length, normalizedExisting.length);
  const editDistance = getEditDistance(normalizedNew, normalizedExisting);

  if (maxLength <= 10) return editDistance <= 2;
  return editDistance <= 3;
}

function findExistingMatch(newTx, existingTxs) {
  const newAmountKey = normalizeAmountKey(newTx.amount);
  if (!newAmountKey) return null;

  let bestMatch = null;

  existingTxs.forEach((existing) => {
    const existingAmountKey = normalizeAmountKey(existing.amount);
    if (!existingAmountKey || existingAmountKey !== newAmountKey) return;
    if (!haveComparableDates(newTx, existing)) return;
    if (!merchantLooksSame(newTx, existing)) return;

    const exactMerchant = normalizeMerchantKey(newTx.merchant) === normalizeMerchantKey(existing.merchant);
    const merchantSimilarity = calculateMerchantSimilarity(newTx.merchant, existing.merchant);
    const matchType = exactMerchant ? 'exact' : 'fuzzy';
    const score = merchantSimilarity + (exactMerchant ? 5 : 0) + (newTx.date && existing.date ? 3 : 0);
    const candidate = {
      id: existing.id || null,
      merchant: existing.merchant || null,
      date: existing.date || null,
      uploadedDay: existing.uploadedDay || null,
      amount: Number(existing.amount || 0),
      matchType,
      merchantSimilarity,
      isPending: Boolean(existing.isPending),
      score,
    };

    if (!bestMatch || candidate.score > bestMatch.score) {
      bestMatch = candidate;
    }
  });

  return bestMatch;
}

function isAmbiguousExistingMatch(tx, existingMatch) {
  if (!existingMatch) return false;
  if (existingMatch.matchType === 'exact') return false;
  if (tx.adminReviewApproved) return false;
  if (tx.isPending || !tx.rawParsed?.date) return true;
  return existingMatch.merchantSimilarity < 97;
}

function buildDecision(transaction, partialDecision) {
  const confidence = partialDecision.confidence || scoreTransactionConfidence(transaction, partialDecision);
  const decision = {
    transaction,
    outcome: partialDecision.outcome,
    reasonCode: partialDecision.reasonCode,
    existingMatch: partialDecision.existingMatch || null,
    duplicateMatch: partialDecision.duplicateMatch || null,
    processedDay: partialDecision.processedDay || null,
    processedDate: partialDecision.processedDate || null,
    confidence,
  };

  decision.explanation = partialDecision.explanation || formatDecisionExplanation(decision);
  decision.trace = buildDecisionTrace(transaction, decision);

  return decision;
}

export function mergeTransactions(
  newTransactions,
  existingTransactions = [],
  processedLog = {}
) {
  const toAdd = [];
  const skipped = [];
  const flagged = [];
  const decisions = [];
  const today = getTodayDate();
  const batchKeys = new Set();

  for (const tx of newTransactions) {
    const txWithDate = {
      ...tx,
      date: tx.date || today,
      isPending: tx.isPending || !tx.date,
    };
    const txKey = buildTransactionKey(txWithDate);

    const processedMatch = findProcessedLogMatch(txWithDate, processedLog);
    if (processedMatch) {
      const decision = buildDecision(txWithDate, {
        outcome: 'skipped',
        reasonCode: 'already_processed',
        processedDay: processedMatch.log?.uploadDay,
        processedDate: processedMatch.log?.uploadDate,
      });
      skipped.push({
        transaction: txWithDate,
        reason: 'already_processed',
        processedDate: processedMatch.log?.uploadDate,
        processedDay: processedMatch.log?.uploadDay,
        processedMatchType: processedMatch.matchType,
        explanation: decision.explanation,
        confidence: decision.confidence,
        trace: decision.trace,
      });
      decisions.push(decision);
      continue;
    }

    if (txKey && batchKeys.has(txKey)) {
      const decision = buildDecision(txWithDate, {
        outcome: 'skipped',
        reasonCode: 'duplicate_in_upload',
        duplicateMatch: tx.duplicateMatch || null,
      });
      skipped.push({
        transaction: txWithDate,
        reason: 'duplicate_in_upload',
        explanation: decision.explanation,
        confidence: decision.confidence,
        trace: decision.trace,
      });
      decisions.push(decision);
      continue;
    }

    const existingMatch = findExistingMatch(txWithDate, existingTransactions);
    if (existingMatch && isAmbiguousExistingMatch(txWithDate, existingMatch)) {
      const decision = buildDecision(txWithDate, {
        outcome: 'flagged',
        reasonCode: 'flagged_for_review',
        existingMatch,
      });
      flagged.push({
        transaction: txWithDate,
        reason: 'flagged_for_review',
        existingMatch,
        explanation: decision.explanation,
        confidence: decision.confidence,
        trace: decision.trace,
      });
      decisions.push(decision);
      continue;
    }

    if (existingMatch) {
      const decision = buildDecision(txWithDate, {
        outcome: 'skipped',
        reasonCode: 'already_exists_overlap',
        existingMatch,
      });
      skipped.push({
        transaction: txWithDate,
        reason: 'already_exists_overlap',
        existingMatch,
        explanation: decision.explanation,
        confidence: decision.confidence,
        trace: decision.trace,
      });
      decisions.push(decision);
      continue;
    }

    if (txWithDate.isPending) {
      const yesterdayStr = shiftDateKey(today, -1);

      const existsYesterday = existingTransactions.find(
        (existing) =>
          existing.date === yesterdayStr &&
          Math.abs(parseFloat(txWithDate.amount) - parseFloat(existing.amount)) < 0.01 &&
          (existing.merchant || '').toUpperCase() === (txWithDate.merchant || '').toUpperCase()
      );

      if (existsYesterday) {
        const decision = buildDecision(txWithDate, {
          outcome: 'skipped',
          reasonCode: 'already_exists_yesterday',
          existingMatch: {
            merchant: existsYesterday.merchant || null,
            date: existsYesterday.date || yesterdayStr,
            uploadedDay: existsYesterday.uploadedDay || null,
            amount: Number(existsYesterday.amount || 0),
            matchType: 'exact',
            merchantSimilarity: 100,
          },
        });
        skipped.push({
          transaction: txWithDate,
          reason: 'already_exists_yesterday',
          explanation: decision.explanation,
          confidence: decision.confidence,
          trace: decision.trace,
        });
        decisions.push(decision);
        continue;
      }
    }

    if (txKey) {
      batchKeys.add(txKey);
    }
    toAdd.push(txWithDate);
    decisions.push(
      buildDecision(txWithDate, {
        outcome: 'import_ready',
        reasonCode: 'ready_to_import',
      })
    );
  }

  const decisionSummary = summarizeDecisionCounts(decisions);

  return {
    toAdd,
    skipped,
    flagged,
    decisions,
    summary: {
      newTransactions: newTransactions.length,
      toAdd: toAdd.length,
      skipped: skipped.length,
      flagged: flagged.length,
      skippedByReason: {
        already_processed: skipped.filter((s) => s.reason === 'already_processed').length,
        duplicate_in_upload: skipped.filter((s) => s.reason === 'duplicate_in_upload').length,
        already_exists_overlap: skipped.filter((s) => s.reason === 'already_exists_overlap').length,
        already_exists_yesterday: skipped.filter((s) => s.reason === 'already_exists_yesterday').length,
      },
      flaggedByReason: {
        flagged_for_review: flagged.filter((item) => item.reason === 'flagged_for_review').length,
      },
      decisionSummary,
    },
  };
}

export function filterYesterdaysDuplicates(transactions, yesterdaysPending = []) {
  if (!yesterdaysPending || yesterdaysPending.length === 0) {
    return transactions;
  }

  return transactions.filter((tx) => {
    if (tx.date && tx.date !== getTodayDate()) {
      return true;
    }

    const matchesYesterday = yesterdaysPending.some(
      (yesterday) =>
        Math.abs(parseFloat(tx.amount) - parseFloat(yesterday.amount)) < 0.01 &&
        (tx.merchant || '').toUpperCase() === (yesterday.merchant || '').toUpperCase()
    );

    return !matchesYesterday;
  });
}

export function prepareForFirebase(transactions, source = 'image') {
  return transactions.map((tx) => ({
    merchant: tx.merchant,
    amount: tx.amount,
    category: tx.category || null,
    date: tx.date,
    isPending: tx.isPending || false,
    isRefund: Boolean(tx.isRefund) || Number(tx.amount) < 0,
    source: source,
    imageHash: tx.imageHash || null,
  }));
}
