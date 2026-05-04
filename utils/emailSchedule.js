import {
  DEFAULT_AUTOMATED_EMAIL_TIME,
  DEFAULT_AUTOMATED_EMAIL_TIME_ZONE,
  DEFAULT_AUTOMATED_EMAIL_WINDOW_MINUTES,
} from '../config/emailNotifications';

function parseMeridiemTime(value) {
  const match = String(value || '')
    .trim()
    .match(/^(\d{1,2})(?::?(\d{2}))?\s*(am|pm)$/i);

  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3].toLowerCase();

  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
  if (meridiem === 'pm' && hour !== 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;

  return { hour, minute };
}

export function parseScheduledTime(value = DEFAULT_AUTOMATED_EMAIL_TIME) {
  const meridiemTime = parseMeridiemTime(value);
  if (meridiemTime) return meridiemTime;

  const match = String(value || '')
    .trim()
    .match(/^(\d{1,2})(?::(\d{2}))?$/);

  if (!match) {
    throw new Error(`Invalid automated email time "${value}". Use HH:mm, such as 23:00.`);
  }

  const hour = Number(match[1]);
  const minute = Number(match[2] || 0);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid automated email time "${value}". Use a 24-hour time from 00:00 to 23:59.`);
  }

  return { hour, minute };
}

export function formatScheduledTime(value = DEFAULT_AUTOMATED_EMAIL_TIME) {
  const { hour, minute } = parseScheduledTime(value);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function getZonedDateParts(date = new Date(), timeZone = DEFAULT_AUTOMATED_EMAIL_TIME_ZONE) {
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

export function getZonedDateKey(date = new Date(), timeZone = DEFAULT_AUTOMATED_EMAIL_TIME_ZONE) {
  const parts = getZonedDateParts(date, timeZone);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(
    parts.day
  ).padStart(2, '0')}`;
}

export function getAutomatedEmailSchedule({
  time = DEFAULT_AUTOMATED_EMAIL_TIME,
  timeZone = DEFAULT_AUTOMATED_EMAIL_TIME_ZONE,
  windowMinutes = DEFAULT_AUTOMATED_EMAIL_WINDOW_MINUTES,
} = {}) {
  const normalizedTime = formatScheduledTime(time);
  const parsedTime = parseScheduledTime(normalizedTime);
  const parsedWindow = Number(windowMinutes);
  const minimumWindow = DEFAULT_AUTOMATED_EMAIL_WINDOW_MINUTES;

  return {
    time: normalizedTime,
    timeZone,
    hour: parsedTime.hour,
    minute: parsedTime.minute,
    windowMinutes:
      Number.isFinite(parsedWindow) && parsedWindow > 0
        ? Math.max(parsedWindow, minimumWindow)
        : minimumWindow,
  };
}

export function getAutomatedEmailScheduleDecision({
  now = new Date(),
  time = DEFAULT_AUTOMATED_EMAIL_TIME,
  timeZone = DEFAULT_AUTOMATED_EMAIL_TIME_ZONE,
  windowMinutes = DEFAULT_AUTOMATED_EMAIL_WINDOW_MINUTES,
} = {}) {
  const schedule = getAutomatedEmailSchedule({ time, timeZone, windowMinutes });
  const parts = getZonedDateParts(now, schedule.timeZone);
  const currentMinuteOfDay = parts.hour * 60 + parts.minute;
  const scheduledMinuteOfDay = schedule.hour * 60 + schedule.minute;
  const minutesAfterScheduledTime = currentMinuteOfDay - scheduledMinuteOfDay;

  return {
    due:
      minutesAfterScheduledTime >= 0 &&
      minutesAfterScheduledTime < schedule.windowMinutes,
    localDate: getZonedDateKey(now, schedule.timeZone),
    localTime: `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`,
    minutesAfterScheduledTime,
    schedule,
  };
}
