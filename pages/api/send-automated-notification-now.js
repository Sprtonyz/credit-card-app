import { runAutomatedNotificationEmail } from '../../services/automatedNotificationService';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const result = await runAutomatedNotificationEmail({ force: true });
    return res.status(200).json(result);
  } catch (error) {
    console.error('Forced automated notification email failed:', error);
    return res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to send automated notification emails.',
    });
  }
}
