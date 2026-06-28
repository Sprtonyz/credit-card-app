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
    const assignmentComments = Array.isArray(req.body?.assignmentComments)
      ? req.body.assignmentComments
      : [];
    const transactions = Array.isArray(req.body?.transactions) ? req.body.transactions : null;
    const closingBalance = Number(req.body?.closingBalance);

    if (!transactions) {
      res.status(400).json({ error: 'Missing parsed transactions.' });
      return;
    }

    const result = await pushRowsToGoogleSheet(
      transactions,
      assignmentCodes,
      assignmentComments,
      Number.isFinite(closingBalance) ? closingBalance : null
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
