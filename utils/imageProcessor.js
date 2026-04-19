import Tesseract from 'tesseract.js';
import { correctTransaction } from './ocrErrorCorrection';
import { getTodayDate } from '../services/firebaseService';

const MONTH_PATTERN = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';
const DATE_LINE_RE = new RegExp(
  `^(?:(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?\\s+)?\\d{1,2}\\s+${MONTH_PATTERN}\\s+\\d{2,4}$`,
  'i'
);
const DATE_PREFIX_RE = new RegExp(
  `^\\s*(?:(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?\\s+)?\\d{1,2}\\s+${MONTH_PATTERN}\\s+\\d{2,4}\\s*[-:–—]?\\s*`,
  'i'
);
const AMOUNT_RE = /-?(?:\$|aud\s*)?\d{1,3}(?:[,\s]\d{3})*(?:[.,]\d{2})|-?\$?\d+[.,]\d{2}/i;

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
    .replace(DATE_PREFIX_RE, '')
    .replace(/^\s*[-:–—]+\s*/i, '')
    .replace(/\b(?:amt|amount|frgn amt|foreign fee|pending|posted)\b[:\s-]*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isForeignFeeLine(text) {
  return /foreign\s+fee/i.test(text || '');
}

function isStandaloneDateLine(text) {
  return DATE_LINE_RE.test(normalizeOcrLine(text || ''));
}

function extractDateFromLine(text) {
  const cleaned = normalizeOcrLine(text || '');
  const matches = cleaned.match(
    /(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?\s+\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{2,4}|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{2,4}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/i
  );
  return matches ? matches[0] : null;
}

function extractAmountMatch(text) {
  if (!text) return null;
  const matches = normalizeOcrLine(text).match(AMOUNT_RE);
  return matches ? matches[0] : null;
}

function toLineEntries(text, lines = []) {
  if (lines && lines.length > 0) {
    return lines
      .map((line, idx) => ({
        text: normalizeOcrLine(line.text || ''),
        rawText: line.text || '',
        bbox: line.bbox || null,
        index: idx,
      }))
      .filter((line) => line.text.length > 0)
      .sort((a, b) => {
        const ay = a.bbox?.y0 ?? 0;
        const by = b.bbox?.y0 ?? 0;
        if (ay !== by) return ay - by;
        const ax = a.bbox?.x0 ?? 0;
        const bx = b.bbox?.x0 ?? 0;
        return ax - bx;
      });
  }

  return (text || '')
    .split('\n')
    .map((line, idx) => ({
      text: normalizeOcrLine(line),
      rawText: line,
      bbox: null,
      index: idx,
    }))
    .filter((line) => line.text.length > 0);
}

function parseClassicTransactionText(text) {
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
    const amountMatch = trimmed.match(AMOUNT_RE);
    const dateMatch = extractDateFromLine(trimmed);

    if (dateMatch) {
      currentDate = dateMatch;
    }

    if (/entertainment|food|groceries|transport|shopping|utilities|health/i.test(trimmed)) {
      currentCategory = trimmed;
    }

    if (isForeignFeeLine(trimmed)) {
      currentMerchant = null;
      currentAmount = null;
      currentCategory = null;
      continue;
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
          .replace(amountText, '')
          .replace(/\b(?:aud|usd)\b/i, '')
          .replace(/[:\-]+$/, '')
          .trim()
      );

      const merchant = merchantText || currentMerchant;
      if (merchant && amountText) {
        if (!isForeignFeeLine(merchant)) {
          transactions.push({
            merchant,
            amount: amountText,
            date: currentDate,
            category: currentCategory,
            lineIndex: idx + 1,
            rawLine: trimmed,
            parserProfile: 'classic',
          });
        }
        currentMerchant = null;
        currentAmount = null;
        currentDate = null;
        currentCategory = null;
        continue;
      }

      currentAmount = amountText;
      if (currentAmount && currentMerchant) {
        if (!isForeignFeeLine(currentMerchant)) {
          transactions.push({
            merchant: currentMerchant,
            amount: currentAmount,
            date: currentDate,
            category: currentCategory,
            lineIndex: idx + 1,
            rawLine: trimmed,
            parserProfile: 'classic',
          });
        }
        currentMerchant = null;
        currentAmount = null;
        currentDate = null;
        currentCategory = null;
      }
    }
  }

  if (currentAmount && currentMerchant && !isForeignFeeLine(currentMerchant)) {
    transactions.push({
      merchant: currentMerchant,
      amount: currentAmount,
      date: currentDate,
      category: currentCategory,
      lineIndex: lines.length,
      rawLine: lines[lines.length - 1] || '',
      parserProfile: 'classic',
    });
  }

  return transactions;
}

