import XLSX from 'xlsx';
import { buildTopSpendingsSummary } from './topSpendingsSummary.js';

const SPLIT_ASSIGNMENT_CODE = 'split';
const DUE_BALANCE_MATCH_TOLERANCE = 0.01;
const DUE_BALANCE_MATCH_FILL_RGB = 'FFC6EFCE';
const DUE_BALANCE_MISMATCH_FILL_RGB = 'FFFFC7CE';
const SPLIT_SHARE_FORMULAS = {
  t: '2/3',
  n: '1/3',
};
const ASSIGNMENT_FILL_RGB_BY_CODE = {
  n: 'FFA4C2F4',
  t: 'FFB7E1CD',
  macq: 'FFF9CB9C',
  macqbill: 'FFB4A7D6',
  split: 'FFD5A6BD',
};
const TOP_SPENDINGS_START_COLUMN = 'F';
const TOP_SPENDINGS_BASE_START_ROW = 140;
const TOP_SPENDINGS_ROW_BUFFER = 4;
const TOP_SPENDINGS_MAX_ROWS_PER_OWNER = 10;
const TOP_SPENDINGS_SECTION_GAP_ROWS = 2;
const TOP_SPENDINGS_CLEAR_BUFFER_ROWS = 6;

function parseIsoDate(dateValue) {
  const match = String(dateValue || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, monthIndex, day));

  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function buildDateCell(dateValue, templateCell) {
  const parsedDate = parseIsoDate(dateValue);
  if (!parsedDate) {
    return {
      t: 's',
      v: String(dateValue || ''),
      z: templateCell?.z || 'dd/mm/yyyy',
      s: templateCell?.s || undefined,
    };
  }

  return {
    t: 'd',
    v: parsedDate,
    z: templateCell?.z || 'dd/mm/yyyy',
    s: templateCell?.s || undefined,
  };
}

function buildAmountCell(amountValue, templateCell) {
  const numericAmount = Number(amountValue || 0);
  return {
    t: 'n',
    v: Number((-numericAmount).toFixed(2)),
    z: templateCell?.z || 'General',
    s: templateCell?.s || undefined,
  };
}

function buildDescriptionCell(descriptionValue, templateCell) {
  return {
    t: 's',
    v: String(descriptionValue || ''),
    z: templateCell?.z || 'General',
    s: templateCell?.s || undefined,
  };
}

function buildAssignmentCell(assignmentValue, templateCell) {
  return {
    t: 's',
    v: String(assignmentValue || ''),
    z: templateCell?.z || 'General',
    s: templateCell?.s || undefined,
  };
}

function buildCommentCell(commentValue, templateCell) {
  return {
    t: 's',
    v: String(commentValue || ''),
    z: templateCell?.z || 'General',
    s: templateCell?.s || undefined,
  };
}

function buildTextCell(textValue, templateCell) {
  return {
    t: 's',
    v: String(textValue || ''),
    z: templateCell?.z || 'General',
    s: templateCell?.s || undefined,
  };
}

function roundCurrency(value) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) return 0;
  return Number(numericValue.toFixed(2));
}

function normalizeAssignmentCode(value) {
  return String(value || '').trim().toLowerCase();
}

function buildClosingAmountCell(amountValue, templateCell) {
  const numericAmount = roundCurrency(amountValue);
  return {
    t: 'n',
    v: numericAmount,
    z: templateCell?.z || '$0.00',
    s: templateCell?.s || undefined,
  };
}

function clearCellAddress(worksheet, address) {
  if (worksheet[address]) {
    delete worksheet[address];
  }
}

function cloneWorksheet(worksheet) {
  return JSON.parse(JSON.stringify(worksheet));
}

function sumNumericColumn(worksheet, columnLetter, maxRow) {
  let sum = 0;

  for (let rowIndex = 1; rowIndex <= maxRow; rowIndex += 1) {
    const cell = worksheet[`${columnLetter}${rowIndex}`];
    if (!cell) continue;

    const numericValue = Number(cell.v);
    if (!Number.isFinite(numericValue)) continue;
    sum += numericValue;
  }

  return roundCurrency(sum);
}

