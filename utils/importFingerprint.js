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

export function buildTransactionFingerprint(transaction = {}) {
  return [
    normalizeDate(transaction.date),
    normalizeAmount(transaction.amount),
    normalizeText(transaction.merchant),
    transaction.isPending ? 'pending' : 'posted',
  ].join('|');
}

export function buildImageImportFingerprint(transactions = []) {
  const fingerprints = (transactions || [])
    .map((transaction) => buildTransactionFingerprint(transaction))
    .filter(Boolean)
    .sort();

  return fingerprints.join('||');
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
      recoveredFromTransactions: true,
    };
  });

  return enriched;
}
