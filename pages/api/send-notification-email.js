import {
  buildCustomUpdateContent,
  buildEmailContent,
  createTransport,
  getDefaultRecipients,
  getEmailSenderSettings,
  parseRecipients,
  sendEmail,
} from '../../services/emailNotificationService';
import { DEFAULT_APP_URL } from '../../config/emailNotifications';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const transporter = createTransport();
  const { from, replyTo } = getEmailSenderSettings();

  if (!transporter) {
    return res.status(500).json({
      error: 'Missing GMAIL_USER or GMAIL_APP_PASSWORD environment variable.',
    });
  }

  const payload = req.body || {};
  const recipients = payload.to ? parseRecipients(payload.to) : getDefaultRecipients();
  const reports = Array.isArray(payload.reports) && payload.reports.length > 0
    ? payload.reports
    : [
        {
          profileName: payload.profileName || 'Credit Card',
          stats: payload.stats || {},
          appUrl: payload.appUrl || DEFAULT_APP_URL,
          subject: payload.subject || 'Westpac CC Tracker update',
        },
      ];

  if (recipients.length === 0) {
    return res.status(400).json({ error: 'At least one recipient is required.' });
  }

  if (recipients.length > 50) {
    return res.status(400).json({ error: 'Too many recipients for one email.' });
  }

  if (payload.kind === 'custom_update') {
    const message = String(payload.message || '').trim();
    const subject = String(payload.subject || 'Westpac CC Tracker quick update').trim();

    if (!message) {
      return res.status(400).json({ error: 'Message is required.' });
    }

    if (message.length > 1200) {
      return res.status(400).json({ error: 'Message is too long.' });
    }

    const { text, html } = buildCustomUpdateContent({
      message,
      appUrl: payload.appUrl || DEFAULT_APP_URL,
    });
    const info = await sendEmail({
      transporter,
      from,
      replyTo,
      to: recipients,
      subject,
      text,
      html,
    });

    return res.status(200).json({
      ok: true,
      sent: [
        {
          messageId: info.messageId,
          subject,
          recipients,
        },
      ],
      sender: from,
    });
  }

  const sent = [];
  for (const report of reports) {
    const profileName = report.profileName || report.profile || 'Profile';
    const subject = String(report.subject || `${profileName} summary`).trim();
    const { text, html } = buildEmailContent({
      ...report,
      profileName,
      appUrl: report.appUrl || DEFAULT_APP_URL,
    });

    const info = await sendEmail({
      transporter,
      from,
      replyTo,
      to: recipients,
      subject,
      text,
      html,
    });

    sent.push({
      messageId: info.messageId,
      profileName,
      subject,
      recipients,
    });
  }

  return res.status(200).json({
    ok: true,
    sent,
    sender: from,
  });
}