function getLastUsedRowInColumnRange(worksheet, startColumnIndex, endColumnIndex) {
  let lastUsedRow = 0;
  const cellAddresses = Object.keys(worksheet).filter((address) => !address.startsWith('!'));

  for (const address of cellAddresses) {
    const decoded = XLSX.utils.decode_cell(address);
    if (decoded.c < startColumnIndex || decoded.c > endColumnIndex) continue;

    const cell = worksheet[address];
    const hasFormula = typeof cell?.f === 'string' && cell.f.trim().length > 0;
    const cellValue = cell?.v;
    const hasValue =
      cellValue !== undefined &&
      cellValue !== null &&
      !(typeof cellValue === 'string' && cellValue.trim().length === 0);

    if (!hasFormula && !hasValue) continue;
    lastUsedRow = Math.max(lastUsedRow, decoded.r + 1);
  }

  return lastUsedRow;
}

function clearCellBlock(worksheet, startColumnIndex, endColumnIndex, startRow, endRow) {
  for (let row = startRow; row <= endRow; row += 1) {
    for (let column = startColumnIndex; column <= endColumnIndex; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row - 1, c: column });
      clearCellAddress(worksheet, address);
    }
  }
}

function buildSummaryAmountCell(amountValue, templateCell) {
  return {
    t: 'n',
    v: roundCurrency(amountValue),
    z: templateCell?.z || '$#,##0.00',
    s: templateCell?.s || undefined,
  };
}

