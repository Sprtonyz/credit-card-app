import Tesseract from 'tesseract.js';
import {
  buildImageImportFingerprint,
  buildImageRowContexts,
  buildOrderedImageImportFingerprint,
  enrichTransactionsWithImportContext,
} from './importFingerprint.js';
import { correctTransaction } from './ocrErrorCorrection.js';
import { getTodayDate } from '../services/firebaseService.js';

const MONTH_PATTERN = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';
const CATEGORY_HINT_RE =
  /^(?:category in progress|in progress|uncategorised|uncategorized|groceries|takeaway & fast food|restaurants & dining|online shopping|online services|coffee shops|shopping|parking|service charges & fees|refunds & rebates|other utilities|other expenses|loan repayment|personal care|pay tv & telephone|electronics & software|clothes & shoes|food & drink|transport|utilities|health|entertainment|medicine & health|medicine & supplements)$/i;
const DATE_LINE_RE = new RegExp(
  `^(?:(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?\\s+)?\\d{1,2}\\s+${MONTH_PATTERN}\\s+\\d{2,4}$`,
  'i'
);
const DATE_PREFIX_RE = new RegExp(
  `^\\s*(?:(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?\\s+)?\\d{1,2}\\s+${MONTH_PATTERN}\\s+\\d{2,4}\\s*[-:\\u2013\\u2014]?\\s*`,
  'i'
);
const AMOUNT_RE = /(?:[-+]?\s*\$?\s*\d[\d,]*(?:[.,]\d{2})?|\$?\s*\d[\d,]*[.,]\d{2})/i;
const BARE_AMOUNT_RE = /(?:^|[^\d])(\d[\d,]*(?:[.,]\d{2}))(?!\d)/g;
const RELATIVE_DATE_RE = /^(today|yesterday)$/i;
const CATEGORY_LABEL_RE =
  /(?:^|[^a-z])(?:category|ategory)\s+in\s+progress\b|^(?:uncategorised|uncategorized|groceries|takeaway & fast food|restaurants & dining|online shopping|online services|coffee shops|shopping|parking|service charges & fees|refunds & rebates|other utilities|other expenses|loan repayment|personal care|pay tv & telephone|electronics & software|clothes & shoes|food & drink|transport|utilities|health|entertainment|medicine & health|medicine & supplements)$/i;

