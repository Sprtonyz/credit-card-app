function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAmount(value) {
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) return '0.00';
  return Number(amount).toFixed(2);
}

function normalizeDate(value) {
  return value ? String(value) : 'pending';
}

function normalizeFingerprintDate(transaction = {}) {
  return transaction.isPending || !transaction.date ? 'pending' : normalizeDate(transaction.date);
}

export function buildTransactionFingerprint(transaction = {}) {
  return [
    normalizeFingerprintDate(transaction),
    normalizeAmount(transaction.amount),
    normalizeText(transaction.merchant),
    transaction.isPending ? 'pending' : 'posted',
  ].join('|');
}

export function buildTransactionRowFingerprint(transaction = {}) {
  const merchant = normalizeText(transaction.merchant);
  const amount = normalizeAmount(transaction.amount);
  if (!merchant || amount === '0.00') return null;

  return [
    normalizeFingerprintDate(transaction),
    amount,
    merchant,
    transaction.isPending ? 'pending' : 'posted',
  ].join('|');
}

export function buildTransactionDedupeContext(transactions = [], index = 0, windowSize = 2) {
  const fingerprints = (transactions || []).map((transaction) =>
    transaction?.rowFingerprint || buildTransactionRowFingerprint(transaction)
  );

  const before = [];
  const after = [];

  for (let offset = 1; offset <= windowSize; offset += 1) {
    const previous = fingerprints[index - offset];
    const next = fingerprints[index + offset];

    if (previous) before.push(previous);
    if (next) after.push(next);
  }

  return { before, after };
}

export function enrichTransactionsWithImportContext(transactions = [], options = {}) {
  const { windowSize = 2 } = options;
  const withFingerprints = (transactions || []).map((transaction, index) => ({
    ...transaction,
    sequenceIndex:
      transaction?.sequenceIndex !== null &&
      transaction?.sequenceIndex !== undefined &&
      Number.isFinite(Number(transaction.sequenceIndex))
        ? Number(transaction.sequenceIndex)
        : index,
    rowFingerprint: transaction?.rowFingerprint || buildTransactionRowFingerprint(transaction),
  }));

  return withFingerprints.map((transaction, index) => ({
    ...transaction,
    dedupeNeighbors:
      transaction?.dedupeNeighbors || buildTransactionDedupeContext(withFingerprints, index, windowSize),
  }));
}

export function buildImageImportFingerprint(transactions = []) {
  const fingerprints = (transactions || [])
    .map((transaction) => buildTransactionFingerprint(transaction))
    .filter(Boolean)
    .sort();

  return fingerprints.join('||');
}

export function buildOrderedImageImportFingerprint(transactions = []) {
  return enrichTransactionsWithImportContext(transactions)
    .map((transaction) => transaction.rowFingerprint)
    .filter(Boolean)
    .join('>>');
}

export function buildImageRowContexts(transactions = []) {
  return enrichTransactionsWithImportContext(transactions).map((transaction, index) => ({
    rowFingerprint: transaction.rowFingerprint || null,
    sequenceIndex: Number.isFinite(Number(transaction.sequenceIndex)) ? Number(transaction.sequenceIndex) : index,
    merchant: transaction.merchant || null,
    amount: Number.isFinite(Number(transaction.amount)) ? Number(transaction.amount) : null,
    date: transaction.date || null,
    isPending: Boolean(transaction.isPending),
    before: transaction.dedupeNeighbors?.before || [],
    after: transaction.dedupeNeighbors?.after || [],
  }));
}

function hasSharedContext(left = {}, right = {}) {
  const beforeLeft = Array.isArray(left.before) ? left.before.filter(Boolean) : [];
  const beforeRight = Array.isArray(right.before) ? right.before.filter(Boolean) : [];
  const afterLeft = Array.isArray(left.after) ? left.after.filter(Boolean) : [];
  const afterRight = Array.isArray(right.after) ? right.after.filter(Boolean) : [];

  const beforeOverlap = beforeLeft.some((fingerprint) => beforeRight.includes(fingerprint));
  const afterOverlap = afterLeft.some((fingerprint) => afterRight.includes(fingerprint));

  return {
    beforeOverlap,
    afterOverlap,
    hasOverlap: beforeOverlap || afterOverlap,
    hasStrongOverlap: beforeOverlap && afterOverlap,
  };
}

