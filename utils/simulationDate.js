const SIMULATED_DAY_KEY = 'cc_v4_day_offset';

function hasWindow() {
  return typeof window !== 'undefined';
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

export function getSimulatedTodayDate() {
  const offset = getSavedSimulatedDay();
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date;
}

export function getSimulatedNow() {
  return getSimulatedTodayDate();
}

export function getSimulatedISOString() {
  return getSimulatedNow().toISOString();
}

export function formatLocalDate(date = getSimulatedTodayDate()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