function writeTopSpendingsSummaryToSheet(
  worksheet,
  transactions,
  assignmentCodes,
  options = {}
) {
  const summarySections = buildTopSpendingsSummary(transactions, assignmentCodes, {
    maxRowsPerOwner: TOP_SPENDINGS_MAX_ROWS_PER_OWNER,
  });
  if (summarySections.length === 0) return null;

  const startColumnIndex = XLSX.utils.decode_col(
    options.startColumn || TOP_SPENDINGS_START_COLUMN
  );
  const startRow = Number.isInteger(options.startRow) && options.startRow > 0
    ? options.startRow
    : TOP_SPENDINGS_BASE_START_ROW;
  const merchantColumnIndex = startColumnIndex;
  const totalColumnIndex = startColumnIndex + 1;
  const estimatedRowsPerSection = TOP_SPENDINGS_MAX_ROWS_PER_OWNER + 2 + TOP_SPENDINGS_SECTION_GAP_ROWS;
  const clearEndRow =
    startRow +
    summarySections.length * estimatedRowsPerSection +
    TOP_SPENDINGS_CLEAR_BUFFER_ROWS;

  clearCellBlock(
    worksheet,
    merchantColumnIndex,
    totalColumnIndex,
    startRow,
    clearEndRow
  );

  const titleTemplate = worksheet.F1 || worksheet.C1 || worksheet.C2 || null;
  const textTemplate = worksheet.C103 || worksheet.C2 || worksheet.C1 || null;
  const amountTemplate = worksheet.G9 || worksheet.B1 || null;
  const startColumnLetter = XLSX.utils.encode_col(startColumnIndex);
  let currentRow = startRow;

  for (const section of summarySections) {
    worksheet[`${startColumnLetter}${currentRow}`] = buildTextCell(section.title, titleTemplate);
    currentRow += 1;

    worksheet[`${startColumnLetter}${currentRow}`] = buildTextCell('Merchant', textTemplate);
    worksheet[`${XLSX.utils.encode_col(totalColumnIndex)}${currentRow}`] = buildTextCell(
      section.totalLabel,
      textTemplate
    );
    currentRow += 1;

    const summaryRows =
      section.rows.length > 0
        ? section.rows
        : [{ merchant: 'No spending rows found', total: null }];

    for (const row of summaryRows) {
      worksheet[`${startColumnLetter}${currentRow}`] = buildTextCell(
        row.merchant,
        textTemplate
      );

      const totalAddress = `${XLSX.utils.encode_col(totalColumnIndex)}${currentRow}`;
      if (Number.isFinite(row.total)) {
        worksheet[totalAddress] = buildSummaryAmountCell(row.total, amountTemplate);
      } else {
        clearCellAddress(worksheet, totalAddress);
      }

      currentRow += 1;
    }

    currentRow += TOP_SPENDINGS_SECTION_GAP_ROWS;
  }

  return {
    endColumnIndex: totalColumnIndex,
    endRow: currentRow - 1,
  };
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

function applySplitAwareFormulas(worksheet) {
  const refRange = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
  let formulaWasUpdated = false;

  for (let rowIndex = refRange.s.r; rowIndex <= refRange.e.r; rowIndex += 1) {
    for (let columnIndex = refRange.s.c; columnIndex <= refRange.e.c; columnIndex += 1) {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      const cell = worksheet[address];
      if (!cell?.f) continue;

      const originalFormula = String(cell.f);
      const withTonySplit = withSplitShareFormula(originalFormula, 't');
      const withNugsSplit = withSplitShareFormula(withTonySplit, 'n');

      if (withNugsSplit === originalFormula) continue;
      worksheet[address].f = withNugsSplit;
      formulaWasUpdated = true;
    }
  }

  return formulaWasUpdated;
}

function markWorkbookForFullRecalculation(workbook) {
  workbook.Workbook = workbook.Workbook || {};
  const existingCalcPr = workbook.Workbook.CalcPr || {};
  workbook.Workbook.CalcPr = {
    ...existingCalcPr,
    fullCalcOnLoad: 'true',
    calcCompleted: 'false',
  };
}

function withAttribute(tagXml, attributeName, attributeValue) {
  const attributePattern = new RegExp(`\\b${attributeName}="[^"]*"`, 'i');
  if (attributePattern.test(tagXml)) {
    return tagXml.replace(attributePattern, `${attributeName}="${attributeValue}"`);
  }
  return tagXml.replace(/\/>$/, ` ${attributeName}="${attributeValue}"/>`);
}

function withUpdatedCount(openingTag, countValue) {
  if (/\bcount="\d+"/i.test(openingTag)) {
    return openingTag.replace(/\bcount="\d+"/i, `count="${countValue}"`);
  }
  return openingTag.replace(/>$/, ` count="${countValue}">`);
}

function normalizeXmlSnippet(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function withFontColor(fontXml, colorRgb = 'FF000000') {
  const colorTag = `<color rgb="${colorRgb}"/>`;
  if (/<color\b[^>]*\/>/i.test(fontXml)) {
    return fontXml.replace(/<color\b[^>]*\/>/i, colorTag);
  }
  if (/<color\b[^>]*>[\s\S]*?<\/color>/i.test(fontXml)) {
    return fontXml.replace(/<color\b[^>]*>[\s\S]*?<\/color>/i, colorTag);
  }
  return fontXml.replace(/<\/font>/i, `${colorTag}</font>`);
}

function ensureBlackFontFromStyle(stylesXml, baseStyleIndex) {
  const fontsBlockMatch = stylesXml.match(/<fonts\b[^>]*>[\s\S]*?<\/fonts>/i);
  const cellXfsBlockMatch = stylesXml.match(/<cellXfs\b[^>]*>[\s\S]*?<\/cellXfs>/i);
  if (!fontsBlockMatch || !cellXfsBlockMatch) {
    return { stylesXml, fontId: 0 };
  }

  const fontsBlock = fontsBlockMatch[0];
  const fontsInnerMatch = fontsBlock.match(/<fonts\b[^>]*>([\s\S]*?)<\/fonts>/i);
  const fontsInner = fontsInnerMatch?.[1] || '';
  const fontEntries = fontsInner.match(/<font>[\s\S]*?<\/font>/gi) || [];
  if (fontEntries.length === 0) {
    return { stylesXml, fontId: 0 };
  }

  const cellXfsBlock = cellXfsBlockMatch[0];
  const cellXfsInnerMatch = cellXfsBlock.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/i);
  const cellXfsInner = cellXfsInnerMatch?.[1] || '';
  const xfEntries = cellXfsInner.match(/<xf\b[^>]*\/>/gi) || [];
  const safeBaseIndex = Math.min(Math.max(baseStyleIndex, 0), Math.max(xfEntries.length - 1, 0));
  const baseXfEntry = xfEntries[safeBaseIndex] || xfEntries[0] || '';
  const baseFontIdMatch = baseXfEntry.match(/\bfontId="(\d+)"/i);
  const baseFontId = baseFontIdMatch ? Number(baseFontIdMatch[1]) : 0;
  const safeFontIndex = Math.min(Math.max(baseFontId, 0), fontEntries.length - 1);
  const baseFontEntry = fontEntries[safeFontIndex] || fontEntries[0];
  const blackFontEntry = withFontColor(baseFontEntry, 'FF000000');
  const normalizedTarget = normalizeXmlSnippet(blackFontEntry);
  const existingIndex = fontEntries.findIndex(
    (entry) => normalizeXmlSnippet(entry) === normalizedTarget
  );
  if (existingIndex !== -1) {
    return { stylesXml, fontId: existingIndex };
  }

  const openingTag = fontsBlock.match(/<fonts\b[^>]*>/i)?.[0] || '<fonts>';
  const updatedOpeningTag = withUpdatedCount(openingTag, fontEntries.length + 1);
  const updatedFontsBlock = `${updatedOpeningTag}${fontsInner}${blackFontEntry}</fonts>`;
  return {
    stylesXml: stylesXml.replace(fontsBlock, updatedFontsBlock),
    fontId: fontEntries.length,
  };
}

function ensureSolidFill(stylesXml, fillRgb) {
  const fillsBlockMatch = stylesXml.match(/<fills\b[^>]*>[\s\S]*?<\/fills>/i);
  if (!fillsBlockMatch) {
    return { stylesXml, fillId: 0 };
  }

  const fillsBlock = fillsBlockMatch[0];
  const fillsInnerMatch = fillsBlock.match(/<fills\b[^>]*>([\s\S]*?)<\/fills>/i);
  const fillsInner = fillsInnerMatch?.[1] || '';
  const fillEntries = fillsInner.match(/<fill>[\s\S]*?<\/fill>/gi) || [];
  const solidFillPattern = new RegExp(
    `<patternFill[^>]*patternType="solid"[^>]*>[\\s\\S]*?<fgColor[^>]*rgb="${fillRgb}"`,
    'i'
  );

  for (let index = 0; index < fillEntries.length; index += 1) {
    if (solidFillPattern.test(fillEntries[index])) {
      return { stylesXml, fillId: index };
    }
  }

  const appendedFillEntry = `<fill><patternFill patternType="solid"><fgColor rgb="${fillRgb}"/><bgColor rgb="${fillRgb}"/></patternFill></fill>`;
  const openingTag = fillsBlock.match(/<fills\b[^>]*>/i)?.[0] || '<fills>';
  const updatedOpeningTag = withUpdatedCount(openingTag, fillEntries.length + 1);
  const updatedFillsBlock = `${updatedOpeningTag}${fillsInner}${appendedFillEntry}</fills>`;

  return {
    stylesXml: stylesXml.replace(fillsBlock, updatedFillsBlock),
    fillId: fillEntries.length,
  };
}

function ensureCellXfVariant(stylesXml, baseStyleIndex, options = {}) {
  const cellXfsBlockMatch = stylesXml.match(/<cellXfs\b[^>]*>[\s\S]*?<\/cellXfs>/i);
  if (!cellXfsBlockMatch) {
    return { stylesXml, styleIndex: baseStyleIndex };
  }

  const cellXfsBlock = cellXfsBlockMatch[0];
  const cellXfsInnerMatch = cellXfsBlock.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/i);
  const cellXfsInner = cellXfsInnerMatch?.[1] || '';
  const xfEntries = cellXfsInner.match(/<xf\b[^>]*\/>/gi) || [];
  if (xfEntries.length === 0) {
    return { stylesXml, styleIndex: baseStyleIndex };
  }

  const safeBaseIndex = Math.min(Math.max(baseStyleIndex, 0), xfEntries.length - 1);
  let targetXfEntry = xfEntries[safeBaseIndex];

  if (options.fillId !== undefined) {
    targetXfEntry = withAttribute(targetXfEntry, 'fillId', String(options.fillId));
  }
  if (options.applyFill !== undefined) {
    targetXfEntry = withAttribute(targetXfEntry, 'applyFill', options.applyFill ? '1' : '0');
  }
  if (options.fontId !== undefined) {
    targetXfEntry = withAttribute(targetXfEntry, 'fontId', String(options.fontId));
  }
  if (options.applyFont !== undefined) {
    targetXfEntry = withAttribute(targetXfEntry, 'applyFont', options.applyFont ? '1' : '0');
  }

  const normalizedTarget = normalizeXmlSnippet(targetXfEntry);
  const existingIndex = xfEntries.findIndex(
    (entry) => normalizeXmlSnippet(entry) === normalizedTarget
  );
  if (existingIndex !== -1) {
    return { stylesXml, styleIndex: existingIndex };
  }

  const openingTag = cellXfsBlock.match(/<cellXfs\b[^>]*>/i)?.[0] || '<cellXfs>';
  const updatedOpeningTag = withUpdatedCount(openingTag, xfEntries.length + 1);
  const updatedCellXfsBlock = `${updatedOpeningTag}${cellXfsInner}${targetXfEntry}</cellXfs>`;

  return {
    stylesXml: stylesXml.replace(cellXfsBlock, updatedCellXfsBlock),
    styleIndex: xfEntries.length,
  };
}

