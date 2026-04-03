import React, { useState, useEffect } from 'react';
import Papa from 'papaparse';

export default function CreditCardApp() {
  const [transactions, setTransactions] = useState([]);
  const [submissions, setSubmissions] = useState({});
  const [currentUser, setCurrentUser] = useState(null);
  const [editingTx, setEditingTx] = useState(null);
  const [csvFile, setCsvFile] = useState(null);
  const [csvDate, setCsvDate] = useState(null);
  const USERS = ['Tony', 'Nugs'];
  const STORAGE_KEY = 'cc_submissions';
  const CSV_DATE_KEY = 'cc_csv_date';

  // Load from local storage on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    const savedCsvDate = localStorage.getItem(CSV_DATE_KEY);
    if (saved) {
      try {
        setSubmissions(JSON.parse(saved));
      } catch (e) {
        console.log('Failed to load submissions');
      }
    }
    if (savedCsvDate) {
      setCsvDate(savedCsvDate);
    }
  }, []);

  // Save to local storage whenever submissions change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(submissions));
  }, [submissions]);

  // Parse CSV and extract transactions
  const handleCSVUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const parsed = results.data
          .filter((row) => row.Date && row.Amount)
          .map((row, idx) => ({
            id: `${row.Date}-${idx}`,
            date: row.Date,
            amount: parseFloat(row.Amount) || 0,
            description: row.Description || 'Unknown',
          }));

        setTransactions(parsed);
        setCsvFile(file.name);
        // Store today's date as CSV upload date
        const today = new Date().toISOString().split('T')[0];
        setCsvDate(today);
        localStorage.setItem(CSV_DATE_KEY, today);
      },
      error: (err) => alert(`Error parsing CSV: ${err.message}`),
    });
  };

  // Handle user submission
  const submitAssignment = (txId, user) => {
    setSubmissions((prev) => ({
      ...prev,
      [txId]: {
        ...prev[txId],
        [currentUser]: user,
        lastUpdated: new Date().toISOString(),
      },
    }));
    setEditingTx(null);
  };

  // Detect conflicts (only after 24 hours from CSV upload)
  const hasConflict = (txId) => {
    if (!csvDate) return false;
    
    const csvUploadDate = new Date(csvDate);
    const now = new Date();
    const hoursDiff = (now - csvUploadDate) / (1000 * 60 * 60);
    
    // Only show conflicts if more than 24 hours have passed
    if (hoursDiff < 24) return false;

    const sub = submissions[txId];
    if (!sub) return false;
    const userAssignments = Object.entries(sub)
      .filter(([key]) => USERS.includes(key))
      .map(([, val]) => val)
      .filter((v) => v !== null);
    return userAssignments.length > 1 && new Set(userAssignments).size > 1;
  };

  // Check if all users submitted for a transaction
  const allSubmitted = (txId) => {
    const sub = submissions[txId];
    if (!sub) return false;
    return USERS.every((user) => sub[user] !== null && sub[user] !== undefined);
  };

  // Get current user's submission for a transaction
  const getCurrentSubmission = (txId) => {
    return submissions[txId]?.[currentUser] || null;
  };

  // Calculate stats
  const stats = {
    total: transactions.length,
    assigned: transactions.filter((tx) => allSubmitted(tx.id) && !hasConflict(tx.id))
      .length,
    conflicts: transactions.filter((tx) => hasConflict(tx.id)).length,
    pending: transactions.filter(
      (tx) => !allSubmitted(tx.id) || hasConflict(tx.id)
    ).length,
  };

  // Sort transactions: pending/conflicts first, then completed
  const sortedTransactions = [...transactions].sort((a, b) => {
    const aStatus = hasConflict(a.id) || !allSubmitted(a.id) ? 0 : 1;
    const bStatus = hasConflict(b.id) || !allSubmitted(b.id) ? 0 : 1;
    return aStatus - bStatus;
  });

  // Check if it's been 24 hours since CSV upload
  const isConflictPhase = csvDate && ((new Date() - new Date(csvDate)) / (1000 * 60 * 60)) >= 24;

  // If no user selected, show landing page
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <h1 className="text-5xl font-bold mb-2">💳</h1>
          <h2 className="text-4xl font-bold mb-6">Credit Card</h2>
          <p className="text-slate-300 mb-8">Who are you?</p>
          
          <div className="space-y-3">
            {USERS.map((user) => (
              <button
                key={user}
                onClick={() => setCurrentUser(user)}
                className="w-full px-8 py-4 bg-blue-600 hover:bg-blue-700 rounded-lg transition text-lg font-medium"
              >
                {user}
              </button>
            ))}
          </div>
          
          <p className="text-slate-400 text-sm mt-8">Upload a CSV to get started</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex justify-between items-start">
          <div>
            <h1 className="text-4xl font-bold mb-2">💳 Credit Card Consolidation</h1>
            <p className="text-slate-300">Logged in as: <span className="text-blue-400 font-bold">{currentUser}</span></p>
          </div>
          <button
            onClick={() => setCurrentUser(null)}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm"
          >
            Switch User
          </button>
        </div>

        {/* Upload Section */}
        <div className="bg-slate-800 rounded-lg p-6 mb-6 border border-slate-700">
          <label className="block mb-2 text-sm font-medium">Upload CSV</label>
          <input
            type="file"
            accept=".csv"
            onChange={handleCSVUpload}
            className="w-full px-4 py-2 bg-slate-700 rounded border border-slate-600 text-white cursor-pointer hover:border-blue-500 transition"
          />
          {csvFile && (
            <p className="text-sm text-green-400 mt-2">✓ Loaded: {csvFile}</p>
          )}
        </div>

        {transactions.length === 0 ? (
          <div className="bg-slate-800 rounded-lg p-12 text-center border border-slate-700">
            <p className="text-slate-400">Upload a CSV to get started</p>
          </div>
        ) : (
          <>
            {/* Stats Bar */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              {[
                { label: 'Total', value: stats.total, color: 'blue' },
                { label: 'Assigned', value: stats.assigned, color: 'green' },
                { label: 'Conflicts', value: stats.conflicts, color: 'red' },
                { label: 'Pending', value: stats.pending, color: 'yellow' },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className={`bg-slate-800 rounded-lg p-4 text-center border-2 border-${stat.color}-500`}
                >
                  <p className="text-2xl font-bold">{stat.value}</p>
                  <p className="text-sm text-slate-400">{stat.label}</p>
                </div>
              ))}
            </div>

            {/* Show conflict phase message if 24 hours have passed */}
            {isConflictPhase && stats.conflicts > 0 && (
              <div className="bg-red-900/30 border border-red-500 rounded-lg p-4 mb-6">
                <p className="text-red-200">
                  <strong>⚠️ Conflict Phase:</strong> Both users have submitted. {stats.conflicts} conflict(s) detected. Work together to resolve them.
                </p>
              </div>
            )}

            {/* Transactions List */}
            <div className="space-y-3">
              {sortedTransactions.map((tx) => {
                const conflict = hasConflict(tx.id);
                const submitted = allSubmitted(tx.id);
                const userSub = getCurrentSubmission(tx.id);
                const isEditing = editingTx === tx.id;

                return (
                  <div
                    key={tx.id}
                    className={`bg-slate-800 rounded-lg p-4 border-2 transition ${
                      conflict
                        ? 'border-red-500 bg-red-900/20'
                        : submitted
                          ? 'border-green-500 bg-green-900/20'
                          : 'border-yellow-500 bg-yellow-900/20'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex-1">
                        <div className="flex gap-2 items-center mb-1">
                          <span className="text-xs px-2 py-1 bg-slate-700 rounded">
                            {tx.date}
                          </span>
                          {conflict && <span className="text-xs px-2 py-1 bg-red-600 rounded">⚠️ CONFLICT</span>}
                          {submitted && !conflict && (
                            <span className="text-xs px-2 py-1 bg-green-600 rounded">✓ ASSIGNED</span>
                          )}
                        </div>
                        <p className="font-medium">{tx.description}</p>
                        <p className="text-sm text-slate-400">Amount: ${tx.amount.toFixed(2)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold text-blue-300">
                          ${tx.amount.toFixed(2)}
                        </p>
                      </div>
                    </div>

                    {/* Submissions Display - Only show other user during conflict phase */}
                    <div className="bg-slate-900 rounded p-3 mb-3 text-sm">
                      <p className="text-slate-400 mb-2">
                        {isConflictPhase ? 'User Assignments:' : `${currentUser}'s Assignment:`}
                      </p>
                      <div className={isConflictPhase ? 'grid grid-cols-2 gap-2' : ''}>
                        {isConflictPhase ? (
                          USERS.map((user) => {
                            const assignment = submissions[tx.id]?.[user];
                            return (
                              <div key={user} className="bg-slate-800 rounded p-2">
                                <p className="text-xs text-slate-400">{user}:</p>
                                <p className="font-mono text-sm">
                                  {assignment ? (
                                    <span className="text-blue-300">{assignment}</span>
                                  ) : (
                                    <span className="text-slate-500">—</span>
                                  )}
                                </p>
                              </div>
                            );
                          })
                        ) : (
                          <div className="bg-slate-800 rounded p-2">
                            <p className="text-xs text-slate-400">{currentUser}:</p>
                            <p className="font-mono text-sm">
                              {userSub ? (
                                <span className="text-blue-300">{userSub}</span>
                              ) : (
                                <span className="text-slate-500">Not yet assigned</span>
                              )}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Action Buttons / Edit Mode */}
                    {isEditing ? (
                      <div className="flex gap-2 flex-wrap">
                        {['Tony', 'Nugs', 'Split', 'Other'].map((option) => (
                          <button
                            key={option}
                            onClick={() => submitAssignment(tx.id, option)}
                            className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 rounded transition"
                          >
                            {option}
                          </button>
                        ))}
                        <button
                          onClick={() => setEditingTx(null)}
                          className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded transition"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          onClick={() => setEditingTx(tx.id)}
                          className="flex-1 px-3 py-2 text-sm bg-slate-700 hover:bg-slate-600 rounded transition"
                        >
                          {userSub ? '✏️ Edit' : '➕ Assign'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Summary */}
            <div className="bg-slate-800 rounded-lg p-6 mt-8 border border-slate-700">
              <h3 className="text-lg font-bold mb-4">Summary</h3>
              <div className="grid md:grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-slate-400">Resolved:</p>
                  <p className="text-2xl font-bold text-green-400">{stats.assigned}</p>
                </div>
                <div>
                  <p className="text-slate-400">Remaining:</p>
                  <p className="text-2xl font-bold text-yellow-400">{stats.pending}</p>
                </div>
              </div>
              {stats.conflicts > 0 && (
                <p className="text-red-400 mt-4 text-sm">
                  ⚠️ {stats.conflicts} transaction(s) have conflicts that need resolution
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
