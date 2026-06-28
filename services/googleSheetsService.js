import { google } from 'googleapis';
import { buildTopSpendingsSummary } from '../utils/topSpendingsSummary.js';

const DEFAULT_SPREADSHEET_ID = '1GJj79D8DovXaocK1o_9mVBmy5H5yCVuKWCZNc62jdVc';
const SOURCE_SHEET_NAME = 'Sheet1';
const SPLIT_ASSIGNMENT_CODE = 'split';
const SPLIT_SHARE_FORMULAS = {
  t: '2/3',
  n: '1/3',
};
const DUE_BALANCE_MATCH_TOLERANCE = 0.01;
const DUE_BALANCE_MATCH_COLOR = { red: 198 / 255, green: 239 / 255, blue: 206 / 255 };
const DUE_BALANCE_MISMATCH_COLOR = { red: 1, green: 199 / 255, blue: 206 / 255 };
const ASSIGNMENT_COLOR_BLUE = { red: 164 / 255, green: 194 / 255, blue: 244 / 255 };
const ASSIGNMENT_COLOR_GREEN = { red: 183 / 255, green: 225 / 255, blue: 205 / 255 };
const ASSIGNMENT_COLOR_ORANGE = { red: 249 / 255, green: 203 / 255, blue: 156 / 255 };
const ASSIGNMENT_COLOR_PURPLE = { red: 180 / 255, green: 167 / 255, blue: 214 / 255 };
const ASSIGNMENT_COLOR_SPLIT = { red: 213 / 255, green: 166 / 255, blue: 189 / 255 };
const ASSIGNMENT_TEXT_COLOR_BLACK = { red: 0, green: 0, blue: 0 };
const DEFAULT_SHEET_TEXT_FORMAT = {
  fontFamily: 'Calibri',
  fontSize: 11,
  foregroundColor: ASSIGNMENT_TEXT_COLOR_BLACK,
};
const TOP_SPENDINGS_START_COLUMN = 'F';
const TOP_SPENDINGS_END_COLUMN = 'G';
const TOP_SPENDINGS_BASE_START_ROW = 140;
const TOP_SPENDINGS_ROW_BUFFER = 4;
const TOP_SPENDINGS_MAX_ROWS_PER_OWNER = 10;
const TOP_SPENDINGS_SECTION_GAP_ROWS = 2;
const TOP_SPENDINGS_CLEAR_BUFFER_ROWS = 6;

function firstAvailableEnv(names) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return null;
}

function getServiceAccountEmailHint() {
  const directEmail = firstAvailableEnv(['GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_CLIENT_EMAIL']);
  if (directEmail) return directEmail;

  const jsonValue = firstAvailableEnv(['GOOGLE_SERVICE_ACCOUNT_JSON', 'GOOGLE_CREDENTIALS_JSON']);
  if (!jsonValue) return null;

  try {
    const parsed = JSON.parse(jsonValue);
    return parsed?.client_email || parsed?.email || null;
  } catch {
    return null;
  }
}

function getServiceAccountCredentials() {
  const jsonValue = firstAvailableEnv(['GOOGLE_SERVICE_ACCOUNT_JSON', 'GOOGLE_CREDENTIALS_JSON']);
  if (jsonValue) {
    try {
      const parsed = JSON.parse(jsonValue);
      const clientEmail = parsed?.client_email || parsed?.email || null;
      const privateKey = parsed?.private_key || parsed?.key || null;

      if (!clientEmail || !privateKey) {
        throw new Error(
          'GOOGLE_SERVICE_ACCOUNT_JSON must include client_email and private_key.'
        );
      }

      return {
        clientEmail,
        privateKey,
      };
    } catch (error) {
      throw new Error(
        `Invalid GOOGLE_SERVICE_ACCOUNT_JSON: ${error?.message || 'could not parse JSON.'}`
      );
    }
  }

  const clientEmail = firstAvailableEnv(['GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_CLIENT_EMAIL']);
  const privateKey = firstAvailableEnv([
    'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
    'GOOGLE_PRIVATE_KEY',
  ]);

  if (!clientEmail || !privateKey) {
    throw new Error(
      'Missing Google service account credentials. Set GOOGLE_SERVICE_ACCOUNT_JSON, or set GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_CLIENT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY/GOOGLE_PRIVATE_KEY in Vercel.'
    );
  }

  return {
    clientEmail,
    privateKey,
  };
}

