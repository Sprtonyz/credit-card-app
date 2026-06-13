import Fuse from 'fuse.js';
import {
  buildImageRowContexts,
  buildOrderedImageImportFingerprint,
  buildTransactionRowFingerprint,
  enrichTransactionsWithImportContext,
} from './importFingerprint.js';

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

function getContextOverlapDetails(tx1, tx2) {
  const context1 = getContextNeighbors(tx1);
  const context2 = getContextNeighbors(tx2);

  const beforeOverlap = context1.before.some((value) => context2.before.includes(value));
  const afterOverlap = context1.after.some((value) => context2.after.includes(value));

  return {
    beforeOverlap,
    afterOverlap,
    hasOverlap: beforeOverlap || afterOverlap,
    hasStrongOverlap: beforeOverlap && afterOverlap,
  };
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

  const sameSource = isSameSource(tx1, tx2);

  return {
    match: true,
    reason: date1 && date2 ? 'same_day_match' : 'date_missing_match',
    merchantSimilarity,
    sameSource,
    amountDifference: Math.abs(parseFloat(tx1.amount) - parseFloat(tx2.amount)),
    date1,
    date2,
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
        group.push({ index: j, transaction: transactions[j], duplicateMatch: match });
        processed.add(j);
      }
    }

    processed.add(i);

    if (group.length > 1) {
      if (!group[0].duplicateMatch && group[1]?.duplicateMatch) {
        group[0] = {
          ...group[0],
          duplicateMatch: group[1].duplicateMatch,
        };
      }
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
  const { allTransactions, imageMap, imageTransactions } = flattenProcessedImages(processedImages);
  const skipDecisions = new Map();
  const duplicateGroups = [];
  const exactImageHashes = new Map();

  processedImages.forEach((image, imageIdx) => {
    if (!image?.imageHash) return;
    if (!exactImageHashes.has(image.imageHash)) {
      exactImageHashes.set(image.imageHash, imageIdx);
      return;
    }

    const originalImageIdx = exactImageHashes.get(image.imageHash);
    const originalRows = imageTransactions[originalImageIdx] || [];
    const duplicateRows = imageTransactions[imageIdx] || [];

    duplicateRows.forEach((record, txIdx) => {
      const keepRecord = originalRows[txIdx] || originalRows.find((row) => row.rowFingerprint === record.rowFingerprint);
      if (!keepRecord) return;

      const duplicateMatch = buildOverlapMatch(keepRecord, record, {
        reason: 'exact_image_hash',
        overlapLength: duplicateRows.length,
      });
      skipDecisions.set(record.globalIndex, duplicateMatch);
      duplicateGroups.push(buildDuplicateGroup(keepRecord, record, duplicateMatch));
    });
  });

  for (let leftIdx = 0; leftIdx < imageTransactions.length; leftIdx += 1) {
    for (let rightIdx = leftIdx + 1; rightIdx < imageTransactions.length; rightIdx += 1) {
      const runs = findOrderedOverlapRuns(imageTransactions[leftIdx], imageTransactions[rightIdx]);

      runs.forEach((run) => {
        run.rightRecords.forEach((skipRecord, offset) => {
          if (skipDecisions.has(skipRecord.globalIndex)) return;

          const keepRecord = run.leftRecords[offset] || run.leftRecords[0];
          const duplicateMatch = buildOverlapMatch(keepRecord, skipRecord, {
            reason: 'ordered_screenshot_overlap',
            overlapLength: run.length,
          });
          skipDecisions.set(skipRecord.globalIndex, duplicateMatch);
          duplicateGroups.push(buildDuplicateGroup(keepRecord, skipRecord, duplicateMatch));
        });
      });
    }
  }

  allTransactions.forEach((leftRecord, leftIdx) => {
    for (let rightIdx = leftIdx + 1; rightIdx < allTransactions.length; rightIdx += 1) {
      const rightRecord = allTransactions[rightIdx];
      if (leftRecord.imageSource.imageIndex === rightRecord.imageSource.imageIndex) continue;
      if (skipDecisions.has(rightRecord.globalIndex)) continue;
      if (!leftRecord.rowFingerprint || leftRecord.rowFingerprint !== rightRecord.rowFingerprint) continue;

      const contextOverlap = getContextOverlapDetails(leftRecord.transaction, rightRecord.transaction);
      if (!contextOverlap.hasStrongOverlap) continue;

      const duplicateMatch = buildOverlapMatch(leftRecord, rightRecord, {
        reason: 'row_context_overlap',
        overlapLength: 1,
        contextOverlap,
      });
      skipDecisions.set(rightRecord.globalIndex, duplicateMatch);
      duplicateGroups.push(buildDuplicateGroup(leftRecord, rightRecord, duplicateMatch));
    }
  });

  const unique = allTransactions
    .filter((record) => !skipDecisions.has(record.globalIndex))
    .map((record) => ({
      index: record.globalIndex,
      transaction: record.transaction,
      imageSource: record.imageSource,
    }));

  return {
    unique,
    duplicates: duplicateGroups,
    skippedIndices: Array.from(skipDecisions.keys()).sort((a, b) => a - b),
    summary: {
      total: allTransactions.length,
      uniqueCount: unique.length,
      duplicateGroups: duplicateGroups.length,
      skippedCount: skipDecisions.size,
    },
    imageCount: processedImages.length,
    imageMap,
  };
}

