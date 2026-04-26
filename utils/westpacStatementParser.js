import path from 'path';
import { pathToFileURL } from 'url';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';
import 'pdfjs-dist/legacy/build/pdf.worker.entry.js';

const DATE_RE = /^\d{1,2}\s+[A-Za-z]{3}\s+\d{2}$/;
const DATE_TOKEN_RE = /(^|\s)\d{1,2}\s+[A-Za-z]{3}\s+\d{2}(\s|$)/;
const AMOUNT_TOKEN_RE = /^-?\d[\d,]*\.\d{2}-?$/;
const FOREIGN_FEE_RE = /FOREIGN FEE/i;
const FOREIGN_FEE_INFO_ROW_RE = /\b[A-Z]{3}\+FOREIGN FEE AUD\b/i;
const CREDIT_HINT_RE = /\b(refund|reversal|chargeback|credit)\b/i;
const TRANSACTION_PAGE_RE = /Date of\s+Description\s+Debits/i;
const COUNTRY_TOKEN_RE = /^(AUS|SGP|USA|HKG|GBR|NZL|CAN|SGN|SIN)$/i;
const MONTH_INDEX = {
  Jan: '01',
  Feb: '02',
  Mar: '03',
  Apr: '04',
  May: '05',
  Jun: '06',
  Jul: '07',
  Aug: '08',
  Sep: '09',
  Oct: '10',
  Nov: '11',
  Dec: '12',
};

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function groupItemsIntoRows(items, tolerance = 2.2) {
  const rows = [];

  items.forEach((item) => {
    let row = rows.find((candidate) => Math.abs(candidate.y - item.y) < tolerance);
    if (!row) {
      row = { y: item.y, items: [] };
      rows.push(row);
    }
    row.items.push(item);
  });

  return rows
    .map((row) => ({
      y: row.y,
      items: row.items.sort((left, right) => left.x - right.x),
    }))
    .sort((left, right) => right.y - left.y);
}

function parseAmountToken(token) {
  if (!token) return null;

  const normalized = String(token)
    .replace(/[,\s]/g, '')
    .replace(/-$/, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeStatementDate(token) {
  const match = String(token || '').match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2})$/);
  if (!match) return null;

  const day = String(match[1]).padStart(2, '0');
  const month = MONTH_INDEX[match[2]];
  const year = `20${match[3]}`;

  if (!month) return null;
  return `${year}-${month}-${day}`;
}

function isDateToken(token) {
  return DATE_RE.test(normalizeWhitespace(token));
}

function cleanDescription(tokens) {
  return normalizeWhitespace(
    tokens
      .filter(Boolean)
      .filter((token) => !COUNTRY_TOKEN_RE.test(token))
      .join(' ')
      .replace(/\s+[|]\s+/g, ' ')
  );
}

function buildForeignFeeDescription(previousTransaction) {
  if (!previousTransaction?.description) return 'Foreign fee';
  return `Foreign fee - ${previousTransaction.description}`;
}

function isInformationalForeignFeeRow(rowText) {
  return FOREIGN_FEE_INFO_ROW_RE.test(normalizeWhitespace(rowText));
}

function extractPageText(pageItems) {
  return normalizeWhitespace(pageItems.map((item) => item.str).join(' '));
}

function extractSummaryNumber(fullText, labelPattern) {
  const match = fullText.match(labelPattern);
  if (!match) return null;
  const amount = parseAmountToken(match[1]);
  return amount;
}

function parseSummary(fullText) {
  const openingBalance = extractSummaryNumber(fullText, /Opening Balance\s+([\d,]+\.\d{2})/i);
  const closingBalance = extractSummaryNumber(fullText, /Closing Balance(?: of)?\s+([\d,]+\.\d{2})/i);
  const newPurchases = extractSummaryNumber(fullText, /New Purchases\s+([\d,]+\.\d{2})/i);
  const feesAndCharges = extractSummaryNumber(
    fullText,
    /Fees, Government & Interest Charges\s+([\d,]+\.\d{2})/i
  );
  const paymentsAndCredits = extractSummaryNumber(
    fullText,
    /We Deducted Payments and Other Credits\s+([\d,]+\.\d{2}-?)/i
  );

  return {
    openingBalance,
    closingBalance,
    newPurchases,
    feesAndCharges,
    paymentsAndCredits,
  };
}

async function extractPdfPages(pdfBuffer) {
  const standardFontDataUrl = pathToFileURL(
    path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'standard_fonts')
  ).href;

  const loadingTask = pdfjsLib.getDocument({
    data: pdfBuffer instanceof Uint8Array ? pdfBuffer : new Uint8Array(pdfBuffer),
    standardFontDataUrl,
  });

  const doc = await loadingTask.promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const items = textContent.items
      .map((item) => ({
        str: normalizeWhitespace(item.str),
        x: item.transform?.[4] ?? 0,
        y: item.transform?.[5] ?? 0,
      }))
      .filter((item) => item.str.length > 0);
    pages.push({
      pageNumber,
      items,
      text: extractPageText(items),
    });
  }

  return pages;
}