function getWorksheetXmlPath(workbook, sheetName) {
  const workbookSheets = Array.isArray(workbook?.Workbook?.Sheets)
    ? workbook.Workbook.Sheets
    : [];
  const selectedSheet = workbookSheets.find((sheet) => sheet?.name === sheetName) || workbookSheets[0];
  const sheetId = Number(selectedSheet?.sheetId);
  if (!Number.isInteger(sheetId) || sheetId <= 0) return 'xl/worksheets/sheet1.xml';
  return `xl/worksheets/sheet${sheetId}.xml`;
}

function getCellStyleIndex(sheetXml, cellAddress = 'G9') {
  const cellTagMatch = sheetXml.match(new RegExp(`<c\\b[^>]*\\br="${cellAddress}"[^>]*>`, 'i'));
  if (!cellTagMatch) return 0;
  const styleMatch = cellTagMatch[0].match(/\bs="(\d+)"/i);
  return styleMatch ? Number(styleMatch[1]) : 0;
}

function applyStyleIndexToCell(sheetXml, cellAddress, styleIndex) {
  const cellTagPattern = new RegExp(`<c\\b[^>]*\\br="${cellAddress}"[^>]*>`, 'i');
  const cellTagMatch = sheetXml.match(cellTagPattern);
  if (!cellTagMatch) return sheetXml;

  const existingTag = cellTagMatch[0];
  const updatedTag = /\bs="\d+"/i.test(existingTag)
    ? existingTag.replace(/\bs="\d+"/i, `s="${styleIndex}"`)
    : existingTag.replace(/<c\b/i, `<c s="${styleIndex}"`);

  return sheetXml.replace(existingTag, updatedTag);
}

