import React, { useEffect, useMemo, useState } from 'react';

function formatReason(reason) {
  if (!reason) return 'new_transaction';
  return String(reason).replace(/_/g, ' ');
}

function getBadgeClass(reason, selected) {
  if (selected) return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  if (reason === 'duplicate_in_upload') return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
  if (reason === 'already_exists_overlap' || reason === 'already_processed') {
    return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
  }

  return 'bg-slate-700 text-slate-300 border-slate-600';
}

export default function TransactionSelectionReview({
  items = [],
  summary = null,
  onConfirm,
  onCancel,
  isLoading = false,
}) {
  const [selectedIndices, setSelectedIndices] = useState(() =>
    new Set(items.filter((item) => item.defaultSelected).map((item) => item.index))
  );

  useEffect(() => {
    setSelectedIndices(new Set(items.filter((item) => item.defaultSelected).map((item) => item.index)));
  }, [items]);

  const selectedCount = selectedIndices.size;
  const selectedItems = useMemo(
    () => items.filter((item) => selectedIndices.has(item.index)),
    [items, selectedIndices]
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

      {summary ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <div className="bg-slate-900 rounded p-3 text-center">
            <p className="text-2xl font-bold text-blue-400">{summary.total}</p>
            <p className="text-xs text-slate-400">Total Extracted</p>
          </div>
          <div className="bg-slate-900 rounded p-3 text-center">
            <p className="text-2xl font-bold text-emerald-400">{summary.defaultSelected}</p>
            <p className="text-xs text-slate-400">Preselected</p>
          </div>
          <div className="bg-slate-900 rounded p-3 text-center">
            <p className="text-2xl font-bold text-amber-400">{summary.duplicateInUpload}</p>
            <p className="text-xs text-slate-400">In-Upload Dupes</p>
          </div>
          <div className="bg-slate-900 rounded p-3 text-center">
            <p className="text-2xl font-bold text-rose-400">{summary.skippedExisting}</p>
            <p className="text-xs text-slate-400">Skipped Existing</p>
          </div>
        </div>
      ) : null}

      <div className="space-y-3 max-h-[60vh] overflow-auto pr-1">
        {items.map((item) => {
          const selected = selectedIndices.has(item.index);
          return (
            <label
              key={`${item.index}-${item.transaction.merchant}-${item.transaction.amount}`}
              className={`block rounded-lg border p-4 transition cursor-pointer ${
                selected ? 'border-blue-500 bg-slate-900/90' : 'border-slate-700 bg-slate-900/50'
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => handleToggle(item.index)}
                  className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-900 text-blue-500"
                />
                <div className="flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-white">
                        {item.transaction.merchant} - ${Number(item.transaction.amount || 0).toFixed(2)}
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        From: {item.imageName || 'Unknown image'}
                        {item.transaction.lineIndex ? ` · OCR line ${item.transaction.lineIndex}` : ''}
                      </p>
                      {item.transaction.date ? (
                        <p className="text-xs text-slate-400">Date: {item.transaction.date}</p>
                      ) : (
                        <p className="text-xs text-slate-500">Date: pending / not captured</p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-1 text-[11px] font-semibold uppercase tracking-wider ${getBadgeClass(
                        item.reason,
                        selected
                      )}`}
                    >
                      {selected ? 'selected' : formatReason(item.reason)}
                    </span>
                  </div>
                  {item.transaction.rawLine ? (
                    <p className="text-xs text-slate-500 font-mono mt-2 break-all">{item.transaction.rawLine}</p>
                  ) : null}
                </div>
              </div>
            </label>
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
          disabled={isLoading}
          className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-white font-medium transition"
        >
          {isLoading ? 'Importing...' : `Import ${selectedItems.length} Transaction${selectedItems.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  );
}
