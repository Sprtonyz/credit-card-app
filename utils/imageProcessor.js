import Tesseract from 'tesseract.js';
import { correctTransaction } from './ocrErrorCorrection';

function normalizeOcrLine(line) {
  return line
    .replace(/\u00a0/g, ' ')
    .replace(/[|]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/(?<=\d)[oO](?=\d)/g, '0')
    .replace(/(?<=\d)[lI](?=\d)/g, '1')
    .replace(/(?<=\d)[sS](?=\d)/g, '5')
    .trim();
}

function cleanMerchantCandidate(text) {
  if (!text) return '';

  return text
    .replace(/^\s*(pending|posted)\s*[-:–—]?\s*/i, '')
    .replace(/^\s*(?:\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})\s*/i, '')
    .replace(/^\s*[-:–—]+\s*/i, '')
    .trim();
}

async function extractTextFromImage(imageFile, onProgress) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async (event) => {
      try {
        const image = event.target.result;

        const {
          data: { text },
        } = await Tesseract.recognize(image, 'eng', {
          tessedit_pageseg_mode: 6,
          preserve_interword_spaces: '1',
          logger: (m) => {
            if (onProgress) {
              onProgress(m.progress);
            }
          },
        });

        resolve(text);
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => {
      reject(new Error('Failed to read image file'));
    };

    reader.readAsDataURL(imageFile);
  });
}

function parseTransactionText(text) {
  if (!text) return [];

  const transactions = [];
  const lines = text
    .split('\n')
    .map((line) => normalizeOcrLine(line))
    .filter((line) => line.length > 0);

  let currentMerchant = null;
  let currentAmount = null;
  let currentDate = null;
  let currentCategory = null;

  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx];
    const trimmed = line.trim();
    const isUiLabel = /^(date|description|merchant|amount|total|balance|card|transaction|transactions|pending)$/i.test(trimmed);
    const amountMatch = trimmed.match(
      /(?:\$|aud\s*)?\d{1,3}(?:[,\s]\d{3})*(?:[.,]\d{2})|\$?\d+[.,]\d{2}/i
    );
    const dateMatch = trimmed.match(
      /\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4}/i
    );

    if (dateMatch) {
      currentDate = dateMatch[0];
    }

    if (/entertainment|food|groceries|transport|shopping|utilities|health/i.test(trimmed)) {
      currentCategory = trimmed;
    }

    if (!amountMatch && !dateMatch && !isUiLabel && trimmed.length > 2) {
      const cleanedMerchant = cleanMerchantCandidate(trimmed);
      if (cleanedMerchant) {
        currentMerchant = cleanedMerchant;
      }
      continue;
    }

    if (amountMatch) {
      const amountText = amountMatch[0];
      const merchantText = cleanMerchantCandidate(
        trimmed
        .replace(amountMatch[0], '')
        .replace(/\b(?:aud|usd)\b/i, '')
        .replace(/[:\-]+$/, '')
        .trim()
      );

      const merchant = merchantText || currentMerchant;
      if (merchant && amountText) {
        transactions.push({
          merchant,
          amount: amountText,
          date: currentDate,
          category: currentCategory,
          lineIndex: idx + 1,
          rawLine: trimmed,
        });
        currentMerchant = null;
        currentAmount = null;
        currentDate = null;
        currentCategory = null;
        continue;
      }

      currentAmount = amountText;
      if (currentAmount && currentMerchant) {
        transactions.push({
          merchant: currentMerchant,
          amount: currentAmount,
          date: currentDate,
          category: currentCategory,
          lineIndex: idx + 1,
          rawLine: trimmed,
        });
        currentMerchant = null;
        currentAmount = null;
        currentDate = null;
        currentCategory = null;
      }
    }
  }

  if (currentAmount && currentMerchant) {
    transactions.push({
      merchant: currentMerchant,
      amount: currentAmount,
      date: currentDate,
      category: currentCategory,
      lineIndex: lines.length,
      rawLine: lines[lines.length - 1] || '',
    });
  }

  return transactions;
}

export async function generateImageHash(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async (event) => {
      try {
        const buffer = event.target.result;
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        resolve(hashHex);
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => {
      reject(new Error('Failed to read file for hashing'));
    };

    reader.readAsArrayBuffer(file);
  });
}

export async function processImage(imageFile, onProgress) {
  try {
    const imageHash = await generateImageHash(imageFile);
    const extractedText = await extractTextFromImage(imageFile, onProgress);
    const rawTransactions = parseTransactionText(extractedText);
    const correctedTransactions = rawTransactions.map(correctTransaction);
    const rawLineCount = extractedText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean).length;

    return {
      imageHash,
      fileName: imageFile.name,
      extractedText,
      transactions: correctedTransactions,
      originalCount: rawTransactions.length,
      rawLineCount,
    };
  } catch (error) {
    console.error('Error processing image:', error);
    throw error;
  }
}

export async function processImages(imageFiles, onProgress) {
  const results = [];

  for (let i = 0; i < imageFiles.length; i++) {
    try {
      const result = await processImage(imageFiles[i], (progress) => {
        const overallProgress = (i + progress) / imageFiles.length;
        if (onProgress) {
          onProgress({
            currentFile: i + 1,
            totalFiles: imageFiles.length,
            fileProgress: progress,
            overallProgress,
          });
        }
      });

      results.push(result);
    } catch (error) {
      console.error(`Error processing image ${i + 1}:`, error);
      results.push({
        imageHash: null,
        fileName: imageFiles[i].name,
        error: error.message,
        transactions: [],
      });
    }
  }

  return results;
}

