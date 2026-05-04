import { runAutomatedNotificationEmail } from '../../../services/automatedNotificationService';
import {
  appendAutomationEvent,
  getFirebaseRestAuthToken,
} from '../../../services/firebaseRestService';

function isAuthorized(req) {
  const secret = process.env.CRON_SECRET || process.env.AUTOMATED_EMAIL_CRON_SECRET;
  if (!secret) return true;

  const authHeader = req.headers.authorization || '';
  const querySecret = req.query?.secret || '';

  return (
    authHeader === `Bearer ${secret}` ||
    querySecret === secret ||
    Boolean(req.headers['x-vercel-cron-auth-token'])
  );
}

function getBooleanFlag(value) {
  return value === true || value === '1' || value === 'true';
}

function getSafeRequestMeta(req) {
  return {
    method: req.method,
    url: req.url,
    hasAuthorizationHeader: Boolean(req.headers.authorization),
    hasVercelCronHeader: Boolean(req.headers['x-vercel-cron-auth-token']),
    userAgent: req.headers['user-agent'] || null,
  };
}

async function logAutomationEvent(event, authToken) {
  try {
    await appendAutomationEvent(event, authToken);
  } catch (error) {
    console.warn('Failed to write automation event:', error);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authToken = await getFirebaseRestAuthToken();
  const requestMeta = getSafeRequestMeta(req);
  await logAutomationEvent(
    {
      type: 'cron_invoked',
      request: requestMeta,
    },
    authToken
  );

  if (!isAuthorized(req)) {
    await logAutomationEvent(
      {
        type: 'cron_unauthorized',
        request: requestMeta,
      },
      authToken
    );
    return res.status(401).json({ error: 'Unauthorized cron request.' });
  }

  try {
    const result = await runAutomatedNotificationEmail({
      force: getBooleanFlag(req.query?.force) || getBooleanFlag(req.body?.force),
      dryRun: getBooleanFlag(req.query?.dryRun) || getBooleanFlag(req.body?.dryRun),
    });

    await logAutomationEvent(
      {
        type: 'cron_result',
        skipped: Boolean(result.skipped),
        reason: result.reason || null,
        dryRun: Boolean(result.dryRun),
        localDate: result.localDate || null,
        localTime: result.localTime || null,
        schedule: result.schedule || null,
        sentProfiles: Array.isArray(result.sent)
          ? result.sent.map((item) => item.profileName).filter(Boolean)
          : [],
      },
      authToken
    );

    return res.status(200).json(result);
  } catch (error) {
    console.error('Automated notification email failed:', error);
    await logAutomationEvent(
      {
        type: 'cron_error',
        error: error?.message || 'Automated notification email failed.',
        request: requestMeta,
      },
      authToken
    );
    return res.status(500).json({
      ok: false,
      error: error?.message || 'Automated notification email failed.',
    });
  }
}
