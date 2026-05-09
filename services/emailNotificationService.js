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

function getActionRequiredCount(stats = {}) {
  return [
    stats.pendingCount,
    stats.outstandingCount,
    stats.conflictsCount,
    stats.unsuresCount,
  ].reduce((total, value) => total + Number(value || 0), 0);
}

const EMAIL_FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,Helvetica,sans-serif";

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
  const actionRequiredCount = getActionRequiredCount(stats);
  const macquarieExcessShare = Number(stats.macquarieExcessShare || 0);

  const breakdownRows = [
    {
      label: 'New pending',
      value: formatCount(stats.pendingCount),
      detail: 'Fresh items from the latest upload',
      color: '#2563eb',
    },
    {
      label: 'Outstanding',
      value: formatCount(stats.outstandingCount),
      detail: 'Older items still waiting',
      color: '#d97706',
    },
    {
      label: 'Conflicts',
      value: formatCount(stats.conflictsCount),
      detail: 'Different choices to resolve',
      color: '#dc2626',
    },
    {
      label: 'Unsures',
      value: formatCount(stats.unsuresCount),
      detail: 'Marked unsure',
      color: '#7c3aed',
    },
  ];

  const text = [
    `${profileName} update`,
    '',
    `Action required: ${formatCount(actionRequiredCount)} items`,
    `Spending: ${formatCurrency(stats.totalSpend)}`,
    macquarieExcessShare > 0
      ? `+ ${formatCurrency(macquarieExcessShare)} (Macquarie's excess)`
      : '',
    '',
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
    <div style="font-family:${EMAIL_FONT_STACK};background:#dce7f3;padding:28px 12px;color:#111827">
      <div style="max-width:640px;margin:0 auto">
        <div style="background:#0f172a;border-radius:18px;padding:22px;color:#ffffff">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;font-family:${EMAIL_FONT_STACK}">
            <tr>
              <td>
                <div style="font-size:12px;line-height:16px;text-transform:uppercase;letter-spacing:.12em;color:#93c5fd;font-weight:900">Westpac CC Tracker</div>
                <div style="margin-top:8px;font-size:25px;line-height:31px;font-weight:900">${escapeHtml(profileName)} summary</div>
              </td>
              <td align="right" valign="top" style="font-size:12px;line-height:17px;color:#cbd5e1">${escapeHtml(updatedAt)}</td>
            </tr>
          </table>

          <div style="margin-top:20px;border-radius:14px;background:#ffffff;color:#111827;padding:20px">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;font-family:${EMAIL_FONT_STACK}">
              <tr>
                <td valign="top" width="50%" style="padding-right:12px">
                  <div style="font-size:12px;line-height:16px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;font-weight:900">Action required</div>
                  <div style="margin-top:5px;font-size:46px;line-height:50px;color:#111827;font-weight:900;font-family:${EMAIL_FONT_STACK}">${escapeHtml(formatCount(actionRequiredCount))}</div>
                  <div style="margin-top:3px;font-size:13px;line-height:18px;color:#64748b">items to review</div>
                </td>
                <td valign="top" width="50%" style="padding-left:12px">
                  <div style="font-size:12px;line-height:16px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;font-weight:900">Spending</div>
                  <div style="margin-top:10px;font-size:32px;line-height:36px;color:#111827;font-weight:900;font-family:${EMAIL_FONT_STACK}">${escapeHtml(formatCurrency(stats.totalSpend))}</div>
                  <div style="margin-top:4px;font-size:13px;line-height:18px;color:#64748b">assigned so far</div>
                  ${
                    macquarieExcessShare > 0
                      ? `
                        <div style="margin-top:10px;border-radius:10px;background:#f8fafc;border:1px solid #e5e7eb;padding:9px 10px">
                          <div style="font-size:15px;line-height:19px;color:#111827;font-weight:900">+ ${escapeHtml(formatCurrency(macquarieExcessShare))}</div>
                          <div style="margin-top:2px;font-size:11px;line-height:15px;color:#64748b;font-weight:700">(Macquarie's excess)</div>
                        </div>
                      `
                      : ''
                  }
                </td>
              </tr>
            </table>

            <div style="margin-top:18px;height:1px;line-height:1px;background:#e5e7eb">&nbsp;</div>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;font-family:${EMAIL_FONT_STACK}">
              ${breakdownRows
                .map(
                  (row, index) => `
                    <tr>
                      <td style="padding:${index === 0 ? '16px 0 13px 0' : '13px 0'};border-bottom:${index === breakdownRows.length - 1 ? '0' : '1px solid #e5e7eb'}">
                        <div style="font-size:15px;line-height:20px;color:#111827;font-weight:800">${escapeHtml(row.label)}</div>
                        <div style="margin-top:2px;font-size:12px;line-height:17px;color:#6b7280">${escapeHtml(row.detail)}</div>
                      </td>
                      <td align="right" style="padding:${index === 0 ? '16px 0 13px 0' : '13px 0'};border-bottom:${index === breakdownRows.length - 1 ? '0' : '1px solid #e5e7eb'};color:${row.color};font-size:24px;line-height:28px;font-weight:900;font-family:${EMAIL_FONT_STACK}">${escapeHtml(row.value)}</td>
                    </tr>
                  `
                )
                .join('')}
            </table>

            <div style="margin-top:20px">
              <a
                href="${escapeHtml(appUrl)}"
                style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:999px;padding:12px 18px;font-size:14px;line-height:18px;font-weight:800;font-family:${EMAIL_FONT_STACK}"
              >
                Open Westpac Tracker
              </a>
            </div>
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