function applyAssignmentCodeHighlights(workbookBuffer, workbook, assignmentConfig) {
  if (!assignmentConfig?.sheetName || !Array.isArray(assignmentConfig.rows)) {
    return workbookBuffer;
  }

  const targetSheetPath = getWorksheetXmlPath(workbook, assignmentConfig.sheetName);
  const workbookArchive = XLSX.CFB.read(workbookBuffer, { type: 'buffer' });
  const stylesEntry = XLSX.CFB.find(workbookArchive, '/xl/styles.xml');
  const targetSheetEntry = XLSX.CFB.find(workbookArchive, `/${targetSheetPath}`);
  if (!stylesEntry || !targetSheetEntry) return workbookBuffer;

  let stylesXml = Buffer.from(stylesEntry.content || []).toString('utf8');
  let targetSheetXml = Buffer.from(targetSheetEntry.content || []).toString('utf8');
  const baseStyleIndex = getCellStyleIndex(targetSheetXml, 'D1');
  const fontResult = ensureBlackFontFromStyle(stylesXml, baseStyleIndex);
  stylesXml = fontResult.stylesXml;

  const defaultStyleResult = ensureCellXfVariant(stylesXml, baseStyleIndex, {
    fillId: 0,
    applyFill: false,
    fontId: fontResult.fontId,
    applyFont: true,
  });
  stylesXml = defaultStyleResult.stylesXml;
  const defaultStyleIndex = defaultStyleResult.styleIndex;
  const styleIndexByCode = {};

  for (const [code, fillRgb] of Object.entries(ASSIGNMENT_FILL_RGB_BY_CODE)) {
    const fillResult = ensureSolidFill(stylesXml, fillRgb);
    stylesXml = fillResult.stylesXml;

    const styleResult = ensureCellXfVariant(stylesXml, baseStyleIndex, {
      fillId: fillResult.fillId,
      applyFill: true,
      fontId: fontResult.fontId,
      applyFont: true,
    });
    stylesXml = styleResult.stylesXml;
    styleIndexByCode[code] = styleResult.styleIndex;
  }

  for (const rowEntry of assignmentConfig.rows) {
    const rowNumber = Number(rowEntry?.row);
    if (!Number.isInteger(rowNumber) || rowNumber <= 0) continue;

    const assignmentCode = normalizeAssignmentCode(rowEntry?.code);
    const styleIndex = styleIndexByCode[assignmentCode] ?? defaultStyleIndex;

    targetSheetXml = applyStyleIndexToCell(targetSheetXml, `D${rowNumber}`, styleIndex);
  }

  stylesEntry.content = Buffer.from(stylesXml, 'utf8');
  targetSheetEntry.content = Buffer.from(targetSheetXml, 'utf8');
  return XLSX.CFB.write(workbookArchive, { type: 'buffer' });
}

