import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import Papa from 'papaparse';
import { matchAssignmentsToParsedTransactions } from '../utils/assignmentMatcher';

const MOCK_ASSIGNMENT_POOL = [
  {
    id: 'mock-aldi',
    date: '2026-04-03',
    uploadedDay: '2026-04-03',
    isPending: false,
    amount: 25.58,
    description: 'ALDI STORES WEST FOOTSCRA AUS',
    assignment: 'Tony',
    sheetCode: 't',
    comment: 'Groceries for the team',
  },
  {
    id: 'mock-kc-cha',
    date: '2026-04-01',
    uploadedDay: '2026-04-01',
    isPending: true,
    amount: 9.9,
    description: 'KC CHA PTY LTD. CARLTON',
    assignment: 'Nugs',
    sheetCode: 'n',
  },
  {
    id: 'mock-krispy',
    date: '2026-04-01',
    uploadedDay: '2026-04-01',
    isPending: true,
    amount: 7.9,
    description: 'Krispy Kreme Highpoint Maribyrnong',
    assignment: 'Macquarie',
    sheetCode: 'macq',
  },
  {
    id: 'mock-coles-macq',
    date: '2026-04-01',
    uploadedDay: '2026-04-01',
    isPending: true,
    amount: 42.8,
    description: 'COLES Footscray',
    assignment: 'Macquarie',
    sheetCode: 'macq',
  },
  {
    id: 'mock-coles-tony',
    date: '2026-04-02',
    uploadedDay: '2026-04-02',
    isPending: true,
    amount: 42.8,
    description: 'COLES Footscray',
    assignment: 'Tony',
    sheetCode: 't',
  },
  {
    id: 'mock-old-coles',
    date: '2026-04-01',
    uploadedDay: '2026-04-01',
    isPending: true,
    amount: 89.5,
    description: 'COLES Footscray',
    assignment: 'Macquarie',
    sheetCode: 'macq',
  },
];

const MOCK_STATEMENT_TRANSACTIONS = [
  {
    order: 0,
    date: '2026-04-03',
    amount: 25.58,
    description: 'ALDI STORES WEST FOOTSCRA AUS',
    rawDescription: 'ALDI STORES WEST FOOTSCRA AUS',
    sourcePage: 1,
  },
  {
    order: 1,
    date: '2026-04-04',
    amount: 9.9,
    description: 'KC CHA PTY LTD. CARLTON',
    rawDescription: 'KC CHA PTY LTD. CARLTON',
    sourcePage: 1,
  },
  {
    order: 2,
    date: '2026-04-05',
    amount: 7.9,
    description: 'Krispy Kreme Highpoint Maribyrnong',
    rawDescription: 'Krispy Kreme Highpoint Maribyrnong',
    sourcePage: 1,
  },
  {
    order: 3,
    date: '2026-04-03',
    amount: 42.8,
    description: 'COLES Footscray',
    rawDescription: 'COLES Footscray',
    sourcePage: 1,
  },
  {
    order: 4,
    date: '2026-04-08',
    amount: 89.5,
    description: 'COLES Footscray',
    rawDescription: 'COLES Footscray',
    sourcePage: 1,
  },
];

const MOCK_STATEMENT_PAYLOAD = {
  fileName: 'matcher-self-test.pdf',
  statement: {
    openingBalance: null,
    closingBalance: null,
    closingBalanceDelta: null,
    newPurchases: null,
    feesAndCharges: null,
    paymentsAndCredits: null,
    parsedTransactionTotal: 168.68,
    reconciliationDifference: null,
  },
  transactions: MOCK_STATEMENT_TRANSACTIONS,
  pageCount: 1,
};

function formatAmount(amount) {
  const numeric = Number(amount || 0);
  const prefix = numeric < 0 ? '-' : '';
  return `${prefix}$${Math.abs(numeric).toFixed(2)}`;
}