function parseTransactionRows(page) {
  const rows = groupItemsIntoRows(page.items);
  const transactions = [];
  let currentDate = null;
  let previousTransaction = null;

  rows.forEach((row) => {
    const rowTokens = row.items.map((item) => item.str);
    const rowText = normalizeWhitespace(rowTokens.join(' '));

    if (!TRANSACTION_PAGE_RE.test(page.text) && !DATE_TOKEN_RE.test(rowText)) {
      return;
    }

    const dateTokenIndex = rowTokens.findIndex((token) => isDateToken(token));
    const amountTokenIndex = [...rowTokens]
      .map((token, index) => ({ token, index }))
      .filter(({ token }) => AMOUNT_TOKEN_RE.test(token))
      .map(({ index }) => index)
      .pop();

    const hasForeignFee = FOREIGN_FEE_RE.test(rowText);
    if (hasForeignFee && isInformationalForeignFeeRow(rowText)) {
      return;
    }

    if (dateTokenIndex === -1 && !hasForeignFee) {
      return;
    }

    if (dateTokenIndex !== -1) {
      currentDate = normalizeStatementDate(rowTokens[dateTokenIndex]);
    }

    const amountToken =
      amountTokenIndex !== undefined ? rowTokens[amountTokenIndex] : rowTokens.find((token) => AMOUNT_TOKEN_RE.test(token));
    if (!amountToken) {
      return;
    }

    let amount = parseAmountToken(amountToken);
    if (amount === null) {
      return;
    }

    const trailingTokens = amountTokenIndex !== undefined ? rowTokens.slice(amountTokenIndex + 1) : [];
    const explicitCredit = CREDIT_HINT_RE.test(rowText);
    const isRefund = Boolean(
      amountToken.startsWith('-') ||
        amountToken.endsWith('-') ||
        explicitCredit ||
        trailingTokens.some((token) => token === '-' || /credit/i.test(token))
    );

    if (isRefund) {
      amount = -Math.abs(amount);
    } else {
      amount = Math.abs(amount);
    }

    const descriptionTokens = dateTokenIndex !== -1
      ? rowTokens.slice(dateTokenIndex + 1, amountTokenIndex === undefined ? rowTokens.length : amountTokenIndex)
      : rowTokens.slice(0, amountTokenIndex);

    let description = cleanDescription(descriptionTokens);
    let isForeignFee = false;

    if (hasForeignFee && dateTokenIndex === -1) {
      description = buildForeignFeeDescription(previousTransaction);
      isForeignFee = true;
    } else if (hasForeignFee) {
      isForeignFee = true;
    }

    const transaction = {
      order: transactions.length,
      date: currentDate || null,
      amount: Number(amount.toFixed(2)),
      description: description || rowText,
      rawDescription: rowText,
      isRefund,
      isForeignFee,
      sourcePage: page.pageNumber,
    };

    transactions.push(transaction);
    previousTransaction = transaction;
  });

  return transactions;
}

export async function parseWestpacStatementPdf(pdfBuffer) {
  const pages = await extractPdfPages(pdfBuffer);
  const transactionPages = pages.filter((page) => TRANSACTION_PAGE_RE.test(page.text));
  const summaryPage = pages[0] || null;
  const summary = parseSummary(summaryPage?.text || '');

  const transactions = transactionPages
    .flatMap((page) => parseTransactionRows(page))
    .sort((left, right) => {
      const leftDate = left.date || '';
      const rightDate = right.date || '';
      if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
      return left.order - right.order;
    });
  const total = transactions.reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  const closingBalance = Number(summary.closingBalance ?? NaN);
  const openingBalance = Number(summary.openingBalance ?? NaN);
  const closingBalanceDelta = Number.isFinite(closingBalance) && Number.isFinite(openingBalance)
    ? Number((closingBalance - openingBalance).toFixed(2))
    : null;

  return {
    statement: {
      openingBalance: Number.isFinite(openingBalance) ? openingBalance : null,
      closingBalance: Number.isFinite(closingBalance) ? closingBalance : null,
      closingBalanceDelta,
      newPurchases: summary.newPurchases,
      feesAndCharges: summary.feesAndCharges,
      paymentsAndCredits: summary.paymentsAndCredits,
      parsedTransactionTotal: Number(total.toFixed(2)),
      reconciliationDifference:
        Number.isFinite(closingBalance) ? Number((total - closingBalance).toFixed(2)) : null,
    },
    transactions,
    pageCount: pages.length,
  };
}