function flattenProcessedImages(processedImages = []) {
  const allTransactions = [];
  const imageMap = {};
  const imageTransactions = [];

  processedImages.forEach((image, imageIdx) => {
    const enrichedTransactions = enrichTransactionsWithImportContext(image?.transactions || []);

    imageTransactions[imageIdx] = enrichedTransactions.map((tx, txIdx) => {
      const globalIndex = allTransactions.length;
      const transaction = {
        ...tx,
        imageHash: tx.imageHash || image.imageHash || null,
        imageFingerprint: tx.imageFingerprint || image.imageFingerprint || null,
        orderedImageFingerprint: tx.orderedImageFingerprint || image.orderedImageFingerprint || null,
        imageName: tx.imageName || image.fileName || null,
      };
      const imageSource = {
        imageIndex: imageIdx,
        transactionIndex: txIdx,
        imageName: image.fileName,
        imageHash: image.imageHash,
      };
      const record = {
        globalIndex,
        transaction,
        imageSource,
        rowFingerprint: transaction.rowFingerprint || buildTransactionRowFingerprint(transaction),
      };

      allTransactions.push(record);
      imageMap[globalIndex] = imageSource;
      return record;
    });
  });

  return { allTransactions, imageMap, imageTransactions };
}

function fingerprintsMatch(left, right) {
  return Boolean(left?.rowFingerprint && right?.rowFingerprint && left.rowFingerprint === right.rowFingerprint);
}

function findOrderedOverlapRuns(leftRecords = [], rightRecords = []) {
  const runs = [];
  const MIN_OVERLAP_RUN = 2;

  for (let leftIdx = 0; leftIdx < leftRecords.length; leftIdx += 1) {
    for (let rightIdx = 0; rightIdx < rightRecords.length; rightIdx += 1) {
      if (!fingerprintsMatch(leftRecords[leftIdx], rightRecords[rightIdx])) continue;
      if (
        leftIdx > 0 &&
        rightIdx > 0 &&
        fingerprintsMatch(leftRecords[leftIdx - 1], rightRecords[rightIdx - 1])
      ) {
        continue;
      }

      let length = 0;
      while (
        leftIdx + length < leftRecords.length &&
        rightIdx + length < rightRecords.length &&
        fingerprintsMatch(leftRecords[leftIdx + length], rightRecords[rightIdx + length])
      ) {
        length += 1;
      }

      if (length >= MIN_OVERLAP_RUN) {
        runs.push({
          leftStart: leftIdx,
          rightStart: rightIdx,
          length,
          leftRecords: leftRecords.slice(leftIdx, leftIdx + length),
          rightRecords: rightRecords.slice(rightIdx, rightIdx + length),
        });
      }
    }
  }

  return runs.sort((left, right) => right.length - left.length);
}

