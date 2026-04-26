function roundScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toTitleCase(value) {
  return String(value || '')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function getConfidenceLevel(score) {
  if (score >= 75) return 'high';
  if (score >= 45) return 'medium';
  return 'low';
}

export function scoreTransactionConfidence(transaction, context = {}) {
  const signals = [];
  let score = 50;

  const rawLine = String(transaction?.rawLine || '').trim();
  const merchant = String(transaction?.merchant || '').trim();
  const rawMerchant = String(transaction?.rawParsed?.merchant || '').trim();
  const rawAmountText = String(transaction?.rawAmountText || '').trim();
  const normalizedDate = transaction?.date || null;
  const originalDate = transaction?.rawParsed?.date || null;
  const normalization = transaction?.normalization || {};
  const duplicateMatch = context?.duplicateMatch || null;
  const existingMatch = context?.existingMatch || null;

  if (merchant.length >= 4) {
    score += 18;
    signals.push({
      key: 'merchant_present',
      impact: 'positive',
      label: 'Merchant text was extracted cleanly.',
    });
  } else {
    score -= 28;
    signals.push({
      key: 'merchant_weak',
      impact: 'negative',
      label: 'Merchant text is short or incomplete.',
    });
  }

  if (Number.isFinite(Number(transaction?.amount))) {
    score += 16;
    signals.push({
      key: 'amount_present',
      impact: 'positive',
      label: 'Amount was parsed into a numeric value.',
    });
  } else {
    score -= 32;
    signals.push({
      key: 'amount_missing',
      impact: 'negative',
      label: 'Amount could not be parsed confidently.',
    });
  }

  if (/[.,]\d{2}$/.test(rawAmountText)) {
    score += 8;
    signals.push({
      key: 'amount_explicit_cents',
      impact: 'positive',
      label: 'Amount included explicit cents in the OCR text.',
    });
  } else if (rawAmountText) {
    score -= 10;
    signals.push({
      key: 'amount_reformatted',
      impact: 'negative',
      label: 'Amount needed cleanup before it looked valid.',
    });
  }

  if (originalDate && normalizedDate) {
    score += 12;
    signals.push({
      key: 'date_explicit',
      impact: 'positive',
      label: 'Date was read directly from the screenshot.',
    });
  } else if (transaction?.isPending || !normalizedDate) {
    score -= 18;
    signals.push({
      key: 'date_inferred',
      impact: 'negative',
      label: 'Date was missing or inferred from upload context.',
    });
  }

  if (normalization.merchantChanged) {
    score -= 8;
    signals.push({
      key: 'merchant_normalized',
      impact: 'negative',
      label: 'Merchant text needed OCR cleanup.',
    });
  }

  if (normalization.amountChanged) {
    score -= 6;
    signals.push({
      key: 'amount_normalized',
      impact: 'negative',
      label: 'Amount formatting was corrected after OCR.',
    });
  }

  if (rawLine && merchant) {
    const rawNormalized = normalizeText(rawLine);
    const merchantNormalized = normalizeText(merchant);
    if (rawNormalized && merchantNormalized && !rawNormalized.includes(merchantNormalized)) {
      score -= 7;
      signals.push({
        key: 'raw_line_mismatch',
        impact: 'negative',
        label: 'Final merchant text differs from the raw OCR line.',
      });
    }
  }

  if (transaction?.parserProfile === 'itemized') {
    score += 6;
    signals.push({
      key: 'itemized_parser',
      impact: 'positive',
      label: 'Structured itemized layout was detected.',
    });
  }

  if (transaction?.lineGap === 'wrapped') {
    score -= 5;
    signals.push({
      key: 'wrapped_line',
      impact: 'negative',
      label: 'The transaction had to be reconstructed across multiple OCR lines.',
    });
  }

  if (transaction?.isRefund) {
    score -= 4;
    signals.push({
      key: 'refund_ambiguity',
      impact: 'negative',
      label: 'Refund or credit rows can be harder to reconcile automatically.',
    });
  }

  if (duplicateMatch?.merchantSimilarity && duplicateMatch.merchantSimilarity < 98) {
    score -= 12;
    signals.push({
      key: 'fuzzy_duplicate_match',
      impact: 'negative',
      label: 'Duplicate detection relied on a fuzzy merchant match.',
    });
  }

  if (duplicateMatch?.reason === 'date_missing_match') {
    score -= 10;
    signals.push({
      key: 'duplicate_missing_date',
      impact: 'negative',
      label: 'Duplicate detection had to work without both dates present.',
    });
  }

  if (existingMatch?.matchType === 'fuzzy') {
    score -= 14;
    signals.push({
      key: 'fuzzy_existing_match',
      impact: 'negative',
      label: 'The best existing match is similar, but not exact.',
    });
  }

  const finalScore = roundScore(score);
  return {
    score: finalScore,
    level: getConfidenceLevel(finalScore),
    signals,
    summary: signals.slice(0, 3).map((signal) => signal.label),
  };
}

export function buildDecisionTrace(transaction, decision = {}) {
  const normalization = transaction?.normalization || {};
  const existingMatch = decision?.existingMatch || null;
  const duplicateMatch = decision?.duplicateMatch || null;

  return {
    rawOcrLine: transaction?.rawLine || null,
    parsed: {
      merchant: transaction?.rawParsed?.merchant || transaction?.merchant || null,
      amountText: transaction?.rawParsed?.amountText || transaction?.rawAmountText || null,
      date: transaction?.rawParsed?.date || null,
    },
    normalized: {
      merchant: transaction?.merchant || null,
      amount: Number.isFinite(Number(transaction?.amount)) ? Number(transaction.amount) : null,
      date: transaction?.date || null,
      pending: Boolean(transaction?.isPending),
      changes: [
        normalization.merchantChanged ? 'merchant cleaned up' : null,
        normalization.amountChanged ? 'amount reformatted' : null,
        normalization.dateChanged ? 'date normalized' : null,
      ].filter(Boolean),
    },
    duplicateEvaluation: duplicateMatch
      ? {
          reason: duplicateMatch.reason || null,
          merchantSimilarity: duplicateMatch.merchantSimilarity ?? null,
          sameSource: duplicateMatch.sameSource ?? null,
        }
      : null,
    existingMatch: existingMatch
      ? {
          merchant: existingMatch.merchant || null,
          date: existingMatch.date || null,
          amount: existingMatch.amount ?? null,
          uploadedDay: existingMatch.uploadedDay || null,
          matchType: existingMatch.matchType || null,
          merchantSimilarity: existingMatch.merchantSimilarity ?? null,
        }
      : null,
    finalDecision: {
      outcome: decision.outcome || null,
      reasonCode: decision.reasonCode || null,
      explanation: decision.explanation || null,
    },
  };
}

export function formatDecisionExplanation(decision = {}) {
  const reasonCode = decision.reasonCode || decision.reason || null;
  const tx = decision.transaction || {};
  const existingMatch = decision.existingMatch || null;
  const duplicateMatch = decision.duplicateMatch || null;
  const imageName = tx.imageName || tx.imageSource?.imageName || decision.imageName || null;

  if (reasonCode === 'already_processed') {
    const processedDay = decision.processedDay || decision.processedDate || null;
    return processedDay
      ? `Skipped because this screenshot appears to have already been imported on ${processedDay}.`
      : 'Skipped because this screenshot appears to have already been imported already.';
  }

  if (reasonCode === 'duplicate_in_upload') {
    return duplicateMatch?.merchantSimilarity && duplicateMatch.merchantSimilarity < 98
      ? 'Flagged because another item in this upload looks very similar, but the match is fuzzy.'
      : 'Skipped because another item in this upload appears to be the same transaction.';
  }

  if (reasonCode === 'already_exists_overlap') {
    if (existingMatch) {
      const merchant = existingMatch.merchant ? toTitleCase(existingMatch.merchant) : 'an existing transaction';
      const date = existingMatch.date || existingMatch.uploadedDay || 'a previous upload';
      return `Skipped because a matching transaction already exists for ${date} (${merchant}, $${Number(existingMatch.amount || 0).toFixed(2)}).`;
    }
    return 'Skipped because a matching transaction already exists.';
  }

  if (reasonCode === 'already_exists_yesterday') {
    return 'Skipped because a pending transaction from yesterday already appears to match this row.';
  }

  if (reasonCode === 'flagged_for_review') {
    if (existingMatch?.matchType === 'fuzzy') {
      return 'Flagged for review because the existing match is fuzzy and should be confirmed by an admin.';
    }

    if (duplicateMatch?.reason === 'date_missing_match') {
      return 'Flagged for review because the duplicate match depends on a missing or inferred date.';
    }

    return 'Flagged for review because this transaction is not confident enough to auto-decide.';
  }

  if (reasonCode === 'ready_to_import') {
    return imageName
      ? `Ready to import from ${imageName}.`
      : 'Ready to import.';
  }

  return 'Decision available for review.';
}

export function summarizeDecisionCounts(decisions = []) {
  return decisions.reduce(
    (acc, decision) => {
      const outcome = decision?.outcome || 'unknown';
      const reasonCode = decision?.reasonCode || 'unknown';

      acc.total += 1;
      acc.byOutcome[outcome] = (acc.byOutcome[outcome] || 0) + 1;
      acc.byReason[reasonCode] = (acc.byReason[reasonCode] || 0) + 1;

      return acc;
    },
    {
      total: 0,
      byOutcome: {},
      byReason: {},
    }
  );
}
