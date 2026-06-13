import nodemailer from 'nodemailer';
import {
  DEFAULT_APP_URL,
  DEFAULT_AUTOMATED_EMAIL_TIME_ZONE,
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

function getEmailTimeZone() {
  return (
    process.env.AUTOMATED_EMAIL_TIME_ZONE ||
    process.env.EMAIL_AUTOMATION_TIME_ZONE ||
    DEFAULT_AUTOMATED_EMAIL_TIME_ZONE
  );
}

function buildIconCircle({ symbol, color, background }) {
  return `
    <div class="icon-circle force-dark-soft" style="width:44px;height:44px;border-radius:999px;background:${background};color:${color};font-size:22px;line-height:44px;text-align:center;font-weight:900;font-family:${EMAIL_FONT_STACK}">
      ${symbol}
    </div>
  `;
}

function buildBreakdownRows(rows) {
  return rows
    .map(
      (row, index) => `
        <tr>
          <td width="54" valign="middle" style="padding:${index === 0 ? '12px 0 11px 0' : '11px 0'};border-bottom:${index === rows.length - 1 ? '0' : '1px solid rgba(148,163,184,.10)'}">
            ${buildIconCircle(row)}
          </td>
          <td valign="middle" style="padding:${index === 0 ? '12px 8px 11px 0' : '11px 8px 11px 0'};border-bottom:${index === rows.length - 1 ? '0' : '1px solid rgba(148,163,184,.10)'}">
            <div class="dark-text status-label" style="font-size:18px;line-height:22px;color:#f8fafc;font-weight:900;font-family:${EMAIL_FONT_STACK};white-space:nowrap">${escapeHtml(row.label)}</div>
            <div class="muted-text status-detail" style="margin-top:4px;font-size:14px;line-height:18px;color:#a8b3c1;font-weight:500;font-family:${EMAIL_FONT_STACK}">${escapeHtml(row.detail)}</div>
          </td>
          <td align="right" valign="middle" width="52" style="padding:${index === 0 ? '12px 0 11px 0' : '11px 0'};border-bottom:${index === rows.length - 1 ? '0' : '1px solid rgba(148,163,184,.10)'};color:${row.color};font-size:32px;line-height:36px;font-weight:900;font-family:${EMAIL_FONT_STACK}">
            ${escapeHtml(row.value)}
          </td>
        </tr>
      `
    )
    .join('');
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
    timeZone: getEmailTimeZone(),
  });
  const actionRequiredCount = getActionRequiredCount(stats);
  const hasActionRequired = actionRequiredCount > 0;
  const macquarieExcessShare = Number(stats.macquarieExcessShare || 0);

  const breakdownRows = [
    {
      label: 'New pending',
      value: formatCount(stats.pendingCount),
      detail: 'Fresh items from latest upload',
      color: '#4f83ff',
      symbol: '&#9633;',
      background: 'rgba(47,112,255,.14)',
    },
    {
      label: 'Outstanding',
      value: formatCount(stats.outstandingCount),
      detail: 'Older items still waiting',
      color: '#ff9f43',
      symbol: '&#9719;',
      background: 'rgba(255,159,67,.13)',
    },
    {
      label: 'Conflicts',
      value: formatCount(stats.conflictsCount),
      detail: 'Different choices to resolve',
      color: '#ff4d55',
      symbol: '!',
      background: 'rgba(255,77,85,.13)',
    },
    {
      label: 'Unsures',
      value: formatCount(stats.unsuresCount),
      detail: 'Marked unsure',
      color: '#985dff',
      symbol: '?',
      background: 'rgba(152,93,255,.14)',
    },
  ];

  const text = (hasActionRequired
    ? [
        `${profileName} update`,
        '',
        `Action required: ${formatCount(actionRequiredCount)} items`,
        `Spending: ${formatCurrency(stats.totalSpend)}`,
        macquarieExcessShare > 0
          ? `+ ${formatCurrency(macquarieExcessShare)} Macquarie excess split`
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
    : [
        `${profileName} update`,
        '',
        'Nothing to action',
        'No pending, outstanding, conflict, or unsure items need review right now.',
        `Spending: ${formatCurrency(stats.totalSpend)}`,
        macquarieExcessShare > 0
          ? `+ ${formatCurrency(macquarieExcessShare)} Macquarie excess split`
          : '',
        '',
        `Open the app: ${appUrl}`,
        `Updated: ${updatedAt}`,
      ])
    .filter(Boolean)
    .join('\n');

  const html = `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style>
          :root {
            color-scheme: light dark;
            supported-color-schemes: light dark;
          }

          body,
          .email-shell,
          .force-dark {
            background-color: #05080c !important;
            color: #f8fafc !important;
          }

          .force-dark-panel {
            background-color: #0b1218 !important;
            color: #f8fafc !important;
            border-color: #29323a !important;
          }

          .force-dark-tile {
            background-color: #0d1722 !important;
            color: #f8fafc !important;
          }

          .force-dark-soft {
            color: inherit;
          }

          .dark-text {
            color: #f8fafc !important;
          }

          .muted-text {
            color: #a8b3c1 !important;
          }

          @media (prefers-color-scheme: dark) {
            body,
            .email-shell,
            .force-dark {
              background-color: #05080c !important;
              color: #f8fafc !important;
            }

            .force-dark-panel {
              background-color: #0b1218 !important;
              color: #f8fafc !important;
              border-color: #29323a !important;
            }

            .force-dark-tile {
              background-color: #0d1722 !important;
              color: #f8fafc !important;
            }

            .dark-text {
              color: #f8fafc !important;
            }

            .muted-text {
              color: #a8b3c1 !important;
            }
          }

          @media screen and (max-width: 480px) {
            .email-shell {
              padding: 18px 10px !important;
            }

            .email-card {
              border-radius: 24px !important;
              padding: 20px 18px 20px 18px !important;
            }

            .brand {
              font-size: 12px !important;
              line-height: 16px !important;
            }

            .sent-date {
              font-size: 12px !important;
              line-height: 16px !important;
              white-space: nowrap !important;
            }

            .headline {
              font-size: 30px !important;
              line-height: 34px !important;
              margin: 12px 0 18px 0 !important;
            }

            .stat-tile {
              min-height: 180px !important;
              padding: 18px 16px 16px 16px !important;
              border-radius: 18px !important;
            }

            .tile-label {
              font-size: 13px !important;
              line-height: 18px !important;
            }

            .action-count {
              font-size: 56px !important;
              line-height: 58px !important;
              margin-top: 22px !important;
            }

            .spend-amount {
              font-size: 35px !important;
              line-height: 39px !important;
              margin-top: 34px !important;
            }

            .tile-caption {
              font-size: 16px !important;
              line-height: 21px !important;
            }

            .status-panel {
              margin-top: 18px !important;
              padding: 10px 16px !important;
              border-radius: 18px !important;
            }

            .status-label {
              font-size: 16px !important;
              line-height: 20px !important;
            }

            .status-detail {
              font-size: 12px !important;
              line-height: 16px !important;
            }

            .icon-circle {
              width: 40px !important;
              height: 40px !important;
              line-height: 40px !important;
              font-size: 20px !important;
            }

            .cta-wrap {
              margin-top: 18px !important;
            }

            .cta-link {
              padding: 15px 12px !important;
              font-size: 16px !important;
              line-height: 21px !important;
            }

            .all-clear-panel {
              padding: 24px 20px !important;
              border-radius: 20px !important;
            }

            .all-clear-title {
              font-size: 28px !important;
              line-height: 32px !important;
            }

            .all-clear-copy {
              font-size: 15px !important;
              line-height: 21px !important;
            }
          }
        </style>
      </head>
      <body style="margin:0;padding:0;background:#05080c;color:#f8fafc" bgcolor="#05080c">
    <div class="email-shell force-dark" style="margin:0;padding:24px 10px;background:#081017;background-image:radial-gradient(circle at 8% 0%,#172636 0,#081017 42%,#05080c 100%);font-family:${EMAIL_FONT_STACK};color:#f8fafc" bgcolor="#05080c">
      <div style="max-width:560px;margin:0 auto">
        <div class="email-card force-dark-panel" style="background:#0b1218;background-image:linear-gradient(150deg,#111c25 0%,#071018 48%,#05080c 100%);border:1px solid #29323a;border-radius:28px;padding:22px 22px 22px 22px;color:#f8fafc;box-shadow:0 26px 70px rgba(0,0,0,.52)">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;font-family:${EMAIL_FONT_STACK}">
            <tr>
              <td>
                <div class="brand" style="font-size:13px;line-height:17px;text-transform:uppercase;letter-spacing:0;color:#4f83ff;font-weight:900;font-family:${EMAIL_FONT_STACK}">Westpac CC Tracker</div>
              </td>
              <td align="right" valign="top" style="width:45%;font-size:13px;line-height:17px;color:#a9b1bd;font-weight:600;font-family:${EMAIL_FONT_STACK};white-space:nowrap" class="sent-date muted-text">${escapeHtml(updatedAt)}</td>
            </tr>
          </table>

          <h1 class="headline dark-text" style="margin:14px 0 22px 0;color:#f8fafc;font-size:36px;line-height:40px;font-weight:900;font-family:${EMAIL_FONT_STACK}">
            ${escapeHtml(profileName)} summary
          </h1>

          ${
            hasActionRequired
              ? `
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;font-family:${EMAIL_FONT_STACK}">
                  <tr>
                    <td width="50%" valign="top" style="padding:0 8px 0 0">
                      <div class="stat-tile force-dark-tile" style="min-height:196px;background:#0d1722;background-image:linear-gradient(145deg,rgba(28,72,126,.38),rgba(8,16,24,.94));border:1px solid rgba(69,111,167,.34);border-radius:20px;padding:20px 18px 18px 18px;box-shadow:inset 0 1px 0 rgba(255,255,255,.04)">
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;font-family:${EMAIL_FONT_STACK}">
                          <tr>
                            <td valign="top" width="52">
                              ${buildIconCircle({
                                symbol: '&#10003;',
                                color: '#4f83ff',
                                background: 'rgba(79,131,255,.14)',
                              })}
                            </td>
                            <td valign="top" class="tile-label" style="padding-top:8px;color:#4f83ff;font-size:15px;line-height:21px;text-transform:uppercase;letter-spacing:0;font-weight:900;font-family:${EMAIL_FONT_STACK}">
                              Action<br />Required
                            </td>
                          </tr>
                        </table>
                        <div class="action-count" style="margin-top:25px;color:#4f83ff;font-size:64px;line-height:66px;font-weight:900;font-family:${EMAIL_FONT_STACK}">
                          ${escapeHtml(formatCount(actionRequiredCount))}
                        </div>
                        <div class="tile-caption dark-text" style="margin-top:6px;color:#f8fafc;font-size:18px;line-height:23px;font-weight:500;font-family:${EMAIL_FONT_STACK}">
                          items to review
                        </div>
                        <div style="margin-top:23px;width:14px;height:14px;border-radius:999px;background:#4f83ff;box-shadow:0 0 22px rgba(79,131,255,.7)">&nbsp;</div>
                      </div>
                    </td>
                    <td width="50%" valign="top" style="padding:0 0 0 8px">
                      <div class="stat-tile force-dark-tile" style="min-height:196px;background:#13191d;background-image:linear-gradient(145deg,rgba(255,255,255,.08),rgba(9,14,18,.94));border:1px solid rgba(148,163,184,.22);border-radius:20px;padding:20px 18px 18px 18px;box-shadow:inset 0 1px 0 rgba(255,255,255,.04)">
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;font-family:${EMAIL_FONT_STACK}">
                          <tr>
                            <td valign="top" width="52">
                              ${buildIconCircle({
                                symbol: '&#36;',
                                color: '#cbd5e1',
                                background: 'rgba(203,213,225,.11)',
                              })}
                            </td>
                            <td valign="top" class="tile-label muted-text" style="padding-top:15px;color:#b2bac5;font-size:15px;line-height:20px;text-transform:uppercase;letter-spacing:0;font-weight:900;font-family:${EMAIL_FONT_STACK}">
                              Spending
                            </td>
                          </tr>
                        </table>
                        <div class="spend-amount dark-text" style="margin-top:39px;color:#f8fafc;font-size:40px;line-height:44px;font-weight:900;font-family:${EMAIL_FONT_STACK};white-space:nowrap">
                          ${escapeHtml(formatCurrency(stats.totalSpend))}
                        </div>
                        <div class="tile-caption muted-text" style="margin-top:6px;color:#a8b3c1;font-size:17px;line-height:22px;font-weight:500;font-family:${EMAIL_FONT_STACK}">
                          assigned so far
                        </div>
                        ${
                          macquarieExcessShare > 0
                            ? `
                              <div style="margin-top:9px;padding-top:8px;border-top:1px solid rgba(255,107,107,.18);color:#a8b3c1;font-size:11px;line-height:15px;font-weight:800;font-family:${EMAIL_FONT_STACK}">
                                <span style="color:#ff6b6b">+ ${escapeHtml(formatCurrency(macquarieExcessShare))}</span>
                                <span class="muted-text" style="color:#a8b3c1">Macquarie excess split</span>
                              </div>
                            `
                            : ''
                        }
                      </div>
                    </td>
                  </tr>
                </table>

                <div class="status-panel force-dark-panel" style="margin-top:20px;background:#0d151b;background-image:linear-gradient(145deg,rgba(255,255,255,.04),rgba(8,15,20,.94));border:1px solid rgba(148,163,184,.20);border-radius:20px;padding:10px 18px">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;font-family:${EMAIL_FONT_STACK}">
                    ${buildBreakdownRows(breakdownRows)}
                  </table>
                </div>
              `
              : `
                <div class="all-clear-panel force-dark-tile" style="background:#0d151b;background-image:linear-gradient(145deg,rgba(79,131,255,.14),rgba(8,15,20,.96));border:1px solid rgba(79,131,255,.24);border-radius:22px;padding:30px 28px;box-shadow:inset 0 1px 0 rgba(255,255,255,.04)">
                  <div style="width:56px;height:56px;border-radius:999px;background:rgba(79,131,255,.14);color:#4f83ff;font-size:30px;line-height:56px;text-align:center;font-weight:900;font-family:${EMAIL_FONT_STACK}">
                    &#10003;
                  </div>
                  <div class="all-clear-title dark-text" style="margin-top:24px;color:#f8fafc;font-size:34px;line-height:38px;font-weight:900;font-family:${EMAIL_FONT_STACK}">
                    Nothing to action
                  </div>
                  <div class="all-clear-copy muted-text" style="margin-top:10px;color:#a8b3c1;font-size:17px;line-height:24px;font-weight:500;font-family:${EMAIL_FONT_STACK}">
                    No pending, outstanding, conflict, or unsure items need review right now.
                  </div>
                </div>
              `
          }

          <div class="cta-wrap" style="margin-top:20px">
            <a
              class="cta-link"
              href="${escapeHtml(appUrl)}"
              style="display:block;background:#1268f3;background-image:linear-gradient(135deg,#1477ff,#0757df);border:1px solid #2f86ff;color:#ffffff;text-decoration:none;border-radius:12px;padding:16px 12px;font-size:17px;line-height:23px;text-align:center;font-weight:900;font-family:${EMAIL_FONT_STACK};box-shadow:0 15px 36px rgba(18,104,243,.32)"
            >
              <span style="font-size:22px;line-height:0;vertical-align:-2px;margin-right:10px">&#8599;</span>
              ${hasActionRequired ? 'Review items in Westpac Tracker' : 'Open Westpac Tracker'}
            </a>
          </div>
        </div>
      </div>
    </div>
      </body>
    </html>
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
    timeZone: getEmailTimeZone(),
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
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style>
          :root {
            color-scheme: light dark;
            supported-color-schemes: light dark;
          }

          body,
          .email-shell,
          .force-dark {
            background-color: #05080c !important;
            color: #f8fafc !important;
          }

          .force-dark-panel {
            background-color: #0b1218 !important;
            color: #f8fafc !important;
            border-color: #29323a !important;
          }

          .force-dark-soft {
            color: inherit;
          }

          .dark-text {
            color: #f8fafc !important;
          }

          .muted-text {
            color: #a8b3c1 !important;
          }

          @media (prefers-color-scheme: dark) {
            body,
            .email-shell,
            .force-dark {
              background-color: #05080c !important;
              color: #f8fafc !important;
            }

            .force-dark-panel {
              background-color: #0b1218 !important;
              color: #f8fafc !important;
              border-color: #29323a !important;
            }

            .dark-text {
              color: #f8fafc !important;
            }

            .muted-text {
              color: #a8b3c1 !important;
            }
          }

          @media screen and (max-width: 480px) {
            .email-shell {
              padding: 18px 10px !important;
            }

            .email-card {
              border-radius: 24px !important;
              padding: 20px 18px !important;
            }

            .headline {
              font-size: 30px !important;
              line-height: 34px !important;
              margin: 12px 0 18px 0 !important;
            }

            .message-panel {
              padding: 18px 16px !important;
              border-radius: 18px !important;
            }

            .message-body {
              font-size: 15px !important;
              line-height: 21px !important;
            }

            .cta-link {
              padding: 15px 12px !important;
              font-size: 16px !important;
              line-height: 21px !important;
            }
          }
        </style>
      </head>
      <body style="margin:0;padding:0;background:#05080c;color:#f8fafc" bgcolor="#05080c">
        <div class="email-shell force-dark" style="margin:0;padding:24px 10px;background:#081017;background-image:radial-gradient(circle at 8% 0%,#172636 0,#081017 42%,#05080c 100%);font-family:${EMAIL_FONT_STACK};color:#f8fafc" bgcolor="#05080c">
          <div style="max-width:560px;margin:0 auto">
            <div class="email-card force-dark-panel" style="background:#0b1218;background-image:linear-gradient(150deg,#111c25 0%,#071018 48%,#05080c 100%);border:1px solid #29323a;border-radius:28px;padding:22px;color:#f8fafc;box-shadow:0 26px 70px rgba(0,0,0,.52)">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;font-family:${EMAIL_FONT_STACK}">
                <tr>
                  <td>
                    <div class="brand" style="font-size:13px;line-height:17px;text-transform:uppercase;letter-spacing:0;color:#4f83ff;font-weight:900;font-family:${EMAIL_FONT_STACK}">Westpac CC Tracker</div>
                  </td>
                  <td align="right" valign="top" style="width:45%;font-size:13px;line-height:17px;color:#a9b1bd;font-weight:600;font-family:${EMAIL_FONT_STACK};white-space:nowrap" class="sent-date muted-text">${escapeHtml(updatedAt)}</td>
                </tr>
              </table>

              <h1 class="headline dark-text" style="margin:14px 0 22px 0;color:#f8fafc;font-size:36px;line-height:40px;font-weight:900;font-family:${EMAIL_FONT_STACK}">
                Quick update
              </h1>

              <div class="message-panel force-dark-panel" style="background:#0d151b;background-image:linear-gradient(145deg,rgba(255,255,255,.04),rgba(8,15,20,.94));border:1px solid rgba(148,163,184,.20);border-radius:20px;padding:20px 18px">
                <div class="message-body dark-text" style="font-size:17px;line-height:24px;white-space:normal;color:#f8fafc;font-family:${EMAIL_FONT_STACK}">
                  ${htmlMessage.replace(/\n/g, '<br />')}
                </div>
              </div>

              <div style="margin-top:18px;color:#a8b3c1;font-size:12px;line-height:16px;font-family:${EMAIL_FONT_STACK}">
                Sent ${escapeHtml(updatedAt)}
              </div>

            </div>
          </div>
        </div>
      </body>
    </html>
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
