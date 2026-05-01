import nodemailer from 'nodemailer';

const DEFAULT_TEST_RECIPIENT = 'spr.tony@gmail.com';
const DEFAULT_GMAIL_USER = 'westpactracker@gmail.com';

function parseRecipients(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }

  return String(value || '')
    .split(/[\n,;]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCount(value) {
  return Number(value || 0).toLocaleString('en-AU');
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(Number(value || 0));
}

function getLandingUrl(appUrl) {
  try {
    const url = new URL(appUrl || 'https://ccapp-nine.vercel.app');
    url.searchParams.set('landing', '1');
    return url.toString();
  } catch {
    return `${String(appUrl || 'https://ccapp-nine.vercel.app').replace(/\/?$/, '')}/?landing=1`;
  }
}

function buildEmailContent(report) {
  const profileName = report.profileName || report.profile || 'Profile';
  const stats = report.stats || {};
  const appUrl = getLandingUrl(report.appUrl || 'https://ccapp-nine.vercel.app');
  const updatedAt = new Date().toLocaleString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

  const text = [
    `${profileName} update`,
    '',
    `Spend: ${formatCurrency(stats.totalSpend)}`,
    `New pending: ${formatCount(stats.pendingCount)}`,
    `Outstanding: ${formatCount(stats.outstandingCount)}`,
    `Conflicts: ${formatCount(stats.conflictsCount)}`,
    `Unsures: ${formatCount(stats.unsuresCount)}`,
    '',
    `Open the app: ${appUrl}`,
    `Updated: ${updatedAt}`,
  ]
    .filter(Boolean)
    .join('\n');

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#eef2f7;padding:32px;color:#0f172a">
      <div style="max-width:680px;margin:0 auto">
        <div style="background:#10223a;color:#ffffff;border-radius:18px 18px 0 0;padding:22px 28px">
          <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;opacity:.8">Westpac CC Tracker</div>
          <div style="margin-top:8px;font-size:26px;font-weight:700">${escapeHtml(profileName)} update</div>
          <div style="margin-top:6px;font-size:14px;opacity:.85">Snapshot from the latest upload.</div>
        </div>

        <div style="background:#ffffff;border:1px solid #dbe3ee;border-top:none;border-radius:0 0 18px 18px;padding:28px">
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">
            <div style="padding:14px 16px;border:1px solid #e5ebf3;border-radius:14px;background:#f8fbfe">
              <div style="color:#6b7a90;font-size:12px;text-transform:uppercase;letter-spacing:.08em">Spend</div>
              <div style="margin-top:8px;font-size:22px;font-weight:700">${escapeHtml(formatCurrency(stats.totalSpend))}</div>
            </div>
            <div style="padding:14px 16px;border:1px solid #e5ebf3;border-radius:14px;background:#f8fbfe">
              <div style="color:#6b7a90;font-size:12px;text-transform:uppercase;letter-spacing:.08em">New pending</div>
              <div style="margin-top:8px;font-size:22px;font-weight:700">${escapeHtml(formatCount(stats.pendingCount))}</div>
            </div>
            <div style="padding:14px 16px;border:1px solid #e5ebf3;border-radius:14px;background:#f8fbfe">
              <div style="color:#6b7a90;font-size:12px;text-transform:uppercase;letter-spacing:.08em">Outstanding</div>
              <div style="margin-top:8px;font-size:22px;font-weight:700">${escapeHtml(formatCount(stats.outstandingCount))}</div>
            </div>
            <div style="padding:14px 16px;border:1px solid #e5ebf3;border-radius:14px;background:#f8fbfe">
              <div style="color:#6b7a90;font-size:12px;text-transform:uppercase;letter-spacing:.08em">Conflicts</div>
              <div style="margin-top:8px;font-size:22px;font-weight:700">${escapeHtml(formatCount(stats.conflictsCount))}</div>
            </div>
            <div style="padding:14px 16px;border:1px solid #e5ebf3;border-radius:14px;background:#f8fbfe">
              <div style="color:#6b7a90;font-size:12px;text-transform:uppercase;letter-spacing:.08em">Unsures</div>
              <div style="margin-top:8px;font-size:22px;font-weight:700">${escapeHtml(formatCount(stats.unsuresCount))}</div>
            </div>
            <div style="padding:14px 16px;border:1px solid #e5ebf3;border-radius:14px;background:#f8fbfe">
              <div style="color:#6b7a90;font-size:12px;text-transform:uppercase;letter-spacing:.08em">Updated</div>
              <div style="margin-top:8px;font-size:18px;font-weight:700">${escapeHtml(updatedAt)}</div>
            </div>
          </div>

          <div style="margin-top:24px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
            <a
              href="${escapeHtml(appUrl)}"
              style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:700"
            >
              Open Westpac CC Tracker
            </a>
          </div>
        </div>
      </div>
    </div>
  `;

  return { text, html };
}

function buildCustomUpdateContent({ message, appUrl }) {
  const safeMessage = String(message || '').trim();
  const landingUrl = getLandingUrl(appUrl || 'https://ccapp-nine.vercel.app');
  const updatedAt = new Date().toLocaleString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  const htmlMessage = escapeHtml(safeMessage).replace(/\n/g, '<br />');

  const text = [
    'Westpac CC Tracker update',
    '',
    safeMessage,
    '',
    `Open the app: ${landingUrl}`,
    `Sent: ${updatedAt}`,
  ].join('\n');

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#eef2f7;padding:32px;color:#0f172a">
      <div style="max-width:640px;margin:0 auto">
        <div style="background:#10223a;color:#ffffff;border-radius:18px 18px 0 0;padding:22px 28px">
          <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;opacity:.8">Westpac CC Tracker</div>
          <div style="margin-top:8px;font-size:24px;font-weight:700">Quick update</div>
        </div>
        <div style="background:#ffffff;border:1px solid #dbe3ee;border-top:none;border-radius:0 0 18px 18px;padding:28px">
          <div style="font-size:16px;line-height:1.55;white-space:normal">${htmlMessage}</div>
          <div style="margin-top:24px;color:#64748b;font-size:13px">Sent ${escapeHtml(updatedAt)}</div>
          <div style="margin-top:22px">
            <a
              href="${escapeHtml(landingUrl)}"
              style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:700"
            >
              Open Westpac CC Tracker
            </a>
          </div>
        </div>
      </div>
    </div>
  `;

  return { text, html };
}

function createTransport() {
  const gmailUser = process.env.GMAIL_USER || DEFAULT_GMAIL_USER;
  const appPassword = process.env.GMAIL_APP_PASSWORD;

  if (!gmailUser || !appPassword) {
    return null;
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: gmailUser,
      pass: appPassword,
    },
  });
}

