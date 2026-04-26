import XLSX from 'xlsx';

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

function buildClosingAmountCell(amountValue, templateCell) {
  const numericAmount = Number(amountValue || 0);
  return {
    t: 'n',
    v: Number(numericAmount.toFixed(2)),
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
  const descriptionTemplate = worksheet.C1 || worksheet.C2 || null;
  const assignmentTemplate = worksheet.D1 || worksheet.D2 || null;
  const closingAmountTemplate = worksheet.G9 || worksheet.G10 || null;
  const assignmentCodes = Array.isArray(options.assignmentCodes) ? options.assignmentCodes : [];

  for (let rowIndex = 1; rowIndex <= maxNeededRow; rowIndex += 1) {
    const transaction = transactions[rowIndex - 1];
    const addressA = `A${rowIndex}`;
    const addressB = `B${rowIndex}`;
    const addressC = `C${rowIndex}`;
    const addressD = `D${rowIndex}`;

    if (transaction) {
      worksheet[addressA] = buildDateCell(transaction.date, dateTemplate);
      worksheet[addressB] = buildAmountCell(transaction.amount, amountTemplate);
      worksheet[addressC] = buildDescriptionCell(transaction.description, descriptionTemplate);
      worksheet[addressD] = buildAssignmentCell(assignmentCodes[rowIndex - 1] || '', assignmentTemplate);
      continue;
    }

    clearCellAddress(worksheet, addressA);
    clearCellAddress(worksheet, addressB);
    clearCellAddress(worksheet, addressC);
    clearCellAddress(worksheet, addressD);
  }

  if (options.closingAmount !== undefined && options.closingAmount !== null) {
    worksheet.G9 = buildClosingAmountCell(options.closingAmount, closingAmountTemplate);
  }

  const existingEndCol = Math.max(range.e.c, XLSX.utils.decode_col('R'));
  worksheet['!ref'] = XLSX.utils.encode_range({
    s: { c: 0, r: 0 },
    e: { c: existingEndCol, r: Math.max(maxExistingRow, maxNeededRow) - 1 },
  });

  return workbook;
}

export function workbookToBuffer(workbook) {
  return XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
    cellStyles: true,
  });
}
