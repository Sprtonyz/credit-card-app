import http from 'http';
import https from 'https';

const DEFAULT_APP_URL = 'https://sprtony.vercel.app/';
const DEFAULT_TIME = '23:00';
const DEFAULT_TIME_ZONE = 'Australia/Melbourne';
const DEFAULT_SEND_WINDOW_MINUTES = 15;
const DEFAULT_MAX_WAIT_MINUTES = 75;
const TARGET_OFFSET_MS = 2000;

function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseScheduledTime(value = DEFAULT_TIME) {
  const match = String(value || '')
    .trim()
    .match(/^(\d{1,2})(?::(\d{2}))?$/);

  if (!match) {
    throw new Error(`Invalid automated email time "${value}". Use HH:mm, such as 23:00.`);
  }

  const hour = Number(match[1]);
  const minute = Number(match[2] || 0);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid automated email time "${value}". Use 00:00 to 23:59.`);
  }

  return { hour, minute };
}

function formatScheduledTime(value = DEFAULT_TIME) {
  const { hour, minute } = parseScheduledTime(value);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function requestJson(url, { method = 'GET', headers = {} } = {}) {
  const target = new URL(url);
  const client = target.protocol === 'http:' ? http : https;

  return new Promise((resolve, reject) => {
    const req = client.request(
      target,
      {
        method,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'credit-card-email-scheduler/1.0',
          ...headers,
        },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          const statusCode = res.statusCode || 0;
          let data = null;

          if (body) {
            try {
              data = JSON.parse(body);
            } catch {
              data = body;
            }
          }

          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`Request to ${url} failed with ${statusCode}: ${body}`));
            return;
          }

          resolve(data);
        });
      }
    );

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error(`Request to ${url} timed out.`));
    });
    req.end();
  });
}

function getZonedDateParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-AU', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function localPartsToTimestamp(parts) {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second || 0
  );
}

function zonedDateTimeToUtcMs(targetParts, timeZone) {
  const targetLocalMs = localPartsToTimestamp({ ...targetParts, second: 0 });
  let utcMs = Date.UTC(
    targetParts.year,
    targetParts.month - 1,
    targetParts.day,
    targetParts.hour,
    targetParts.minute,
    0
  );

  for (let index = 0; index < 4; index += 1) {
    const actualParts = getZonedDateParts(new Date(utcMs), timeZone);
    const actualLocalMs = localPartsToTimestamp(actualParts);
    utcMs -= actualLocalMs - targetLocalMs;
  }

  return utcMs;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function loadSettings(appUrl, headers) {
  try {
    const data = await requestJson(`${appUrl}/api/notification-automation-settings`, {
      headers,
    });
    return data?.settings || {};
  } catch (error) {
    if (/failed with (401|403)/.test(error.message)) {
      throw new Error(`Could not load saved email schedule with configured credentials. ${error.message}`);
    }

    console.warn(`Could not load saved email schedule; using defaults. ${error.message}`);
    return {};
  }
}

function getDecision(settings) {
  const now = new Date();
  const time = formatScheduledTime(
    settings.time || process.env.AUTOMATED_EMAIL_TIME || DEFAULT_TIME
  );
  const timeZone =
    settings.timeZone || process.env.AUTOMATED_EMAIL_TIME_ZONE || DEFAULT_TIME_ZONE;
  const configuredWindow = parsePositiveNumber(
    settings.windowMinutes || process.env.AUTOMATED_EMAIL_WINDOW_MINUTES,
    DEFAULT_SEND_WINDOW_MINUTES
  );
  const sendWindowMinutes = Math.min(
    configuredWindow,
    parsePositiveNumber(
      process.env.EMAIL_SCHEDULER_SEND_WINDOW_MINUTES,
      DEFAULT_SEND_WINDOW_MINUTES
    )
  );
  const maxWaitMinutes = parsePositiveNumber(
    process.env.EMAIL_SCHEDULER_MAX_WAIT_MINUTES,
    DEFAULT_MAX_WAIT_MINUTES
  );
  const { hour, minute } = parseScheduledTime(time);
  const nowParts = getZonedDateParts(now, timeZone);
  const targetUtcMs = zonedDateTimeToUtcMs(
    {
      year: nowParts.year,
      month: nowParts.month,
      day: nowParts.day,
      hour,
      minute,
      second: 0,
    },
    timeZone
  );
  const msUntilTarget = targetUtcMs - now.getTime();
  const minutesUntilTarget = msUntilTarget / 60000;
  const minutesAfterTarget = -minutesUntilTarget;

  return {
    now,
    time,
    timeZone,
    nowParts,
    targetUtcMs,
    msUntilTarget,
    minutesUntilTarget,
    minutesAfterTarget,
    sendWindowMinutes,
    maxWaitMinutes,
  };
}

async function main() {
  const appUrl = String(process.env.APP_URL || DEFAULT_APP_URL).replace(/\/$/, '');
  const cronSecret = process.env.CRON_SECRET || '';
  const headers = cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {};
  const settings = await loadSettings(appUrl, headers);
  const decision = getDecision(settings);

  console.log(
    [
      `Current ${decision.timeZone} time: ${String(decision.nowParts.hour).padStart(2, '0')}:${String(
        decision.nowParts.minute
      ).padStart(2, '0')}`,
      `Target send time: ${decision.time}`,
      `Send window: ${decision.sendWindowMinutes} minutes`,
      `Max wait: ${decision.maxWaitMinutes} minutes`,
    ].join('\n')
  );

  if (decision.minutesUntilTarget > decision.maxWaitMinutes) {
    console.log('Target is too far away for this scheduler wake-up; skipping.');
    return;
  }

  if (decision.minutesAfterTarget >= decision.sendWindowMinutes) {
    console.log('Target send window has already passed; skipping.');
    return;
  }

  if (decision.msUntilTarget > 0) {
    const waitMs = decision.msUntilTarget + TARGET_OFFSET_MS;
    console.log(`Waiting ${Math.ceil(waitMs / 1000)} seconds for the target send time.`);
    await sleep(waitMs);
  }

  const result = await requestJson(`${appUrl}/api/cron/send-notification-email`, {
    headers,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
