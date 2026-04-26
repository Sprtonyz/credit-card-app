import fs from 'fs/promises';
import path from 'path';
import { parseWestpacStatementPdf } from '../../utils/westpacStatementParser';
import {
  ensureBackupSheet,
  updateWorkbookColumnsABC,
  workbookToBuffer,
} from '../../utils/workbookSheetUpdater';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const assignmentCodes = Array.isArray(req.body?.assignmentCodes) ? req.body.assignmentCodes : [];
    const localPdfPath = path.join(process.cwd(), 'local', 'estatement.pdf');
    const localWorkbookPath = path.join(process.cwd(), 'sheet.xlsx');
    const [pdfBuffer, workbookBuffer] = await Promise.all([
      fs.readFile(localPdfPath),
      fs.readFile(localWorkbookPath),
    ]);

    const parsed = await parseWestpacStatementPdf(pdfBuffer);
    const workbook = updateWorkbookColumnsABC(workbookBuffer, parsed.transactions, {
      assignmentCodes,
      closingAmount: parsed.statement?.closingBalance,
    });
    ensureBackupSheet(workbook, 'Sheet1', 'back up');
    const outputBuffer = workbookToBuffer(workbook);
    const outputName = 'sheet-updated-from-pdf.xlsx';
    const outputPath = path.join(process.cwd(), 'local', outputName);

    await fs.writeFile(outputPath, outputBuffer);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${outputName}"`);
    res.setHeader('X-Codex-Output-Path', outputPath);
    res.status(200).send(outputBuffer);
  } catch (error) {
    console.error('Failed to update sheet:', error);
    res.status(500).json({
      error: error?.message || 'Failed to update the sheet workbook.',
    });
  }
}