function normalizeOcrLine(line) {
  return String(line || '')
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

  let cleaned = String(text)
    .replace(/^[^A-Za-z0-9]+/, '')
    .replace(/\b(?:amt|amount|frgn amt|frgn|foreign fee|pending|posted)\b[:\s-]*/gi, ' ')
    .replace(DATE_PREFIX_RE, '')
    .replace(/^\s*[-:\u2013\u2014]+\s*/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const parts = cleaned.split(' ');
  while (
    parts.length > 1 &&
    (/^[A-Za-z0-9]{1,2}[\W_]*$/.test(parts[0]) || /^[a-z]{1,4}$/.test(parts[0])) &&
    /[A-Za-z]/.test(parts[1] || '')
  ) {
    parts.shift();
  }

  cleaned = parts.join(' ').replace(/\s+/g, ' ').trim();

  return cleaned;
}

function isForeignFeeLine(text) {
  return /(?:foreign\s+fee|frgn\s+amt|u\.?\s*s\.?\s*dollar)/i.test(text || '');
}

function isStandaloneDateLine(text) {
  const cleaned = normalizeOcrLine(text || '');
  if (RELATIVE_DATE_RE.test(cleaned)) return true;
  const dateToken = extractDateFromLine(cleaned);
  if (!dateToken) return false;

  const leftovers = cleaned
    .replace(dateToken, '')
    .replace(/^[^A-Za-z0-9]+/, '')
    .replace(/[^A-Za-z0-9]+$/g, '')
    .trim();

  return leftovers.length === 0 || /^[A-Za-z]{1,2}$/.test(leftovers);
}

function resolveRelativeDateHeader(header, fallbackDate) {
  const normalizedHeader = normalizeOcrLine(header || '').toLowerCase();
  if (!normalizedHeader) return null;

  if (!RELATIVE_DATE_RE.test(normalizedHeader)) {
    return extractDateFromLine(normalizedHeader) || null;
  }

  const reference = new Date(fallbackDate || Date.now());
  if (Number.isNaN(reference.getTime())) return null;

  if (normalizedHeader === 'yesterday') {
    reference.setDate(reference.getDate() - 1);
  }

  const year = reference.getFullYear();
  const month = String(reference.getMonth() + 1).padStart(2, '0');
  const day = String(reference.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
  const normalized = normalizeOcrLine(text);
  const tokens = normalized.split(' ');
  const candidates = [];

  const pushCandidate = (candidate, tokenIndex = -1) => {
    const normalizedCandidate = normalizeAmountToken(candidate);
    if (!normalizedCandidate) return;
    if (!/[\d]/.test(normalizedCandidate)) return;

    const hasDecimal = /[.,]\d{2}$/.test(normalizedCandidate);
    const hasCurrencyMarker = /[$+-]/.test(normalizedCandidate);
    if (!hasDecimal && !hasCurrencyMarker) return;

    candidates.push(normalizedCandidate);
  };

  tokens.forEach((token, index) => {
    const candidate = token
      .replace(/^[^0-9$+\-]+/, '')
      .replace(/[^0-9.,$+\-]+$/g, '');

    if (!candidate) return;
    if (!/^[+-]?\$?\d[\d,]*(?:[.,]\d{2})?$|^\$[+-]?\d[\d,]*(?:[.,]\d{2})?$/.test(candidate)) return;
    if (!/[.,]\d{2}$/.test(candidate) && !/[$+-]/.test(candidate)) return;
    pushCandidate(candidate, index);
  });

  if (candidates.length > 0) {
    const uniqueCandidates = [...new Set(candidates)];
    uniqueCandidates.sort((a, b) => {
      const scoreDiff = scoreAmountCandidate(b) - scoreAmountCandidate(a);
      if (scoreDiff !== 0) return scoreDiff;
      return b.length - a.length;
    });
    return uniqueCandidates[0];
  }

  return null;
}

function normalizeAmountToken(amountToken) {
  if (!amountToken) return null;
  return String(amountToken)
    .replace(/\s+/g, '')
    .replace(/[\u2013\u2014]/g, '-');
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
  return /^(category in progress|in progress|date|description|merchant|amount|total|balance|card|transaction|transactions|pending|posted)$/i.test(
    normalized
  );
}

function isCategoryLine(text) {
  return CATEGORY_LABEL_RE.test(normalizeOcrLine(text || ''));
}

function isMerchantStarterLine(text) {
  const normalized = normalizeOcrLine(text || '');
  if (!normalized) return false;
  if (isLabelOnlyLine(normalized) || isNoiseLine(normalized)) return false;
  if (isForeignFeeLine(normalized) || isCategoryLine(normalized) || isStandaloneDateLine(normalized)) return false;
  if (extractAmountMatch(normalized)) return false;
  if (/^[A-Za-z]{1,3}\s*[:\-]?$/.test(normalized)) return false;
  if (/^[A-Za-z]{1,3}$/.test(normalized) && !/[&*']/g.test(normalized)) return false;
  return /[A-Za-z]/.test(normalized);
}

function isMerchantContinuationLine(text) {
  const normalized = normalizeOcrLine(text || '');
  if (!normalized) return false;
  if (isLabelOnlyLine(normalized) || isNoiseLine(normalized)) return false;
  if (isForeignFeeLine(normalized) || isCategoryLine(normalized) || isStandaloneDateLine(normalized)) return false;
  if (extractAmountMatch(normalized)) return false;
  if (/^[A-Za-z]{1,3}\s*[:\-]?$/.test(normalized)) return false;
  return /[A-Za-z]/.test(normalized);
}

function normalizeBbox(bbox) {
  if (!bbox) return null;
  const x0 = Number(bbox.x0 ?? bbox.left ?? bbox.x ?? 0);
  const y0 = Number(bbox.y0 ?? bbox.top ?? bbox.y ?? 0);
  const x1 = Number(bbox.x1 ?? bbox.right ?? x0);
  const y1 = Number(bbox.y1 ?? bbox.bottom ?? y0);
  return {
    x0,
    y0,
    x1,
    y1,
  };
}

function mergeBboxes(entries = []) {
  const boxes = entries.map((entry) => normalizeBbox(entry?.bbox)).filter(Boolean);
  if (boxes.length === 0) return null;

  return {
    x0: Math.min(...boxes.map((box) => box.x0)),
    y0: Math.min(...boxes.map((box) => box.y0)),
    x1: Math.max(...boxes.map((box) => box.x1)),
    y1: Math.max(...boxes.map((box) => box.y1)),
  };
}

function toLineEntries(text, lines = []) {
  if (lines && lines.length > 0) {
    return lines
      .map((line, idx) => ({
        text: normalizeOcrLine(line.text || ''),
        rawText: line.text || '',
        bbox: normalizeBbox(line.bbox || line),
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

function toWordEntries(words = []) {
  return (words || [])
    .map((word, idx) => ({
      text: normalizeOcrLine(word.text || ''),
      rawText: word.text || '',
      bbox: normalizeBbox(word.bbox || word),
      index: idx,
    }))
    .filter((word) => word.text.length > 0)
    .sort((a, b) => {
      const ay = a.bbox?.y0 ?? 0;
      const by = b.bbox?.y0 ?? 0;
      if (ay !== by) return ay - by;
      const ax = a.bbox?.x0 ?? 0;
      const bx = b.bbox?.x0 ?? 0;
      return ax - bx;
    });
}

function rangesOverlap(a0, a1, b0, b1, margin = 6) {
  return Math.max(a0, b0) <= Math.min(a1, b1) + margin;
}

function isLikelyNoiseMerchant(text) {
  const normalized = cleanMerchantCandidate(text || '');
  if (!normalized) return true;
  if (/^(?:ep|fh|i|p|©|\(5)$/i.test(normalized)) return true;
  if (/^[A-Za-z]{1,2}$/.test(normalized)) return true;
  return false;
}

function scoreAmountCandidate(candidate) {
  const normalized = normalizeAmountToken(candidate || '');
  const digitsOnly = normalized.replace(/[^\d]/g, '');
  let score = 0;

  if (/[.,]\d{2}/.test(normalized)) score += 30;
  if (/[.,]\d{2}$/.test(normalized)) score += 10;
  if (/^-/.test(normalized)) score += 4;
  if (/\$/.test(normalized)) score += 2;
  if (!/[.,]\d{2}/.test(normalized) && /^\-?\$?\d{4,6}$/.test(normalized)) score -= 25;
  if (digitsOnly.length <= 6) score += 1;

  return score;
}

function extractAmountCandidatesFromWords(entry, wordEntries = []) {
  if (!entry?.bbox || wordEntries.length === 0) return [];

  const entryTop = entry.bbox.y0 ?? 0;
  const entryBottom = entry.bbox.y1 ?? entryTop;
  const entryHeight = Math.max(1, entryBottom - entryTop);
  const entryCenter = entryTop + entryHeight / 2;
  const lineWords = wordEntries.filter((word) => {
    if (!word.bbox) return false;
    const wordTop = word.bbox.y0 ?? 0;
    const wordBottom = word.bbox.y1 ?? wordTop;
    const wordHeight = Math.max(1, wordBottom - wordTop);
    const wordCenter = wordTop + wordHeight / 2;
    const sameBand =
      rangesOverlap(entryTop, entryBottom, wordTop, wordBottom, 2) &&
      Math.abs(wordCenter - entryCenter) <= Math.max(4, Math.min(entryHeight, wordHeight) * 0.55);
    return sameBand;
  });

  if (lineWords.length === 0) return [];

  const sorted = [...lineWords].sort((a, b) => (a.bbox?.x0 ?? 0) - (b.bbox?.x0 ?? 0));
  const candidates = [];

  for (let size = 1; size <= Math.min(4, sorted.length); size += 1) {
    const suffix = sorted.slice(-size).map((word) => word.text).join(' ');
    candidates.push(suffix);
    candidates.push(sorted[sorted.length - size].text);
  }

  return candidates;
}

function extractBestAmountCandidate(entry, wordEntries = []) {
  const lineLevelCandidates = [entry?.text || '', entry?.rawText || '']
    .map((value) => extractAmountMatch(value))
    .filter(Boolean)
    .map((value) => normalizeAmountToken(value));

  const candidates = lineLevelCandidates.length > 0
    ? lineLevelCandidates
    : extractAmountCandidatesFromWords(entry, wordEntries)
        .map((value) => extractAmountMatch(value))
        .filter(Boolean)
        .map((value) => normalizeAmountToken(value));

  const uniqueCandidates = [...new Set(candidates)];
  if (uniqueCandidates.length === 0) return null;

  uniqueCandidates.sort((a, b) => {
    const scoreDiff = scoreAmountCandidate(b) - scoreAmountCandidate(a);
    if (scoreDiff !== 0) return scoreDiff;
    return b.length - a.length;
  });

  return uniqueCandidates[0];
}

function stripAmountFromLine(text, amountText) {
  const amount = String(amountText || '').trim();
  const withoutAmount = amount
    ? String(text || '').replace(new RegExp(amount.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), ' ')
    : String(text || '');

  return cleanMerchantCandidate(
    withoutAmount
      .replace(/\b(?:aud|usd)\b/gi, ' ')
      .replace(/\b(?:amt|amount|frgn amt|frgn|foreign fee|pending|posted)\b[:\s-]*/gi, ' ')
      .replace(/[:\-–—]+$/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function parseClassicTransactionText(text, lineEntries = [], wordEntries = [], fallbackDate = null) {
  const entries = toLineEntries(text, lineEntries);
  if (entries.length === 0) return [];

  const normalizedWords = toWordEntries(wordEntries);
  const transactions = [];
  let currentMerchantParts = [];
  let currentDate = null;
  let currentCategory = null;

  const pushTransaction = (merchant, amountText, entry, rawLine) => {
    if (!merchant || !amountText || isForeignFeeLine(merchant)) return;

    transactions.push({
      merchant,
      amount: amountText,
      rawAmountText: amountText,
      date: currentDate,
      category: currentCategory,
      lineIndex: entry.index + 1,
      lineBbox: entry.bbox || null,
      rawLine,
      parserProfile: 'classic',
    });

    currentMerchantParts = [];
    currentCategory = null;
  };

  for (const entry of entries) {
    const trimmed = entry.text.trim();
    if (!trimmed) continue;

    if (RELATIVE_DATE_RE.test(normalizeOcrLine(trimmed))) {
      currentDate = resolveRelativeDateHeader(trimmed, fallbackDate) || currentDate;
      currentMerchantParts = [];
      currentCategory = null;
      continue;
    }

    const dateMatch = extractDateFromLine(trimmed);
    if (dateMatch && isStandaloneDateLine(trimmed)) {
      currentDate = resolveRelativeDateHeader(trimmed, fallbackDate) || dateMatch;
      currentMerchantParts = [];
      currentCategory = null;
      continue;
    }

    if (isForeignFeeLine(trimmed)) {
      currentMerchantParts = [];
      currentCategory = null;
      continue;
    }

    if (isCategoryLine(trimmed) || /entertainment|food|groceries|transport|shopping|utilities|health|parking|repair|repay|subscription|refund/i.test(trimmed)) {
      currentCategory = trimmed;
      currentMerchantParts = [];
      continue;
    }

    if (isLabelOnlyLine(trimmed) || isNoiseLine(trimmed)) {
      continue;
    }

    const amountMatch = extractBestAmountCandidate(entry, normalizedWords);
    if (amountMatch) {
      const inlineMerchant = stripAmountFromLine(trimmed, amountMatch);
      const mergedMerchant = cleanMerchantCandidate(currentMerchantParts.join(' '));
      const merchant = cleanMerchantCandidate([mergedMerchant, inlineMerchant].filter(Boolean).join(' '));
      const rawLine = [merchant || mergedMerchant || inlineMerchant, amountMatch].filter(Boolean).join(' ').trim();

      if (!merchant || isLikelyNoiseMerchant(merchant) || isCategoryLine(merchant)) {
        currentMerchantParts = [];
        continue;
      }

      pushTransaction(merchant, amountMatch, entry, rawLine);
      continue;
    }

    if (isMerchantStarterLine(trimmed) || (isMerchantContinuationLine(trimmed) && currentMerchantParts.length > 0)) {
      const cleaned = cleanMerchantCandidate(trimmed);
      if (cleaned) {
        currentMerchantParts.push(cleaned);
      }
      continue;
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
    const amountMatch = extractAmountMatch(mergedText);
    const dateFromGroup = currentGroup.map((entry) => extractDateFromLine(entry.text)).find(Boolean);
    const amountText = amountMatch ? normalizeAmountToken(amountMatch).replace(/^-/, '') : null;

    if (isForeignFeeLine(mergedText) || isForeignFeeLine(merchantText)) {
      currentGroup = [];
      return;
    }

    if (merchantText && amountText) {
      transactions.push({
        merchant: merchantText,
        amount: amountText,
        rawAmountText: amountText,
        date: dateFromGroup || currentDate || fallbackDate,
        category: null,
        lineIndex: currentGroup[0].index + 1,
        lineBbox: mergeBboxes(currentGroup),
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
      currentDate = resolveRelativeDateHeader(trimmed, fallbackDate) || dateMatch;
      continue;
    }

    if (RELATIVE_DATE_RE.test(normalizeOcrLine(trimmed))) {
      flushGroup();
      currentDate = resolveRelativeDateHeader(trimmed, fallbackDate) || currentDate;
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

export {
  cleanMerchantCandidate,
  detectParserProfile,
  extractAmountMatch,
  extractDateFromLine,
  extractBestAmountCandidate,
  parseClassicTransactionText,
  parseItemizedTransactionText,
  parseOcrResult,
};

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

function buildOcrCanvas(image, options = {}) {
  const { scale = 2, mode = 'balanced' } = options;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to prepare OCR canvas');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  if (mode === 'raw') {
    return canvas;
  }

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;

    if (mode === 'thresholded') {
      const contrastBoost = (gray - 128) * 1.35 + 128;
      const clipped = Math.max(0, Math.min(255, Math.round(contrastBoost)));
      const thresholded = clipped > 232 ? 255 : clipped;
      data[i] = thresholded;
      data[i + 1] = thresholded;
      data[i + 2] = thresholded;
      continue;
    }

    const contrastBoost = (gray - 128) * 1.18 + 128;
    const softened = Math.max(0, Math.min(255, Math.round(contrastBoost)));
    data[i] = softened;
    data[i + 1] = softened;
    data[i + 2] = softened;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

async function runOcrPass(image, onProgress, options = {}) {
  const {
    mode = 'balanced',
    scale = 2,
    progressStart = 0,
    progressEnd = 1,
  } = options;
  const source = buildOcrCanvas(image, { mode, scale });

  const { data } = await Tesseract.recognize(source, 'eng', {
    tessedit_pageseg_mode: 6,
    preserve_interword_spaces: '1',
    logger: (message) => {
      if (!onProgress || typeof message.progress !== 'number') return;
      const progress =
        progressStart + (progressEnd - progressStart) * Math.max(0, Math.min(1, message.progress));
      onProgress(progress);
    },
  });

  return {
    text: data?.text || '',
    lines: data?.lines || [],
    words: data?.words || [],
    ocrMode: mode,
  };
}

function parseOcrResult(ocrData, requestedProfile, uploadDate) {
  const profile = detectParserProfile(ocrData.text, ocrData.lines, requestedProfile || 'classic');
  const rawTransactions =
    profile === 'itemized'
      ? parseItemizedTransactionText(ocrData.text, ocrData.lines, uploadDate)
      : parseClassicTransactionText(ocrData.text, ocrData.lines, ocrData.words, uploadDate);

  return {
    ...ocrData,
    parserProfile: profile,
    rawTransactions,
  };
}

function looksLikeMissingDecimalAmount(amountToken) {
  const normalized = normalizeAmountToken(amountToken || '');
  return !/[.,]\d{2}/.test(normalized) && /^\-?\$?\d{3,6}$/.test(normalized);
}

function scoreParsedResult(result) {
  const transactions = result.rawTransactions || [];
  if (transactions.length === 0) return -1000;

  let score = transactions.length * 100;

  transactions.forEach((tx) => {
    const amount = String(tx.amount || '');
    if (/[.,]\d{2}/.test(amount)) score += 20;
    if (looksLikeMissingDecimalAmount(amount)) score -= 28;
    if (/\.00$/.test(amount) && /^\-?\$?\d{4,}\.00$/.test(amount)) score -= 12;
    if ((tx.merchant || '').length >= 5) score += 3;
  });

  if (result.ocrMode === 'balanced') score += 4;
  return score;
}

function shouldRunFallback(result) {
  const transactions = result.rawTransactions || [];
  if (transactions.length === 0) return true;

  const suspiciousAmounts = transactions.filter((tx) =>
    looksLikeMissingDecimalAmount(tx.amount) || /^\-?\$?\d{4,}\.00$/.test(String(tx.amount || ''))
  ).length;
  const decimalAmounts = transactions.filter((tx) => /[.,]\d{2}/.test(String(tx.amount || ''))).length;

  return suspiciousAmounts > 0 || decimalAmounts < Math.ceil(transactions.length / 2);
}

function pickBestParsedResult(results) {
  return [...results].sort((a, b) => scoreParsedResult(b) - scoreParsedResult(a))[0];
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
    const dataUrl = await readFileAsDataUrl(imageFile);
    const image = await loadImageElement(dataUrl);
    const uploadDate = options.uploadDate || getTodayDate();
    const requestedProfile = options.profile || 'classic';

    const primaryOcr = await runOcrPass(image, onProgress, {
      mode: 'balanced',
      scale: 2.4,
      progressStart: 0,
      progressEnd: 0.7,
    });
    const candidateResults = [parseOcrResult(primaryOcr, requestedProfile, uploadDate)];

    if (shouldRunFallback(candidateResults[0])) {
      const fallbackModes = ['raw', 'thresholded'];

      for (let idx = 0; idx < fallbackModes.length; idx += 1) {
        const start = 0.7 + idx * 0.15;
        const end = 0.85 + idx * 0.15;
        const fallbackOcr = await runOcrPass(image, onProgress, {
          mode: fallbackModes[idx],
          scale: 2.6,
          progressStart: start,
          progressEnd: end,
        });
        candidateResults.push(parseOcrResult(fallbackOcr, requestedProfile, uploadDate));
      }
    } else if (onProgress) {
      onProgress(1);
    }

    const bestResult = pickBestParsedResult(candidateResults);
    const correctedTransactions = enrichTransactionsWithImportContext(
      bestResult.rawTransactions.map(correctTransaction)
    );
    const imageFingerprint = buildImageImportFingerprint(correctedTransactions);
    const orderedImageFingerprint = buildOrderedImageImportFingerprint(correctedTransactions);
    const rowContexts = buildImageRowContexts(correctedTransactions);
    const rawLineCount = bestResult.text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean).length;

    return {
      imageHash,
      fileName: imageFile.name,
      extractedText: bestResult.text,
      ocrLines: bestResult.lines,
      ocrWords: bestResult.words,
      transactions: correctedTransactions,
      imageFingerprint,
      orderedImageFingerprint,
      rowContexts,
      originalCount: bestResult.rawTransactions.length,
      rawLineCount,
      parserProfile: bestResult.parserProfile,
      ocrMode: bestResult.ocrMode,
      imageDimensions: {
        width: image.naturalWidth || null,
        height: image.naturalHeight || null,
      },
    };
  } catch (error) {
    console.error('Error processing image:', error);
    throw error;
  }
}

export async function processImages(imageFiles, onProgress, options = {}) {
  const results = [];

  for (let i = 0; i < imageFiles.length; i += 1) {
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
