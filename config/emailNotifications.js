export const DEFAULT_APP_URL = 'https://ccapp-nine.vercel.app';
export const DEFAULT_GMAIL_USER = 'westpactracker@gmail.com';
export const DEFAULT_EMAIL_FROM_NAME = 'Westpac CC Tracker';

export const DEFAULT_RECIPIENTS_BY_PROFILE = {
  Tony: 'spr.tony@gmail.com',
  Nugs: 'nguyet_anh_le@hotmail.com',
};

export const DEFAULT_EMAIL_RECIPIENTS = Object.values(DEFAULT_RECIPIENTS_BY_PROFILE);

export const DEFAULT_AUTOMATED_EMAIL_TIME = '23:00';
export const DEFAULT_AUTOMATED_EMAIL_TIME_ZONE = 'Australia/Melbourne';
export const DEFAULT_AUTOMATED_EMAIL_WINDOW_MINUTES = 15;
export const MAX_AUTOMATED_EMAIL_WINDOW_MINUTES = 15;
export const AUTOMATED_NOTIFICATION_SETTINGS_ROOT = 'notificationAutomation/settings';
export const AUTOMATED_NOTIFICATION_RUNS_ROOT = 'notificationAutomation/runs';
export const AUTOMATED_NOTIFICATION_EVENTS_ROOT = 'notificationAutomation/events';
