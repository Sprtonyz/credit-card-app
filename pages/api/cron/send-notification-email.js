import { runAutomatedNotificationEmail } from '../../../services/automatedNotificationService';

function isAuthorized(req) {
  const secret = process.env.CRON_SECRET || process.env.AUTOMATED_EMAIL_CRON_SECRET;
  if (!secret) return true;

  const authHeader = req.headers.authorization || '';
  const querySecret = req.query?.secret || '';

  return authHeader === `Bearer ${secret}` || querySecret === secret;
}

function getBooleanFlag(value) {
  return value === true || value === '1' || value === 'true';
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized cron request.' });
  }

  try {
    const result = await runAutomatedNotificationEmail({
      force: getBooleanFlag(req.query?.force) || getBooleanFlag(req.body?.force),
      dryRun: getBooleanFlag(req.query?.dryRun) || getBooleanFlag(req.body?.dryRun),
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error('Automated notification email failed:', error);
    return res.status(500).json({
      ok: false,
      error: error?.message || 'Automated notification email failed.',
    });
  }
}
