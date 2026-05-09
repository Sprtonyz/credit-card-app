import { firebaseConfig } from '../config/firebase';
import {
  AUTOMATED_NOTIFICATION_EVENTS_ROOT,
  AUTOMATED_NOTIFICATION_SETTINGS_ROOT,
  DEFAULT_AUTOMATED_EMAIL_TIME,
  DEFAULT_AUTOMATED_EMAIL_TIME_ZONE,
  DEFAULT_AUTOMATED_EMAIL_WINDOW_MINUTES,
} from '../config/emailNotifications';
import { normalizeScheduleWindowMinutes } from '../utils/emailSchedule';

function getDatabaseUrl() {
  return String(process.env.FIREBASE_DATABASE_URL || firebaseConfig.databaseURL || '').replace(/\/$/, '');
}

function getApiKey() {
  return process.env.FIREBASE_API_KEY || firebaseConfig.apiKey;
}

function encodePath(path) {
  const parts = Array.isArray(path) ? path : String(path || '').split('/');
  return parts.filter(Boolean).map((part) => encodeURIComponent(part)).join('/');
}

function buildDatabaseUrl(path, authToken) {
  const databaseUrl = getDatabaseUrl();

  if (!databaseUrl) {
    throw new Error('Missing Firebase database URL.');
  }

  const url = new URL(`${databaseUrl}/${encodePath(path)}.json`);
  if (authToken) {
    url.searchParams.set('auth', authToken);
  }
  return url.toString();
}

export async function getFirebaseRestAuthToken() {
  if (process.env.FIREBASE_DATABASE_AUTH_TOKEN) {
    return process.env.FIREBASE_DATABASE_AUTH_TOKEN;
  }

  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ returnSecureToken: true }),
    });

    const data = await response.json();
    if (!response.ok || data?.error) {
      throw new Error(data?.error?.message || 'Firebase anonymous sign-in failed.');
    }

    return data.idToken || null;
  } catch (error) {
    console.warn('Firebase anonymous REST sign-in failed; trying unauthenticated database access.', error);
    return null;
  }
}

export async function requestFirebaseJson(path, { authToken, method = 'GET', body } = {}) {
  const response = await fetch(buildDatabaseUrl(path, authToken), {
    method,
    headers: body === undefined
      ? undefined
      : {
          'Content-Type': 'application/json',
        },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok || data?.error) {
    throw new Error(data?.error || `Firebase request failed with ${response.status}.`);
  }

  return data;
}

function mapFirebaseTransactions(value = {}) {
  if (!value || typeof value !== 'object') return [];

  return Object.entries(value)
    .filter(([, transaction]) => transaction && typeof transaction === 'object')
    .map(([id, transaction]) => ({
      id,
      ...transaction,
    }));
}

export async function getEmailAutomationData(authToken = null) {
  const resolvedAuthToken = authToken || (await getFirebaseRestAuthToken());
  const [transactions, submissions] = await Promise.all([
    requestFirebaseJson('transactions', { authToken: resolvedAuthToken }),
    requestFirebaseJson('submissions', { authToken: resolvedAuthToken }),
  ]);

  return {
    authToken: resolvedAuthToken,
    transactions: mapFirebaseTransactions(transactions),
    submissions: submissions || {},
  };
}

export async function getAutomationSettings(authToken) {
  const settings = await requestFirebaseJson(AUTOMATED_NOTIFICATION_SETTINGS_ROOT, { authToken });

  return {
    time: settings?.time || DEFAULT_AUTOMATED_EMAIL_TIME,
    timeZone: settings?.timeZone || DEFAULT_AUTOMATED_EMAIL_TIME_ZONE,
    windowMinutes: normalizeScheduleWindowMinutes(
      settings?.windowMinutes || DEFAULT_AUTOMATED_EMAIL_WINDOW_MINUTES
    ),
    updatedAt: settings?.updatedAt || null,
  };
}

export async function saveAutomationSettings(settings, authToken) {
  return requestFirebaseJson(AUTOMATED_NOTIFICATION_SETTINGS_ROOT, {
    authToken,
    method: 'PUT',
    body: {
      time: settings.time || DEFAULT_AUTOMATED_EMAIL_TIME,
      timeZone: settings.timeZone || DEFAULT_AUTOMATED_EMAIL_TIME_ZONE,
      windowMinutes: normalizeScheduleWindowMinutes(
        settings.windowMinutes || DEFAULT_AUTOMATED_EMAIL_WINDOW_MINUTES
      ),
      updatedAt: settings.updatedAt || new Date().toISOString(),
    },
  });
}

export async function appendAutomationEvent(event = {}, authToken = null) {
  const resolvedAuthToken = authToken || (await getFirebaseRestAuthToken());
  const payload = {
    ...event,
    createdAt: event.createdAt || new Date().toISOString(),
  };

  return requestFirebaseJson(AUTOMATED_NOTIFICATION_EVENTS_ROOT, {
    authToken: resolvedAuthToken,
    method: 'POST',
    body: payload,
  });
}

export async function getAutomationRun(dateKey, authToken) {
  return requestFirebaseJson(['notificationAutomation', 'runs', dateKey], { authToken });
}

export async function saveAutomationRun(dateKey, run, authToken) {
  return requestFirebaseJson(['notificationAutomation', 'runs', dateKey], {
    authToken,
    method: 'PUT',
    body: run,
  });
}