async function sendEmail({ transporter, from, replyTo, to, subject, text, html }) {
  const info = await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html,
    replyTo: replyTo || undefined,
  });

  return info;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const transporter = createTransport();
  const gmailUser = process.env.GMAIL_USER || DEFAULT_GMAIL_USER;
  const senderName = process.env.EMAIL_FROM_NAME || 'Westpac CC Tracker';
  const from = process.env.EMAIL_FROM || `${senderName} <${gmailUser}>`;
  const replyTo = process.env.EMAIL_REPLY_TO || undefined;

  if (!transporter) {
    return res.status(500).json({
      error: 'Missing GMAIL_USER or GMAIL_APP_PASSWORD environment variable.',
    });
  }

  const payload = req.body || {};
  const recipients = parseRecipients(
    payload.to || process.env.EMAIL_TEST_RECIPIENT || DEFAULT_TEST_RECIPIENT
  );
  const reports = Array.isArray(payload.reports) && payload.reports.length > 0
    ? payload.reports
    : [
        {
          profileName: payload.profileName || 'Credit Card',
          stats: payload.stats || {},
          appUrl: payload.appUrl || 'https://ccapp-nine.vercel.app',
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
      appUrl: payload.appUrl || 'https://ccapp-nine.vercel.app',
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
      appUrl: report.appUrl || 'https://ccapp-nine.vercel.app',
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
