import { google } from 'googleapis';

const DEFAULT_SPREADSHEET_ID = '1GJj79D8DovXaocK1o_9mVBmy5H5yCVuKWCZNc62jdVc';
const SOURCE_SHEET_NAME = 'Sheet1';

function firstAvailableEnv(names) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return null;
}

function getSpreadsheetId() {
  return process.env.GOOGLE_SHEETS_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;
}

function getGoogleAuth() {
  const clientEmail = firstAvailableEnv(['GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_CLIENT_EMAIL']);
  if (!clientEmail) {
    throw new Error(
      'Missing Google service account email. Set GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_CLIENT_EMAIL in Vercel.'
    );
  }

  const privateKey = firstAvailableEnv([
    'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
    'GOOGLE_PRIVATE_KEY',
  ]);
  if (!privateKey) {
    throw new Error(
      'Missing Google service account private key. Set GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY or GOOGLE_PRIVATE_KEY in Vercel.'
    );
  }

  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
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
    range: `${sheetName}!A:D`,
  });
}

async function writeRowsToGeneratedSheet(sheets, sheetName, rows) {
  const spreadsheetId = getSpreadsheetId();
  if (rows.length === 0) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1:D${rows.length}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: rows,
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

export async function pushRowsToGoogleSheet(parsedTransactions = [], assignmentCodes = [], closingAmount = null) {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const metadata = await getSpreadsheetMetadata(sheets);
  const sourceSheet = getSheetByName(metadata, SOURCE_SHEET_NAME);
  const generatedSheet = await duplicateSourceSheet(sheets, metadata);
  const rows = buildGoogleSheetRows(parsedTransactions, assignmentCodes);

  await unmergeGeneratedSheetTransactionArea(sheets, sourceSheet, generatedSheet.sheetId);
  await clearGeneratedSheetColumns(sheets, generatedSheet.sheetName);
  await writeRowsToGeneratedSheet(sheets, generatedSheet.sheetName, rows);
  await updateGeneratedSheetClosingAmount(sheets, generatedSheet.sheetName, closingAmount);

  return {
    spreadsheetId,
    rowCount: rows.length,
    sourceSheetName: SOURCE_SHEET_NAME,
    generatedSheetName: generatedSheet.sheetName,
  };
}

function formatSheetDate(dateValue) {
  const match = String(dateValue || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(dateValue || '');
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function buildGoogleSheetRows(parsedTransactions = [], assignmentCodes = []) {
  return getSortedTransactions(parsedTransactions, assignmentCodes).map(({ transaction, assignmentCode }) => [
    formatSheetDate(transaction.date),
    Number((-Number(transaction.amount || 0)).toFixed(2)),
    transaction.description || '',
    assignmentCode,
  ]);
}