function getSpreadsheetId() {
  return process.env.GOOGLE_SHEETS_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;
}

function getGoogleAuth() {
  const { clientEmail, privateKey } = getServiceAccountCredentials();

  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function wrapGoogleSheetsError(error, operationLabel = 'Google Sheets operation') {
  const statusCode = Number(error?.response?.status);
  const apiMessage =
    error?.response?.data?.error?.message ||
    error?.response?.data?.error_description ||
    null;
  const baseMessage = String(apiMessage || error?.message || operationLabel);
  const spreadsheetId = getSpreadsheetId();
  const serviceAccountEmail = getServiceAccountEmailHint();

  const contextSuffix = ` (spreadsheet: ${spreadsheetId}${serviceAccountEmail ? `, service account: ${serviceAccountEmail}` : ''})`;

  if (statusCode === 403 || /permission denied|insufficient permission|forbidden/i.test(baseMessage)) {
    return new Error(
      `Google Sheets permission denied while ${operationLabel}${contextSuffix}. ` +
        `Share the spreadsheet with that service account as Editor and verify GOOGLE_SHEETS_SPREADSHEET_ID points to the intended sheet.`
    );
  }

  if (statusCode > 0) {
    return new Error(`${operationLabel} failed with status ${statusCode}: ${baseMessage}${contextSuffix}`);
  }

  return new Error(`${operationLabel} failed: ${baseMessage}${contextSuffix}`);
}

async function getSheetsClient() {
  const auth = getGoogleAuth();
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

async function getSpreadsheetMetadata(sheets) {
  const spreadsheetId = getSpreadsheetId();
  const response = await sheets.spreadsheets.get({ spreadsheetId });
  return response.data;
}

function getSheetByName(metadata, sheetName) {
  return (metadata.sheets || []).find((sheet) => sheet.properties?.title === sheetName) || null;
}

function buildGeneratedSheetName(metadata) {
  const existingNames = new Set((metadata.sheets || []).map((sheet) => sheet.properties?.title).filter(Boolean));
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const baseName = `import ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(
    now.getHours()
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  if (!existingNames.has(baseName)) return baseName;

  let suffix = 2;
  while (existingNames.has(`${baseName} ${suffix}`)) {
    suffix += 1;
  }
  return `${baseName} ${suffix}`;
}

function getMergesIntersectingTransactionColumns(sheet) {
  return (sheet?.merges || []).filter((merge) => (merge.startColumnIndex ?? 0) < 4);
}

function parseSheetDateValue(dateValue) {
  const match = String(dateValue || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return Number.POSITIVE_INFINITY;

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, monthIndex, day);
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
}

function getSortedTransactions(parsedTransactions = [], assignmentCodes = []) {
  return parsedTransactions
    .map((transaction, index) => ({
      transaction,
      assignmentCode: assignmentCodes[index] || '',
      index,
    }))
    .sort((left, right) => {
      const leftDate = parseSheetDateValue(left.transaction?.date);
      const rightDate = parseSheetDateValue(right.transaction?.date);
      if (leftDate !== rightDate) return leftDate - rightDate;
      return left.index - right.index;
    });
}

function roundCurrency(value) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) return 0;
  return Number(numericValue.toFixed(2));
}

function sumImportedAmounts(rows = []) {
  return rows.reduce((sum, row) => sum + Number(row?.[1] || 0), 0);
}

function withSplitShareFormula(formula, assignmentCode) {
  const baseFormula = String(formula || '');
  if (!baseFormula) return baseFormula;

  const splitSumIfPattern = /SUMIF\(D:D,\s*"split"\s*,\s*B:B\)/i;
  if (splitSumIfPattern.test(baseFormula)) return baseFormula;

  const assigneeSumIfPattern = new RegExp(
    `SUMIF\\(D:D,\\s*"${assignmentCode}"\\s*,\\s*B:B\\)`,
    'i'
  );
  if (!assigneeSumIfPattern.test(baseFormula)) return baseFormula;

  const splitShareFormula = SPLIT_SHARE_FORMULAS[assignmentCode];
  if (!splitShareFormula) return baseFormula;

  return baseFormula.replace(
    assigneeSumIfPattern,
    (matchedFormula) =>
      `${matchedFormula}+SUMIF(D:D, "${SPLIT_ASSIGNMENT_CODE}", B:B)*${splitShareFormula}`
  );
}

function buildSplitAwareGoogleFormula(formula) {
  if (typeof formula !== 'string' || formula.length === 0) return formula;

  const formulaBody = formula.startsWith('=') ? formula.slice(1) : formula;
  const withTonySplit = withSplitShareFormula(formulaBody, 't');
  const withNugsSplit = withSplitShareFormula(withTonySplit, 'n');
  return formula.startsWith('=') ? `=${withNugsSplit}` : withNugsSplit;
}

async function duplicateSourceSheet(sheets, metadata) {
  const spreadsheetId = getSpreadsheetId();
  const sourceSheet = getSheetByName(metadata, SOURCE_SHEET_NAME);
  if (sourceSheet?.properties?.sheetId === undefined) {
    throw new Error(`Could not find source sheet "${SOURCE_SHEET_NAME}" in Google Sheets.`);
  }

  const newSheetName = buildGeneratedSheetName(metadata);
  const response = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          duplicateSheet: {
            sourceSheetId: sourceSheet.properties.sheetId,
            newSheetName,
          },
        },
      ],
    },
  });

  const duplicateReply = response.data?.replies?.[0]?.duplicateSheet?.properties;
  if (duplicateReply?.sheetId === undefined) {
    throw new Error('Google Sheets created no duplicate sheet.');
  }

  return {
    sheetId: duplicateReply.sheetId,
    sheetName: duplicateReply.title || newSheetName,
  };
}

async function unmergeGeneratedSheetTransactionArea(sheets, sourceSheet, generatedSheetId) {
  const spreadsheetId = getSpreadsheetId();
  const merges = getMergesIntersectingTransactionColumns(sourceSheet);
  if (merges.length === 0) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: merges.map((merge) => ({
        unmergeCells: {
          range: {
            sheetId: generatedSheetId,
            startRowIndex: merge.startRowIndex,
            endRowIndex: merge.endRowIndex,
            startColumnIndex: merge.startColumnIndex,
            endColumnIndex: merge.endColumnIndex,
          },
        },
      })),
    },
  });
}

async function clearGeneratedSheetColumns(sheets, sheetName) {
  const spreadsheetId = getSpreadsheetId();
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${sheetName}!A:E`,
  });
}

