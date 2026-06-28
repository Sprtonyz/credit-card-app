import fs from 'fs/promises';
import path from 'path';
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
      const assignmentComments = Array.isArray(req.body?.assignmentComments)
        ? req.body.assignmentComments
        : [];
      const transactions = Array.isArray(req.body?.transactions) ? req.body.transactions : null;
      const closingAmount = Number(req.body?.closingBalance);

    if (!transactions) {
      res.status(400).json({ error: 'Missing parsed transactions.' });
      return;
    }

    const localWorkbookPath = path.join(process.cwd(), 'sheet.xlsx');
    const workbookBuffer = await fs.readFile(localWorkbookPath);
    const workbook = updateWorkbookColumnsABC(workbookBuffer, transactions, {
      assignmentCodes,
      assignmentComments,
      closingAmount: Number.isFinite(closingAmount) ? closingAmount : null,
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
