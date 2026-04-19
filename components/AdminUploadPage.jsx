import React, { useState } from 'react';
import Link from 'next/link';
import ImageUploader from './ImageUploader';
import ImageReviewModal from './ImageReviewModal';
import { processImages } from '../utils/imageProcessor';
import { detectDuplicatesAcrossImages } from '../utils/duplicateDetection';
import { mergeTransactions, prepareForFirebase } from '../utils/transactionMerger';
import {
  addTransactions,
  getAllTransactions,
  saveProcessedLog,
  getAllProcessedLogs,
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

export default function AdminUploadPage() {
  const [step, setStep] = useState('upload');
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [processedImages, setProcessedImages] = useState([]);
  const [duplicateDetection, setDuplicateDetection] = useState(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleImagesSelected = (files) => {
    setUploadedFiles(files);
    setError(null);
  };

  const handleConfirmTransactions = async (keptIndices, processedOverride = processedImages) => {
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
    if (uploadedFiles.length === 0) {
      setError('Please select at least one image');
      return;
    }

    setIsLoading(true);
    setStep('processing');
    setError(null);

    try {
      const results = await processImages(uploadedFiles, (progressUpdate) => {
        setProgress(progressUpdate.overallProgress);
      });

      setProcessedImages(results);

      const successfulImages = results.filter((result) => !result.error);
      if (successfulImages.length === 0) {
        throw new Error('Failed to process any images. Please check the image quality and try again.');
      }

      const detection = detectDuplicatesAcrossImages(successfulImages);
      setDuplicateDetection(detection);

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

  const handleStartOver = () => {
    setStep('upload');
    setUploadedFiles([]);
    setProcessedImages([]);
    setDuplicateDetection(null);
    setProgress(0);
    setError(null);
    setSuccessMessage(null);
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

            <button
              onClick={handleProcessImages}
              disabled={uploadedFiles.length === 0 || isLoading}
              className="w-full mt-6 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-white font-medium transition"
            >
              {isLoading ? 'Processing...' : `Process ${uploadedFiles.length} Image(s)`}
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