function applyDueBalanceHighlight(workbookBuffer, workbook, highlightConfig) {
  if (!highlightConfig?.sheetName) return workbookBuffer;

  const targetSheetPath = getWorksheetXmlPath(workbook, highlightConfig.sheetName);
  const workbookArchive = XLSX.CFB.read(workbookBuffer, { type: 'buffer' });
  const stylesEntry = XLSX.CFB.find(workbookArchive, '/xl/styles.xml');
  const targetSheetEntry = XLSX.CFB.find(workbookArchive, `/${targetSheetPath}`);
  if (!stylesEntry || !targetSheetEntry) return workbookBuffer;

  const fillRgb = highlightConfig.isMatch
    ? DUE_BALANCE_MATCH_FILL_RGB
    : DUE_BALANCE_MISMATCH_FILL_RGB;

  let stylesXml = Buffer.from(stylesEntry.content || []).toString('utf8');
  const targetSheetXml = Buffer.from(targetSheetEntry.content || []).toString('utf8');
  const g9BaseStyleIndex = getCellStyleIndex(targetSheetXml, 'G9');

  const fillResult = ensureSolidFill(stylesXml, fillRgb);
  stylesXml = fillResult.stylesXml;

  const styleResult = ensureCellXfVariant(stylesXml, g9BaseStyleIndex, {
    fillId: fillResult.fillId,
    applyFill: true,
  });
  stylesXml = styleResult.stylesXml;

  const updatedSheetXml = applyStyleIndexToCell(targetSheetXml, 'G9', styleResult.styleIndex);

  stylesEntry.content = Buffer.from(stylesXml, 'utf8');
  targetSheetEntry.content = Buffer.from(updatedSheetXml, 'utf8');
  return XLSX.CFB.write(workbookArchive, { type: 'buffer' });
}

export function ensureBackupSheet(workbook, sourceSheetName = 'Sheet1', backupSheetName = 'back up') {
  if (!workbook?.Sheets?.[sourceSheetName]) {
    throw new Error(`Source worksheet "${sourceSheetName}" was not found.`);
  }

  if (workbook.Sheets[backupSheetName]) {
    delete workbook.Sheets[backupSheetName];
    workbook.SheetNames = workbook.SheetNames.filter((name) => name !== backupSheetName);
  }

  workbook.Sheets[backupSheetName] = cloneWorksheet(workbook.Sheets[sourceSheetName]);
  workbook.SheetNames.push(backupSheetName);
  return workbook;
}

