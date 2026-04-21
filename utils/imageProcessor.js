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
const AMOUNT_RE = /(?:-\s*\$?\s*\d[\d,]*(?:[.,]\d{2})?|\$\s*\d[\d,]*(?:[.,]\d{2})?)/i;

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
    .replace(/^[^A-Za-z0-9]+/, '')
    .replace(/^[A-Z]\s+(?=[A-Za-z])/g, '')
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

function normalizeAmountToken(amountToken) {
  if (!amountToken) return null;
  return amountToken.replace(/\s+/g, '').replace(/[–—]/g, '-');
}

function isNoiseLine(text) {
  const normalized = normalizeOcrLine(text || '');
  if (!normalized) return true;
  if (/^[^a-z0-9]+$/i.test(normalized)) return true;
  if (normalized.length < 2) return true;
  return false;
}

function isLabelOnlyLine(text) {
  const normalized = normalizeOcrLine(text || '').toLowerCase();
  if (!normalized) return true;
  if (
    /^(category in progress|in progress|date|description|merchant|amount|total|balance|card|transaction|transactions)$/.test(
      normalized
    )
  ) {
    return true;
  }
  return false;
}

function isMerchantStarterLine(text) {
  const normalized = normalizeOcrLine(text || '');
  if (!normalized) return false;
  if (isLabelOnlyLine(normalized) || isNoiseLine(normalized)) return false;
  return /^(pending|posted)\b/i.test(normalized);
}

function isMerchantContinuationLine(text) {
  const normalized = normalizeOcrLine(text || '');
  if (!normalized) return false;
  if (isLabelOnlyLine(normalized) || isNoiseLine(normalized)) return false;
  if (extractAmountMatch(normalized)) return false;
  return /[A-Za-z]/.test(normalized);
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

function parseClassicTransactionText(text, lineEntries = []) {
  const entries = toLineEntries(text, lineEntries);
  if (entries.length === 0) return [];

  const transactions = [];
  let currentMerchantParts = [];
  let currentDate = null;
  let currentCategory = null;

  const pushTransaction = (merchant, amountText, entry, rawLine) => {
    if (!merchant || !amountText || isForeignFeeLine(merchant)) return;

    transactions.push({
      merchant,
      amount: amountText,
      date: currentDate,
      category: currentCategory,
      lineIndex: entry.index + 1,
      rawLine,
      parserProfile: 'classic',
    });

    currentMerchantParts = [];
    currentDate = null;
    currentCategory = null;
  };

  for (const entry of entries) {
    const trimmed = entry.text.trim();
    if (!trimmed) continue;

    const dateMatch = extractDateFromLine(trimmed);
    if (dateMatch && isStandaloneDateLine(trimmed)) {
      currentDate = dateMatch;
      continue;
    }

    if (isForeignFeeLine(trimmed)) {
      currentMerchantParts = [];
      currentCategory = null;
      continue;
    }

    if (/entertainment|food|groceries|transport|shopping|utilities|health/i.test(trimmed)) {
      currentCategory = trimmed;
    }

    if (isLabelOnlyLine(trimmed) || isNoiseLine(trimmed)) {
      continue;
    }

    const amountMatch = extractAmountMatch(trimmed);
    if (amountMatch) {
      const amountText = normalizeAmountToken(amountMatch);
      const inlineMerchant = cleanMerchantCandidate(
        trimmed
          .replace(amountMatch, '')
          .replace(/\b(?:aud|usd)\b/i, '')
          .replace(/[:\-]+$/, '')
          .trim()
      );
      const mergedMerchant = cleanMerchantCandidate(currentMerchantParts.join(' '));
      const merchant = inlineMerchant || mergedMerchant;
      const rawLine = inlineMerchant
        ? `${inlineMerchant} ${amountText}`.trim()
        : `${mergedMerchant} ${amountText}`.trim();

      pushTransaction(merchant, amountText, entry, rawLine);
      continue;
    }

    if (isMerchantStarterLine(trimmed)) {
      const cleaned = cleanMerchantCandidate(trimmed);
      if (cleaned) {
        currentMerchantParts = [cleaned];
      }
      continue;
    }

    if (isMerchantContinuationLine(trimmed) && currentMerchantParts.length > 0) {
      const cleaned = cleanMerchantCandidate(trimmed);
      if (cleaned) {
        currentMerchantParts.push(cleaned);
      }
    }
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
    const amountText = amountMatch ? normalizeAmountToken(amountMatch[0]).replace(/^-/, '') : null;

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

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => resolve(event.target.result);
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load image for OCR'));
    image.src = src;
  });
}

function buildOcrCanvas(image, scale = 2) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to prepare OCR canvas');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    const contrastBoost = (gray - 128) * 1.35 + 128;
    const clipped = Math.max(0, Math.min(255, Math.round(contrastBoost)));
    const thresholded = clipped > 232 ? 255 : clipped;
    data[i] = thresholded;
    data[i + 1] = thresholded;
    data[i + 2] = thresholded;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

async function extractOcrDataFromImage(imageFile, onProgress) {
  const dataUrl = await readFileAsDataUrl(imageFile);
  const image = await loadImageElement(dataUrl);
  const canvas = buildOcrCanvas(image, 2);

  const { data } = await Tesseract.recognize(canvas, 'eng', {
    tessedit_pageseg_mode: 6,
    preserve_interword_spaces: '1',
    logger: (m) => {
      if (onProgress) {
        onProgress(m.progress);
      }
    },
  });

  return {
    text: data?.text || '',
    lines: data?.lines || [],
  };
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
        : parseClassicTransactionText(ocrData.text, ocrData.lines);
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
