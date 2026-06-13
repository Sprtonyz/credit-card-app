import React, { useEffect, useMemo, useState } from 'react';

function formatReason(reason) {
  const labels = {
    ready_to_import: 'ready',
    duplicate_in_upload: 'screenshot overlap',
    already_exists_overlap: 'matched existing',
    already_exists_recent: 'recent duplicate',
    already_exists_pending_carry_forward: 'pending carry-forward',
    already_exists_yesterday: 'matched yesterday pending',
    already_processed: 'already imported screenshot',
    flagged_for_review: 'needs review',
  };

  return labels[reason] || String(reason || 'new_transaction').replace(/_/g, ' ');
}

function getBadgeClass(reason, selected) {
  if (selected) return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  if (reason === 'duplicate_in_upload') return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
  if (reason === 'flagged_for_review') return 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30';
  if (
    reason === 'already_exists_overlap' ||
    reason === 'already_exists_recent' ||
    reason === 'already_exists_pending_carry_forward' ||
    reason === 'already_processed'
  ) {
    return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
  }

  return 'bg-slate-700 text-slate-300 border-slate-600';
}

function getConfidenceClass(level) {
  if (level === 'high') return 'bg-emerald-500/15 text-emerald-300';
  if (level === 'medium') return 'bg-amber-500/15 text-amber-300';
  return 'bg-rose-500/15 text-rose-300';
}

function getReviewPriority(item) {
  if (item?.reason === 'ready_to_import') return 0;
  if (item?.reason === 'flagged_for_review') return 1;
  if (
    item?.reason === 'already_exists_overlap' ||
    item?.reason === 'already_exists_recent' ||
    item?.reason === 'already_exists_pending_carry_forward' ||
    item?.reason === 'already_processed'
  ) return 2;
  if (item?.reason === 'duplicate_in_upload') return 3;
  return 4;
}

