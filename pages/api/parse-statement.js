import { parseWestpacStatementPdf } from '../../utils/westpacStatementParser';
import fs from 'fs/promises';
import path from 'path';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '15mb',
    },
  },
};

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const localPdfPath = path.join(process.cwd(), 'local', 'estatement.pdf');
      const pdfBuffer = await fs.readFile(localPdfPath);
      const parsed = await parseWestpacStatementPdf(pdfBuffer);

      res.status(200).json({
        fileName: 'local/estatement.pdf',
        mimeType: 'application/pdf',
        source: 'local',
        ...parsed,
      });
    } catch (error) {
      console.error('Failed to parse local statement:', error);
      res.status(500).json({
        error: error?.message || 'Failed to parse local PDF statement.',
      });
    }
    return;
  }

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