function parseItemizedTransactionText(text, lineEntries = [], fallbackDate = null) {
  if (!text && lineEntries.length === 0) return [];

  const entries = toLineEntries(text, lineEntries);
  const transactions = [];
  let currentDate = fallbackDate;
  let currentGroup = [];

  const flushGroup = () => {
    if (currentGroup.length === 0) return;

    const mergedText = currentGroup.map((entry) => entry.text).join(' ');
    const merchantText = cleanMerchantCandidate(
      mergedText
        .replace(/\b(?:aud|usd)\b/i, '')
        .replace(/\b(?:amt|frgn amt|frgn|amount)\b[:\s-]*/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    );
    const amountMatch = mergedText.match(AMOUNT_RE);
    const dateFromGroup = currentGroup.map((entry) => extractDateFromLine(entry.text)).find(Boolean);
    const amountText = amountMatch ? amountMatch[0].replace(/^-/, '') : null;

    if (isForeignFeeLine(mergedText) || isForeignFeeLine(merchantText)) {
      currentGroup = [];
      return;
    }

    if (merchantText && amountText) {
      transactions.push({
        merchant: merchantText,
        amount: amountText,
        date: dateFromGroup || currentDate || fallbackDate,
        category: null,
        lineIndex: currentGroup[0].index + 1,
        rawLine: mergedText,
        lineGap: currentGroup.length > 1 ? 'wrapped' : 'single',
        parserProfile: 'itemized',
      });
    }

    currentGroup = [];
  };

  for (const entry of entries) {
    const trimmed = entry.text.trim();
    const dateMatch = extractDateFromLine(trimmed);

    if (dateMatch && isStandaloneDateLine(trimmed)) {
      flushGroup();
      currentDate = dateMatch;
      continue;
    }

    if (isForeignFeeLine(trimmed)) {
      flushGroup();
      currentGroup = [];
      continue;
    }

    currentGroup.push(entry);
  }

  flushGroup();
  return transactions;
}

function detectParserProfile(text, lines, requestedProfile = 'classic') {
  if (requestedProfile && requestedProfile !== 'auto') {
    return requestedProfile;
  }

  const entries = toLineEntries(text, lines);
  if (entries.some((entry) => isStandaloneDateLine(entry.text))) {
    return 'itemized';
  }

  return 'classic';
}

async function extractOcrDataFromImage(imageFile, onProgress) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async (event) => {
      try {
        const image = event.target.result;

        const { data } = await Tesseract.recognize(image, 'eng', {
          tessedit_pageseg_mode: 6,
          preserve_interword_spaces: '1',
          logger: (m) => {
            if (onProgress) {
              onProgress(m.progress);
            }
          },
        });

        resolve({
          text: data?.text || '',
          lines: data?.lines || [],
        });
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

export async function processImage(imageFile, onProgress, options = {}) {
  try {
    const imageHash = await generateImageHash(imageFile);
    const ocrData = await extractOcrDataFromImage(imageFile, onProgress);
    const profile = detectParserProfile(ocrData.text, ocrData.lines, options.profile || 'classic');
    const uploadDate = options.uploadDate || getTodayDate();
    const rawTransactions =
      profile === 'itemized'
        ? parseItemizedTransactionText(ocrData.text, ocrData.lines, uploadDate)
        : parseClassicTransactionText(ocrData.text);
    const correctedTransactions = rawTransactions.map(correctTransaction);
    const rawLineCount = ocrData.text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean).length;

    return {
      imageHash,
      fileName: imageFile.name,
      extractedText: ocrData.text,
      ocrLines: ocrData.lines,
      transactions: correctedTransactions,
      originalCount: rawTransactions.length,
      rawLineCount,
      parserProfile: profile,
    };
  } catch (error) {
    console.error('Error processing image:', error);
    throw error;
  }
}

export async function processImages(imageFiles, onProgress, options = {}) {
  const results = [];

  for (let i = 0; i < imageFiles.length; i++) {
    try {
      const result = await processImage(
        imageFiles[i],
        (progress) => {
          const overallProgress = (i + progress) / imageFiles.length;
          if (onProgress) {
            onProgress({
              currentFile: i + 1,
              totalFiles: imageFiles.length,
              fileProgress: progress,
              overallProgress,
            });
          }
        },
        options
      );

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
