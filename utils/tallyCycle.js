export const TALLY_CYCLE_SETTINGS_ROOT = 'cc_v5_app_state/tallyCycleSettings';
export const DEFAULT_TALLY_CYCLE_SETTINGS = Object.freeze({
  startDay: 13,
  startMonth: null,
});
export const TALLY_CYCLE_MIN_DAY = 1;
export const TALLY_CYCLE_MAX_DAY = 31;
export const TALLY_CYCLE_MIN_MONTH = 1;
export const TALLY_CYCLE_MAX_MONTH = 12;

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function padDatePart(value) {
  return String(value).padStart(2, '0');
}

function isLeapYear(year) {
  if (year % 400 === 0) return true;
  if (year % 100 === 0) return false;
  return year % 4 === 0;
}

function getDaysInMonth(year, monthIndex) {
  const month = Number(monthIndex);
  if (month === 1) return isLeapYear(year) ? 29 : 28;
  if ([3, 5, 8, 10].includes(month)) return 30;
  return 31;
}

function parseDateKeyParts(dateKey) {
  if (!DATE_KEY_PATTERN.test(String(dateKey || ''))) return null;

  const [yearRaw, monthRaw, dayRaw] = String(dateKey).split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12) return null;

  const maxDay = getDaysInMonth(year, month - 1);
  if (day < 1 || day > maxDay) return null;

  return {
    year,
    monthIndex: month - 1,
    day,
  };
}

function formatDateKey({ year, monthIndex, day }) {
  return `${String(year).padStart(4, '0')}-${padDatePart(monthIndex + 1)}-${padDatePart(day)}`;
}

function addMonths({ year, monthIndex }, monthsToAdd) {
  const totalMonths = year * 12 + monthIndex + Number(monthsToAdd || 0);
  const nextYear = Math.floor(totalMonths / 12);
  const nextMonthIndex = ((totalMonths % 12) + 12) % 12;
  return {
    year: nextYear,
    monthIndex: nextMonthIndex,
  };
}

function clampCycleStartDay(day, year, monthIndex) {
  const maxDay = getDaysInMonth(year, monthIndex);
  return Math.max(TALLY_CYCLE_MIN_DAY, Math.min(maxDay, day));
}

function subtractOneDay(dateKey) {
  const parts = parseDateKeyParts(dateKey);
  if (!parts) return null;

  if (parts.day > 1) {
    return formatDateKey({
      year: parts.year,
      monthIndex: parts.monthIndex,
      day: parts.day - 1,
    });
  }

  const previousMonth = addMonths(parts, -1);
  const previousMonthLastDay = getDaysInMonth(previousMonth.year, previousMonth.monthIndex);
  return formatDateKey({
    year: previousMonth.year,
    monthIndex: previousMonth.monthIndex,
    day: previousMonthLastDay,
  });
}

function normalizeStartDay(startDay) {
  const parsed = Number(startDay);
  if (!Number.isFinite(parsed)) return DEFAULT_TALLY_CYCLE_SETTINGS.startDay;
  return Math.min(TALLY_CYCLE_MAX_DAY, Math.max(TALLY_CYCLE_MIN_DAY, Math.round(parsed)));
}

function normalizeStartMonth(startMonth) {
  if (startMonth === null || startMonth === undefined || startMonth === '') {
    return DEFAULT_TALLY_CYCLE_SETTINGS.startMonth;
  }

  const parsed = Number(startMonth);
  if (!Number.isFinite(parsed)) return DEFAULT_TALLY_CYCLE_SETTINGS.startMonth;
  return Math.min(TALLY_CYCLE_MAX_MONTH, Math.max(TALLY_CYCLE_MIN_MONTH, Math.round(parsed)));
}

function getMonthStartKey(year, monthIndex, startDay) {
  return formatDateKey({
    year,
    monthIndex,
    day: clampCycleStartDay(startDay, year, monthIndex),
  });
}

function dateKeyToDate(dateKey) {
  const parts = parseDateKeyParts(dateKey);
  if (!parts) return null;
  return new Date(Date.UTC(parts.year, parts.monthIndex, parts.day));
}

function formatDateKeyForRange(dateKey) {
  const date = dateKeyToDate(dateKey);
  if (!date) return 'n/a';
  return new Intl.DateTimeFormat('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function isValidDateKey(dateKey) {
  return parseDateKeyParts(dateKey) !== null;
}

export function normalizeTallyCycleSettings(settings = {}) {
  return {
    startDay: normalizeStartDay(settings?.startDay),
    startMonth: normalizeStartMonth(settings?.startMonth),
  };
}

export function buildTallyDateRange(referenceDateKey, settings = DEFAULT_TALLY_CYCLE_SETTINGS) {
  const referenceParts = parseDateKeyParts(referenceDateKey);
  const normalizedSettings = normalizeTallyCycleSettings(settings);

  if (!referenceParts) {
    return {
      startKey: null,
      endKey: null,
      startDay: normalizedSettings.startDay,
      startMonth: normalizedSettings.startMonth,
    };
  }

  const { year, monthIndex } = referenceParts;
  const activeMonthBase = normalizedSettings.startMonth
    ? (() => {
        const anchorMonthIndex = normalizedSettings.startMonth - 1;
        const currentMonthStartKey = getMonthStartKey(year, anchorMonthIndex, normalizedSettings.startDay);
        const currentMonthBase = { year, monthIndex: anchorMonthIndex };

        if (referenceDateKey >= currentMonthStartKey) {
          return currentMonthBase;
        }

        return addMonths(currentMonthBase, -1);
      })()
    : referenceDateKey >= getMonthStartKey(year, monthIndex, normalizedSettings.startDay)
      ? { year, monthIndex }
      : addMonths({ year, monthIndex }, -1);
  const startKey = getMonthStartKey(
    activeMonthBase.year,
    activeMonthBase.monthIndex,
    normalizedSettings.startDay
  );

  const nextMonthBase = addMonths(activeMonthBase, 1);
  const nextStartKey = getMonthStartKey(
    nextMonthBase.year,
    nextMonthBase.monthIndex,
    normalizedSettings.startDay
  );
  const endKey = subtractOneDay(nextStartKey);

  return {
    startKey,
    endKey,
    startDay: normalizedSettings.startDay,
    startMonth: normalizedSettings.startMonth,
  };
}

export function isDateKeyWithinTallyDateRange(dateKey, tallyDateRange) {
  if (!tallyDateRange?.startKey || !tallyDateRange?.endKey) return true;
  if (!isValidDateKey(dateKey)) return false;
  return dateKey >= tallyDateRange.startKey && dateKey <= tallyDateRange.endKey;
}

export function isTransactionWithinTallyDateRange(transaction, tallyDateRange) {
  if (!tallyDateRange?.startKey || !tallyDateRange?.endKey) return true;

  const transactionDateKey = transaction?.date || transaction?.uploadedDay || null;
  return isDateKeyWithinTallyDateRange(transactionDateKey, tallyDateRange);
}

export function formatTallyDateRangeLabel(tallyDateRange) {
  if (!tallyDateRange?.startKey || !tallyDateRange?.endKey) return 'Current cycle';
  return `${formatDateKeyForRange(tallyDateRange.startKey)} - ${formatDateKeyForRange(
    tallyDateRange.endKey
  )}`;
}
