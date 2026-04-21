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
  getTodayDate,
  saveProcessedLog,
  getAllProcessedLogs,
  clearUploadedData,
} from '../services/firebaseService';

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
      setStep('success');
    } catch (err) {
      console.error('Error saving transactions:', err);
      setError(err.message || 'Failed to save transactions to Firebase');
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

