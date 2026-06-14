import {
  DEFAULT_APP_URL,
  DEFAULT_AUTOMATED_EMAIL_TIME,
  DEFAULT_AUTOMATED_EMAIL_TIME_ZONE,
  DEFAULT_AUTOMATED_EMAIL_WINDOW_MINUTES,
} from '../config/emailNotifications';
import { buildProfileEmailReports } from '../utils/adminReporting';
import { getAutomatedEmailScheduleDecision } from '../utils/emailSchedule';
import {
  getAutomationSettings,
  getAutomationRun,
  getEmailAutomationData,
  getFirebaseRestAuthToken,
  getTallyCycleSettings,
  saveAutomationRun,
} from './firebaseRestService';
import {
  buildEmailContent,
  createTransport,
  getEmailSenderSettings,
  getProfileRecipients,
  sendEmail,
} from './emailNotificationService';

function getScheduleEnv() {
  return {
    time:
      process.env.AUTOMATED_EMAIL_TIME ||
      process.env.EMAIL_AUTOMATION_TIME ||
      DEFAULT_AUTOMATED_EMAIL_TIME,
    timeZone:
      process.env.AUTOMATED_EMAIL_TIME_ZONE ||
      process.env.EMAIL_AUTOMATION_TIME_ZONE ||
      DEFAULT_AUTOMATED_EMAIL_TIME_ZONE,
    windowMinutes:
      process.env.AUTOMATED_EMAIL_WINDOW_MINUTES ||
      process.env.EMAIL_AUTOMATION_WINDOW_MINUTES ||
      DEFAULT_AUTOMATED_EMAIL_WINDOW_MINUTES,
  };
}

function mergeScheduleSettings(persistedSettings = {}) {
  const envSchedule = getScheduleEnv();

  return {
    time: persistedSettings.time || envSchedule.time,
    timeZone: persistedSettings.timeZone || envSchedule.timeZone,
    windowMinutes:
      Number(persistedSettings.windowMinutes) || Number(envSchedule.windowMinutes),
  };
}

function getAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || DEFAULT_APP_URL;
}

function serializeSentItem(item) {
  return {
    messageId: item.messageId,
    profileName: item.profileName,
    subject: item.subject,
    recipients: item.recipients,
  };
}

export async function runAutomatedNotificationEmail({
  now = new Date(),
  force = false,
  dryRun = false,
} = {}) {
  const authToken = await getFirebaseRestAuthToken();
  const persistedSettings = await getAutomationSettings(authToken);
  const scheduleDecision = getAutomatedEmailScheduleDecision({
    now,
    ...mergeScheduleSettings(persistedSettings),
  });

  if (!force && !scheduleDecision.due) {
    return {
      ok: true,
      skipped: true,
      reason: 'outside_schedule',
      localDate: scheduleDecision.localDate,
      localTime: scheduleDecision.localTime,
      schedule: scheduleDecision.schedule,
    };
  }

  const { transactions, submissions } = await getEmailAutomationData(authToken);
  const tallyCycleSettings = await getTallyCycleSettings(authToken);
  const previousRun = await getAutomationRun(scheduleDecision.localDate, authToken);

  if (!force && previousRun?.sentAt) {
    return {
      ok: true,
      skipped: true,
      reason: 'already_sent_today',
      localDate: scheduleDecision.localDate,
      localTime: scheduleDecision.localTime,
      previousRun,
      schedule: scheduleDecision.schedule,
    };
  }

  const reports = buildProfileEmailReports(
    transactions,
    submissions || {},
    scheduleDecision.localDate,
    tallyCycleSettings
  ).map((report) => ({
    ...report,
    appUrl: getAppUrl(),
  }));

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      localDate: scheduleDecision.localDate,
      localTime: scheduleDecision.localTime,
      reports: reports.map((report) => ({
        profileName: report.profileName,
        subject: report.subject,
        recipients: getProfileRecipients(report.profileName),
        stats: report.stats,
      })),
      schedule: scheduleDecision.schedule,
    };
  }

  const transporter = createTransport();
  const { from, replyTo } = getEmailSenderSettings();

  if (!transporter) {
    throw new Error('Missing GMAIL_USER or GMAIL_APP_PASSWORD environment variable.');
  }

  const sent = [];
  for (const report of reports) {
    const profileName = report.profileName || report.profile || 'Profile';
    const recipients = getProfileRecipients(profileName);

    if (recipients.length === 0) {
      throw new Error(`No recipients configured for ${profileName}.`);
    }

    const subject = String(report.subject || `${profileName} summary`).trim();
    const { text, html } = buildEmailContent({
      ...report,
      profileName,
      appUrl: report.appUrl || getAppUrl(),
    });

    const info = await sendEmail({
      transporter,
      from,
      replyTo,
      to: recipients,
      subject,
      text,
      html,
    });

    sent.push({
      messageId: info.messageId,
      profileName,
      subject,
      recipients,
    });
  }

  const runRecord = {
    sentAt: new Date().toISOString(),
    localDate: scheduleDecision.localDate,
    localTime: scheduleDecision.localTime,
    schedule: scheduleDecision.schedule,
    sender: from,
    sent: sent.map(serializeSentItem),
  };

  await saveAutomationRun(scheduleDecision.localDate, runRecord, authToken);

  return {
    ok: true,
    skipped: false,
    localDate: scheduleDecision.localDate,
    localTime: scheduleDecision.localTime,
    schedule: scheduleDecision.schedule,
    sent: sent.map(serializeSentItem),
    sender: from,
  };
}
