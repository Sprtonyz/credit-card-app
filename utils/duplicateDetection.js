import Fuse from 'fuse.js';

function calculateSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;

  const s1 = str1.toString().toLowerCase();
  const s2 = str2.toString().toLowerCase();

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

function areTransactionsDuplicates(tx1, tx2, merchantThreshold = 90) {
  if (Math.abs(parseFloat(tx1.amount) - parseFloat(tx2.amount)) > 0.01) {
    return false;
  }

  const merchantSimilarity = calculateSimilarity(tx1.merchant, tx2.merchant);
  if (merchantSimilarity < merchantThreshold) {
    return false;
  }

  if (tx1.category && tx2.category) {
    const categorySimilarity = calculateSimilarity(tx1.category, tx2.category);
    if (categorySimilarity < 80) {
      return false;
    }
  }

  return true;
}

export function detectDuplicates(transactions) {
  const duplicates = [];
  const unique = [];
  const flagged = [];
  const processed = new Set();

  for (let i = 0; i < transactions.length; i++) {
    if (processed.has(i)) continue;

    const current = transactions[i];
    const group = [{ index: i, transaction: current }];

    for (let j = i + 1; j < transactions.length; j++) {
      if (processed.has(j)) continue;

      if (areTransactionsDuplicates(current, transactions[j])) {
        group.push({ index: j, transaction: transactions[j] });
        processed.add(j);
      }
    }

    processed.add(i);

    if (group.length > 1) {
      duplicates.push(group);
    } else {
      unique.push({ index: i, transaction: current });
    }
  }

  for (let i = 0; i < transactions.length; i++) {
    for (let j = i + 1; j < transactions.length; j++) {
      const tx1 = transactions[i];
      const tx2 = transactions[j];

      if (
        Math.abs(parseFloat(tx1.amount) - parseFloat(tx2.amount)) < 0.01 &&
        tx1.merchant === tx2.merchant &&
        !duplicates.some((group) => group.some((item) => item.index === i)) &&
        !duplicates.some((group) => group.some((item) => item.index === j))
      ) {
        flagged.push({
          group: [
            { index: i, transaction: tx1 },
            { index: j, transaction: tx2 },
          ],
          reason: 'same_amount_merchant',
        });
      }
    }
  }

  return {
    unique,
    duplicates,
    flagged,
    summary: {
      total: transactions.length,
      uniqueCount: unique.length,
      duplicateGroups: duplicates.length,
      flaggedGroups: flagged.length,
    },
  };
}

export function detectDuplicatesAcrossImages(processedImages) {
  const allTransactions = [];
  const imageMap = {};

  processedImages.forEach((image, imageIdx) => {
    image.transactions.forEach((tx) => {
      const idx = allTransactions.length;
      allTransactions.push(tx);
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
    flagged: detection.flagged.map((flagged) => ({
      group: flagged.group.map((item) => ({
        ...item,
        imageSource: imageMap[item.index],
      })),
      reason: flagged.reason,
    })),
    summary: detection.summary,
    imageCount: processedImages.length,
  };
}

export function selectTransactionsFromDuplicates(allTransactions, selectedIndices) {
  const selected = new Set(selectedIndices);
  return allTransactions.filter((tx, idx) => selected.has(idx));
}
