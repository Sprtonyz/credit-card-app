import React, { useEffect, useMemo, useState } from 'react';
import TransactionSelectionReview from '../../components/TransactionSelectionReview';
import { processImages } from '../../utils/imageProcessor';

function parseSignedAmount(value) {
  const rawValue = String(value || '').trim();
  if (!rawValue) return null;

  const compactValue = rawValue.replace(/[$,\s]/g, '');
  if (!compactValue) return null;

  const wrappedInBrackets =
    compactValue.startsWith('(') && compactValue.endsWith(')') && compactValue.length > 2;
  const normalizedValue = wrappedInBrackets
    ? `-${compactValue.slice(1, -1)}`
    : compactValue;

  const parsed = Number(normalizedValue);
  if (!Number.isFinite(parsed)) return null;

  return Number(parsed.toFixed(2));
}

function buildReviewItems(processedImages, amountOverrides) {
  const items = [];

  processedImages.forEach((image) => {
    (image.transactions || []).forEach((tx, txIndex) => {
      const reviewKey = `ocr:${image.imageHash || image.fileName || 'image'}:${tx.lineIndex ?? txIndex}`;
      const amountOverrideInput = amountOverrides[reviewKey] || '';
      const parsedOverrideAmount = parseSignedAmount(amountOverrideInput);
      const hasAmountOverride = String(amountOverrideInput || '').trim() !== '';
      const amountOverrideValid = !hasAmountOverride || parsedOverrideAmount !== null;
      const transaction =
        amountOverrideValid && parsedOverrideAmount !== null
          ? {
              ...tx,
              amount: parsedOverrideAmount,
              overrideAmount: parsedOverrideAmount,
              overrideAmountInput: amountOverrideInput,
              overrideAmountValid: true,
            }
          : {
              ...tx,
              overrideAmount: null,
              overrideAmountInput: amountOverrideInput,
              overrideAmountValid: !hasAmountOverride,
            };

      items.push({
        index: items.length,
        reviewKey,
        imageName: image.fileName,
        reason: 'ready_to_import',
        defaultSelected: true,
        explanation: 'Debug OCR item loaded from the local sample image.',
        confidence: { level: 'high', score: 0.98 },
        transaction,
        amountOverrideInput,
        amountOverrideValid,
      });
    });
  });

  return items;
}

export default function ReviewTestPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [processedImages, setProcessedImages] = useState([]);
  const [amountOverrides, setAmountOverrides] = useState({});
  const [progressLabel, setProgressLabel] = useState('Waiting to start');

  useEffect(() => {
    let cancelled = false;

    const loadSample = async () => {
      try {
        setLoading(true);
        setError('');
        setProgressLabel('Loading sample image...');

        const response = await fetch('/dev-review-sample.jpg');
        if (!response.ok) {
          throw new Error(`Failed to load sample image: ${response.status}`);
        }

        const blob = await response.blob();
        const file = new File([blob], 'unnamed.jpg', { type: blob.type || 'image/jpeg' });

        setProgressLabel('Running OCR...');
        const results = await processImages([file], (progress) => {
          if (cancelled) return;
          const percent = Math.round((progress.overallProgress || 0) * 100);
          setProgressLabel(`Running OCR... ${percent}%`);
        });

        if (cancelled) return;
        setProcessedImages(results);
        setProgressLabel('OCR complete');
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Failed to load or process the sample image.');
          setProgressLabel('Failed');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadSample();

    return () => {
      cancelled = true;
    };
  }, []);

  const items = useMemo(
    () => buildReviewItems(processedImages, amountOverrides),
    [processedImages, amountOverrides]
  );

  const summary = useMemo(
    () => ({
      total: items.length,
      defaultSelected: items.filter((item) => item.defaultSelected).length,
    }),
    [items]
  );

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-white">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
          <h1 className="text-xl font-bold">Review Test</h1>
          <p className="text-sm text-slate-400">
            This page loads <code>/dev-review-sample.jpg</code>, runs the OCR pipeline, and renders the
            same review component used by the upload flow.
          </p>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-300">
            <span className="rounded-full border border-slate-700 px-2 py-1">Status: {progressLabel}</span>
            <span className="rounded-full border border-slate-700 px-2 py-1">
              OCR items: {items.length}
            </span>
            <span className="rounded-full border border-slate-700 px-2 py-1">
              Overrides: {Object.keys(amountOverrides).length}
            </span>
          </div>
          {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
          <pre className="mt-3 max-h-52 overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-300">
            {JSON.stringify(amountOverrides, null, 2)}
          </pre>
        </div>

        <TransactionSelectionReview
          items={items}
          summary={summary}
          onConfirm={(selectedIndices) => {
            console.log('confirm', selectedIndices);
          }}
          onCancel={() => {
            console.log('cancel');
          }}
          onUpdateAmountOverride={(reviewKey, rawValue) => {
            setAmountOverrides((previous) => {
              const next = { ...previous };
              if (String(rawValue || '').trim() === '') {
                delete next[reviewKey];
              } else {
                next[reviewKey] = rawValue;
              }
              return next;
            });
          }}
          onToggleCommonReoccurrence={null}
          onRemoveManualTransaction={null}
          isSavingCommonReoccurrence={false}
          isLoading={loading}
        />
      </div>
    </div>
  );
}
