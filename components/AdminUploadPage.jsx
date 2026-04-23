import React, { useState } from 'react';
import Link from 'next/link';
import ImageUploader from './ImageUploader';
import ImageReviewModal from './ImageReviewModal';
import { processImages } from '../utils/imageProcessor';
import { detectDuplicatesAcrossImages, getKeptTransactionIndices } from '../utils/duplicateDetection';
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

function buildProcessedBatches(processedLogs = {}) {
  return Object.entries(processedLogs)
    .map(([imageHash, log]) => ({
      imageHash,
      imageName: log?.imageName || 'Unknown image',
      uploadDate: log?.uploadDate || null,
      uploadDay: log?.uploadDay || null,
      extractedCount: Number(log?.extractedCount || 0),
      transactionIds: Array.isArray(log?.transactions) ? log.transactions.filter(Boolean) : [],
    }))
    .sort((a, b) => {
      const aTime = Date.parse(a.uploadDate || '') || 0;
      const bTime = Date.parse(b.uploadDate || '') || 0;
      return bTime - aTime;
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

function getUploadResultStats(summary = {}, addedCount = 0) {
  const skippedByReason = summary?.skippedByReason || {};

  return {
    added: Number(addedCount || 0),
    skippedExisting:
      Number(skippedByReason.already_exists_overlap || 0) +
      Number(skippedByReason.already_exists_yesterday || 0) +
      Number(skippedByReason.already_processed || 0),
    skippedCurrentUpload: Number(skippedByReason.duplicate_in_upload || 0),
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
  const [isEmailSending, setIsEmailSending] = useState(false);
  const [emailStatus, setEmailStatus] = useState(null);
  const [notificationReports, setNotificationReports] = useState([]);
  const [lastUploadUndo, setLastUploadUndo] = useState(null);
  const [confirmTonyEmail, setConfirmTonyEmail] = useState(false);
  const [confirmNugsEmail, setConfirmNugsEmail] = useState(false);
  const [uploadedBatches, setUploadedBatches] = useState([]);

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

  React.useEffect(() => {
    if (!authReady) return undefined;

    let cancelled = false;

    const loadUploadedBatches = async () => {
      try {
        const processedLogs = await getAllProcessedLogs();
        if (cancelled) return;
        setUploadedBatches(buildProcessedBatches(processedLogs || {}));
      } catch (err) {
        console.error('Failed to load uploaded batches:', err);
      }
    };

    loadUploadedBatches();

    return () => {
      cancelled = true;
    };
  }, [authReady, step, successMessage, lastUploadUndo]);

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
      await handleConfirmTransactions(getKeptTransactionIndices(detection), results);
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
    setEmailStatus(null);
    setNotificationReports([]);
    setConfirmTonyEmail(false);
    setConfirmNugsEmail(false);
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

  const handleDeleteUploadedBatch = async (batch) => {
    if (!authReady || !batch) return;

    const confirmText = [
      'Delete this uploaded batch?',
      `${batch.imageName} (${batch.transactionIds.length} transaction${batch.transactionIds.length === 1 ? '' : 's'})`,
      'This will remove the transactions and processed log from Firebase.',
    ].join('\n\n');

    if (!window.confirm(confirmText)) {
      return;
    }

    setIsLoading(true);
    setEmailStatus(null);

    try {
      await Promise.all([
        deleteTransactionsByIds(batch.transactionIds),
        deleteProcessedLogs([batch.imageHash]),
      ]);

      if (lastUploadUndo && lastUploadUndo.imageHashes?.includes(batch.imageHash)) {
        setLastUploadUndo(null);
      }

      const processedLogs = await getAllProcessedLogs();
      setUploadedBatches(buildProcessedBatches(processedLogs || {}));
      setEmailStatus({
        type: 'success',
        message: `Deleted ${batch.transactionIds.length} transaction${batch.transactionIds.length === 1 ? '' : 's'} from ${batch.imageName}.`,
      });
    } catch (err) {
      console.error('Failed to delete uploaded batch:', err);
      setEmailStatus({
        type: 'error',
        message: err.message || 'Failed to delete the selected batch.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendSelectedEmails = async () => {
    const selectedProfiles = [];
    if (confirmTonyEmail) selectedProfiles.push('Tony');
    if (confirmNugsEmail) selectedProfiles.push('Nugs');

    if (selectedProfiles.length === 0) {
      setEmailStatus({
        type: 'error',
        message: 'Tick Tony and/or Nugs before sending the emails.',
      });
      return;
    }

    const recipientsByProfile = {
      Tony: 'spr.tony@gmail.com',
      Nugs: 'nguyet_anh_le@hotmail.com',
    };

    setIsEmailSending(true);
    setEmailStatus(null);

    try {
      const reports =
        notificationReports.length > 0
          ? notificationReports
          : buildProfileEmailReports(
              await getAllTransactions(),
              await getAllSubmissions(),
              getSavedSimulatedDay()
            );

      for (const profileName of selectedProfiles) {
        const report = reports.find((item) => item.profileName === profileName);
        if (!report) {
          throw new Error(`Could not build the ${profileName} email report.`);
        }

        const response = await fetch('/api/send-notification-email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to: [recipientsByProfile[profileName]],
            reports: [
              {
                ...report,
                subject: report.subject,
              },
            ],
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data?.error || `Failed to send the ${profileName} email.`);
        }
      }

      setEmailStatus({
        type: 'success',
        message: `Sent ${selectedProfiles.join(' and ')} email${selectedProfiles.length === 1 ? '' : 's'}.`,
      });
    } catch (err) {
      console.error('Failed to send selected emails:', err);
      setEmailStatus({
        type: 'error',
        message: err.message || 'Failed to send the selected emails.',
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
              <div className="flex items-center justify-between gap-3 mb-3">
                <p className="text-sm text-slate-300">
                  Uploaded batches in Firebase
                </p>
                <span className="text-xs text-slate-500">
                  {uploadedBatches.length} batch{uploadedBatches.length === 1 ? '' : 'es'}
                </span>
              </div>
              {uploadedBatches.length === 0 ? (
                <p className="text-xs text-slate-500">No processed upload batches were found.</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-auto pr-1">
                  {uploadedBatches.slice(0, 8).map((batch) => (
                    <div
                      key={batch.imageHash}
                      className="rounded-lg border border-slate-700 bg-slate-950/80 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-white">
                            {batch.imageName}
                          </p>
                          <p className="text-xs text-slate-400 mt-1">
                            {batch.extractedCount} transaction{batch.extractedCount === 1 ? '' : 's'}
                            {batch.uploadDate ? ` · ${batch.uploadDate}` : ''}
                          </p>
                        </div>
                        <button
                          onClick={() => handleDeleteUploadedBatch(batch)}
                          disabled={isLoading}
                          className="shrink-0 rounded-md bg-rose-700 px-3 py-2 text-xs font-medium text-white hover:bg-rose-600 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-2 text-xs text-slate-500">
                Use this to remove an older 9-transaction upload from Firebase without touching everything else.
              </p>
            </div>

            <div className="mt-4 rounded-lg border border-slate-700 bg-slate-900/50 p-4">
              <p className="text-sm text-slate-300 mb-3">
                Email notifications
              </p>
              <div className="space-y-3">
                <label className="flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-950/70 p-3">
                  <input
                    type="checkbox"
                    checked={confirmTonyEmail}
                    onChange={(e) => setConfirmTonyEmail(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-900 text-blue-500"
                  />
                  <span className="text-sm text-slate-200">
                    Send Tony summary to <span className="text-white">spr.tony@gmail.com</span>
                  </span>
                </label>

                <label className="flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-950/70 p-3">
                  <input
                    type="checkbox"
                    checked={confirmNugsEmail}
                    onChange={(e) => setConfirmNugsEmail(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-900 text-blue-500"
                  />
                  <span className="text-sm text-slate-200">
                    Send Nugs summary to <span className="text-white">nguyet_anh_le@hotmail.com</span>
                  </span>
                </label>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                <div className="bg-slate-950 rounded-lg p-3 border border-slate-700">
                  <p className="text-xs text-slate-400">Tony spend</p>
                  <p className="text-xl font-bold text-white">
                    {notificationReports[0] ? `$${Number(notificationReports[0].stats.totalSpend || 0).toFixed(2)}` : '...'}
                  </p>
                </div>
                <div className="bg-slate-950 rounded-lg p-3 border border-slate-700">
                  <p className="text-xs text-slate-400">Nugs spend</p>
                  <p className="text-xl font-bold text-white">
                    {notificationReports[1] ? `$${Number(notificationReports[1].stats.totalSpend || 0).toFixed(2)}` : '...'}
                  </p>
                </div>
                <div className="bg-slate-950 rounded-lg p-3 border border-slate-700">
                  <p className="text-xs text-slate-400">Tony pending</p>
                  <p className="text-xl font-bold text-white">
                    {notificationReports[0] ? notificationReports[0].stats.pendingCount : '...'}
                  </p>
                </div>
                <div className="bg-slate-950 rounded-lg p-3 border border-slate-700">
                  <p className="text-xs text-slate-400">Nugs pending</p>
                  <p className="text-xl font-bold text-white">
                    {notificationReports[1] ? notificationReports[1].stats.pendingCount : '...'}
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
                onClick={handleSendSelectedEmails}
                disabled={isEmailSending || (!confirmTonyEmail && !confirmNugsEmail)}
                className="mt-4 w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-white font-medium transition"
              >
                {isEmailSending ? 'Sending...' : 'Send selected emails'}
              </button>
            </div>

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

            <div className="space-y-2 mt-4">
              <Link href="/">
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
              flagged={[]}
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
                    0
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

            {(() => {
              const resultStats = getUploadResultStats(
                successMessage.summary || lastMergeReport?.summary,
                successMessage.added
              );

              return (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6 text-left">
                  <div className="bg-slate-900 rounded-lg border border-emerald-500/30 p-4">
                    <p className="text-xs uppercase tracking-wider text-emerald-300">New Added</p>
                    <p className="text-2xl font-bold text-white mt-1">{resultStats.added}</p>
                    <p className="text-xs text-slate-400 mt-1">Transactions written to Firebase</p>
                  </div>
                  <div className="bg-slate-900 rounded-lg border border-amber-500/30 p-4">
                    <p className="text-xs uppercase tracking-wider text-amber-300">Skipped Existing</p>
                    <p className="text-2xl font-bold text-white mt-1">{resultStats.skippedExisting}</p>
                    <p className="text-xs text-slate-400 mt-1">Matched against earlier uploads</p>
                  </div>
                  <div className="bg-slate-900 rounded-lg border border-sky-500/30 p-4">
                    <p className="text-xs uppercase tracking-wider text-sky-300">Skipped In Upload</p>
                    <p className="text-2xl font-bold text-white mt-1">{resultStats.skippedCurrentUpload}</p>
                    <p className="text-xs text-slate-400 mt-1">Collapsed inside this OCR batch</p>
                  </div>
                </div>
              );
            })()}

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

            <div className="space-y-2">
              <Link href="/">
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

