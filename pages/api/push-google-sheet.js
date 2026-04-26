import fs from 'fs/promises';
import path from 'path';
import { parseWestpacStatementPdf } from '../../utils/westpacStatementParser';
import { pushRowsToGoogleSheet } from '../../services/googleSheetsService';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const assignmentCodes = Array.isArray(req.body?.assignmentCodes)
      ? req.body.assignmentCodes
      : [];
    const localPdfPath = path.join(process.cwd(), 'local', 'estatement.pdf');
    const pdfBuffer = await fs.readFile(localPdfPath);
    const parsed = await parseWestpacStatementPdf(pdfBuffer);
    const result = await pushRowsToGoogleSheet(
      parsed.transactions,
      assignmentCodes,
      parsed.statement?.closingBalance
    );

    res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error('Failed to push rows to Google Sheets:', error);
    res.status(500).json({
      error: error?.message || 'Failed to push rows to Google Sheets.',
    });
  }
}