function findOrderedSubsequenceOverlap(leftRecords = [], rightRecords = []) {
  const MIN_SUBSEQUENCE_OVERLAP = 2;
  const leftLength = leftRecords.length;
  const rightLength = rightRecords.length;
  const lengths = Array.from({ length: leftLength + 1 }, () => new Array(rightLength + 1).fill(0));

  for (let leftIdx = leftLength - 1; leftIdx >= 0; leftIdx -= 1) {
    for (let rightIdx = rightLength - 1; rightIdx >= 0; rightIdx -= 1) {
      if (fingerprintsMatch(leftRecords[leftIdx], rightRecords[rightIdx])) {
        lengths[leftIdx][rightIdx] = lengths[leftIdx + 1][rightIdx + 1] + 1;
      } else {
        lengths[leftIdx][rightIdx] = Math.max(lengths[leftIdx + 1][rightIdx], lengths[leftIdx][rightIdx + 1]);
      }
    }
  }

  if (lengths[0][0] < MIN_SUBSEQUENCE_OVERLAP) return null;

  const leftMatches = [];
  const rightMatches = [];
  let leftIdx = 0;
  let rightIdx = 0;

  while (leftIdx < leftLength && rightIdx < rightLength) {
    if (fingerprintsMatch(leftRecords[leftIdx], rightRecords[rightIdx])) {
      leftMatches.push(leftRecords[leftIdx]);
      rightMatches.push(rightRecords[rightIdx]);
      leftIdx += 1;
      rightIdx += 1;
    } else if (lengths[leftIdx + 1][rightIdx] >= lengths[leftIdx][rightIdx + 1]) {
      leftIdx += 1;
    } else {
      rightIdx += 1;
    }
  }

  if (rightMatches.length < MIN_SUBSEQUENCE_OVERLAP) return null;

  const hasGap =
    leftMatches.some((record, index) => {
      if (index === 0) return false;
      return record.imageSource.transactionIndex - leftMatches[index - 1].imageSource.transactionIndex > 1;
    }) ||
    rightMatches.some((record, index) => {
      if (index === 0) return false;
      return record.imageSource.transactionIndex - rightMatches[index - 1].imageSource.transactionIndex > 1;
    });

  return {
    length: rightMatches.length,
    leftRecords: leftMatches,
    rightRecords: rightMatches,
    hasGap,
  };
}

function buildOverlapMatch(keepRecord, skipRecord, details = {}) {
  const merchantSimilarity = calculateSimilarity(
    keepRecord?.transaction?.merchant,
    skipRecord?.transaction?.merchant
  );

  return {
    match: true,
    classification: 'screenshot_overlap',
    reason: details.reason || 'ordered_screenshot_overlap',
    merchantSimilarity,
    sameSource: false,
    amountDifference: Math.abs(
      parseFloat(keepRecord?.transaction?.amount || 0) - parseFloat(skipRecord?.transaction?.amount || 0)
    ),
    overlapLength: details.overlapLength || 1,
    contextOverlap: details.contextOverlap || null,
    keepIndex: keepRecord?.globalIndex ?? null,
    skipIndex: skipRecord?.globalIndex ?? null,
    keepImageName: keepRecord?.imageSource?.imageName || null,
    skipImageName: skipRecord?.imageSource?.imageName || null,
    processedDay: details.processedDay || null,
    processedDate: details.processedDate || null,
  };
}

function buildDuplicateGroup(keepRecord, skipRecord, duplicateMatch) {
  return {
    type: 'screenshot_overlap',
    group: [
      {
        index: keepRecord.globalIndex,
        transaction: keepRecord.transaction,
        imageSource: keepRecord.imageSource,
        duplicateRole: 'keep',
        duplicateMatch,
      },
      {
        index: skipRecord.globalIndex,
        transaction: skipRecord.transaction,
        imageSource: skipRecord.imageSource,
        duplicateRole: 'skip',
        duplicateAction: 'skip',
        duplicateMatch,
      },
    ],
  };
}

export function annotateProcessedImagesWithDuplicateDecisions(processedImages = [], detection = null) {
  const skipMap = new Map();

  (detection?.duplicates || []).forEach((duplicateGroup) => {
    const items = Array.isArray(duplicateGroup) ? duplicateGroup : duplicateGroup?.group || [];
    items.forEach((item) => {
      if (item?.duplicateRole !== 'skip' && item?.duplicateAction !== 'skip') return;
      skipMap.set(item.index, item.duplicateMatch || null);
    });
  });

  let globalIndex = 0;

  return (processedImages || []).map((image) => {
    const transactions = enrichTransactionsWithImportContext(image?.transactions || []).map((transaction) => {
      const duplicateMatch = skipMap.get(globalIndex);
      const annotated = {
        ...transaction,
        imageHash: transaction.imageHash || image.imageHash || null,
        imageFingerprint: transaction.imageFingerprint || image.imageFingerprint || null,
        orderedImageFingerprint: transaction.orderedImageFingerprint || image.orderedImageFingerprint || null,
        imageName: transaction.imageName || image.fileName || null,
      };

      globalIndex += 1;

      return duplicateMatch
        ? {
            ...annotated,
            duplicateAction: 'skip',
            duplicateMatch,
          }
        : annotated;
    });

    return {
      ...image,
      transactions,
      orderedImageFingerprint: image?.orderedImageFingerprint || buildOrderedImageImportFingerprint(transactions),
      rowContexts: image?.rowContexts || buildImageRowContexts(transactions),
    };
  });
}

