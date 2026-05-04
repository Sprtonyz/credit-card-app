import nodemailer from 'nodemailer';
import {
  DEFAULT_APP_URL,
  DEFAULT_EMAIL_FROM_NAME,
  DEFAULT_EMAIL_RECIPIENTS,
  DEFAULT_GMAIL_USER,
  DEFAULT_RECIPIENTS_BY_PROFILE,
} from '../config/emailNotifications';

export function parseRecipients(value) {
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

export function getLandingUrl(appUrl) {
  try {
    const url = new URL(appUrl || DEFAULT_APP_URL);
    url.searchParams.set('landing', '1');
    return url.toString();
  } catch {
    return `${String(appUrl || DEFAULT_APP_URL).replace(/\/?$/, '')}/?landing=1`;
  }
}

export function buildEmailContent(report) {
  const profileName = report.profileName || report.profile || 'Profile';
  const stats = report.stats || {};
  const appUrl = getLandingUrl(report.appUrl || DEFAULT_APP_URL);
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

export function buildCustomUpdateContent({ message, appUrl }) {
  const safeMessage = String(message || '').trim();
  const landingUrl = getLandingUrl(appUrl || DEFAULT_APP_URL);
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

export function createTransport() {
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

export function getEmailSenderSettings() {
  const gmailUser = process.env.GMAIL_USER || DEFAULT_GMAIL_USER;
  const senderName = process.env.EMAIL_FROM_NAME || DEFAULT_EMAIL_FROM_NAME;

  return {
    gmailUser,
    from: process.env.EMAIL_FROM || `${senderName} <${gmailUser}>`,
    replyTo: process.env.EMAIL_REPLY_TO || undefined,
  };
}

export function getDefaultRecipients() {
  return parseRecipients(
    process.env.EMAIL_NOTIFICATION_RECIPIENTS ||
      process.env.EMAIL_RECIPIENTS ||
      process.env.EMAIL_TEST_RECIPIENT ||
      DEFAULT_EMAIL_RECIPIENTS
  );
}

export function getProfileRecipients(profileName) {
  const envKey = `EMAIL_RECIPIENT_${String(profileName || '').toUpperCase()}`;
  return parseRecipients(process.env[envKey] || DEFAULT_RECIPIENTS_BY_PROFILE[profileName]);
}

export async function sendEmail({ transporter, from, replyTo, to, subject, text, html }) {
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
