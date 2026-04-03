import React, { useState, useEffect } from 'react';

export default function CreditCardDemo() {
  const [transactions, setTransactions] = useState([]);
  const [submissions, setSubmissions] = useState({});
  const [currentUser, setCurrentUser] = useState('Tony');
  const [editingTx, setEditingTx] = useState(null);
  const [csvFile, setCsvFile] = useState('demo-data.csv');
  const USERS = ['Tony', 'Nugs'];
  const STORAGE_KEY = 'cc_submissions_demo';

  // Load from local storage on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setSubmissions(JSON.parse(saved));
      } catch (e) {
        console.log('Failed to load submissions');
      }
    }
    loadDemoData();
  }, []);

  // Save to local storage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(submissions));
  }, [submissions]);

  // Load demo data
  const loadDemoData = () => {
    const demoTransactions = [
      { id: '2026-04-03-0', date: '2026-04-03', amount: 75.0, description: 'VELOCITY REWARDS FEE' },
      { id: '2026-04-03-1', date: '2026-04-03', amount: 295.0, description: 'CARD FEE' },
      { id: '2026-04-03-2', date: '2026-04-03', amount: 32.21, description: 'aliexpress North Sydney AUS' },
      { id: '2026-04-02-0', date: '2026-04-02', amount: 1468.0, description: 'FOREIGN FEE AUD 8.01' },
      { id: '2026-04-02-1', date: '2026-04-02', amount: 275.05, description: 'KICKSTARTER.COM TSIMSHATSUI HKG' },
      { id: '2026-04-01-0', date: '2026-04-01', amount: 98.0, description: 'gu health rewards GR CAMBERWELL AUS' },
      { id: '2026-04-01-1', date: '2026-04-01', amount: 12.9, description: 'McDonalds 950055 SUNSHINE AUS' },
      { id: '2026-03-31-0', date: '2026-03-31', amount: 89.5, description: 'Coles Supermarket Footscray' },
      { id: '2026-03-31-1', date: '2026-03-31', amount: 45.0, description: 'Bunnings Warehouse' },
      { id: '2026-03-30-0', date: '2026-03-30', amount: 22.3, description: 'ALDI STORES WEST' },
    ];
    setTransactions(demoTransactions);
  };

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

  const hasConflict = (txId) => {
    const sub = submissions[txId];
    if (!sub) return false;
    const userAssignments = Object.entries(sub)
      .filter(([key]) => USERS.includes(key))
      .map(([, val]) => val)
      .filter((v) => v !== null);
    return userAssignments.length > 1 && new Set(userAssignments).size > 1;
  };

  const allSubmitted = (txId) => {
    const sub = submissions[txId];
    if (!sub) return false;
    return USERS.every((user) => sub[user] !== null && sub[user] !== undefined);
  };

  const getCurrentSubmission = (txId) => {
    return submissions[txId]?.[currentUser] || null;
  };

  const stats = {
    total: transactions.length,
    assigned: transactions.filter((tx) => allSubmitted(tx.id) && !hasConflict(tx.id)).length,
    conflicts: transactions.filter((tx) => hasConflict(tx.id)).length,
    pending: transactions.filter((tx) => !allSubmitted(tx.id) || hasConflict(tx.id)).length,
  };

  const sortedTransactions = [...transactions].sort((a, b) => {
    const aStatus = hasConflict(a.id) || !allSubmitted(a.id) ? 0 : 1;
    const bStatus = hasConflict(b.id) || !allSubmitted(b.id) ? 0 : 1;
    return aStatus - bStatus;
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">💳 Credit Card Consolidation</h1>
          <p className="text-slate-300">Assign transactions and resolve conflicts</p>
          <p className="text-xs text-slate-400 mt-2">Demo Mode - Try assigning transactions!</p>
        </div>

        {/* Info Box */}
        <div className="bg-blue-900/30 border border-blue-500 rounded-lg p-4 mb-6">
          <p className="text-sm text-blue-200">
            <strong>Try this:</strong> Switch to "Tony", assign a transaction to "Tony". Then switch to "Nugs" and assign the SAME transaction to "Nugs". Watch it turn red (conflict)!
          </p>
        </div>

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

        {/* User Selection */}
        <div className="bg-slate-800 rounded-lg p-4 mb-6 border border-slate-700">
          <p className="text-sm mb-2">Current User:</p>
          <div className="flex gap-2">
            {USERS.map((user) => (
              <button
                key={user}
                onClick={() => setCurrentUser(user)}
                className={`px-6 py-2 rounded transition ${
                  currentUser === user
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                {user}
              </button>
            ))}
          </div>
        </div>

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
                      <span className="text-xs px-2 py-1 bg-slate-700 rounded">{tx.date}</span>
                      {conflict && <span className="text-xs px-2 py-1 bg-red-600 rounded">⚠️ CONFLICT</span>}
                      {submitted && !conflict && (
                        <span className="text-xs px-2 py-1 bg-green-600 rounded">✓ ASSIGNED</span>
                      )}
                    </div>
                    <p className="font-medium">{tx.description}</p>
                    <p className="text-sm text-slate-400">Amount: ${tx.amount.toFixed(2)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-blue-300">${tx.amount.toFixed(2)}</p>
                  </div>
                </div>

                {/* Submissions Display */}
                <div className="bg-slate-900 rounded p-3 mb-3 text-sm">
                  <p className="text-slate-400 mb-2">User Assignments:</p>
                  <div className="grid grid-cols-2 gap-2">
                    {USERS.map((user) => {
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
                    })}
                  </div>
                </div>

                {/* Action Buttons */}
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
                    {userSub && (
                      <span className="px-3 py-2 text-sm bg-slate-700 rounded">
                        You: <span className="text-blue-300">{userSub}</span>
                      </span>
                    )}
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
      </div>
    </div>
  );
}