async function writeRowsToGeneratedSheet(sheets, sheetName, rows) {
  const spreadsheetId = getSpreadsheetId();
  if (rows.length === 0) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1:E${rows.length}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: rows,
    },
  });
}

async function ensureGeneratedSheetSplitFormulas(sheets, sheetName) {
  const spreadsheetId = getSpreadsheetId();
  const formulaCells = ['F2', 'F3', 'F6', 'F7'];
  const ranges = formulaCells.map((cell) => `${sheetName}!${cell}`);
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges,
    valueRenderOption: 'FORMULA',
  });

  const valueRanges = response.data?.valueRanges || [];
  const updates = [];

  for (let index = 0; index < ranges.length; index += 1) {
    const formulaValue = valueRanges[index]?.values?.[0]?.[0];
    if (typeof formulaValue !== 'string' || !formulaValue.startsWith('=')) continue;

    const nextFormula = buildSplitAwareGoogleFormula(formulaValue);
    if (nextFormula === formulaValue) continue;

    updates.push({
      range: ranges[index],
      values: [[nextFormula]],
    });
  }

  if (updates.length === 0) return;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: updates,
    },
  });
}

function buildTopSpendingsSummaryValues(parsedTransactions = [], assignmentCodes = []) {
  const sections = buildTopSpendingsSummary(parsedTransactions, assignmentCodes, {
    maxRowsPerOwner: TOP_SPENDINGS_MAX_ROWS_PER_OWNER,
  });
  const values = [];

  sections.forEach((section) => {
    values.push([section.title, '']);
    values.push(['Merchant', section.totalLabel || 'Total']);

    const sectionRows =
      section.rows.length > 0
        ? section.rows
        : [{ merchant: 'No spending rows found', total: null }];

    sectionRows.forEach((row) => {
      values.push([row.merchant, Number.isFinite(row.total) ? Number(row.total.toFixed(2)) : '']);
    });

    for (let gap = 0; gap < TOP_SPENDINGS_SECTION_GAP_ROWS; gap += 1) {
      values.push(['', '']);
    }
  });

  return values;
}

