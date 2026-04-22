import React, { useState } from 'react';
import Link from 'next/link';
import ImageUploader from './ImageUploader';
import ImageReviewModal from './ImageReviewModal';
import { processImages } from '../utils/imageProcessor';
import { detectDuplicatesAcrossImages } from '../utils/duplicateDetection';
import { mergeTransactions, prepareForFirebase } from '../utils/transactionMerger';
import { ensureAnonymousAuth } from '../utils/firebaseAuth';
import {
  addTransactions,
  getAllTransactions,
  getAllSubmissions,
  getTodayDate,
  saveProcessedLog,
  getAllProcessedLogs,
  deleteTransactionsByIds,
  deleteProcessedLogs,
  clearUploadedData,
} from '../services/firebaseService';
import { getSavedSimulatedDay } from '../utils/simulationDate';

function buildAllTransactions(processedImages) {
  const allTransactions = [];

  processedImages.forEach((image) => {
    if (!image.transactions) return;

    image.transactions.forEach((tx) => {
      allTransactions.push({
        ...tx,
        imageHash: image.imageHash,
        imageName: image.fileName,
      });
    });
  });

  return allTransactions;
}

function OcrDiagnostics({ processedImages }) {
  if (!processedImages || processedImages.length === 0) return null;

  return (
    <div className="ocr-diagnostics">
      <h3 className="ocr-diagnostics-title">OCR Diagnostics</h3>
      <p className="ocr-diagnostics-sub">
        Raw extracted text and parsed transactions from the uploaded screenshots.
      </p>

      <div className="space-y-4">
        {processedImages.map((image) => (
          <details key={image.imageHash || image.fileName} className="ocr-diagnostics-item">
            <summary>
              <span>{image.fileName}</span>
              <span>
                {image.error
                  ? 'error'
                  : `${image.rawLineCount || image.originalCount || 0} OCR lines | ${image.transactions?.length || 0} parsed`}
              </span>
            </summary>

            {image.error ? (
              <p className="ocr-diagnostics-error">{image.error}</p>
            ) : (
              <>
                <div className="ocr-diagnostics-meta">
                  <span>Hash: {image.imageHash || 'n/a'}</span>
                  <span>Parser: {image.parserProfile || 'classic'}</span>
                  <span>OCR mode: {image.ocrMode || 'balanced'}</span>
                  <span>OCR text:</span>
                </div>
                <pre className="ocr-diagnostics-text">
                  {image.extractedText || 'No text extracted.'}
                </pre>
                <div className="ocr-diagnostics-meta">
                  <span>Parsed transactions:</span>
                </div>
                <ul className="ocr-diagnostics-txs">
                  {(image.transactions || []).map((tx, idx) => (
                    <li key={`${image.fileName}-${idx}`}>
                      <span className="ocr-diagnostics-line">
                        {tx.lineIndex ? `Line ${tx.lineIndex}` : 'Line ?'}
                      </span>
                      <span className="ocr-diagnostics-tx">
                        {tx.merchant} - ${Number(tx.amount || 0).toFixed(2)}
                      </span>
                      {tx.isRefund ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                          Refund / credit
                        </span>
                      ) : null}
                      {tx.rawLine ? <span className="ocr-diagnostics-raw">{tx.rawLine}</span> : null}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </details>
        ))}
      </div>
    </div>
  );
}

function parseRecipientList(value) {
  return String(value || '')
    .split(/[\n,;]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const PROFILE_NAMES = ['Tony', 'Nugs'];

function getSubmissionValue(sub, user) {
  return sub?.[user]?.value ?? null;
}

function getSubmissionDay(sub, user) {
  const dayValue = sub?.[user]?.day;
  if (dayValue === undefined || dayValue === null || dayValue === '') return null;
  const parsed = Number(dayValue);
  return Number.isFinite(parsed) ? parsed : null;
}

function getSubmissionStatus(sub) {
  const values = PROFILE_NAMES.map((u) => getSubmissionValue(sub, u)).filter(Boolean);
  const hasUnsure = values.includes('Unsure');
  const allPicked = values.length === PROFILE_NAMES.length;

  return {
    resolved: allPicked && !hasUnsure && new Set(values).size === 1,
    conflict: allPicked && !hasUnsure && new Set(values).size > 1,
    unsure: hasUnsure,
    anyPicked: values.length > 0,
  };
}

function isVisibleForUser(tx, submissions, user, day) {
  if (!user) return true;

  const sub = submissions[tx.id] || {};
  const { resolved } = getSubmissionStatus(sub);
  const submittedDay = getSubmissionDay(sub, user);
  const submittedToday = submittedDay !== null && submittedDay === day;

  return !resolved && !submittedToday;
}

function shouldCountForAssignee(sub, assignee, day) {
  const values = PROFILE_NAMES.map((u) => {
    const submittedDay = getSubmissionDay(sub, u);
    return submittedDay !== null && submittedDay === day ? getSubmissionValue(sub, u) : null;
  }).filter(Boolean);
  if (values.includes('Unsure')) return false;
  return values.includes(assignee);
}

function dateToMs(dateKey) {
  if (!dateKey) return null;
  const ms = Date.parse(`${dateKey}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

function daysBetween(olderKey, newerKey) {
  const olderMs = dateToMs(olderKey);
  const newerMs = dateToMs(newerKey);
  if (olderMs === null || newerMs === null) return null;
  return Math.floor((newerMs - olderMs) / 86400000);
}

function buildProfileEmailReports(transactions, submissions, day) {
  const todayKey = getTodayDate();

  return PROFILE_NAMES.map((profileName) => {
    const visibleTransactions = transactions.filter((tx) =>
      isVisibleForUser(tx, submissions, profileName, day)
    );

    const totalSpend = Object.entries(submissions).reduce((acc, [txId, sub]) => {
      const tx = transactions.find((item) => item.id === txId);
      if (!tx || !shouldCountForAssignee(sub, profileName, day)) return acc;
      return acc + Number(tx.amount || 0);
    }, 0);

    const pendingTransactions = visibleTransactions.filter((tx) => {
      if (!(tx.isPending || !tx.date)) return false;
      const referenceDay = tx.uploadedDay || tx.date || todayKey;
      return referenceDay === todayKey;
    });

    const outstandingTransactions = visibleTransactions.filter((tx) => {
      if (!(tx.isPending || !tx.date)) return false;
      const referenceDay = tx.uploadedDay || tx.date;
      if (!referenceDay) return false;
      const age = daysBetween(referenceDay, todayKey);
      return age !== null && age > 1;
    });

    const conflictsCount = visibleTransactions.filter((tx) => {
      const status = getSubmissionStatus(submissions[tx.id] || {});
      return status.conflict;
    }).length;

    const unsuresCount = visibleTransactions.filter((tx) => {
      const status = getSubmissionStatus(submissions[tx.id] || {});
      return status.unsure;
    }).length;

    return {
      profileName,
      subject: `${profileName} profile summary - ${todayKey}`,
      appUrl: 'https://ccapp-nine.vercel.app',
      stats: {
        totalSpend,
        pendingCount: pendingTransactions.length,
        outstandingCount: outstandingTransactions.length,
        conflictsCount,
        unsuresCount,
      },
    };
  });
}

function buildUndoPayload(addedRecords, processedImages) {
  const imageToTransactionIds = new Map();

  addedRecords.forEach((record) => {
    const imageHash = record.tx?.imageHash;
    if (!imageHash) return;

    if (!imageToTransactionIds.has(imageHash)) {
      imageToTransactionIds.set(imageHash, []);
    }
    imageToTransactionIds.get(imageHash).push(record.id);
  });

  const imageHashes = Array.from(imageToTransactionIds.keys());

  return {
    transactionIds: addedRecords.map((record) => record.id).filter(Boolean),
    imageHashes,
    imageBreakdown: processedImages
      .filter((image) => image.imageHash && imageToTransactionIds.has(image.imageHash))
      .map((image) => ({
        imageHash: image.imageHash,
        imageName: image.fileName,
        transactionIds: imageToTransactionIds.get(image.imageHash) || [],
      })),
  };
}

const LAST_UPLOAD_UNDO_KEY = 'cc_last_upload_undo';

export default function AdminUploadPage() {
  const [step, setStep] = useState('upload');
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [processedImages, setProcessedImages] = useState([]);
  const [ocrPreviewImages, setOcrPreviewImages] = useState([]);
  const [duplicateDetection, setDuplicateDetection] = useState(null);
  const [lastMergeReport, setLastMergeReport] = useState(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [emailRecipients, setEmailRecipients] = useState('spr.tony@gmail.com');
  const [emailSubject, setEmailSubject] = useState('');
  const [isEmailSending, setIsEmailSending] = useState(false);
  const [emailStatus, setEmailStatus] = useState(null);
  const [notificationReports, setNotificationReports] = useState([]);
  const [testEmailRecipient, setTestEmailRecipient] = useState('spr.tony@gmail.com');
  const [lastUploadUndo, setLastUploadUndo] = useState(null);
  const [confirmTonyEmail, setConfirmTonyEmail] = useState(false);
  const [confirmNugsEmail, setConfirmNugsEmail] = useState(false);

  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LAST_UPLOAD_UNDO_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.transactionIds)) {
        setLastUploadUndo(parsed);
      }
    } catch (err) {
      console.warn('Failed to restore last upload undo state:', err);
    }
  }, []);

  React.useEffect(() => {
    try {
      if (lastUploadUndo) {
        window.localStorage.setItem(LAST_UPLOAD_UNDO_KEY, JSON.stringify(lastUploadUndo));
      } else {
        window.localStorage.removeItem(LAST_UPLOAD_UNDO_KEY);
      }
    } catch (err) {
      console.warn('Failed to persist last upload undo state:', err);
    }
  }, [lastUploadUndo]);

  React.useEffect(
    () =>
      ensureAnonymousAuth({
        onReady: () => setAuthReady(true),
        onError: (authError) => {
          console.error('Anonymous Firebase sign-in failed:', authError);
          setError('Unable to sign in to Firebase automatically.');
        },
      }),
    []
  );

  React.useEffect(() => {
    if (step !== 'success') return;

    const defaultSubject = `Credit card upload ready - ${getTodayDate()}`;
    setEmailSubject(defaultSubject);
    setEmailStatus(null);
    setConfirmTonyEmail(false);
    setConfirmNugsEmail(false);
  }, [step, successMessage]);

  React.useEffect(() => {
    if (step !== 'success') return undefined;

    let cancelled = false;

    const loadNotificationReports = async () => {
      try {
        const [allTransactions, allSubmissions] = await Promise.all([
          getAllTransactions(),
          getAllSubmissions(),
        ]);
        if (cancelled) return;

        setNotificationReports(
          buildProfileEmailReports(allTransactions, allSubmissions || {}, getSavedSimulatedDay())
        );
      } catch (err) {
        console.error('Failed to load notification reports:', err);
      }
    };

    loadNotificationReports();

    return () => {
      cancelled = true;
    };
  }, [step, successMessage]);

  const handleFirebaseSmokeTest = async () => {
    if (!authReady) return;
    setIsLoading(true);
    setError(null);
    setStep('processing');

    const marker = `FIREBASE TEST ${new Date().toISOString()}`;
    const testTransaction = {
      merchant: marker,
      amount: 1.23,
      category: 'Test',
      date: getTodayDate(),
      isPending: false,
      source: 'manual-test',
      uploadedDate: new Date().toISOString(),
      imageHash: `smoke-${Date.now()}`,
      owner: null,
    };

    try {
      const ids = await addTransactions([testTransaction]);
      const allTransactions = await getAllTransactions();
      const written = allTransactions.find(
        (tx) => tx.merchant === marker && Number(tx.amount) === 1.23
      );

      if (!written) {
        throw new Error('Write completed but the test transaction was not readable back from Firebase');
      }

      setSuccessMessage({
        added: 1,
        skipped: 0,
        summary: {
          marker,
          id: ids[0],
        },
      });
      setStep('success');
    } catch (err) {
      console.error('Firebase smoke test failed:', err);
      setError(err.message || 'Firebase write test failed');
      setStep('upload');
    } finally {
      setIsLoading(false);
    }
  };

  const runOcrPipeline = async () => {
    const results = await processImages(
      uploadedFiles,
      (progressUpdate) => {
        setProgress(progressUpdate.overallProgress);
      },
      { profile: 'classic', uploadDate: getTodayDate() }
    );

    setProcessedImages(results);

    const successfulImages = results.filter((result) => !result.error);
    if (successfulImages.length === 0) {
      throw new Error('Failed to process any images. Please check the image quality and try again.');
    }

    const detection = detectDuplicatesAcrossImages(successfulImages);
    setDuplicateDetection(detection);
    return { results, detection };
  };

  const handleImagesSelected = (files) => {
    setUploadedFiles(files);
    setError(null);
  };

  const handleConfirmTransactions = async (keptIndices, processedOverride = processedImages) => {
    if (!authReady) return;
    setIsLoading(true);
    setStep('processing');

    try {
      let allTransactions = buildAllTransactions(processedOverride);

      if (keptIndices.length > 0) {
        allTransactions = allTransactions.filter((_, idx) => keptIndices.includes(idx));
      }

      const existingTransactions = await getAllTransactions();
      const processedLogs = await getAllProcessedLogs();

      const mergeResult = mergeTransactions(
        allTransactions,
        existingTransactions,
        processedLogs || {}
      );
      setLastMergeReport({
        skipped: mergeResult.skipped,
        summary: mergeResult.summary,
      });

      if (mergeResult.toAdd.length === 0) {
        setLastUploadUndo(null);
        setSuccessMessage({
          added: 0,
          skipped: mergeResult.skipped.length,
          message: 'No new transactions to add. All were duplicates or already processed.',
        });
        setStep('success');
        return;
      }

      const firebaseTransactions = prepareForFirebase(mergeResult.toAdd, 'image');
      const transactionIds = await addTransactions(firebaseTransactions);
      const addedRecords = mergeResult.toAdd.map((tx, idx) => ({
        id: transactionIds[idx],
        tx,
      }));
      const undoPayload = buildUndoPayload(addedRecords, processedOverride);

      for (const image of processedOverride) {
        if (!image.imageHash) continue;

        const imageTransactionIds = addedRecords
          .filter((record) => record.tx.imageHash === image.imageHash)
          .map((record) => record.id)
          .filter(Boolean);

        if (imageTransactionIds.length > 0) {
          await saveProcessedLog(image.imageHash, imageTransactionIds, image.fileName);
        }
      }

      setSuccessMessage({
        added: mergeResult.toAdd.length,
        skipped: mergeResult.skipped.length,
        summary: mergeResult.summary,
      });
      setLastUploadUndo(undoPayload);
      setStep('success');
    } catch (err) {
      console.error('Error saving transactions:', err);
      setError(err.message || 'Failed to save transactions to Firebase');
      setLastUploadUndo(null);
      setStep('review');
    } finally {
      setIsLoading(false);
    }
  };

  const handleProcessImages = async () => {
    if (!authReady) return;
    if (uploadedFiles.length === 0) {
      setError('Please select at least one image');
      return;
    }

    setIsLoading(true);
    setStep('processing');
    setError(null);

    try {
      const { results, detection } = await runOcrPipeline();

      if (detection.duplicates.length > 0 || detection.flagged.length > 0) {
        setStep('review');
      } else {
        await handleConfirmTransactions([], results);
      }
    } catch (err) {
      console.error('Error processing images:', err);
      setError(err.message || 'Failed to process images. Please try again.');
      setStep('upload');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePreviewOcr = async () => {
    if (!authReady) return;
    if (uploadedFiles.length === 0) {
      setError('Please select at least one image');
      return;
    }

    setIsLoading(true);
    setStep('processing');
    setError(null);

    try {
      const { results } = await runOcrPipeline();
      setOcrPreviewImages(results);
      setStep('preview');
    } catch (err) {
      console.error('Error processing images:', err);
      setError(err.message || 'Failed to process images. Please try again.');
      setStep('upload');
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartOver = () => {
    setStep('upload');
    setUploadedFiles([]);
    setProcessedImages([]);
    setDuplicateDetection(null);
    setLastMergeReport(null);
    setProgress(0);
    setError(null);
    setSuccessMessage(null);
    setOcrPreviewImages([]);
    setEmailRecipients('');
    setEmailSubject('');
    setEmailStatus(null);
    setNotificationReports([]);
    setConfirmTonyEmail(false);
  };

  const handleUndoLastUpload = async () => {
    if (!authReady || !lastUploadUndo) return;

    const { transactionIds = [], imageHashes = [], imageBreakdown = [] } = lastUploadUndo;
    const confirmText = [
      'Undo the last upload batch?',
      `This will remove ${transactionIds.length} transaction${transactionIds.length === 1 ? '' : 's'} and their processed logs.`,
      'Older uploads will stay intact.',
    ].join('\n\n');

    if (!window.confirm(confirmText)) {
      return;
    }

    setIsLoading(true);
    setEmailStatus(null);

    try {
      await Promise.all([
        deleteTransactionsByIds(transactionIds),
        deleteProcessedLogs(imageHashes),
      ]);

      setLastUploadUndo(null);
      setSuccessMessage({
        added: 0,
        skipped: 0,
        message: `Undid the last upload batch: ${transactionIds.length} transaction${transactionIds.length === 1 ? '' : 's'} removed.`,
      });
      setEmailStatus({
        type: 'success',
        message: `Removed the last upload batch from Firebase. ${imageBreakdown.length} image${imageBreakdown.length === 1 ? '' : 's'} rolled back.`,
      });
      setStep('success');
    } catch (err) {
      console.error('Failed to undo last upload:', err);
      setEmailStatus({
        type: 'error',
        message: err.message || 'Failed to undo the last upload.',
      });
      setStep('success');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendEmailNotification = async ({ profileNames = PROFILE_NAMES, forceRecipient = null } = {}) => {
    if (!authReady || !successMessage) return;

    const recipients =
      forceRecipient ? [forceRecipient] : parseRecipientList(emailRecipients);
    if (recipients.length === 0) {
      setEmailStatus({
        type: 'error',
        message: 'Add at least one recipient email address first.',
      });
      return;
    }

    const confirmText = [
      `Send this notification to ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}?`,
      'This will email the current upload summary and link to the app.',
    ].join('\n\n');

    if (!window.confirm(confirmText)) {
      return;
    }

    setIsEmailSending(true);
    setEmailStatus(null);

    try {
      const reports =
        notificationReports.length > 0
          ? notificationReports.filter((report) => profileNames.includes(report.profileName))
          : buildProfileEmailReports(
              await getAllTransactions(),
              await getAllSubmissions(),
              getSavedSimulatedDay()
            ).filter((report) => profileNames.includes(report.profileName));
      const subjectPrefix = emailSubject.trim();

      const response = await fetch('/api/send-notification-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: recipients,
          reports: reports.map((report) => ({
            ...report,
            subject: subjectPrefix
              ? `${subjectPrefix} - ${report.profileName}`
              : report.subject,
          })),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'Failed to send email notification.');
      }

      setEmailStatus({
        type: 'success',
        message: `Sent ${data.sent.length} profile email${data.sent.length === 1 ? '' : 's'} to ${data.sent[0]?.recipients?.length || recipients.length} recipient${(data.sent[0]?.recipients?.length || recipients.length) === 1 ? '' : 's'}.`,
      });
    } catch (err) {
      console.error('Failed to send notification email:', err);
      setEmailStatus({
        type: 'error',
        message: err.message || 'Failed to send email notification.',
      });
    } finally {
      setIsEmailSending(false);
    }
  };

  const handleSendTonyEmail = async () => {
    if (!confirmTonyEmail) {
      setEmailStatus({
        type: 'error',
        message: 'Please tick the confirmation checkbox first.',
      });
      return;
    }

    await handleSendEmailNotification({
      profileNames: ['Tony'],
      forceRecipient: 'spr.tony@gmail.com',
    });
  };

  const handleSendNugsEmail = async () => {
    if (!confirmNugsEmail) {
      setEmailStatus({
        type: 'error',
        message: 'Please tick the Nugs confirmation checkbox first.',
      });
      return;
    }

    await handleSendEmailNotification({
      profileNames: ['Nugs'],
      forceRecipient: 'nguyet_anh_le@hotmail.com',
    });
  };

  const handleSendTestEmail = async () => {
    if (!authReady) return;

    const recipient =
      testEmailRecipient.trim() || window.prompt('Send a test email to which address?')?.trim();

    if (!recipient) return;

    const confirmed = window.confirm(
      `Send a dummy test email to ${recipient}?\n\nThis will not read or change any transaction data.`
    );

    if (!confirmed) return;

    setIsEmailSending(true);
    setEmailStatus(null);

    try {
      const response = await fetch('/api/send-notification-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: [recipient],
          subject: 'Test email from credit card app',
          appUrl: 'https://ccapp-nine.vercel.app',
          uploadDate: getTodayDate(),
          note: 'This is a dummy test email. It does not reflect live transaction data.',
          stats: {
            pendingCount: 0,
            importedCount: 0,
            skippedCount: 0,
            totalTransactions: 0,
          },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'Failed to send test email.');
      }

      setEmailStatus({
        type: 'success',
        message: `Test email sent to ${data.recipients.length} recipient${data.recipients.length === 1 ? '' : 's'}.`,
      });
    } catch (err) {
      console.error('Failed to send test email:', err);
      setEmailStatus({
        type: 'error',
        message: err.message || 'Failed to send test email.',
      });
    } finally {
      setIsEmailSending(false);
    }
  };

  const handleWipeUploadedData = async () => {
    if (!authReady) return;
    if (
      !window.confirm(
        'Delete all uploaded transactions, processed logs, and submissions from Firebase? This cannot be undone.'
      )
    ) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await clearUploadedData();
      setUploadedFiles([]);
      setProcessedImages([]);
      setOcrPreviewImages([]);
      setDuplicateDetection(null);
      setLastMergeReport(null);
      setSuccessMessage({
        added: 0,
        skipped: 0,
        message: 'All uploaded Firebase data has been cleared.',
      });
      setStep('success');
    } catch (err) {
      console.error('Failed to wipe uploaded data:', err);
      setError(err.message || 'Failed to clear uploaded data');
      setStep('upload');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-6">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <Link href="/">
            <a className="text-blue-400 hover:text-blue-300 text-sm mb-4 inline-block">
              Back to app
            </a>
          </Link>
          <h1 className="text-4xl font-bold mb-2">Import Transactions</h1>
          <p className="text-slate-300">Upload screenshots of transactions to auto-import them</p>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-500 rounded-lg p-4 mb-6">
            <p className="text-red-200">
              <strong>Error:</strong> {error}
            </p>
          </div>
        )}

        {step === 'upload' && (
          <div className="bg-slate-800 rounded-lg p-8 border border-slate-700">
            <ImageUploader onImagesSelected={handleImagesSelected} isLoading={isLoading} />
            <p className="text-xs text-slate-400 mt-4">
              Using classic OCR screenshots.
            </p>

            <button
              onClick={handleProcessImages}
              disabled={uploadedFiles.length === 0 || isLoading || !authReady}
              className="w-full mt-6 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-white font-medium transition"
            >
              {!authReady ? 'Connecting...' : isLoading ? 'Processing...' : `Process ${uploadedFiles.length} Image(s)`}
            </button>

            <button
              onClick={handleFirebaseSmokeTest}
              disabled={isLoading || !authReady}
              className="w-full mt-3 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg text-white font-medium transition"
              >
              Test Firebase Write
            </button>

            <button
              onClick={handlePreviewOcr}
              disabled={uploadedFiles.length === 0 || isLoading || !authReady}
              className="w-full mt-3 px-6 py-3 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded-lg text-white font-medium transition"
            >
              OCR Preview Only
            </button>

            <button
              onClick={handleWipeUploadedData}
              disabled={isLoading || !authReady}
              className="w-full mt-3 px-6 py-3 bg-rose-700 hover:bg-rose-600 disabled:opacity-50 rounded-lg text-white font-medium transition"
            >
              Debug: Wipe Uploaded Data
            </button>

            {lastUploadUndo && (
              <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
                <p className="text-sm text-amber-100 mb-3">
                  A previous upload batch is still available to undo.
                </p>
                <button
                  onClick={handleUndoLastUpload}
                  disabled={isLoading}
                  className="w-full px-6 py-3 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-lg text-white font-medium transition"
                >
                  Undo last upload
                </button>
              </div>
            )}

            <div className="mt-4 rounded-lg border border-slate-700 bg-slate-900/50 p-4">
              <p className="text-sm text-slate-300 mb-3">
                Email-only test: send a dummy notification without touching Firebase data.
              </p>
              <input
                value={testEmailRecipient}
                onChange={(e) => setTestEmailRecipient(e.target.value)}
                placeholder="recipient@example.com"
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-white placeholder:text-slate-500"
              />
              <button
                onClick={handleSendTestEmail}
                disabled={isEmailSending || !authReady}
                className="w-full mt-3 px-6 py-3 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg text-white font-medium transition"
              >
                {isEmailSending ? 'Sending...' : 'Send dummy test email'}
              </button>
            </div>
          </div>
        )}

        {step === 'processing' && (
          <div className="bg-slate-800 rounded-lg p-8 border border-slate-700 text-center">
            <p className="text-3xl mb-4">Processing</p>
            <p className="text-white font-medium mb-4">Processing images with OCR...</p>
            <div className="w-full bg-slate-700 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <p className="text-slate-400 text-sm mt-2">{Math.round(progress * 100)}%</p>
          </div>
        )}

        {step === 'review' && duplicateDetection && (
          <>
            <div className="bg-slate-800 rounded-lg p-6 mb-6 border border-slate-700">
              <h2 className="text-xl font-bold mb-4">Transaction Summary</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-slate-900 rounded p-3 text-center">
                  <p className="text-2xl font-bold text-blue-400">{duplicateDetection.summary.total}</p>
                  <p className="text-xs text-slate-400">Total Extracted</p>
                </div>
                <div className="bg-slate-900 rounded p-3 text-center">
                  <p className="text-2xl font-bold text-green-400">
                    {duplicateDetection.summary.uniqueCount}
                  </p>
                  <p className="text-xs text-slate-400">Unique</p>
                </div>
                <div className="bg-slate-900 rounded p-3 text-center">
                  <p className="text-2xl font-bold text-red-400">
                    {duplicateDetection.summary.duplicateGroups}
                  </p>
                  <p className="text-xs text-slate-400">Duplicates</p>
                </div>
                <div className="bg-slate-900 rounded p-3 text-center">
                  <p className="text-2xl font-bold text-yellow-400">
                    {duplicateDetection.summary.flaggedGroups}
                  </p>
                  <p className="text-xs text-slate-400">Flagged</p>
                </div>
              </div>
            </div>

            <ImageReviewModal
              duplicates={duplicateDetection.duplicates}
              flagged={duplicateDetection.flagged}
              onConfirm={handleConfirmTransactions}
              onCancel={() => setStep('upload')}
              isLoading={isLoading}
            />
          </>
        )}

        {step === 'preview' && (
          <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-2xl font-bold text-white">OCR Preview</h2>
                <p className="text-slate-400 text-sm">
                  Review what the OCR extracted before sending it to Firebase.
                </p>
              </div>
              <button
                onClick={() => setStep('upload')}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-white text-sm"
              >
                Back
              </button>
            </div>

            {duplicateDetection && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                <div className="bg-slate-900 rounded p-3 text-center">
                  <p className="text-2xl font-bold text-blue-400">{duplicateDetection.summary.total}</p>
                  <p className="text-xs text-slate-400">Total Extracted</p>
                </div>
                <div className="bg-slate-900 rounded p-3 text-center">
                  <p className="text-2xl font-bold text-green-400">
                    {duplicateDetection.summary.uniqueCount}
                  </p>
                  <p className="text-xs text-slate-400">Unique</p>
                </div>
                <div className="bg-slate-900 rounded p-3 text-center">
                  <p className="text-2xl font-bold text-red-400">
                    {duplicateDetection.summary.duplicateGroups}
                  </p>
                  <p className="text-xs text-slate-400">Duplicates</p>
                </div>
                <div className="bg-slate-900 rounded p-3 text-center">
                  <p className="text-2xl font-bold text-yellow-400">
                    {duplicateDetection.summary.flaggedGroups}
                  </p>
                  <p className="text-xs text-slate-400">Flagged</p>
                </div>
              </div>
            )}

            <OcrDiagnostics processedImages={ocrPreviewImages} />

            <div className="flex gap-3 mt-5">
              <button
                onClick={() => handleConfirmTransactions([], ocrPreviewImages)}
                disabled={isLoading}
                className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-white font-medium transition"
              >
                {isLoading ? 'Processing...' : 'Import These Transactions'}
              </button>
              <button
                onClick={handleStartOver}
                disabled={isLoading}
                className="px-6 py-3 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded-lg text-white font-medium transition"
              >
                Start Over
              </button>
            </div>

            <p className="text-xs text-slate-400 mt-3">
              Preview mode is for OCR testing only. Import will still use the same merge and dedupe logic.
            </p>
          </div>
        )}

        {step === 'success' && successMessage && (
          <div className="bg-slate-800 rounded-lg p-8 border border-slate-700 text-center">
            <p className="text-5xl mb-4">Complete</p>
            <h2 className="text-2xl font-bold text-white mb-2">Done</h2>
            <p className="text-slate-300 mb-6">
              {successMessage.added > 0
                ? `${successMessage.added} new transaction${successMessage.added !== 1 ? 's' : ''} added successfully.`
                : 'All transactions were duplicates or already processed.'}
            </p>

            {successMessage.skipped > 0 && (
              <p className="text-slate-400 text-sm mb-6">
                {successMessage.skipped} duplicate(s) skipped.
              </p>
            )}

            {lastMergeReport?.skipped?.length > 0 && (
              <details className="text-left bg-slate-900/50 border border-slate-700 rounded-lg p-4 mb-6">
                <summary className="cursor-pointer text-sm font-medium text-slate-200">
                  View skipped / removed items
                </summary>
                <div className="mt-4 space-y-3 max-h-72 overflow-auto pr-2">
                  {lastMergeReport.skipped.map((item, idx) => (
                    <div key={`${item.reason}-${idx}`} className="bg-slate-800 rounded p-3 border border-slate-700">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-white">
                          {item.transaction.merchant} - ${Number(item.transaction.amount || 0).toFixed(2)}
                        </p>
                        <span className="text-xs uppercase tracking-wider text-amber-300">
                          {item.reason.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        Date: {item.transaction.date || 'n/a'} · Image: {item.transaction.imageHash || 'n/a'}
                      </p>
                    </div>
                  ))}
                </div>
              </details>
            )}

            <div className="text-left bg-slate-900/60 border border-slate-700 rounded-lg p-5 mb-6">
              <h3 className="text-lg font-semibold text-white mb-2">Tony email test</h3>
              <p className="text-sm text-slate-300 mb-4">
                This will send only the Tony profile summary to <span className="text-white">spr.tony@gmail.com</span>.
              </p>

              <label className="flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-950/70 p-3">
                <input
                  type="checkbox"
                  checked={confirmTonyEmail}
                  onChange={(e) => setConfirmTonyEmail(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-900 text-blue-500"
                />
                <span className="text-sm text-slate-200">
                  I confirm I want to send the Tony profile email to spr.tony@gmail.com.
                </span>
              </label>

              <label className="block mt-4">
                <span className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
                  Subject prefix
                </span>
                <input
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  placeholder="Credit card upload summary"
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                />
              </label>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                <div className="bg-slate-950 rounded-lg p-3 border border-slate-700">
                  <p className="text-xs text-slate-400">Tony spend</p>
                  <p className="text-xl font-bold text-white">
                    {notificationReports[0] ? `$${Number(notificationReports[0].stats.totalSpend || 0).toFixed(2)}` : '...'}
                  </p>
                </div>
                <div className="bg-slate-950 rounded-lg p-3 border border-slate-700">
                  <p className="text-xs text-slate-400">New pending</p>
                  <p className="text-xl font-bold text-white">
                    {notificationReports[0] ? notificationReports[0].stats.pendingCount : '...'}
                  </p>
                </div>
                <div className="bg-slate-950 rounded-lg p-3 border border-slate-700">
                  <p className="text-xs text-slate-400">Outstanding</p>
                  <p className="text-xl font-bold text-white">
                    {notificationReports[0] ? notificationReports[0].stats.outstandingCount : '...'}
                  </p>
                </div>
                <div className="bg-slate-950 rounded-lg p-3 border border-slate-700">
                  <p className="text-xs text-slate-400">Conflicts</p>
                  <p className="text-xl font-bold text-white">
                    {notificationReports[0] ? notificationReports[0].stats.conflictsCount : '...'}
                  </p>
                </div>
              </div>

              {emailStatus && (
                <p
                  className={`mt-4 text-sm ${emailStatus.type === 'success' ? 'text-emerald-300' : 'text-rose-300'}`}
                >
                  {emailStatus.message}
                </p>
              )}

              <button
                onClick={handleSendTonyEmail}
                disabled={isEmailSending || !confirmTonyEmail}
                className="mt-4 w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-white font-medium transition"
              >
                {isEmailSending ? 'Sending...' : 'Send Tony email'}
              </button>
            </div>

            <div className="text-left bg-slate-900/60 border border-slate-700 rounded-lg p-5 mb-6">
              <h3 className="text-lg font-semibold text-white mb-2">Nugs email test</h3>
              <p className="text-sm text-slate-300 mb-4">
                This will send only the Nugs profile summary to <span className="text-white">nguyet_anh_le@hotmail.com</span>.
              </p>

              <label className="flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-950/70 p-3">
                <input
                  type="checkbox"
                  checked={confirmNugsEmail}
                  onChange={(e) => setConfirmNugsEmail(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-900 text-blue-500"
                />
                <span className="text-sm text-slate-200">
                  I confirm I want to send the Nugs profile email to nguyet_anh_le@hotmail.com.
                </span>
              </label>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                <div className="bg-slate-950 rounded-lg p-3 border border-slate-700">
                  <p className="text-xs text-slate-400">Nugs spend</p>
                  <p className="text-xl font-bold text-white">
                    {notificationReports[1] ? `$${Number(notificationReports[1].stats.totalSpend || 0).toFixed(2)}` : '...'}
                  </p>
                </div>
                <div className="bg-slate-950 rounded-lg p-3 border border-slate-700">
                  <p className="text-xs text-slate-400">New pending</p>
                  <p className="text-xl font-bold text-white">
                    {notificationReports[1] ? notificationReports[1].stats.pendingCount : '...'}
                  </p>
                </div>
                <div className="bg-slate-950 rounded-lg p-3 border border-slate-700">
                  <p className="text-xs text-slate-400">Outstanding</p>
                  <p className="text-xl font-bold text-white">
                    {notificationReports[1] ? notificationReports[1].stats.outstandingCount : '...'}
                  </p>
                </div>
                <div className="bg-slate-950 rounded-lg p-3 border border-slate-700">
                  <p className="text-xs text-slate-400">Conflicts</p>
                  <p className="text-xl font-bold text-white">
                    {notificationReports[1] ? notificationReports[1].stats.conflictsCount : '...'}
                  </p>
                </div>
              </div>

              <button
                onClick={handleSendNugsEmail}
                disabled={isEmailSending || !confirmNugsEmail}
                className="mt-4 w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-white font-medium transition"
              >
                {isEmailSending ? 'Sending...' : 'Send Nugs email'}
              </button>

              <button
                onClick={handleUndoLastUpload}
                disabled={!lastUploadUndo || isLoading}
                className="mt-3 w-full px-6 py-3 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-lg text-white font-medium transition"
              >
                Undo last upload
              </button>
              <p className="mt-2 text-xs text-slate-500">
                Removes only the latest successful import batch, not older uploads.
              </p>
            </div>

            <div className="space-y-2">
              <Link
                href="/"
              >
                <a className="block w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg text-white font-medium transition">
                  Return to Main App
                </a>
              </Link>
              <button
                onClick={handleStartOver}
                className="w-full px-6 py-3 bg-slate-700 hover:bg-slate-600 rounded-lg text-white font-medium transition"
              >
                Upload More Images
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

