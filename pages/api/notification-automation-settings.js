import {
  DEFAULT_AUTOMATED_EMAIL_TIME_ZONE,
  DEFAULT_AUTOMATED_EMAIL_WINDOW_MINUTES,
} from '../../config/emailNotifications';
import {
  getAutomationSettings,
  getFirebaseRestAuthToken,
  saveAutomationSettings,
} from '../../services/firebaseRestService';
import { formatScheduledTime } from '../../utils/emailSchedule';

function isAuthorized(req) {
  const secret = process.env.CRON_SECRET || process.env.AUTOMATED_EMAIL_CRON_SECRET;
  if (!secret) return true;

  const authHeader = req.headers.authorization || '';
  const querySecret = req.query?.secret || '';

  return authHeader === `Bearer ${secret}` || querySecret === secret;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized settings request.' });
  }

  try {
    const authToken = await getFirebaseRestAuthToken();

    if (req.method === 'GET') {
      const settings = await getAutomationSettings(authToken);
      return res.status(200).json({ ok: true, settings });
    }

    const time = formatScheduledTime(req.body?.time);
    const timeZone = req.body?.timeZone || DEFAULT_AUTOMATED_EMAIL_TIME_ZONE;
    const windowMinutes =
      Number(req.body?.windowMinutes) || DEFAULT_AUTOMATED_EMAIL_WINDOW_MINUTES;

    const saved = await saveAutomationSettings(
      {
        time,
        timeZone,
        windowMinutes,
        updatedAt: new Date().toISOString(),
      },
      authToken
    );

    return res.status(200).json({
      ok: true,
      settings: {
        time: saved?.time || time,
        timeZone: saved?.timeZone || timeZone,
        windowMinutes: Number(saved?.windowMinutes) || windowMinutes,
        updatedAt: saved?.updatedAt || null,
      },
    });
  } catch (error) {
    console.error('Notification automation settings request failed:', error);
    return res.status(400).json({
      ok: false,
      error: error?.message || 'Failed to update notification automation settings.',
    });
  }
}