function getAssignmentMatchLabel(match) {
  if (!match || match.matchType === 'no_candidate') return null;
  if (match.matchType === 'ambiguous') return 'review: ambiguous match';
  if (match.matchType === 'low_confidence') {
    return match.dateMatch?.label ? `low confidence: ${match.dateMatch.label}` : 'low confidence';
  }
  return match.dateMatch?.label || match.matchType;
}

function buildCsvRows(transactions) {
  return transactions.map((transaction) => ({
    Date: transaction.date || '',
    Amount: Number(transaction.amount || 0).toFixed(2),
    Description: transaction.description || '',
    Owner: '',
  }));
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.split(',').pop() || '');
    };
    reader.onerror = () => reject(new Error('Unable to read the PDF file.'));
    reader.readAsDataURL(file);
  });
}

export default function StatementImportPage() {
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sheetMessage, setSheetMessage] = useState(null);
  const [assignmentMatches, setAssignmentMatches] = useState([]);
  const [googleSheetMessage, setGoogleSheetMessage] = useState(null);
  const [showMockPreview, setShowMockPreview] = useState(false);

  const activeParsed = showMockPreview ? MOCK_STATEMENT_PAYLOAD : parsed;
  const transactions = activeParsed?.transactions || [];
  const csvRows = useMemo(() => buildCsvRows(transactions), [transactions]);

  const totals = useMemo(() => {
    const refunds = transactions.filter((transaction) => transaction.isRefund).length;
    const foreignFees = transactions.filter((transaction) => transaction.isForeignFee).length;
    return {
      count: transactions.length,
      refunds,
      foreignFees,
    };
  }, [transactions]);

  const handleParse = async () => {
    if (!file) {
      setError('Please choose a PDF first.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setSheetMessage(null);
    setGoogleSheetMessage(null);
    setAssignmentMatches([]);
    setShowMockPreview(false);

    try {
      const base64 = await readFileAsBase64(file);
      const response = await fetch('/api/parse-statement', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || 'application/pdf',
          data: base64,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to parse the PDF.');
      }

      setParsed(payload);
    } catch (err) {
      setParsed(null);
      setError(err?.message || 'Failed to parse the PDF.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownloadCsv = () => {
    const csv = Papa.unparse(csvRows, {
      header: true,
      quotes: true,
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${(file?.name || 'statement').replace(/\.pdf$/i, '')}-transactions.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyCsv = async () => {
    const csv = Papa.unparse(csvRows, {
      header: true,
      quotes: true,
    });
    await navigator.clipboard.writeText(csv);
  };

  const resolveLiveAssignmentMatches = async (statementTransactions = []) => {
    const response = await fetch('/api/statement-assignment-matches', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        transactions: statementTransactions,
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error || 'Failed to resolve assignment matches.');
    }

    return Array.isArray(payload?.matches) ? payload.matches : [];
  };

  const handleBuildUpdatedSheet = async () => {
    setIsLoading(true);
    setError(null);
    setSheetMessage(null);
    setGoogleSheetMessage(null);
    setShowMockPreview(false);

    try {
      if (!parsed) {
        throw new Error('Please parse a statement PDF before building the updated sheet.');
      }

      const matches = await resolveLiveAssignmentMatches(parsed.transactions);
      const assignmentCodes = matches.map((match) => match.code || '');
      const assignmentComments = matches.map((match) => match.matched?.comment || '');
      setAssignmentMatches(matches);

      const response = await fetch('/api/update-sheet', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          assignmentCodes,
          assignmentComments,
          transactions: parsed.transactions,
          closingBalance: parsed.statement?.closingBalance ?? null,
        }),
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload?.error || 'Failed to build the updated workbook.');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'sheet-updated-from-pdf.xlsx';
      anchor.click();
      URL.revokeObjectURL(url);

      setSheetMessage('Local workbook built and saved to local/sheet-updated-from-pdf.xlsx.');
    } catch (err) {
      setError(err?.message || 'Failed to build the updated workbook.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBuildMockUpdatedSheet = async () => {
    setIsLoading(true);
    setError(null);
    setSheetMessage(null);
    setGoogleSheetMessage(null);

    try {
      const matches = matchAssignmentsToParsedTransactions(
        MOCK_STATEMENT_TRANSACTIONS,
        MOCK_ASSIGNMENT_POOL
      );
      const assignmentCodes = matches.map((match) => match.code || '');
      const assignmentComments = matches.map((match) => match.matched?.comment || '');
      setAssignmentMatches(matches);
      setShowMockPreview(true);

      const response = await fetch('/api/update-sheet', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          assignmentCodes,
          assignmentComments,
          transactions: MOCK_STATEMENT_TRANSACTIONS,
          closingBalance: null,
        }),
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload?.error || 'Failed to build the mock workbook.');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'sheet-updated-from-pdf-mock-assignments.xlsx';
      anchor.click();
      URL.revokeObjectURL(url);

      setSheetMessage(
        'Matcher self-test workbook created: exact date rows are filled, pending +3/+4 day rows are filled, ambiguous/out-of-window rows are blank.'
      );
    } catch (err) {
      setError(err?.message || 'Failed to build the mock workbook.');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePushToGoogleSheet = async () => {
    setIsLoading(true);
    setError(null);
    setSheetMessage(null);
    setGoogleSheetMessage(null);
    setShowMockPreview(false);

    try {
      if (!parsed) {
        throw new Error('Please parse a statement PDF before pushing rows to Google Sheets.');
      }

      const matches = await resolveLiveAssignmentMatches(parsed.transactions);
      const assignmentCodes = matches.map((match) => match.code || '');
      const assignmentComments = matches.map((match) => match.matched?.comment || '');
      setAssignmentMatches(matches);

      const response = await fetch('/api/push-google-sheet', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          assignmentCodes,
          assignmentComments,
          transactions: parsed.transactions,
          closingBalance: parsed.statement?.closingBalance ?? null,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to push rows to Google Sheets.');
      }

      setGoogleSheetMessage(
        `Google Sheet updated: ${payload.rowCount} rows written into new tab ${payload.generatedSheetName}, using ${payload.sourceSheetName} as the template.`
      );
    } catch (err) {
      setError(err?.message || 'Failed to push rows to Google Sheets.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-cyan-300">Statement import</p>
            <h1 className="mt-2 text-3xl font-semibold text-white">Westpac PDF to sheet rows</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-300">
              Upload the PDF statement, extract the transaction rows, and export a CSV with
              <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-100">Date</code>,
              <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-100">Amount</code>,
              <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-100">Description</code>,
              and a blank <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-100">Owner</code>{' '}
              column ready for the sheet.
            </p>
          </div>

          <div className="flex gap-3">
            <Link href="/admin/upload">
              <a className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-slate-500 hover:bg-slate-700">
                Back to admin
              </a>
            </Link>
            <Link href="/">
              <a className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-500/20">
                Main app
              </a>
            </Link>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
              <label className="block text-sm font-medium text-slate-200">PDF file</label>
              <div
                className="mt-3 rounded-xl border-2 border-dashed border-slate-700 bg-slate-950/70 p-5 text-center transition hover:border-cyan-500/50"
                onClick={() => document.getElementById('statement-pdf-input')?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    document.getElementById('statement-pdf-input')?.click();
                  }
                }}
              >
                <input
                  id="statement-pdf-input"
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(event) => {
                    const nextFile = event.target.files?.[0] || null;
                    setFile(nextFile);
                    setError(null);
                    setParsed(null);
                    setShowMockPreview(false);
                  }}
                />
                <p className="text-lg font-medium text-white">
                  {file ? file.name : 'Choose the statement PDF'}
                </p>
                <p className="mt-2 text-sm text-slate-400">
                  Only the transaction rows are extracted. The owner column is left blank for later matching.
                </p>
              </div>

              <div className="mt-4 grid gap-3">
                <button
                  onClick={handleParse}
                  disabled={!file || isLoading}
                  className="w-full rounded-xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isLoading ? 'Parsing PDF...' : 'Extract uploaded PDF'}
                </button>
                <button
                  onClick={handleBuildMockUpdatedSheet}
                  disabled={isLoading}
                  className="w-full rounded-xl border border-fuchsia-500/40 bg-fuchsia-500/10 px-4 py-3 text-sm font-semibold text-fuchsia-100 transition hover:bg-fuchsia-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Run matcher self-test
                </button>
              </div>

              {error ? (
                <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
                  {error}
                </div>
              ) : null}
            </div>

            {activeParsed ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
                <h2 className="text-lg font-semibold text-white">Reconciliation</h2>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-slate-950/80 p-3">
                    <p className="text-[11px] uppercase tracking-wider text-slate-400">Opening</p>
                    <p className="mt-1 text-lg font-semibold text-white">
                      {activeParsed.statement.openingBalance !== null
                        ? formatAmount(activeParsed.statement.openingBalance)
                        : 'n/a'}
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-950/80 p-3">
                    <p className="text-[11px] uppercase tracking-wider text-slate-400">Closing</p>
                    <p className="mt-1 text-lg font-semibold text-white">
                      {activeParsed.statement.closingBalance !== null
                        ? formatAmount(activeParsed.statement.closingBalance)
                        : 'n/a'}
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-950/80 p-3">
                    <p className="text-[11px] uppercase tracking-wider text-slate-400">Parsed total</p>
                    <p className="mt-1 text-lg font-semibold text-white">
                      {formatAmount(activeParsed.statement.parsedTransactionTotal)}
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-950/80 p-3">
                    <p className="text-[11px] uppercase tracking-wider text-slate-400">Difference</p>
                    <p
                      className={`mt-1 text-lg font-semibold ${
                        Math.abs(Number(activeParsed.statement.reconciliationDifference || 0)) <= 0.01
                          ? 'text-emerald-300'
                          : 'text-amber-300'
                      }`}
                    >
                      {activeParsed.statement.reconciliationDifference !== null
                        ? formatAmount(activeParsed.statement.reconciliationDifference)
                        : 'n/a'}
                    </p>
                  </div>
                </div>

                <div className="mt-4 space-y-2 text-sm text-slate-300">
                  <p>Total rows: {totals.count}</p>
                  <p>Refund rows: {totals.refunds}</p>
                  <p>Foreign fee rows: {totals.foreignFees}</p>
                  {activeParsed.pageCount ? <p>Pages scanned: {activeParsed.pageCount}</p> : null}
                </div>
              </div>
            ) : null}

            {activeParsed ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={handleDownloadCsv}
                    className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
                  >
                    Download CSV
                  </button>
                  <button
                    onClick={handleCopyCsv}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-slate-500 hover:bg-slate-700"
                  >
                    Copy CSV
                  </button>
                  <button
                    onClick={handleBuildUpdatedSheet}
                    disabled={isLoading || !parsed || showMockPreview}
                    className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Build and test locally
                  </button>
                  <button
                    onClick={handleBuildMockUpdatedSheet}
                    disabled={isLoading}
                    className="rounded-lg border border-fuchsia-500/40 bg-fuchsia-500/10 px-4 py-2 text-sm font-semibold text-fuchsia-100 transition hover:bg-fuchsia-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Run matcher self-test
                  </button>
                  <button
                    onClick={handlePushToGoogleSheet}
                    disabled={isLoading || !parsed || showMockPreview}
                    className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Create new Google Sheet tab
                  </button>
                </div>
                <p className="mt-3 text-xs text-slate-400">
                  The exported CSV includes <code>Date</code>, <code>Amount</code>,{' '}
                  <code>Description</code>, and <code>Owner</code> so it can drop into the sheet
                  without needing any reformatting.
                </p>
                {assignmentMatches.length > 0 ? (
                  <p className="mt-2 text-xs text-slate-400">
                    Matched assignments for {assignmentMatches.filter((match) => match.code).length} of{' '}
                    {assignmentMatches.length} rows {showMockPreview ? 'in the self-test.' : 'from the main app.'}
                  </p>
                ) : null}
                <p className="mt-2 text-xs text-slate-500">
                  Matcher self-test rows include exact-date, pending +3/+4 day, ambiguous Coles,
                  and outside-window Coles cases.
                </p>
                {sheetMessage ? (
                  <p className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                    {sheetMessage}
                  </p>
                ) : null}
                {googleSheetMessage ? (
                  <p className="mt-3 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-100">
                    {googleSheetMessage}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-white">Extracted transactions</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Review the import before you paste it into the sheet.
                </p>
              </div>
              {activeParsed ? (
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-200">
                  {showMockPreview ? 'Self-test preview' : 'Ready to export'}
                </span>
              ) : null}
            </div>

            {!activeParsed ? (
              <div className="mt-8 rounded-2xl border border-dashed border-slate-700 bg-slate-950/40 p-10 text-center text-slate-400">
                Upload a statement PDF and I&apos;ll show the rows here.
              </div>
            ) : (
              <div className="mt-5 overflow-hidden rounded-2xl border border-slate-800">
                <div className="max-h-[70vh] overflow-auto">
                  <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
                    <thead className="sticky top-0 bg-slate-950/95 text-xs uppercase tracking-wider text-slate-400">
                      <tr>
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">Amount</th>
                        <th className="px-4 py-3">Description</th>
                        <th className="px-4 py-3">Flags</th>
                        <th className="px-4 py-3">Assignment</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 bg-slate-950/30">
                      {transactions.map((transaction, index) => (
                        <tr key={`${transaction.sourcePage}-${index}`} className="align-top">
                          <td className="px-4 py-3 whitespace-nowrap text-slate-200">
                            {transaction.date || 'n/a'}
                          </td>
                          <td
                            className={`px-4 py-3 whitespace-nowrap font-semibold ${
                              transaction.isRefund ? 'text-emerald-300' : 'text-white'
                            }`}
                          >
                            {formatAmount(transaction.amount)}
                          </td>
                          <td className="px-4 py-3 text-slate-200">
                            <div>{transaction.description}</div>
                            {transaction.rawDescription && transaction.rawDescription !== transaction.description ? (
                              <div className="mt-1 text-[11px] text-slate-500">{transaction.rawDescription}</div>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-400">
                            <div>Page {transaction.sourcePage}</div>
                            {transaction.isRefund ? <div className="text-emerald-300">Refund / credit</div> : null}
                            {transaction.isForeignFee ? <div className="text-cyan-300">Foreign fee</div> : null}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-300">
                            {assignmentMatches[index]?.code ? (
                              <div className="font-semibold text-amber-200">{assignmentMatches[index].code}</div>
                            ) : (
                              <div
                                className={
                                  assignmentMatches[index]?.matchType === 'ambiguous'
                                    ? 'font-semibold text-amber-300'
                                    : 'text-slate-500'
                                }
                              >
                                {assignmentMatches[index]?.matchType === 'ambiguous' ? 'review' : 'unmatched'}
                              </div>
                            )}
                            {getAssignmentMatchLabel(assignmentMatches[index]) ? (
                              <div className="mt-1 text-[11px] text-slate-400">
                                {getAssignmentMatchLabel(assignmentMatches[index])}
                              </div>
                            ) : null}
                            {assignmentMatches[index]?.confidence ? (
                              <div className="mt-1 text-[11px] text-slate-500">
                                score {assignmentMatches[index].confidence}
                              </div>
                            ) : null}
                            {assignmentMatches[index]?.matched?.description ? (
                              <div className="mt-1 text-[11px] text-slate-500">
                                {assignmentMatches[index].matched.description}
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
