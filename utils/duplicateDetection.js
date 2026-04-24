import Fuse from 'fuse.js';

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function calculateSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;

  const s1 = normalizeText(str1);
  const s2 = normalizeText(str2);

  if (s1 === s2) return 100;

  const fuse = new Fuse([s1], {
    includeScore: true,
    threshold: 0.4,
  });

  const results = fuse.search(s2);
  if (results.length > 0) {
    return Math.round((1 - results[0].score) * 100);
  }

  return 0;
}

function normalizeDateKey(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.toISOString().slice(0, 10);
}

function normalizeAmountKey(value) {
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) return null;
  return Math.abs(amount).toFixed(2);
}

function buildMerchantAmountKey(tx) {
  const amountKey = normalizeAmountKey(tx?.amount);
  const merchantKey = normalizeText(tx?.merchant);
  if (!amountKey || !merchantKey) return null;
  return `${merchantKey}|${amountKey}`;
}

function buildTransactionKey(tx) {
  const amountKey = normalizeAmountKey(tx.amount);
  const merchantKey = normalizeText(tx.merchant);
  const dateKey = normalizeDateKey(tx.date);

  if (!amountKey || !merchantKey) return null;

  return [dateKey || 'no-date', amountKey, merchantKey].join('|');
}

function getContextNeighbors(tx) {
  const before = Array.isArray(tx?.dedupeNeighbors?.before)
    ? tx.dedupeNeighbors.before.filter(Boolean)
    : [];
  const after = Array.isArray(tx?.dedupeNeighbors?.after)
    ? tx.dedupeNeighbors.after.filter(Boolean)
    : [];

  return { before, after };
}

function hasContextOverlap(tx1, tx2) {
  const context1 = getContextNeighbors(tx1);
  const context2 = getContextNeighbors(tx2);

  const beforeOverlap = context1.before.some((value) => context2.before.includes(value));
  const afterOverlap = context1.after.some((value) => context2.after.includes(value));

  return beforeOverlap || afterOverlap;
}

function getDuplicateMatch(tx1, tx2, merchantThreshold = 90) {
  if (Math.abs(parseFloat(tx1.amount) - parseFloat(tx2.amount)) > 0.01) {
    return null;
  }

  const merchantSimilarity = calculateSimilarity(tx1.merchant, tx2.merchant);
  if (merchantSimilarity < merchantThreshold) {
    return null;
  }

  const date1 = normalizeDateKey(tx1.date);
  const date2 = normalizeDateKey(tx2.date);

  if (date1 && date2 && date1 !== date2) {
    return null;
  }

  if (!date1 || !date2) {
    // When OCR cannot confidently recover a date, only auto-collapse rows if
    // they come from the same source line or their surrounding neighbors look
    // like the same overlapping screenshot region.
    if (!isSameSource(tx1, tx2) && !hasContextOverlap(tx1, tx2)) {
      return null;
    }
  }

  if (tx1.category && tx2.category) {
    const categorySimilarity = calculateSimilarity(tx1.category, tx2.category);
    if (categorySimilarity < 80) {
      return null;
    }
  }

  return {
    match: true,
    reason: date1 && date2 ? 'same_day_match' : 'date_missing_match',
  };
}

function isSameSource(tx1, tx2) {
  if (tx1.imageHash && tx2.imageHash && tx1.imageHash === tx2.imageHash) {
    return true;
  }

  const rawLine1 = normalizeText(tx1.rawLine);
  const rawLine2 = normalizeText(tx2.rawLine);
  return rawLine1 && rawLine1 === rawLine2;
}

export function detectDuplicates(transactions) {
  const duplicates = [];
  const unique = [];
  const processed = new Set();
  const seenKeys = new Map();

  for (let i = 0; i < transactions.length; i++) {
    if (processed.has(i)) continue;

    const current = transactions[i];
    const currentKey = buildTransactionKey(current);
    const group = [{ index: i, transaction: current }];

    for (let j = i + 1; j < transactions.length; j++) {
      if (processed.has(j)) continue;

      const match = getDuplicateMatch(current, transactions[j]);
      if (!match) continue;

      const candidateKey = buildTransactionKey(transactions[j]);
      if (match.match && currentKey && candidateKey) {
        group.push({ index: j, transaction: transactions[j] });
        processed.add(j);
      }
    }

    processed.add(i);

    if (group.length > 1) {
      duplicates.push(group);
    } else if (currentKey && !seenKeys.has(currentKey)) {
      unique.push({ index: i, transaction: current });
      seenKeys.set(currentKey, i);
    }
  }

  return {
    unique,
    duplicates,
    summary: {
      total: transactions.length,
      uniqueCount: unique.length,
      duplicateGroups: duplicates.length,
    },
  };
}

export function detectDuplicatesAcrossImages(processedImages) {
  const allTransactions = [];
  const imageMap = {};
  const CONTEXT_WINDOW = 2;

  processedImages.forEach((image, imageIdx) => {
    const imageTransactions = image.transactions || [];

    imageTransactions.forEach((tx, txIdx) => {
      const idx = allTransactions.length;
      const before = [];
      const after = [];

      for (let offset = 1; offset <= CONTEXT_WINDOW; offset += 1) {
        const previousTx = imageTransactions[txIdx - offset];
        const nextTx = imageTransactions[txIdx + offset];

        if (previousTx) before.push(buildMerchantAmountKey(previousTx));
        if (nextTx) after.push(buildMerchantAmountKey(nextTx));
      }

      allTransactions.push({
        ...tx,
        dedupeNeighbors: {
          before,
          after,
        },
      });
      imageMap[idx] = {
        imageIndex: imageIdx,
        imageName: image.fileName,
        imageHash: image.imageHash,
      };
    });
  });

  const detection = detectDuplicates(allTransactions);

  return {
    unique: detection.unique.map((item) => ({
      ...item,
      imageSource: imageMap[item.index],
    })),
    duplicates: detection.duplicates.map((group) => ({
      group: group.map((item) => ({
        ...item,
        imageSource: imageMap[item.index],
      })),
    })),
    summary: detection.summary,
    imageCount: processedImages.length,
  };
}

export function selectTransactionsFromDuplicates(allTransactions, selectedIndices) {
  const selected = new Set(selectedIndices);
  return allTransactions.filter((tx, idx) => selected.has(idx));
}

export function getKeptTransactionIndices(detection) {
  const kept = new Set();

  (detection?.unique || []).forEach((item) => {
    kept.add(item.index);
  });

  (detection?.duplicates || []).forEach((group) => {
    if (Array.isArray(group) && group[0]) {
      kept.add(group[0].index);
    } else if (group?.group?.[0]) {
      kept.add(group.group[0].index);
    }
  });

  return Array.from(kept).sort((a, b) => a - b);
}