async function applyTopSpendingsAmountCurrencyFormat(
  sheets,
  generatedSheetId,
  startRow,
  endRow
) {
  if (generatedSheetId === undefined || generatedSheetId === null) return;
  if (!Number.isInteger(startRow) || !Number.isInteger(endRow) || endRow < startRow) return;

  const spreadsheetId = getSpreadsheetId();
  const amountColumnIndex = 6; // Column G, 0-indexed

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId: generatedSheetId,
              startRowIndex: startRow - 1,
              endRowIndex: endRow,
              startColumnIndex: amountColumnIndex,
              endColumnIndex: amountColumnIndex + 1,
            },
            cell: {
              userEnteredFormat: {
                numberFormat: {
                  type: 'CURRENCY',
                  pattern: '$#,##0.00',
                },
              },
            },
            fields: 'userEnteredFormat.numberFormat',
          },
        },
      ],
    },
  });
}

async function writeGeneratedSheetTopSpendingsSummary(
  sheets,
  sheetName,
  parsedTransactions,
  assignmentCodes,
  options = {}
) {
  const spreadsheetId = getSpreadsheetId();
  const values = buildTopSpendingsSummaryValues(parsedTransactions, assignmentCodes);
  const startRow =
    Number.isInteger(options.startRow) && options.startRow > 0
      ? options.startRow
      : TOP_SPENDINGS_BASE_START_ROW;
  const rowsToClear = Math.max(
    values.length,
    startRow +
      TOP_SPENDINGS_CLEAR_BUFFER_ROWS +
      (TOP_SPENDINGS_MAX_ROWS_PER_OWNER + TOP_SPENDINGS_SECTION_GAP_ROWS + 2) * 2
  );

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${sheetName}!${TOP_SPENDINGS_START_COLUMN}${startRow}:${TOP_SPENDINGS_END_COLUMN}${rowsToClear}`,
  });

  if (values.length === 0) return;

  const endRow = startRow + values.length - 1;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!${TOP_SPENDINGS_START_COLUMN}${startRow}:${TOP_SPENDINGS_END_COLUMN}${endRow}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values,
    },
  });

  await applyTopSpendingsAmountCurrencyFormat(
    sheets,
    options.sheetId,
    startRow,
    endRow
  );
}

function buildAssignmentConditionalRuleRequests(sheetId) {
  const range = {
    sheetId,
    startColumnIndex: 3,
    endColumnIndex: 4,
  };

  const rules = [
    {
      formula: '=LOWER(TRIM($D1))="n"',
      color: ASSIGNMENT_COLOR_BLUE,
    },
    {
      formula: '=LOWER(TRIM($D1))="t"',
      color: ASSIGNMENT_COLOR_GREEN,
    },
    {
      formula: '=LOWER(TRIM($D1))="macq"',
      color: ASSIGNMENT_COLOR_ORANGE,
    },
    {
      formula: '=LOWER(TRIM($D1))="macqbill"',
      color: ASSIGNMENT_COLOR_PURPLE,
    },
    {
      formula: '=LOWER(TRIM($D1))="split"',
      color: ASSIGNMENT_COLOR_SPLIT,
    },
  ];

  return rules
    .map((rule) => ({
      addConditionalFormatRule: {
        index: 0,
        rule: {
          ranges: [range],
          booleanRule: {
            condition: {
              type: 'CUSTOM_FORMULA',
              values: [{ userEnteredValue: rule.formula }],
            },
            format: {
              backgroundColor: rule.color,
            },
          },
        },
      },
    }))
    .reverse();
}

async function normalizeGeneratedSheetAssignmentColumnStyle(sheets, generatedSheetId) {
  if (generatedSheetId === undefined || generatedSheetId === null) return;

  const spreadsheetId = getSpreadsheetId();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId: generatedSheetId,
              startColumnIndex: 3,
              endColumnIndex: 4,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 1, green: 1, blue: 1 },
                textFormat: {
                  fontFamily: 'Calibri',
                  fontSize: 11,
                  foregroundColor: ASSIGNMENT_TEXT_COLOR_BLACK,
                },
              },
            },
            fields:
              'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.fontFamily,userEnteredFormat.textFormat.fontSize,userEnteredFormat.textFormat.foregroundColor',
          },
        },
      ],
    },
  });
}

async function getSheetCellTextFormat(sheets, sheetName, cellAddress) {
  const spreadsheetId = getSpreadsheetId();
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    ranges: [`${sheetName}!${cellAddress}`],
    includeGridData: true,
    fields:
      'sheets.data.rowData.values.userEnteredFormat.textFormat,sheets.data.rowData.values.effectiveFormat.textFormat',
  });

  const value =
    response.data?.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0] || null;
  const userEntered = value?.userEnteredFormat?.textFormat || null;
  const effective = value?.effectiveFormat?.textFormat || null;
  return userEntered || effective || null;
}

async function normalizeGeneratedSheetDescriptionColumnStyle(sheets, generatedSheetId, sheetName) {
  if (generatedSheetId === undefined || generatedSheetId === null) return;
  if (!sheetName) return;

  const spreadsheetId = getSpreadsheetId();
  const templateTextFormat =
    (await getSheetCellTextFormat(sheets, sheetName, 'C103')) || DEFAULT_SHEET_TEXT_FORMAT;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId: generatedSheetId,
              startColumnIndex: 2,
              endColumnIndex: 3,
            },
            cell: {
              userEnteredFormat: {
                textFormat: templateTextFormat,
              },
            },
            fields: 'userEnteredFormat.textFormat',
          },
        },
      ],
    },
  });
}

async function ensureGeneratedSheetAssignmentConditionalFormatting(sheets, generatedSheetId) {
  if (generatedSheetId === undefined || generatedSheetId === null) return;

  const spreadsheetId = getSpreadsheetId();
  const requests = buildAssignmentConditionalRuleRequests(generatedSheetId);
  if (requests.length === 0) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests,
    },
  });
}

async function updateGeneratedSheetClosingAmount(sheets, sheetName, closingAmount) {
  const spreadsheetId = getSpreadsheetId();
  if (closingAmount === undefined || closingAmount === null) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!G9`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[Number(Number(closingAmount).toFixed(2))]],
    },
  });
}

