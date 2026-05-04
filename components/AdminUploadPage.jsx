import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import ImageUploader from './ImageUploader';
import ImageReviewModal from './ImageReviewModal';
import TransactionSelectionReview from './TransactionSelectionReview';
import { processImages } from '../utils/imageProcessor';
import {
  enrichProcessedLogsWithFingerprints,
  findProcessedLogMatch,
} from '../utils/importFingerprint';
import { detectDuplicatesAcrossImages } from '../utils/duplicateDetection';
import { mergeTransactions, prepareForFirebase } from '../utils/transactionMerger';
import {
  formatActivityTimestamp,
  formatDateKeyForDisplay,
} from '../utils/adminReporting';
import { useAdminDashboardData } from '../hooks/useAdminDashboardData';
import {
  addTransactions,
  appendImportAuditEntry,
  getAllTransactions,
  saveProcessedLog,
  getAllProcessedLogs,
  deleteTransactionsByIds,
  deleteProcessedLogs,
  clearUploadedData,
  getNotificationAutomationSettings,
  getTodayDate,
  saveNotificationAutomationSettings,
} from '../services/firebaseService';
import { formatLocalDateTime } from '../utils/simulationDate';
import { formatScheduledTime } from '../utils/emailSchedule';
import {
  DEFAULT_AUTOMATED_EMAIL_TIME,
  DEFAULT_AUTOMATED_EMAIL_TIME_ZONE,
  DEFAULT_RECIPIENTS_BY_PROFILE,
} from '../config/emailNotifications';


function buildAllTransactions(processedImages) {
  const allTransactions = [];

  processedImages.forEach((image) => {
    if (!image.transactions) return;

    image.transactions.forEach((tx) => {
      allTransactions.push({
        ...tx,
        imageHash: image.imageHash,
        imageFingerprint: image.imageFingerprint,
        imageName: image.fileName,
      });
    });
  });

  return allTransactions;
}