export function updateWorkbookColumnsABC(workbookBuffer, transactions = [], options = {}) {
  const workbook = XLSX.read(workbookBuffer, {
    type: 'buffer',
    cellDates: true,
    cellFormula: true,
    cellNF: true,
    cellStyles: true,
  });

  const sheetName = options.sheetName || workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  if (!worksheet) {
    throw new Error('Workbook does not contain a worksheet to update.');
  }

  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:C1');
  const maxExistingRow = range.e.r + 1;
  const maxNeededRow = Math.max(maxExistingRow, transactions.length || 1);
  const dateTemplate = worksheet.A1 || worksheet.A2 || null;
  const amountTemplate = worksheet.B1 || worksheet.B2 || null;
  const descriptionTemplate = worksheet.C103 || worksheet.C2 || worksheet.C1 || null;
  const assignmentTemplate = worksheet.D1 || worksheet.D2 || null;
  const commentTemplate = worksheet.E1 || worksheet.E2 || null;
  const closingAmountTemplate = worksheet.G9 || worksheet.G10 || null;
  const assignmentCodes = Array.isArray(options.assignmentCodes) ? options.assignmentCodes : [];
  const assignmentComments = Array.isArray(options.assignmentComments) ? options.assignmentComments : [];
  const assignmentColorRows = [];

  const splitFormulaUpdated = applySplitAwareFormulas(worksheet);
  if (splitFormulaUpdated) {
    markWorkbookForFullRecalculation(workbook);
  }

  for (let rowIndex = 1; rowIndex <= maxNeededRow; rowIndex += 1) {
    const transaction = transactions[rowIndex - 1];
    const addressA = `A${rowIndex}`;
    const addressB = `B${rowIndex}`;
    const addressC = `C${rowIndex}`;
    const addressD = `D${rowIndex}`;
    const addressE = `E${rowIndex}`;

    if (transaction) {
      worksheet[addressA] = buildDateCell(transaction.date, dateTemplate);
      worksheet[addressB] = buildAmountCell(transaction.amount, amountTemplate);
      worksheet[addressC] = buildDescriptionCell(transaction.description, descriptionTemplate);
      const assignmentCode = String(assignmentCodes[rowIndex - 1] || '').trim();
      const assignmentComment = String(assignmentComments[rowIndex - 1] || '').trim();
      if (!assignmentCode) {
        clearCellAddress(worksheet, addressD);
      } else {
        worksheet[addressD] = buildAssignmentCell(assignmentCode, assignmentTemplate);
        assignmentColorRows.push({ row: rowIndex, code: assignmentCode });
      }
      if (!assignmentComment) {
        clearCellAddress(worksheet, addressE);
      } else {
        worksheet[addressE] = buildCommentCell(assignmentComment, commentTemplate);
      }
      continue;
    }

    clearCellAddress(worksheet, addressA);
    clearCellAddress(worksheet, addressB);
    clearCellAddress(worksheet, addressC);
    clearCellAddress(worksheet, addressD);
    clearCellAddress(worksheet, addressE);
  }

  const summaryAnchorStartRow = Math.max(
    TOP_SPENDINGS_BASE_START_ROW,
    maxNeededRow + TOP_SPENDINGS_ROW_BUFFER,
    getLastUsedRowInColumnRange(
      worksheet,
      XLSX.utils.decode_col(TOP_SPENDINGS_START_COLUMN),
      XLSX.utils.decode_col('R')
    ) + TOP_SPENDINGS_ROW_BUFFER
  );

  const topSpendingsSummaryPlacement = writeTopSpendingsSummaryToSheet(
    worksheet,
    transactions,
    assignmentCodes,
    {
      startColumn: TOP_SPENDINGS_START_COLUMN,
      startRow: summaryAnchorStartRow,
    }
  );

  if (options.closingAmount !== undefined && options.closingAmount !== null) {
    const dueBalance = roundCurrency(options.closingAmount);
    const importedTotalAbs = Math.abs(sumNumericColumn(worksheet, 'B', maxNeededRow));
    const dueBalanceMatchesTally =
      Math.abs(importedTotalAbs - dueBalance) <= DUE_BALANCE_MATCH_TOLERANCE;

    worksheet.G9 = buildClosingAmountCell(dueBalance, closingAmountTemplate);
    workbook.__dueBalanceHighlight = {
      sheetName,
      isMatch: dueBalanceMatchesTally,
    };
  }

  workbook.__assignmentHighlight = {
    sheetName,
    rows: assignmentColorRows,
  };

  const existingEndCol = Math.max(
    range.e.c,
    XLSX.utils.decode_col('R'),
    topSpendingsSummaryPlacement?.endColumnIndex ?? 0
  );
  const existingEndRow = Math.max(
    maxExistingRow,
    maxNeededRow,
    topSpendingsSummaryPlacement?.endRow ?? 0,
    1
  );
  worksheet['!ref'] = XLSX.utils.encode_range({
    s: { c: 0, r: 0 },
    e: { c: existingEndCol, r: existingEndRow - 1 },
  });

  return workbook;
}

export function workbookToBuffer(workbook) {
  const workbookBuffer = XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
    cellStyles: true,
  });

  let updatedBuffer = workbookBuffer;

  if (workbook?.__assignmentHighlight) {
    updatedBuffer = applyAssignmentCodeHighlights(
      updatedBuffer,
      workbook,
      workbook.__assignmentHighlight
    );
  }

  if (workbook?.__dueBalanceHighlight) {
    updatedBuffer = applyDueBalanceHighlight(
      updatedBuffer,
      workbook,
      workbook.__dueBalanceHighlight
    );
  }

  return updatedBuffer;
}
