import { useEffect, useState } from 'react';
import { ensureAnonymousAuth } from '../utils/firebaseAuth';
import {
  buildAdminActivityLog,
  buildProcessedBatches,
  buildProfileEmailReports,
} from '../utils/adminReporting';
import {
  getAllProcessedLogs,
  getAllSubmissions,
  getAllTransactions,
  getPresenceEntries,
  getTodayDate,
} from '../services/firebaseService';

const LAST_UPLOAD_UNDO_KEY = 'cc_last_upload_undo';

export function useAdminDashboardData(step, successMessage, onAuthError) {
  const [authReady, setAuthReady] = useState(false);
  const [emailStatus, setEmailStatus] = useState(null);
  const [notificationReports, setNotificationReports] = useState([]);
  const [lastUploadUndo, setLastUploadUndo] = useState(null);
  const [confirmTonyEmail, setConfirmTonyEmail] = useState(false);
  const [confirmNugsEmail, setConfirmNugsEmail] = useState(false);
  const [uploadedBatches, setUploadedBatches] = useState([]);
  const [adminActivityLog, setAdminActivityLog] = useState([]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LAST_UPLOAD_UNDO_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.transactionIds)) {
        setLastUploadUndo(parsed);
      }
    } catch (error) {
      console.warn('Failed to restore last upload undo state:', error);
    }
  }, []);

  useEffect(() => {
    try {
      if (lastUploadUndo) {
        window.localStorage.setItem(LAST_UPLOAD_UNDO_KEY, JSON.stringify(lastUploadUndo));
      } else {
        window.localStorage.removeItem(LAST_UPLOAD_UNDO_KEY);
      }
    } catch (error) {
      console.warn('Failed to persist last upload undo state:', error);
    }
  }, [lastUploadUndo]);

  useEffect(
    () =>
      ensureAnonymousAuth({
        onReady: () => setAuthReady(true),
        onError: (authError) => {
          console.error('Anonymous Firebase sign-in failed:', authError);
          if (typeof onAuthError === 'function') {
            onAuthError('Unable to sign in to Firebase automatically.');
          }
        },
      }),
    [onAuthError]
  );

  useEffect(() => {
    if (step !== 'success') return;

    setEmailStatus(null);
    setConfirmTonyEmail(false);
    setConfirmNugsEmail(false);
  }, [step, successMessage]);

  const loadNotificationReports = async () => {
    const [allTransactions, allSubmissions] = await Promise.all([
      getAllTransactions(),
      getAllSubmissions(),
    ]);
    const reports = buildProfileEmailReports(allTransactions, allSubmissions || {}, getTodayDate());
    setNotificationReports(reports);
    return reports;
  };

  useEffect(() => {
    if (step !== 'success') return undefined;

    let cancelled = false;

    const run = async () => {
      try {
        const [allTransactions, allSubmissions] = await Promise.all([
          getAllTransactions(),
          getAllSubmissions(),
        ]);
        if (cancelled) return;
        setNotificationReports(buildProfileEmailReports(allTransactions, allSubmissions || {}, getTodayDate()));
      } catch (error) {
        console.error('Failed to load notification reports:', error);
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [step, successMessage]);

  const refreshUploadedBatches = async () => {
    const processedLogs = await getAllProcessedLogs();
    const batches = buildProcessedBatches(processedLogs || {});
    setUploadedBatches(batches);
    return batches;
  };

  useEffect(() => {
    if (!authReady) return undefined;

    let cancelled = false;

    const run = async () => {
      try {
        const processedLogs = await getAllProcessedLogs();
        if (cancelled) return;
        setUploadedBatches(buildProcessedBatches(processedLogs || {}));
      } catch (error) {
        console.error('Failed to load uploaded batches:', error);
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [authReady, step, successMessage, lastUploadUndo]);

  useEffect(() => {
    if (!authReady) return undefined;

    let cancelled = false;

    const loadAdminActivity = async () => {
      try {
        const [presenceEntries, submissions] = await Promise.all([
          getPresenceEntries(),
          getAllSubmissions(),
        ]);
        if (cancelled) return;
        setAdminActivityLog(buildAdminActivityLog(presenceEntries || {}, submissions || {}));
      } catch (error) {
        console.error('Failed to load admin activity log:', error);
      }
    };

    loadAdminActivity();
    const interval = window.setInterval(loadAdminActivity, 10000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [authReady, step, successMessage]);

  return {
    adminActivityLog,
    authReady,
    confirmNugsEmail,
    confirmTonyEmail,
    emailStatus,
    lastUploadUndo,
    loadNotificationReports,
    notificationReports,
    refreshUploadedBatches,
    setConfirmNugsEmail,
    setConfirmTonyEmail,
    setEmailStatus,
    setLastUploadUndo,
    setNotificationReports,
    uploadedBatches,
  };
}