function buildManualReviewItems(processedImages, duplicateDetection, existingTransactions, processedLogs = {}) {
  const allTransactions = buildAllTransactions(processedImages);
  const duplicateMap = new Map();

  (duplicateDetection?.duplicates || []).forEach((group) => {
    const items = Array.isArray(group) ? group : group?.group || [];
    items.forEach((item, itemIndex) => {
      const sibling = items.find((candidate) => candidate.index !== item.index) || items[itemIndex];
      duplicateMap.set(item.index, {
        reason: item?.duplicateMatch?.merchantSimilarity && item.duplicateMatch.merchantSimilarity < 98
          ? 'flagged_for_review'
          : 'duplicate_in_upload',
        duplicateMatch: item?.duplicateMatch || sibling?.duplicateMatch || null,
        matchedTransaction: sibling?.transaction || null,
      });
    });
  });

  const reviewItems = allTransactions.map((tx, index) => {
    const duplicateInfo = duplicateMap.get(index);
    const txForReview = duplicateInfo
      ? {
          ...tx,
          duplicateMatch: duplicateInfo.duplicateMatch,
        }
      : tx;
    const processedMatch = findProcessedLogMatch(txForReview, processedLogs || {});
    const processedEntry = processedMatch?.log || null;
    const singleMergeResult = mergeTransactions([txForReview], existingTransactions, processedLogs);
    const flaggedDecision = singleMergeResult.flagged?.[0] || null;
    const skippedDecision = singleMergeResult.skipped?.[0] || null;
    const readyDecision = singleMergeResult.decisions?.find((decision) => decision.outcome === 'import_ready') || null;

    let reason = 'ready_to_import';
    let defaultSelected = true;
    let explanation = readyDecision?.explanation || 'Ready to import.';
    let confidence = readyDecision?.confidence || null;
    let trace = readyDecision?.trace || null;
    let existingMatch = null;

    if (processedEntry) {
      reason = 'already_processed';
      defaultSelected = false;
      explanation = processedEntry.uploadDay
        ? `Skipped because this screenshot appears to have already been imported on ${processedEntry.uploadDay}${processedMatch?.matchType === 'fingerprint' ? ' (matched by screenshot contents).' : '.'}`
        : 'Skipped because this screenshot appears to have already been imported.';
      confidence = skippedDecision?.confidence || singleMergeResult.decisions?.[0]?.confidence || confidence;
      trace = skippedDecision?.trace || singleMergeResult.decisions?.[0]?.trace || trace;
    } else if (flaggedDecision) {
      reason = flaggedDecision.reason;
      defaultSelected = false;
      explanation = flaggedDecision.explanation;
      confidence = flaggedDecision.confidence;
      trace = flaggedDecision.trace;
      existingMatch = flaggedDecision.existingMatch || null;
    } else if (skippedDecision) {
      reason = skippedDecision.reason;
      defaultSelected = false;
      explanation = skippedDecision.explanation;
      confidence = skippedDecision.confidence;
      trace = skippedDecision.trace;
      existingMatch = skippedDecision.existingMatch || null;
    } else if (duplicateInfo) {
      reason = duplicateInfo.reason;
      defaultSelected = false;
      explanation =
        duplicateInfo.reason === 'flagged_for_review'
          ? 'Flagged for review because another item in this upload is similar, but the duplicate match is fuzzy.'
          : 'Skipped because another item in this upload appears to be the same transaction.';
      confidence = singleMergeResult.decisions?.[0]?.confidence || confidence;
      trace = {
        ...(singleMergeResult.decisions?.[0]?.trace || {}),
        duplicateEvaluation: duplicateInfo.duplicateMatch
          ? {
              reason: duplicateInfo.duplicateMatch.reason || null,
              merchantSimilarity: duplicateInfo.duplicateMatch.merchantSimilarity ?? null,
              sameSource: duplicateInfo.duplicateMatch.sameSource ?? null,
            }
          : null,
      };
    }

    return {
      index,
      transaction: txForReview,
      imageName: tx.imageName,
      reason,
      defaultSelected,
      explanation,
      confidence,
      trace,
      existingMatch,
    };
  });

  return {
    items: reviewItems,
    summary: {
      total: reviewItems.length,
      defaultSelected: reviewItems.filter((item) => item.defaultSelected).length,
      duplicateInUpload: reviewItems.filter((item) => item.reason === 'duplicate_in_upload').length,
      flagged: reviewItems.filter((item) => item.reason === 'flagged_for_review').length,
      skippedExisting: reviewItems.filter(
        (item) =>
          item.reason === 'already_exists_overlap' ||
          item.reason === 'already_exists_yesterday' ||
          item.reason === 'already_processed'
      ).length,
    },
  };
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
  const flaggedByReason = summary?.flaggedByReason || {};

  return {
    added: Number(addedCount || 0),
    skippedExisting:
      Number(skippedByReason.already_exists_overlap || 0) +
      Number(skippedByReason.already_exists_yesterday || 0) +
      Number(skippedByReason.already_processed || 0),
    skippedCurrentUpload: Number(skippedByReason.duplicate_in_upload || 0),
    flaggedForReview: Number(flaggedByReason.flagged_for_review || 0),
  };
}

function getImportedAuditItems(entry) {
  return (entry?.decisions || []).filter((decision) => decision.outcome === 'import_ready');
}

function getAuditItemCount(entry) {
  return Number(entry?.summary?.toAdd || entry?.summary?.removedTransactions || 0);
}

function getReviewSummaryStats(manualReview, duplicateDetection) {
  const reviewSummary = manualReview?.summary || {};
  const total = Number(reviewSummary.total ?? duplicateDetection?.summary?.total ?? 0);
  const flagged = Number(reviewSummary.flagged || 0);
  const duplicates =
    Number(reviewSummary.duplicateInUpload || 0) +
    Number(reviewSummary.skippedExisting || 0);
  const unique = Math.max(0, total - duplicates - flagged);

  return {
    total,
    unique,
    duplicates,
    flagged,
  };
}