export function findProcessedRowMatch(transaction = {}, processedLogs = {}) {
  const rowFingerprint = transaction?.rowFingerprint || buildTransactionRowFingerprint(transaction);
  if (!rowFingerprint) return null;

  const transactionContext = {
    before: transaction?.dedupeNeighbors?.before || [],
    after: transaction?.dedupeNeighbors?.after || [],
  };

  for (const [imageHash, log] of Object.entries(processedLogs || {})) {
    const rowContexts = Array.isArray(log?.rowContexts) ? log.rowContexts : [];
    const rowMatch = rowContexts.find((row) => row?.rowFingerprint === rowFingerprint);
    if (!rowMatch) continue;

    const contextMatch = hasSharedContext(transactionContext, rowMatch);
    if (!contextMatch.hasStrongOverlap) continue;

    return {
      key: imageHash,
      log,
      matchType: 'row_context_strong',
      row: rowMatch,
      contextMatch,
    };
  }

  return null;
}

export function findProcessedLogMatch(transaction = {}, processedLogs = {}) {
  const imageHash = transaction?.imageHash || null;
  const imageFingerprint = transaction?.imageFingerprint || null;

  if (imageHash && processedLogs[imageHash]) {
    return {
      key: imageHash,
      log: processedLogs[imageHash],
      matchType: 'hash',
    };
  }

  if (!imageFingerprint) return null;

  const matchEntry = Object.entries(processedLogs || {}).find(([, log]) => {
    return log?.imageFingerprint && log.imageFingerprint === imageFingerprint;
  });

  if (!matchEntry) return null;

  return {
    key: matchEntry[0],
    log: matchEntry[1],
    matchType: 'fingerprint',
  };
}

export function buildProcessedImageDebug(processedImages = [], processedLogs = {}, existingTransactions = []) {
  return (processedImages || []).map((image) => {
    const sameHashTransactions = (existingTransactions || []).filter(
      (transaction) => transaction?.imageHash && image?.imageHash && transaction.imageHash === image.imageHash
    );
    const match = findProcessedLogMatch(
      {
        imageHash: image?.imageHash || null,
        imageFingerprint: image?.imageFingerprint || null,
      },
      processedLogs
    );

    return {
      imageName: image?.fileName || 'Unknown image',
      imageHash: image?.imageHash || null,
      imageFingerprint: image?.imageFingerprint || null,
      orderedImageFingerprint: image?.orderedImageFingerprint || null,
      transactionCount: Array.isArray(image?.transactions) ? image.transactions.length : 0,
      processedMatchType: match?.matchType || null,
      matchedProcessedKey: match?.key || null,
      matchedUploadDay: match?.log?.uploadDay || null,
      matchedImageName: match?.log?.imageName || null,
      recoveredFromTransactions: Boolean(match?.log?.recoveredFromTransactions),
      processedLogHasExactHash:
        Boolean(image?.imageHash) && Object.prototype.hasOwnProperty.call(processedLogs || {}, image.imageHash),
      sameHashTransactionCount: sameHashTransactions.length,
      sameHashMerchants: sameHashTransactions.slice(0, 6).map((transaction) => transaction.merchant || 'Unknown'),
    };
  });
}

export function enrichProcessedLogsWithFingerprints(processedLogs = {}, existingTransactions = []) {
  const transactionsByImageHash = (existingTransactions || []).reduce((acc, transaction) => {
    const imageHash = transaction?.imageHash;
    if (!imageHash) return acc;

    if (!acc[imageHash]) {
      acc[imageHash] = [];
    }

    acc[imageHash].push(transaction);
    return acc;
  }, {});

  const enriched = Object.entries(processedLogs || {}).reduce((acc, [imageHash, log]) => {
    const imageTransactions = transactionsByImageHash[imageHash] || [];
    acc[imageHash] = {
      ...log,
      imageFingerprint:
        log?.imageFingerprint || (imageTransactions.length > 0 ? buildImageImportFingerprint(imageTransactions) : null),
      orderedImageFingerprint:
        log?.orderedImageFingerprint ||
        (imageTransactions.length > 0 ? buildOrderedImageImportFingerprint(imageTransactions) : null),
      rowContexts:
        Array.isArray(log?.rowContexts) && log.rowContexts.length > 0
          ? log.rowContexts
          : buildImageRowContexts(imageTransactions),
    };
    return acc;
  }, {});

  Object.entries(transactionsByImageHash).forEach(([imageHash, imageTransactions]) => {
    if (enriched[imageHash]) return;

    const firstTransaction = imageTransactions[0] || {};
    enriched[imageHash] = {
      uploadDate: firstTransaction.uploadedDate || null,
      uploadDay: firstTransaction.uploadedDay || firstTransaction.date || null,
      extractedCount: imageTransactions.length,
      transactions: imageTransactions.map((transaction) => transaction.id).filter(Boolean),
      imageName: firstTransaction.imageName || 'Recovered from imported transactions',
      imageFingerprint: buildImageImportFingerprint(imageTransactions),
      orderedImageFingerprint: buildOrderedImageImportFingerprint(imageTransactions),
      rowContexts: buildImageRowContexts(imageTransactions),
      recoveredFromTransactions: true,
    };
  });

  return enriched;
}
