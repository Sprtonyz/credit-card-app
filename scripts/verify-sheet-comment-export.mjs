import assert from 'assert/strict';
import XLSX from 'xlsx';
import { buildResolvedAssignmentPool } from '../utils/assignmentMatcher.js';
import { buildGoogleSheetRows } from '../services/googleSheetsService.js';
import { updateWorkbookColumnsABC } from '../utils/workbookSheetUpdater.js';

function buildTemplateWorkbook() {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['Date', 'Amount', 'Description', 'Owner', 'Comment'],
    ['', '', '', '', ''],
  ]);

  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

const transactions = [
  { id: 'tx-1', date: '2026-06-28', amount: 42.15, description: 'Uniqlo', merchant: 'Uniqlo' },
  { id: 'tx-2', date: '2026-06-29', amount: 8.75, description: 'Banh Mi', merchant: 'Banh Mi' },
];

const submissions = {
  'tx-1': {
    Tony: { value: 'Tony', ts: 1, comment: 'Before assignment note' },
    Nugs: { value: 'Tony', ts: 2, comment: 'Funeral Attire' },
  },
  'tx-2': {
    Tony: { value: 'Nugs', ts: 3 },
    Nugs: { value: 'Nugs', ts: 4 },
  },
};

const assignmentComments = {
  'tx-1': {
    Tony: { comment: 'Before assignment note', ts: 1 },
    Nugs: { comment: 'Funeral Attire', ts: 2 },
  },
};

const pool = buildResolvedAssignmentPool(transactions, submissions, assignmentComments);
assert.equal(pool.length, 2);
assert.equal(pool[0].comment, 'Before assignment note\nFuneral Attire');

const rows = buildGoogleSheetRows(
  transactions,
  ['t', 'n'],
  ['Funeral Attire', 'Banh Mi note']
);
assert.equal(rows[0].length, 5);
assert.equal(rows[0][4], 'Funeral Attire');
assert.equal(rows[1][4], 'Banh Mi note');

const workbookBuffer = buildTemplateWorkbook();
const workbook = updateWorkbookColumnsABC(workbookBuffer, transactions, {
  assignmentCodes: ['t', 'n'],
  assignmentComments: ['Funeral Attire', 'Banh Mi note'],
});
const sheet = workbook.Sheets.Sheet1;

assert.ok(sheet.A1.v instanceof Date);
assert.equal(sheet.A1.v.toISOString().slice(0, 10), '2026-06-28');
assert.equal(sheet.D1.v, 't');
assert.equal(sheet.E1.v, 'Funeral Attire');
assert.equal(sheet.E2.v, 'Banh Mi note');

console.log('Sheet comment export verifier passed.');