const ADMIN_UPLOAD_VERSION = '1.0.7';

export default function AdminUploadPage() {
  const [step, setStep] = useState('upload');
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [processedImages, setProcessedImages] = useState([]);
  const [ocrPreviewImages, setOcrPreviewImages] = useState([]);
  const [duplicateDetection, setDuplicateDetection] = useState(null);
  const [manualReview, setManualReview] = useState(null);
  const [lastMergeReport, setLastMergeReport] = useState(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isEmailSending, setIsEmailSending] = useState(false);
  const [quickUpdateMessage, setQuickUpdateMessage] = useState('');
  const [quickUpdateTony, setQuickUpdateTony] = useState(true);
  const [quickUpdateNugs, setQuickUpdateNugs] = useState(true);
  const [automatedEmailTime, setAutomatedEmailTime] = useState(DEFAULT_AUTOMATED_EMAIL_TIME);
  const [automationSettingsUpdatedAt, setAutomationSettingsUpdatedAt] = useState(null);
  const [automationScheduleStatus, setAutomationScheduleStatus] = useState(null);
  const [isSavingAutomationSchedule, setIsSavingAutomationSchedule] = useState(false);
  const {
    adminActivityLog,
    authReady,
    confirmNugsEmail,
    confirmTonyEmail,
    emailStatus,
    importAuditHistory,
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
  } = useAdminDashboardData(step, successMessage, setError);

  useEffect(() => {
    if (!authReady) return undefined;

    let cancelled = false;

    const loadAutomationSchedule = async () => {
      try {
        const settings = await getNotificationAutomationSettings();
        if (cancelled) return;
        setAutomatedEmailTime(formatScheduledTime(settings.time));
        setAutomationSettingsUpdatedAt(settings.updatedAt || null);
      } catch (err) {
        console.error('Failed to load automatic email schedule:', err);
        if (!cancelled) {
          setAutomationScheduleStatus({
            type: 'error',
            message: err.message || 'Failed to load the automatic email schedule.',
          });
        }
      }
    };

    loadAutomationSchedule();

    return () => {
      cancelled = true;
    };
  }, [authReady]);

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
    setManualReview(null);
    setError(null);
  };

  const handleConfirmTransactions = async (selectedIndices = null, processedOverride = processedImages) => {
    if (!authReady) return;
    setIsLoading(true);
    setStep('processing');

    try {
      let allTransactions = buildAllTransactions(processedOverride);

      if (Array.isArray(selectedIndices)) {
        allTransactions = allTransactions
          .filter((_, idx) => selectedIndices.includes(idx))
          .map((tx) => ({
            ...tx,
            adminReviewApproved: true,
          }));
      }

      const existingTransactions = await getAllTransactions();
      const rawProcessedLogs = await getAllProcessedLogs();
      const processedLogs = enrichProcessedLogsWithFingerprints(rawProcessedLogs || {}, existingTransactions);

      const mergeResult = mergeTransactions(
        allTransactions,
        existingTransactions,
        processedLogs
      );
      setLastMergeReport({
        skipped: mergeResult.skipped,
        flagged: mergeResult.flagged,
        decisions: mergeResult.decisions,
        summary: mergeResult.summary,
      });

      if (mergeResult.flagged.length > 0) {
        setManualReview(
          buildManualReviewItems(processedOverride, duplicateDetection, existingTransactions, processedLogs || {})
        
        );
        setSuccessMessage({
          added: 0,
          skipped: mergeResult.skipped.length,
          flagged: mergeResult.flagged.length,
          message: 'Some transactions need manual review before they can be imported.',
          summary: mergeResult.summary,
        });
        setStep('review');
        return;
      }

      if (mergeResult.toAdd.length === 0) {
        setLastUploadUndo(null);
        setSuccessMessage({
          added: 0,
          skipped: mergeResult.skipped.length,
          flagged: mergeResult.flagged.length,
          message: 'No new transactions to add. All were duplicates or already processed.',
          summary: mergeResult.summary,
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
          await saveProcessedLog(
            image.imageHash,
            imageTransactionIds,
            image.fileName,
            image.imageFingerprint || null
          );
        }
      }

      await appendImportAuditEntry({
        type: 'import_batch',
        images: processedOverride.map((image) => ({
          imageHash: image.imageHash || null,
          imageName: image.fileName || 'Unknown image',
        })),
        summary: mergeResult.summary,
        decisions: mergeResult.decisions.map((decision) => ({
          merchant: decision.transaction?.merchant || null,
          amount: Number(decision.transaction?.amount || 0),
          date: decision.transaction?.date || null,
          imageName: decision.transaction?.imageName || null,
          outcome: decision.outcome,
          reasonCode: decision.reasonCode,
          explanation: decision.explanation,
          confidenceLevel: decision.confidence?.level || null,
          confidenceScore: decision.confidence?.score ?? null,
          trace: decision.trace,
        })),
      });

      setSuccessMessage({
        added: mergeResult.toAdd.length,
        skipped: mergeResult.skipped.length,
        flagged: mergeResult.flagged.length,
        summary: mergeResult.summary,
      });
      setManualReview(null);
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
      const [existingTransactions, processedLogs] = await Promise.all([
        getAllTransactions(),
        getAllProcessedLogs(),
      ]);
      setManualReview(
        buildManualReviewItems(
          results,
          detection,
          existingTransactions,
          enrichProcessedLogsWithFingerprints(processedLogs || {}, existingTransactions)
        )
      );
      setStep('review');
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
    setManualReview(null);
    setLastMergeReport(null);
    setProgress(0);
    setError(null);
    setSuccessMessage(null);
    setOcrPreviewImages([]);
    setEmailStatus(null);
    setNotificationReports([]);
    setConfirmTonyEmail(false);
    setConfirmNugsEmail(false);
    setQuickUpdateMessage('');
    setQuickUpdateTony(true);
    setQuickUpdateNugs(true);
  };

  const handleUndoLastUpload = async () => {
    if (!authReady || !lastUploadUndo) return;

    const { transactionIds = [], imageHashes = [], imageBreakdown = [] } = lastUploadUndo;
    const confirmText = [
      'Undo the last upload batch?',
      `This will remove ${transactionIds.length} transaction${transactionIds.length === 1 ? '' : 's'} and their processed logs.`,
      imageBreakdown.length > 0
        ? `Affected images: ${imageBreakdown.map((item) => `${item.imageName} (${item.transactionIds.length})`).join(', ')}`
        : null,
      'Older uploads will stay intact.',
    ].filter(Boolean).join('\n\n');

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

      await appendImportAuditEntry({
        type: 'undo_batch',
        images: imageBreakdown.map((image) => ({
          imageHash: image.imageHash,
          imageName: image.imageName,
        })),
        summary: {
          removedTransactions: transactionIds.length,
          removedImages: imageHashes.length,
        },
      });

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
      batch.uploadDate ? `Imported: ${formatLocalDateTime(new Date(batch.uploadDate))}` : null,
      'This will remove the transactions and processed log from Firebase.',
    ].filter(Boolean).join('\n\n');

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

      await appendImportAuditEntry({
        type: 'delete_batch',
        images: [
          {
            imageHash: batch.imageHash,
            imageName: batch.imageName,
          },
        ],
        summary: {
          removedTransactions: batch.transactionIds.length,
          removedImages: 1,
        },
      });

      if (lastUploadUndo && lastUploadUndo.imageHashes?.includes(batch.imageHash)) {
        setLastUploadUndo(null);
      }

      await refreshUploadedBatches();
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

  const handleSaveAutomationSchedule = async () => {
    if (!authReady) return;

    setIsSavingAutomationSchedule(true);
    setAutomationScheduleStatus(null);

    try {
      const normalizedTime = formatScheduledTime(automatedEmailTime);
      const savedSettings = await saveNotificationAutomationSettings({
        time: normalizedTime,
        timeZone: DEFAULT_AUTOMATED_EMAIL_TIME_ZONE,
      });

      setAutomatedEmailTime(savedSettings.time);
      setAutomationSettingsUpdatedAt(savedSettings.updatedAt || null);
      setAutomationScheduleStatus({
        type: 'success',
        message: `Automatic emails now send at ${savedSettings.time} Melbourne time.`,
      });
    } catch (err) {
      console.error('Failed to save automatic email schedule:', err);
      setAutomationScheduleStatus({
        type: 'error',
        message: err.message || 'Failed to save the automatic email schedule.',
      });
    } finally {
      setIsSavingAutomationSchedule(false);
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

    setIsEmailSending(true);
    setEmailStatus(null);

    try {
      const reports =
        notificationReports.length > 0
          ? notificationReports
          : await loadNotificationReports();

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
            to: [DEFAULT_RECIPIENTS_BY_PROFILE[profileName]],
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

  const handleSendQuickUpdate = async () => {
    const selectedProfiles = [];
    if (quickUpdateTony) selectedProfiles.push('Tony');
    if (quickUpdateNugs) selectedProfiles.push('Nugs');

    const message = quickUpdateMessage.trim();

    if (selectedProfiles.length === 0) {
      setEmailStatus({
        type: 'error',
        message: 'Tick Tony and/or Nugs before sending the update.',
      });
      return;
    }

    if (!message) {
      setEmailStatus({
        type: 'error',
        message: 'Write a quick update before sending.',
      });
      return;
    }

    setIsEmailSending(true);
    setEmailStatus(null);

    try {
      const response = await fetch('/api/send-notification-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          kind: 'custom_update',
          to: selectedProfiles.map((profileName) => DEFAULT_RECIPIENTS_BY_PROFILE[profileName]),
          subject: 'Westpac CC Tracker quick update',
          message,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'Failed to send the quick update.');
      }

      setQuickUpdateMessage('');
      setEmailStatus({
        type: 'success',
        message: `Sent quick update to ${selectedProfiles.join(' and ')}.`,
      });
    } catch (err) {
      console.error('Failed to send quick update:', err);
      setEmailStatus({
        type: 'error',
        message: err.message || 'Failed to send the quick update.',
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
          <div className="mt-3 inline-flex items-center rounded-full bg-slate-800/80 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-slate-300 border border-slate-700">
            synced import {ADMIN_UPLOAD_VERSION}
          </div>
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

            <div className="mt-4">
              <Link href="/admin/statement-import">
                <a className="inline-flex w-full items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-sm font-medium text-cyan-100 transition hover:bg-cyan-500/20">
                  Open PDF statement importer
                </a>
              </Link>
            </div>

            <button
              onClick={handleProcessImages}
              disabled={uploadedFiles.length === 0 || isLoading || !authReady}
              className="w-full mt-6 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-white font-medium transition"
            >
              {!authReady ? 'Connecting...' : isLoading ? 'Processing...' : `Process ${uploadedFiles.length} Image(s)`}
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
                    Send Tony summary to <span className="text-white">{DEFAULT_RECIPIENTS_BY_PROFILE.Tony}</span>
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
                    Send Nugs summary to <span className="text-white">{DEFAULT_RECIPIENTS_BY_PROFILE.Nugs}</span>
                  </span>
                </label>
              </div>

              <div className="mt-3 rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-3 text-left">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wider text-cyan-200">Automatic daily send</p>
                    <p className="mt-1 text-sm text-slate-200">
                      {automatedEmailTime} {DEFAULT_AUTOMATED_EMAIL_TIME_ZONE} to Tony and Nugs
                    </p>
                    {automationSettingsUpdatedAt ? (
                      <p className="mt-1 text-xs text-slate-400">
                        Updated {formatLocalDateTime(new Date(automationSettingsUpdatedAt))}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input
                    type="time"
                    step="3600"
                    value={automatedEmailTime}
                    onChange={(e) => setAutomatedEmailTime(e.target.value)}
                    className="rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleSaveAutomationSchedule}
                    disabled={isSavingAutomationSchedule || !authReady}
                    className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-600 disabled:opacity-50"
                  >
                    {isSavingAutomationSchedule ? 'Saving...' : 'Save time'}
                  </button>
                </div>
                {automationScheduleStatus ? (
                  <p
                    className={`mt-2 text-sm ${
                      automationScheduleStatus.type === 'success' ? 'text-emerald-300' : 'text-rose-300'
                    }`}
                  >
                    {automationScheduleStatus.message}
                  </p>
                ) : null}
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

              <div className="mt-5 border-t border-slate-700 pt-4">
                <p className="text-sm text-slate-300 mb-3">Quick update</p>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/70 p-3">
                    <input
                      type="checkbox"
                      checked={quickUpdateTony}
                      onChange={(e) => setQuickUpdateTony(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-blue-500"
                    />
                    <span className="text-sm text-slate-200">Tony</span>
                  </label>
                  <label className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/70 p-3">
                    <input
                      type="checkbox"
                      checked={quickUpdateNugs}
                      onChange={(e) => setQuickUpdateNugs(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-blue-500"
                    />
                    <span className="text-sm text-slate-200">Nugs</span>
                  </label>
                </div>
                <textarea
                  value={quickUpdateMessage}
                  onChange={(e) => setQuickUpdateMessage(e.target.value)}
                  maxLength={1200}
                  rows={3}
                  placeholder="Write a short update..."
                  className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950/80 p-3 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-xs text-slate-500">{quickUpdateMessage.length}/1200</span>
                  <button
                    onClick={handleSendQuickUpdate}
                    disabled={
                      isEmailSending ||
                      !quickUpdateMessage.trim() ||
                      (!quickUpdateTony && !quickUpdateNugs)
                    }
                    className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-600 disabled:opacity-50"
                  >
                    {isEmailSending ? 'Sending...' : 'Send update'}
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-slate-700 bg-slate-900/50 p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <p className="text-sm text-slate-300">
                  User activity log
                </p>
                <span className="text-xs text-slate-500">
                  Last 12 hrs | refreshes every 10s
                </span>
              </div>
              <div className="space-y-2">
                {adminActivityLog.map((entry) => (
                  <div
                    key={entry.user}
                    className="rounded-lg border border-slate-700 bg-slate-950/80 p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-white">{entry.user}</p>
                      <span
                        className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                          entry.isOnline
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-slate-700 text-slate-300'
                        }`}
                      >
                        {entry.isOnline ? 'Online now' : 'Offline'}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-400">
                      Last online: {formatActivityTimestamp(entry.latestPresenceTs)}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      Last assignment:{' '}
                      {entry.latestSubmission
                        ? `${formatActivityTimestamp(entry.latestSubmission.ts)}${entry.latestSubmission.value ? ` (${entry.latestSubmission.value})` : ''}`
                        : 'No assignments in the last 12 hrs'}
                    </p>
                    {entry.latestSubmission?.dateKey ? (
                      <p className="mt-1 text-[11px] text-slate-500">
                        Assignment date: {formatDateKeyForDisplay(entry.latestSubmission.dateKey)}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

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
                            {batch.uploadDate ? ` | ${formatLocalDateTime(new Date(batch.uploadDate))}` : ''}
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
              <div className="flex items-center justify-between gap-3 mb-3">
                <p className="text-sm text-slate-300">Recent import history</p>
                <span className="text-xs text-slate-500">{importAuditHistory.length} events</span>
              </div>
              {importAuditHistory.length === 0 ? (
                <p className="text-xs text-slate-500">No recent import, undo, or delete events were recorded yet.</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-auto pr-1">
                  {importAuditHistory.map((entry) => {
                    const itemCount = getAuditItemCount(entry);
                    const importedItems = getImportedAuditItems(entry);

                    return (
                      <details
                        key={entry.id}
                        className="rounded-lg border border-slate-700 bg-slate-950/80 p-3"
                      >
                        <summary className="cursor-pointer list-none">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-white">{entry.actionLabel}</p>
                              <p className="text-xs text-slate-400 mt-1">
                                {entry.createdAt ? formatLocalDateTime(new Date(entry.createdAt)) : 'Unknown time'}
                              </p>
                            </div>
                            <span className="rounded-full bg-slate-700 px-2 py-1 text-[11px] text-slate-200">
                              {itemCount} item{itemCount === 1 ? '' : 's'}
                            </span>
                          </div>
                        </summary>
                        <div className="mt-3 space-y-2 text-left">
                          {entry.summary ? (
                            <p className="text-xs text-slate-400">
                              Imported: {entry.summary.toAdd || 0} | Skipped: {entry.summary.skipped || 0} | Flagged: {entry.summary.flagged || 0}
                            </p>
                          ) : null}
                          {entry.type === 'import_batch' ? (
                            <div className="space-y-1">
                              {importedItems.length > 0 ? (
                                importedItems.map((item, idx) => (
                                  <div
                                    key={`${entry.id}-imported-${idx}`}
                                    className="flex items-start justify-between gap-3 rounded-md bg-slate-900/80 px-2 py-2"
                                  >
                                    <div className="min-w-0">
                                      <p className="truncate text-xs font-medium text-slate-200">
                                        {item.merchant || 'Unknown item'}
                                      </p>
                                      <p className="mt-0.5 text-[11px] text-slate-500">
                                        {formatDateKeyForDisplay(item.date)}
                                        {item.imageName ? ` | ${item.imageName}` : ''}
                                      </p>
                                    </div>
                                    <span className="shrink-0 text-xs font-semibold text-white">
                                      ${Number(item.amount || 0).toFixed(2)}
                                    </span>
                                  </div>
                                ))
                              ) : (
                                <p className="text-xs text-slate-500">No imported item details were recorded for this event.</p>
                              )}
                            </div>
                          ) : null}
                          {(entry.images || []).map((image) => (
                            <p key={`${entry.id}-${image.imageHash || image.imageName}`} className="text-xs text-slate-300">
                              {image.imageName || 'Unknown image'}
                            </p>
                          ))}
                        </div>
                      </details>
                    );
                  })}
                </div>
              )}
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
              <Link href="/admin/statement-import">
                <a className="block w-full px-6 py-3 bg-cyan-600 hover:bg-cyan-700 rounded-lg text-white font-medium transition">
                  PDF statement importer
                </a>
              </Link>
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
              {(() => {
                const reviewStats = getReviewSummaryStats(manualReview, duplicateDetection);

                return (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-slate-900 rounded p-3 text-center">
                  <p className="text-2xl font-bold text-blue-400">{reviewStats.total}</p>
                  <p className="text-xs text-slate-400">Total Extracted</p>
                </div>
                <div className="bg-slate-900 rounded p-3 text-center">
                  <p className="text-2xl font-bold text-green-400">
                    {reviewStats.unique}
                  </p>
                  <p className="text-xs text-slate-400">Unique</p>
                </div>
                <div className="bg-slate-900 rounded p-3 text-center">
                  <p className="text-2xl font-bold text-red-400">
                    {reviewStats.duplicates}
                  </p>
                  <p className="text-xs text-slate-400">Duplicates</p>
                </div>
                <div className="bg-slate-900 rounded p-3 text-center">
                  <p className="text-2xl font-bold text-yellow-400">
                    {reviewStats.flagged}
                  </p>
                  <p className="text-xs text-slate-400">Flagged</p>
                </div>
              </div>
                );
              })()}
            </div>

            {manualReview ? (
              <TransactionSelectionReview
                items={manualReview.items}
                summary={manualReview.summary}
                onConfirm={(selectedIndices) => handleConfirmTransactions(selectedIndices, processedImages)}
                onCancel={() => setStep('upload')}
                isLoading={isLoading}
              />
            ) : (
              <ImageReviewModal
                duplicates={duplicateDetection.duplicates}
                flagged={[]}
                onConfirm={handleConfirmTransactions}
                onCancel={() => setStep('upload')}
                isLoading={isLoading}
              />
            )}
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
                onClick={() => handleConfirmTransactions(null, ocrPreviewImages)}
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
                : successMessage.message || 'All transactions were duplicates or already processed.'}
            </p>

            {(() => {
              const resultStats = getUploadResultStats(
                successMessage.summary || lastMergeReport?.summary,
                successMessage.added
              );

              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-6 text-left">
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
                  <div className="bg-slate-900 rounded-lg border border-yellow-500/30 p-4">
                    <p className="text-xs uppercase tracking-wider text-yellow-300">Flagged For Review</p>
                    <p className="text-2xl font-bold text-white mt-1">{resultStats.flaggedForReview}</p>
                    <p className="text-xs text-slate-400 mt-1">Held back for manual confirmation</p>
                  </div>
                </div>
              );
            })()}

            {successMessage.skipped > 0 && (
              <p className="text-slate-400 text-sm mb-6">
                {successMessage.skipped} item{successMessage.skipped === 1 ? '' : 's'} skipped.
              </p>
            )}

            {lastMergeReport?.decisions?.length > 0 && (
              <details className="text-left bg-slate-900/50 border border-slate-700 rounded-lg p-4 mb-6">
                <summary className="cursor-pointer text-sm font-medium text-slate-200">
                  View batch outcome details
                </summary>
                <div className="mt-4 space-y-3 max-h-72 overflow-auto pr-2">
                  {lastMergeReport.decisions.map((item, idx) => (
                    <div key={`${item.reasonCode}-${idx}`} className="bg-slate-800 rounded p-3 border border-slate-700">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-white">
                          {item.transaction.merchant} - ${Number(item.transaction.amount || 0).toFixed(2)}
                        </p>
                        <span className="text-xs uppercase tracking-wider text-amber-300">
                          {item.outcome.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 mt-2">{item.explanation}</p>
                      <p className="text-[11px] text-slate-500 mt-1">
                        Confidence: {item.confidence?.level || 'n/a'} ({item.confidence?.score ?? 'n/a'})
                      </p>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[11px] text-slate-400">Decision trace</summary>
                        <div className="mt-2 rounded bg-slate-950/70 p-3 text-[11px] text-slate-300 space-y-1">
                          <p>Raw OCR: {item.trace?.rawOcrLine || 'n/a'}</p>
                          <p>
                            Parsed: {item.trace?.parsed?.merchant || 'n/a'} | {item.trace?.parsed?.amountText || 'n/a'} | {item.trace?.parsed?.date || 'n/a'}
                          </p>
                          <p>
                            Normalized: {item.trace?.normalized?.merchant || 'n/a'} | {item.trace?.normalized?.amount ?? 'n/a'} | {item.trace?.normalized?.date || 'n/a'}
                          </p>
                          {item.trace?.existingMatch ? (
                            <p>
                              Existing match: {item.trace.existingMatch.merchant || 'n/a'} on {item.trace.existingMatch.date || item.trace.existingMatch.uploadedDay || 'n/a'} ({item.trace.existingMatch.matchType || 'n/a'})
                            </p>
                          ) : null}
                          {item.trace?.duplicateEvaluation ? (
                            <p>
                              Duplicate check: {item.trace.duplicateEvaluation.reason || 'n/a'} at {item.trace.duplicateEvaluation.merchantSimilarity ?? 'n/a'}% similarity
                            </p>
                          ) : null}
                        </div>
                      </details>
                      <p className="text-xs text-slate-400 mt-1">
                        Date: {item.transaction.date || 'n/a'} Â· Image: {item.transaction.imageHash || 'n/a'}
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

