import React, { useState } from 'react';

export default function ImageReviewModal({
  duplicates = [],
  flagged = [],
  onConfirm,
  onCancel,
  isLoading = false,
}) {
  const [selected, setSelected] = useState({});
  const getDuplicateItems = (group) => (Array.isArray(group) ? group : group?.group || []);

  const handleSelectDuplicate = (groupIndex, itemIndex) => {
    setSelected((prev) => ({
      ...prev,
      [groupIndex]: itemIndex,
    }));
  };

  const handleConfirmFlagged = (flaggedIndex, confirmed) => {
    setSelected((prev) => ({
      ...prev,
      [`flagged_${flaggedIndex}`]: confirmed,
    }));
  };

  const allSelectionsComplete = () => {
    for (let i = 0; i < duplicates.length; i++) {
      if (selected[i] === undefined) {
        return false;
      }
    }

    for (let i = 0; i < flagged.length; i++) {
      if (selected[`flagged_${i}`] === undefined) {
        return false;
      }
    }

    return true;
  };

  const handleConfirmAll = () => {
    if (!allSelectionsComplete()) {
      alert('Please make selections for all flagged transactions');
      return;
    }

    const indicesToKeep = new Set();

    duplicates.forEach((group, groupIdx) => {
      const items = getDuplicateItems(group);
      const selectedIdx = selected[groupIdx];
      if (items[selectedIdx]) {
        indicesToKeep.add(items[selectedIdx].index);
      }
    });

    flagged.forEach((flaggedItem, flaggedIdx) => {
      if (selected[`flagged_${flaggedIdx}`]) {
        getDuplicateItems(flaggedItem).forEach((item) => {
          indicesToKeep.add(item.index);
        });
      }
    });

    onConfirm(Array.from(indicesToKeep));
  };

  if (duplicates.length === 0 && flagged.length === 0) {
    return null;
  }

  const getFlaggedMessage = (reason) => {
    if (reason === 'possible_repeat_charge') {
      return 'These charges look like the same merchant and amount, but on different dates. Please confirm whether they are separate transactions.';
    }

    if (reason === 'missing_date_ambiguous') {
      return 'These charges match on merchant and amount, but the OCR did not capture enough date context to be certain.';
    }

    return 'Found multiple similar transactions. Are these different transactions?';
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-slate-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-slate-700">
        <div className="sticky top-0 bg-slate-900 border-b border-slate-700 p-6">
          <h2 className="text-2xl font-bold text-white mb-2">Review Transactions</h2>
          <p className="text-slate-400">
            {duplicates.length > 0 && `${duplicates.length} duplicate group(s) found. `}
            {flagged.length > 0 && `${flagged.length} flagged transaction(s) need confirmation.`}
          </p>
        </div>

        <div className="p-6 space-y-6">
          {duplicates.map((group, groupIdx) => {
            const items = getDuplicateItems(group);

            return (
              <div key={`dup_${groupIdx}`} className="bg-slate-700/50 rounded-lg p-4 border border-red-500/30">
                <h3 className="font-bold text-red-300 mb-3">
                  Duplicate Group {groupIdx + 1}: Select which to keep
                </h3>

                <div className="space-y-2">
                  {items.map((item, itemIdx) => (
                    <label
                      key={`dup_${groupIdx}_${itemIdx}`}
                      className="flex items-start p-3 bg-slate-800 rounded border-2 transition cursor-pointer"
                      style={{
                        borderColor:
                          selected[groupIdx] === itemIdx
                            ? '#3b82f6'
                            : '#475569',
                      }}
                    >
                      <input
                        type="radio"
                        name={`dup_group_${groupIdx}`}
                        value={itemIdx}
                        checked={selected[groupIdx] === itemIdx}
                        onChange={() => handleSelectDuplicate(groupIdx, itemIdx)}
                        className="mt-1 mr-3"
                      />
                      <div className="flex-1">
                        <p className="font-mono text-sm text-slate-300">
                          <span className="font-bold">{item.transaction.merchant}</span>
                          {' - '}
                          <span className="text-blue-300">${item.transaction.amount.toFixed(2)}</span>
                        </p>
                        <p className="text-xs text-slate-400 mt-1">
                          From: {item.imageSource.imageName}
                        </p>
                        <p className="text-xs text-slate-400">
                          {item.transaction.lineIndex ? `OCR line: ${item.transaction.lineIndex}` : 'OCR line: unknown'}
                        </p>
                        {item.transaction.rawLine ? (
                          <p className="text-xs text-slate-500 font-mono mt-1 break-all">
                            {item.transaction.rawLine}
                          </p>
                        ) : null}
                        {item.transaction.date && (
                          <p className="text-xs text-slate-400">
                            Date: {item.transaction.date}
                          </p>
                        )}
                        {item.transaction.category && (
                          <p className="text-xs text-slate-400">
                            Category: {item.transaction.category}
                          </p>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}

          {flagged.map((flaggedItem, flaggedIdx) => (
            <div key={`flag_${flaggedIdx}`} className="bg-slate-700/50 rounded-lg p-4 border border-yellow-500/30">
              <h3 className="font-bold text-yellow-300 mb-3">
                Flagged Transaction {flaggedIdx + 1}
              </h3>
              <p className="text-sm text-slate-300 mb-3">
                {getFlaggedMessage(flaggedItem.reason)}
              </p>

              <div className="space-y-2 mb-3">
                {flaggedItem.group.map((item, itemIdx) => (
                  <div key={`flag_${flaggedIdx}_${itemIdx}`} className="bg-slate-800 rounded p-2 text-sm">
                    <p className="font-mono text-slate-300">
                      <span className="font-bold">{item.transaction.merchant}</span>
                      {' - '}
                      <span className="text-blue-300">${item.transaction.amount.toFixed(2)}</span>
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      From: {item.imageSource.imageName}
                    </p>
                    <p className="text-xs text-slate-400">
                      {item.transaction.lineIndex ? `OCR line: ${item.transaction.lineIndex}` : 'OCR line: unknown'}
                    </p>
                    {item.transaction.date ? (
                      <p className="text-xs text-slate-400">
                        Date: {item.transaction.date}
                      </p>
                    ) : null}
                    {item.transaction.rawLine ? (
                      <p className="text-xs text-slate-500 font-mono mt-1 break-all">
                        {item.transaction.rawLine}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => handleConfirmFlagged(flaggedIdx, true)}
                  className={`flex-1 px-3 py-2 rounded text-sm font-medium transition ${
                    selected[`flagged_${flaggedIdx}`] === true
                      ? 'bg-green-600 text-white'
                      : 'bg-slate-600 hover:bg-slate-500 text-slate-100'
                  }`}
                >
                  Yes, Keep Both
                </button>
                <button
                  onClick={() => handleConfirmFlagged(flaggedIdx, false)}
                  className={`flex-1 px-3 py-2 rounded text-sm font-medium transition ${
                    selected[`flagged_${flaggedIdx}`] === false
                      ? 'bg-red-600 text-white'
                      : 'bg-slate-600 hover:bg-slate-500 text-slate-100'
                  }`}
                >
                  No, Discard Duplicates
                </button>
              </div>
            </div>
          ))}

          {(duplicates.length > 0 || flagged.length > 0) && (
            <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-3 text-sm text-blue-200">
              Transactions not appearing in duplicate groups will be added automatically.
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-slate-900 border-t border-slate-700 p-6 flex gap-2 justify-end">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="px-6 py-2 bg-slate-700 hover:bg-slate-600 rounded text-white font-medium transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirmAll}
            disabled={isLoading || !allSelectionsComplete()}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white font-medium transition disabled:opacity-50"
          >
            {isLoading ? 'Processing...' : 'Confirm & Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
