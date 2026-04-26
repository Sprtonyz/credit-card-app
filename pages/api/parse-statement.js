import { parseWestpacStatementPdf } from '../../utils/westpacStatementParser';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '15mb',
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { fileName, mimeType, data } = req.body || {};

    if (!data) {
      res.status(400).json({ error: 'Missing PDF data.' });
      return;
    }

    const base64 = String(data).includes(',') ? String(data).split(',').pop() : String(data);
    const pdfBuffer = Buffer.from(base64, 'base64');

    if (!pdfBuffer.length) {
      res.status(400).json({ error: 'Unable to read the uploaded file.' });
      return;
    }

    const parsed = await parseWestpacStatementPdf(pdfBuffer);

    res.status(200).json({
      fileName: fileName || 'statement.pdf',
      mimeType: mimeType || 'application/pdf',
      ...parsed,
    });
  } catch (error) {
    console.error('Failed to parse statement:', error);
    res.status(500).json({
      error: error?.message || 'Failed to parse PDF statement.',
    });
  }
}
