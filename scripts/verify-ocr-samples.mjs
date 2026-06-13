import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Tesseract from 'tesseract.js';
import { parseOcrResult } from '../utils/imageProcessor.js';
import { correctTransaction } from '../utils/ocrErrorCorrection.js';

const SAMPLE_DIR = path.resolve(process.cwd(), 'local', 'ocroptimise');

async function parseSample(fileName) {
  const filePath = path.join(SAMPLE_DIR, fileName);
  const data = await Tesseract.recognize(filePath, 'eng', { tessedit_pageseg_mode: 6 });
  const parsed = parseOcrResult(
    {
      text: data.data.text,
      lines: data.data.lines,
      words: data.data.words,
      ocrMode: 'balanced',
    },
    'classic',
    '2026-06-13'
  );

  return {
    raw: parsed.rawTransactions,
    corrected: parsed.rawTransactions.map(correctTransaction),
  };
}

function assertNoForeignFeeRows(rows) {
  assert.equal(
    rows.some((row) => /foreign fee|frgn amt|u\. s\. dollar/i.test(String(row.rawLine || ''))),
    false,
    'foreign fee helper rows should be ignored'
  );
}

const image7 = await parseSample('image7.jpeg');
assert.equal(image7.raw.length, 4, 'image7 should keep the four real transactions');
assertNoForeignFeeRows(image7.raw);
assert.equal(image7.corrected[0].date, '2026-05-31', 'image7 first date should persist');
assert.equal(image7.corrected[1].date, '2026-05-31', 'image7 second row should inherit the date header');
assert.equal(image7.corrected[3].date, '2026-05-28', 'image7 final row should keep the last date header');
assert.equal(image7.raw[1].merchant, 'COLES 7795 BRAYBROOK AUS', 'image7 wrapped merchant should stay together');
assert.equal(image7.raw[1].amount, '-$32.25', 'image7 wrapped merchant should keep the real amount');

const image0 = await parseSample('image0.jpeg');
assert.equal(image0.raw.length, 2, 'image0 should still produce two rows');
assert.equal(image0.raw[0].merchant, 'COLES 7691 BRAYBROOK AU', 'image0 left-side icon should not become the merchant');
assert.equal(image0.raw[0].amount, '-$31.25', 'image0 amount should not be read as the store number');

const image4 = await parseSample('image4.jpeg');
assert.equal(image4.raw.length, 6, 'image4 should still produce six rows');
assert.equal(image4.raw[0].amount, '-$15.00', 'image4 ebay row should keep the real amount');
assert.equal(image4.corrected[5].amount, -149.9, 'image4 refund row should normalize as a refund');

const image1 = await parseSample('image1.jpeg');
assert.equal(image1.corrected.slice(-2)[0].date, '2026-06-12', 'image1 relative date should resolve yesterday');
assert.equal(image1.corrected.slice(-1)[0].date, '2026-06-12', 'image1 relative date should persist across the final rows');

console.log('OCR sample regression checks passed for image0, image1, image4, and image7.');