export default function TransactionSelectionReview({
  items = [],
  summary = null,
  onConfirm,
  onCancel,
  onToggleCommonReoccurrence = null,
  onRemoveManualTransaction = null,
  onUpdateAmountOverride = null,
  isSavingCommonReoccurrence = false,
  isLoading = false,
}) {
  const [selectedIndices, setSelectedIndices] = useState(() =>
    new Set(items.filter((item) => item.defaultSelected).map((item) => item.index))
  );
  const [draftAmounts, setDraftAmounts] = useState({});

  useEffect(() => {
    setSelectedIndices((previous) => {
      const next = new Set();
      items.forEach((item) => {
        if (previous?.has(item.index) || item.defaultSelected) {
          next.add(item.index);
        }
      });
      return next;
    });
  }, [items]);

  useEffect(() => {
    setDraftAmounts((previous) => {
      const next = {};

      items.forEach((item) => {
        const key = item.reviewKey || String(item.index);
        if (Object.prototype.hasOwnProperty.call(previous, key)) {
          next[key] = previous[key];
        } else if (String(item.amountOverrideInput || '').trim() !== '') {
          next[key] = item.amountOverrideInput;
        } else {
          next[key] = Number(item.transaction.amount || 0).toFixed(2);
        }
      });

      return next;
    });
  }, [items]);

  const selectedCount = selectedIndices.size;
  const orderedItems = useMemo(
    () =>
      [...items].sort((left, right) => {
        const priorityDiff = getReviewPriority(left) - getReviewPriority(right);
        if (priorityDiff !== 0) return priorityDiff;
        return left.index - right.index;
      }),
    [items]
  );
  const selectedItems = useMemo(
    () => items.filter((item) => selectedIndices.has(item.index)),
    [items, selectedIndices]
  );
  const hasInvalidAmountOverrides = useMemo(
    () =>
      items.some(
        (item) =>
          String(item.amountOverrideInput || '').trim() !== '' && item.amountOverrideValid === false
      ),
    [items]
  );

  const handleToggle = (index) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const handleCardKeyDown = (event, index) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleToggle(index);
  };

  const handleToggleCommonReoccurrence = async (event, item) => {
    event.preventDefault();
    event.stopPropagation();

    if (!onToggleCommonReoccurrence || !item?.commonReoccurrenceKey) return;

    const shouldMark = !item.isCommonReoccurrence;
    if (shouldMark) {
      setSelectedIndices((prev) => {
        const next = new Set(prev);
        next.add(item.index);
        return next;
      });
    }

    await onToggleCommonReoccurrence(item, shouldMark);
  };

  const handleRemoveManualTransaction = (event, manualId) => {
    event.preventDefault();
    event.stopPropagation();
    if (!onRemoveManualTransaction || !manualId) return;
    onRemoveManualTransaction(manualId);
  };

  const handleAmountOverrideChange = (event, item) => {
    event.stopPropagation();
    const nextValue = event.target.value;
    const key = item.reviewKey || String(item.index);
    setDraftAmounts((previous) => ({
      ...previous,
      [key]: nextValue,
    }));
  };

  const handleAmountOverrideBlur = (item) => {
    if (!onUpdateAmountOverride || !item?.reviewKey) return;

    const key = item.reviewKey || String(item.index);
    const nextValue = String(draftAmounts[key] ?? '').trim();
    const currentValue = String(item.amountOverrideInput || '').trim();

    if (nextValue === currentValue) return;

    onUpdateAmountOverride(item.reviewKey, nextValue);
  };

  const handleAmountOverrideKeyDown = (event, item) => {
    if (event.key !== 'Enter') return;
    event.stopPropagation();
    event.preventDefault();
    handleAmountOverrideBlur(item);
    event.currentTarget.blur();
  };

  const handleConfirm = () => {
    onConfirm(Array.from(selectedIndices).sort((a, b) => a - b));
  };

  return (
    <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h2 className="text-2xl font-bold text-white">Review Import</h2>
          <p className="text-slate-400 text-sm mt-1">
            New transactions are pre-selected. Suspected duplicates and skipped items start unchecked so you can override them for this upload.
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wider text-slate-500">Selected</p>
          <p className="text-2xl font-bold text-white">{selectedCount}</p>
        </div>
      </div>

      <div className="space-y-3 max-h-[60vh] overflow-auto pr-1">
        {orderedItems.map((item) => {
          const selected = selectedIndices.has(item.index);
          return (
            <div
              key={item.reviewKey || item.index}
              role="button"
              tabIndex={0}
              onClick={() => handleToggle(item.index)}
              onKeyDown={(event) => handleCardKeyDown(event, item.index)}
              className={`block rounded-lg border p-4 transition cursor-pointer ${
                selected ? 'border-blue-500 bg-slate-900/90' : 'border-slate-700 bg-slate-900/50'
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selected}
                  onClick={(event) => event.stopPropagation()}
                  onChange={() => handleToggle(item.index)}
                  className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-900 text-blue-500"
                />
                <div className="flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-white">
                          {item.transaction.merchant}
                        </p>
                        <span className="rounded-full border border-slate-700 bg-slate-950/70 px-2 py-0.5 text-[11px] uppercase tracking-wider text-slate-400">
                          parsed ${Number(item.transaction.amount || 0).toFixed(2)}
                        </span>
                        <div
                          className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950/70 px-2 py-1 text-[11px] uppercase tracking-wider text-slate-400"
                          onPointerDown={(event) => event.stopPropagation()}
                          onMouseDown={(event) => event.stopPropagation()}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <span>Amount</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            autoComplete="off"
                            spellCheck={false}
                            onKeyDown={(event) => handleAmountOverrideKeyDown(event, item)}
                            onKeyUp={(event) => event.stopPropagation()}
                            value={
                              draftAmounts[item.reviewKey || String(item.index)] ??
                              (String(item.amountOverrideInput || '').trim() !== ''
                                ? item.amountOverrideInput
                                : Number(item.transaction.amount || 0).toFixed(2))
                            }
                            onFocus={(event) => event.stopPropagation()}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => handleAmountOverrideChange(event, item)}
                            onBlur={() => handleAmountOverrideBlur(item)}
                            className={`w-28 min-w-0 bg-transparent text-right text-xs font-semibold outline-none ${
                              String(item.amountOverrideInput || '').trim() !== '' &&
                              item.amountOverrideValid === false
                                ? 'text-rose-200 placeholder:text-rose-300'
                                : 'text-white placeholder:text-slate-500'
                            }`}
                          />
                        </div>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        From: {item.imageName || 'Unknown image'}
                        {item.transaction.lineIndex ? ` · OCR line ${item.transaction.lineIndex}` : ''}
                      </p>
                      {item.transaction.date ? (
                        <p className="text-xs text-slate-400">Date: {item.transaction.date}</p>
                      ) : (
                        <p className="text-xs text-slate-500">Date: pending / not captured</p>
                      )}
                      {item.explanation ? (
                        <p className="text-xs text-slate-300 mt-2">{item.explanation}</p>
                      ) : null}
                      {item.commonReoccurrenceKey ? (
                        <button
                          type="button"
                          onClick={(event) => handleToggleCommonReoccurrence(event, item)}
                          disabled={isSavingCommonReoccurrence}
                          className={`mt-3 rounded-md border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
                            item.isCommonReoccurrence
                              ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
                              : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20'
                          }`}
                        >
                          {item.isCommonReoccurrence
                            ? 'Common reoccurrence'
                            : 'Mark common reoccurrence'}
                        </button>
                      ) : null}
                      {item.transaction.isManual ? (
                        <button
                          type="button"
                          onClick={(event) =>
                            handleRemoveManualTransaction(event, item.transaction.manualId)
                          }
                          className="mt-2 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/20"
                        >
                          Remove manual entry
                        </button>
                      ) : null}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span
                      className={`shrink-0 rounded-full border px-2 py-1 text-[11px] font-semibold uppercase tracking-wider ${getBadgeClass(
                        item.reason,
                        selected
                      )}`}
                      >
                        {selected ? 'selected' : formatReason(item.reason)}
                      </span>
                      {item.confidence ? (
                        <span
                          className={`rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-wider ${getConfidenceClass(
                            item.confidence.level
                          )}`}
                        >
                          {item.confidence.level} confidence
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {item.transaction.rawLine ? (
                    <p className="text-xs text-slate-500 font-mono mt-2 break-all">{item.transaction.rawLine}</p>
                  ) : null}
                  {item.trace ? (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-[11px] text-slate-400">Decision trace</summary>
                      <div className="mt-2 rounded bg-slate-950/70 p-3 text-[11px] text-slate-300 space-y-1">
                        <p>Raw OCR: {item.trace.rawOcrLine || 'n/a'}</p>
                        <p>
                          Parsed: {item.trace.parsed?.merchant || 'n/a'} | {item.trace.parsed?.amountText || 'n/a'} | {item.trace.parsed?.date || 'n/a'}
                        </p>
                        <p>
                          Normalized: {item.trace.normalized?.merchant || 'n/a'} | {item.trace.normalized?.amount ?? 'n/a'} | {item.trace.normalized?.date || 'n/a'}
                        </p>
                        {item.trace.existingMatch ? (
                          <p>
                            Existing match: {item.trace.existingMatch.merchant || 'n/a'} on {item.trace.existingMatch.date || item.trace.existingMatch.uploadedDay || 'n/a'} ({item.trace.existingMatch.matchType || 'n/a'})
                          </p>
                        ) : null}
                        {item.trace.duplicateEvaluation ? (
                          <p>
                            Duplicate check: {item.trace.duplicateEvaluation.reason || 'n/a'} at {item.trace.duplicateEvaluation.merchantSimilarity ?? 'n/a'}% similarity
                            {item.trace.duplicateEvaluation.overlapLength
                              ? ` across ${item.trace.duplicateEvaluation.overlapLength} row${item.trace.duplicateEvaluation.overlapLength === 1 ? '' : 's'}`
                              : ''}
                          </p>
                        ) : null}
                      </div>
                    </details>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex gap-3">
        <button
          onClick={onCancel}
          disabled={isLoading}
          className="px-6 py-3 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded-lg text-white font-medium transition"
        >
          Back
        </button>
        <button
          onClick={handleConfirm}
          disabled={isLoading || hasInvalidAmountOverrides}
          className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-white font-medium transition"
        >
          {isLoading ? 'Importing...' : `Import ${selectedItems.length} Transaction${selectedItems.length === 1 ? '' : 's'}`}
        </button>
      </div>
      {hasInvalidAmountOverrides ? (
        <p className="mt-3 text-xs text-rose-300">
          Fix any invalid amount overrides before importing.
        </p>
      ) : null}
    </div>
  );
}