export function annotateProcessedImagesWithProcessedLogOverlaps(processedImages = [], processedLogs = {}) {
  const { imageTransactions } = flattenProcessedImages(processedImages);
  const skipMap = new Map();
  const processedImageRecords = Object.entries(processedLogs || {})
    .map(([imageHash, log]) => {
      const rowContexts = Array.isArray(log?.rowContexts) ? log.rowContexts : [];
      return {
        imageHash,
        log,
        records: rowContexts.map((row, index) => ({
          globalIndex: `${imageHash}:${index}`,
          rowFingerprint: row.rowFingerprint || null,
          transaction: {
            merchant: row.merchant || null,
            amount: row.amount ?? null,
            date: row.date || null,
            isPending: Boolean(row.isPending),
          },
          imageSource: {
            imageIndex: -1,
            transactionIndex: index,
            imageName: log?.imageName || 'Previous upload',
            imageHash,
          },
        })),
      };
    })
    .filter((entry) => entry.records.length > 0);

  imageTransactions.forEach((currentRecords) => {
    processedImageRecords.forEach((processedImage) => {
      const runs = findOrderedOverlapRuns(processedImage.records, currentRecords);

      runs.forEach((run) => {
        run.rightRecords.forEach((skipRecord, offset) => {
          if (skipMap.has(skipRecord.globalIndex)) return;

          const keepRecord = run.leftRecords[offset] || run.leftRecords[0];
          const duplicateMatch = buildOverlapMatch(keepRecord, skipRecord, {
            reason: 'processed_screenshot_overlap',
            overlapLength: run.length,
            processedDay: processedImage.log?.uploadDay || null,
            processedDate: processedImage.log?.uploadDate || null,
          });

          skipMap.set(skipRecord.globalIndex, duplicateMatch);
        });
      });

      const subsequence = findOrderedSubsequenceOverlap(processedImage.records, currentRecords);
      if (!subsequence || !subsequence.hasGap) return;

      subsequence.rightRecords.forEach((skipRecord, offset) => {
        if (skipMap.has(skipRecord.globalIndex)) return;

        const keepRecord = subsequence.leftRecords[offset] || subsequence.leftRecords[0];
        const duplicateMatch = buildOverlapMatch(keepRecord, skipRecord, {
          reason: 'processed_ordered_subsequence_overlap',
          overlapLength: subsequence.length,
          processedDay: processedImage.log?.uploadDay || null,
          processedDate: processedImage.log?.uploadDate || null,
        });

        skipMap.set(skipRecord.globalIndex, {
          ...duplicateMatch,
          requiresReview: true,
        });
      });
    });
  });

  let globalIndex = 0;

  return (processedImages || []).map((image) => {
    const transactions = enrichTransactionsWithImportContext(image?.transactions || []).map((transaction) => {
      const duplicateMatch = skipMap.get(globalIndex);
      const annotated = {
        ...transaction,
        imageHash: transaction.imageHash || image.imageHash || null,
        imageFingerprint: transaction.imageFingerprint || image.imageFingerprint || null,
        orderedImageFingerprint: transaction.orderedImageFingerprint || image.orderedImageFingerprint || null,
        imageName: transaction.imageName || image.fileName || null,
      };

      globalIndex += 1;

      if (annotated.duplicateAction === 'skip') return annotated;

      return duplicateMatch
        ? {
            ...annotated,
            duplicateAction: 'skip',
            duplicateMatch,
          }
        : annotated;
    });

    return {
      ...image,
      transactions,
      orderedImageFingerprint: image?.orderedImageFingerprint || buildOrderedImageImportFingerprint(transactions),
      rowContexts: image?.rowContexts || buildImageRowContexts(transactions),
    };
  });
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