async function updateGeneratedSheetDueBalanceFormat(sheets, generatedSheetId, dueBalanceMatchesTally) {
  if (generatedSheetId === undefined || generatedSheetId === null) return;

  const spreadsheetId = getSpreadsheetId();
  const backgroundColor = dueBalanceMatchesTally
    ? DUE_BALANCE_MATCH_COLOR
    : DUE_BALANCE_MISMATCH_COLOR;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId: generatedSheetId,
              startRowIndex: 8,
              endRowIndex: 9,
              startColumnIndex: 6,
              endColumnIndex: 7,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor,
              },
            },
            fields: 'userEnteredFormat.backgroundColor',
          },
        },
      ],
    },
  });
}

function normalizeAssignmentComment(comment) {
  return String(comment || '')
    .replace(/\r\n?/g, '\n')
    .trim();
}

export async function pushRowsToGoogleSheet(
  parsedTransactions = [],
  assignmentCodes = [],
  assignmentComments = [],
  closingAmount = null
) {
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = getSpreadsheetId();
    const metadata = await getSpreadsheetMetadata(sheets);
    const sourceSheet = getSheetByName(metadata, SOURCE_SHEET_NAME);
    const generatedSheet = await duplicateSourceSheet(sheets, metadata);
    const rows = buildGoogleSheetRows(parsedTransactions, assignmentCodes, assignmentComments);

    await unmergeGeneratedSheetTransactionArea(sheets, sourceSheet, generatedSheet.sheetId);
    await clearGeneratedSheetColumns(sheets, generatedSheet.sheetName);
    await writeRowsToGeneratedSheet(sheets, generatedSheet.sheetName, rows);
    await normalizeGeneratedSheetDescriptionColumnStyle(
      sheets,
      generatedSheet.sheetId,
      generatedSheet.sheetName
    );
    await normalizeGeneratedSheetAssignmentColumnStyle(sheets, generatedSheet.sheetId);
    await ensureGeneratedSheetAssignmentConditionalFormatting(sheets, generatedSheet.sheetId);
    await ensureGeneratedSheetSplitFormulas(sheets, generatedSheet.sheetName);
    const summaryStartRow = Math.max(
      TOP_SPENDINGS_BASE_START_ROW,
      rows.length + TOP_SPENDINGS_ROW_BUFFER
    );
    await writeGeneratedSheetTopSpendingsSummary(
      sheets,
      generatedSheet.sheetName,
      parsedTransactions,
      assignmentCodes,
      {
        startRow: summaryStartRow,
        sheetId: generatedSheet.sheetId,
      }
    );
    await updateGeneratedSheetClosingAmount(sheets, generatedSheet.sheetName, closingAmount);

    if (closingAmount !== null && closingAmount !== undefined) {
      const dueBalance = roundCurrency(closingAmount);
      const importedTotalAbs = Math.abs(roundCurrency(sumImportedAmounts(rows)));
      const dueBalanceMatchesTally =
        Math.abs(importedTotalAbs - dueBalance) <= DUE_BALANCE_MATCH_TOLERANCE;
      await updateGeneratedSheetDueBalanceFormat(
        sheets,
        generatedSheet.sheetId,
        dueBalanceMatchesTally
      );
    }

    return {
      spreadsheetId,
      rowCount: rows.length,
      sourceSheetName: SOURCE_SHEET_NAME,
      generatedSheetName: generatedSheet.sheetName,
    };
  } catch (error) {
    throw wrapGoogleSheetsError(error, 'creating a new Google Sheet tab');
  }
}

function formatSheetDate(dateValue) {
  const match = String(dateValue || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(dateValue || '');
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function buildGoogleSheetRows(
  parsedTransactions = [],
  assignmentCodes = [],
  assignmentComments = []
) {
  return getSortedTransactions(parsedTransactions, assignmentCodes).map(
    ({ transaction, assignmentCode, index }) => [
      formatSheetDate(transaction.date),
      Number((-Number(transaction.amount || 0)).toFixed(2)),
      transaction.description || '',
      assignmentCode,
      normalizeAssignmentComment(assignmentComments[index]),
    ]
  );
}
