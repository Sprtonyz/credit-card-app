export const SIMULATED_DAY_KEY = 'cc_v4_day_offset';
export const SIMULATED_TIME_ZONE = 'Australia/Melbourne';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function hasWindow() {
  return typeof window !== 'undefined';
}

function getDateParts(date, timeZone = SIMULATED_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  return parts.reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
}

function parseDateKey(dateKey) {
  if (!dateKey) return null;
  const match = String(dateKey).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  return Date.UTC(year, month - 1, day);
}

export function getSavedSimulatedDay() {
  if (!hasWindow()) return 0;

  const raw = window.localStorage.getItem(SIMULATED_DAY_KEY);
  if (raw === null || raw === '') return 0;

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function setSavedSimulatedDay(day) {
  if (!hasWindow()) return;
  window.localStorage.setItem(SIMULATED_DAY_KEY, String(day));
}

export function clearSavedSimulatedDay() {
  if (!hasWindow()) return;
  window.localStorage.removeItem(SIMULATED_DAY_KEY);
}

export function shiftDateKey(dateKey, days) {
  const parsed = parseDateKey(dateKey);
  if (parsed === null) return null;

  const shifted = new Date(parsed + days * MS_PER_DAY);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(
    shifted.getUTCDate()
  ).padStart(2, '0')}`;
}

export function getSimulatedNow(baseDate = new Date()) {
  const offset = getSavedSimulatedDay();
  return new Date(baseDate.getTime() + offset * MS_PER_DAY);
}

export function getSimulatedTodayDate() {
  return getSimulatedNow();
}

export function formatLocalDate(date = getSimulatedTodayDate()) {
  const parts = getDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatLocalDateTime(date = getSimulatedTodayDate()) {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: SIMULATED_TIME_ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatLocalTime(date = getSimulatedTodayDate()) {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: SIMULATED_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export function getSimulatedISOString() {
  return getSimulatedNow().toISOString();
}
