import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

const HISTORY_KEY = 'cc_performance_debugger_runs_v1';
const BASELINE_KEY = 'cc_performance_debugger_baseline_v1';

const TARGET_ROUTES = [
  { label: 'Main app', path: '/' },
  { label: 'Admin upload', path: '/admin/upload' },
  { label: 'Statement importer', path: '/admin/statement-import' },
];

const DURATION_OPTIONS = [
  { label: '3 seconds', value: 3000 },
  { label: '5 seconds', value: 5000 },
  { label: '10 seconds', value: 10000 },
];

const SAMPLE_SET_OPTIONS = [3, 5, 10];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function median(values) {
  return percentile(values, 0.5);
}

function formatMs(value) {
  if (!Number.isFinite(value)) return 'n/a';
  if (value < 10) return `${value.toFixed(1)} ms`;
  return `${Math.round(value)} ms`;
}

function getTargetLabel(path) {
  return TARGET_ROUTES.find((route) => route.path === path)?.label || path;
}

function buildTargetSrc(path) {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}perfDebug=${Date.now()}`;
}

function calculateScore(metrics) {
  const p95Frame = metrics.p95FrameMs || 16.7;
  const p95Lag = metrics.p95LagMs || 0;
  const droppedRatio = metrics.frameCount
    ? metrics.droppedFrames / metrics.frameCount
    : 0;
  const framePenalty = clamp((p95Frame - 16.7) * 1.8, 0, 42);
  const noticeableLagMs = Math.max(0, p95Lag - 4);
  const lagPenalty = clamp(noticeableLagMs * 1.1, 0, 30);
  const droppedPenalty = clamp(droppedRatio * 100, 0, 16);
  const blockingPenalty = clamp(metrics.totalBlockingMs / 35 + metrics.longTaskCount * 2, 0, 24);

  return Math.round(clamp(100 - framePenalty - lagPenalty - droppedPenalty - blockingPenalty, 0, 100));
}

function getRating(score) {
  if (score >= 85) return { label: 'Feels fast', tone: 'text-emerald-300', border: 'border-emerald-500/30' };
  if (score >= 65) return { label: 'Could be smoother', tone: 'text-amber-300', border: 'border-amber-500/30' };
  return { label: 'Needs attention', tone: 'text-rose-300', border: 'border-rose-500/30' };
}

function formatScoreChange(value) {
  if (!Number.isFinite(value) || value === 0) return 'about the same';
  return value > 0 ? `${value} better` : `${Math.abs(value)} worse`;
}

function formatTimeChange(value) {
  if (!Number.isFinite(value) || Math.abs(value) < 1) return 'about the same';
  return value < 0 ? `${formatMs(Math.abs(value))} faster` : `${formatMs(value)} slower`;
}

function readHistory() {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistHistory(runs) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(runs.slice(0, 16)));
}

function buildSampleSetResult(samples) {
  const scoreValues = samples.map((sample) => sample.score);
  const smoothnessValues = samples.map((sample) => sample.p95FrameMs);
  const pauseValues = samples.map((sample) => sample.p95LagMs);
  const loadValues = samples.map((sample) => sample.loadMs);
  const firstSample = samples[0];

  return {
    id: `set-${Date.now()}`,
    targetPath: firstSample.targetPath,
    targetLabel: firstSample.targetLabel,
    createdAt: new Date().toISOString(),
    durationMs: samples.reduce((sum, sample) => sum + sample.durationMs, 0),
    loadMs: median(loadValues),
    loadTimedOut: samples.some((sample) => sample.loadTimedOut),
    score: Math.round(median(scoreValues)),
    scoreAverage: Math.round(average(scoreValues)),
    scoreMin: Math.min(...scoreValues),
    scoreMax: Math.max(...scoreValues),
    p95FrameMs: median(smoothnessValues),
    p95LagMs: median(pauseValues),
    maxLagMs: Math.max(...samples.map((sample) => sample.maxLagMs)),
    longTaskCount: samples.reduce((sum, sample) => sum + sample.longTaskCount, 0),
    totalBlockingMs: samples.reduce((sum, sample) => sum + sample.totalBlockingMs, 0),
    runCount: samples.length,
    samples,
    isSampleSet: true,
  };
}

function MetricTile({ label, value, detail, tone = 'text-white' }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
      <p className="text-[11px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${tone}`}>{value}</p>
      {detail ? <p className="mt-1 text-xs text-slate-400">{detail}</p> : null}
    </div>
  );
}

export default function PerformanceDebuggerPage() {
  const iframeRef = useRef(null);
  const [targetPath, setTargetPath] = useState('/');
  const [durationMs, setDurationMs] = useState(5000);
  const [sampleCount, setSampleCount] = useState(5);
  const [isRunning, setIsRunning] = useState(false);
  const [runStatus, setRunStatus] = useState('Ready');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [baselineId, setBaselineId] = useState('');

  useEffect(() => {
    setHistory(readHistory());
    setBaselineId(window.localStorage.getItem(BASELINE_KEY) || '');
  }, []);

  const baseline = useMemo(
    () => history.find((run) => run.id === baselineId) || null,
    [baselineId, history]
  );

  const comparison = useMemo(() => {
    if (!result || !baseline || result.targetPath !== baseline.targetPath) return null;

    return {
      score: result.score - baseline.score,
      p95FrameMs: result.p95FrameMs - baseline.p95FrameMs,
      p95LagMs: result.p95LagMs - baseline.p95LagMs,
      totalBlockingMs: result.totalBlockingMs - baseline.totalBlockingMs,
    };
  }, [baseline, result]);

  const measureRouteSpeed = async ({ statusPrefix = '' } = {}) => {
    const iframe = iframeRef.current;
    if (!iframe) {
      throw new Error('Could not start the hidden page check.');
    }

    let frameId = null;
    let intervalId = null;
    let observer = null;
    let stopped = false;

    const cleanup = (targetWindow = window) => {
      stopped = true;
      if (frameId !== null) {
        try {
          targetWindow.cancelAnimationFrame(frameId);
        } catch {
          window.cancelAnimationFrame(frameId);
        }
      }
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
      if (observer) {
        observer.disconnect();
      }
    };

    const loadStartedAt = performance.now();
    const loadResult = await new Promise((resolve) => {
      let resolved = false;
      const finish = (payload) => {
        if (resolved) return;
        resolved = true;
        iframe.removeEventListener('load', handleLoad);
        window.clearTimeout(timeoutId);
        resolve(payload);
      };
      const handleLoad = () =>
        finish({
          loadMs: performance.now() - loadStartedAt,
          timedOut: false,
        });
      const timeoutId = window.setTimeout(
        () =>
          finish({
            loadMs: performance.now() - loadStartedAt,
            timedOut: true,
          }),
        10000
      );

      iframe.addEventListener('load', handleLoad, { once: true });
      iframe.src = buildTargetSrc(targetPath);
    });

    const targetWindow = iframe.contentWindow || window;
    const requestFrame = (callback) => {
      try {
        return targetWindow.requestAnimationFrame(callback);
      } catch {
        return window.requestAnimationFrame(callback);
      }
    };

    const frameDeltas = [];
    const intervalDrifts = [];
    const longTasks = [];
    let previousFrameTime = null;
    const heartbeatMs = 50;
    let previousHeartbeatTime = performance.now();
    const sampleStartedAt = performance.now();

    const sampleFrame = (timestamp) => {
      if (stopped) return;
      if (previousFrameTime !== null) {
        frameDeltas.push(timestamp - previousFrameTime);
      }
      previousFrameTime = timestamp;
      frameId = requestFrame(sampleFrame);
    };

    setRunStatus(
      loadResult.timedOut
        ? `${statusPrefix}Checking after a slow open`
        : `${statusPrefix}Checking feel`
    );
    frameId = requestFrame(sampleFrame);
    intervalId = window.setInterval(() => {
      const current = performance.now();
      const elapsed = current - previousHeartbeatTime;
      intervalDrifts.push(Math.max(0, elapsed - heartbeatMs));
      previousHeartbeatTime = current;
    }, heartbeatMs);

    const supportsLongTask =
      window.PerformanceObserver?.supportedEntryTypes?.includes('longtask') || false;

    if (supportsLongTask) {
      observer = new PerformanceObserver((entryList) => {
        entryList.getEntries().forEach((entry) => {
          if (entry.startTime >= sampleStartedAt - 25) {
            longTasks.push({
              duration: entry.duration,
              startTime: entry.startTime,
              name: entry.name || 'task',
            });
          }
        });
      });
      observer.observe({ entryTypes: ['longtask'] });
    }

    await new Promise((resolve) => window.setTimeout(resolve, Number(durationMs)));
    cleanup(targetWindow);

    const sampleEndedAt = performance.now();
    const actualDurationMs = sampleEndedAt - sampleStartedAt;
    const avgFrameMs = average(frameDeltas);
    const p95FrameMs = percentile(frameDeltas, 0.95);
    const p99FrameMs = percentile(frameDeltas, 0.99);
    const maxFrameMs = frameDeltas.length ? Math.max(...frameDeltas) : 0;
    const p95LagMs = percentile(intervalDrifts, 0.95);
    const maxLagMs = intervalDrifts.length ? Math.max(...intervalDrifts) : 0;
    const totalBlockingMs = longTasks.reduce(
      (sum, task) => sum + Math.max(0, task.duration - 50),
      0
    );
    const memoryMb = performance.memory?.usedJSHeapSize
      ? performance.memory.usedJSHeapSize / 1048576
      : null;
    const metrics = {
      avgFrameMs,
      p95FrameMs,
      p99FrameMs,
      maxFrameMs,
      frameCount: frameDeltas.length,
      droppedFrames: frameDeltas.filter((delta) => delta > 50).length,
      p95LagMs,
      maxLagMs,
      longTaskCount: longTasks.length,
      totalBlockingMs,
    };
    const score = calculateScore(metrics);

    return {
      id: String(Date.now()),
      targetPath,
      targetLabel: getTargetLabel(targetPath),
      createdAt: new Date().toISOString(),
      durationMs: Math.round(actualDurationMs),
      loadMs: loadResult.loadMs,
      loadTimedOut: loadResult.timedOut,
      fps: avgFrameMs ? 1000 / avgFrameMs : 0,
      memoryMb,
      score,
      runCount: 1,
      ...metrics,
    };
  };

  const saveResults = (nextResult, extraResults = []) => {
    const nextHistory = [nextResult, ...extraResults, ...history].slice(0, 16);
    setResult(nextResult);
    setHistory(nextHistory);
    persistHistory(nextHistory);
  };

  const runRouteBenchmark = async () => {
    if (isRunning) return;

    setIsRunning(true);
    setError('');
    setResult(null);
    setRunStatus('Opening page');

    try {
      const nextResult = await measureRouteSpeed();
      saveResults(nextResult);
      setRunStatus('Done');
    } catch (err) {
      console.error('Performance benchmark failed:', err);
      setError(err?.message || 'Could not finish the speed check.');
      setRunStatus('Could not finish');
    } finally {
      setIsRunning(false);
    }
  };

  const runSampleSet = async () => {
    if (isRunning) return;

    setIsRunning(true);
    setError('');
    setResult(null);

    try {
      const samples = [];
      for (let index = 0; index < sampleCount; index += 1) {
        const label = `${index + 1} of ${sampleCount}: `;
        setRunStatus(`${label}Opening page`);
        const sample = await measureRouteSpeed({ statusPrefix: label });
        samples.push(sample);
        if (index < sampleCount - 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 350));
        }
      }

      const nextResult = buildSampleSetResult(samples);
      saveResults(nextResult);
      setRunStatus(`Done: ${sampleCount} checks`);
    } catch (err) {
      console.error('Performance sample set failed:', err);
      setError(err?.message || 'Could not finish the sample set.');
      setRunStatus('Could not finish');
    } finally {
      setIsRunning(false);
    }
  };

  const handleSetBaseline = (run) => {
    setBaselineId(run.id);
    window.localStorage.setItem(BASELINE_KEY, run.id);
  };

  const handleClearHistory = () => {
    setHistory([]);
    setBaselineId('');
    setResult(null);
    window.localStorage.removeItem(HISTORY_KEY);
    window.localStorage.removeItem(BASELINE_KEY);
  };

  const activeRating = result ? getRating(result.score) : null;
  const latestHistory = history.slice(0, 8);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-4 border-b border-slate-800 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-cyan-300">Admin tools</p>
            <h1 className="mt-2 text-3xl font-semibold text-white">App speed check</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              Check whether each page opens smoothly and feels faster after code changes.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/admin/upload">
              <a className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-slate-500 hover:bg-slate-800">
                Admin upload
              </a>
            </Link>
            <Link href="/">
              <a className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-500/20">
                Main app
              </a>
            </Link>
          </div>
        </div>

        {result ? (
          <div className="mb-6 space-y-5">
            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Last check</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {result.targetLabel}
                    {result.isSampleSet ? ` | ${result.runCount} checks` : ''}
                    {' | '}
                    {new Date(result.createdAt).toLocaleTimeString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleSetBaseline(result)}
                  className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-500/20"
                >
                  Save as before
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <MetricTile
                  label="Overall feel"
                  value={result.score}
                  detail={
                    result.isSampleSet
                      ? `avg ${result.scoreAverage || result.score} | ${result.scoreMin}-${result.scoreMax} range`
                      : activeRating?.label
                  }
                  tone={activeRating?.tone}
                />
                <MetricTile
                  label="Smoothness"
                  value={formatMs(result.p95FrameMs)}
                  detail="lower is smoother"
                />
                <MetricTile
                  label="Little pauses"
                  value={formatMs(result.p95LagMs)}
                  detail={`biggest pause ${formatMs(result.maxLagMs)}`}
                />
                <MetricTile
                  label="Freezes"
                  value={result.longTaskCount}
                  detail={`${formatMs(result.totalBlockingMs)} stuck time`}
                  tone={result.longTaskCount > 0 ? 'text-amber-300' : 'text-emerald-300'}
                />
                <MetricTile
                  label="Opens in"
                  value={formatMs(result.loadMs)}
                  detail={result.loadTimedOut ? 'page took too long' : result.targetLabel}
                />
              </div>

              {result.isSampleSet ? (
                <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/70 p-3 text-sm text-slate-300">
                  <p className="font-medium text-white">Sample pool</p>
                  <p className="mt-2 text-xs text-slate-400">
                    Scores from each check: {result.samples.map((sample) => sample.score).join(', ')}.
                    The main result uses the middle score so one weird run does not dominate.
                    Average score: {result.scoreAverage || result.score}.
                  </p>
                </div>
              ) : null}

              {comparison ? (
                <div
                  className={`mt-4 rounded-lg border bg-slate-950/70 p-3 text-sm ${activeRating?.border || 'border-slate-800'}`}
                >
                  <p className="font-medium text-white">Compared with saved check</p>
                  <div className="mt-2 grid gap-2 text-xs text-slate-300 sm:grid-cols-4">
                    <span>feel {formatScoreChange(comparison.score)}</span>
                    <span>smoothness {formatTimeChange(comparison.p95FrameMs)}</span>
                    <span>pauses {formatTimeChange(comparison.p95LagMs)}</span>
                    <span>stuck time {formatTimeChange(comparison.totalBlockingMs)}</span>
                  </div>
                </div>
              ) : baseline && result.targetPath !== baseline.targetPath ? (
                <p className="mt-3 text-xs text-slate-500">
                  Your saved comparison is for {baseline.targetLabel}; choose that page again to compare fairly.
                </p>
              ) : null}
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Previous checks</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Saved in this browser so you can compare before and after code changes.
                  </p>
                </div>
                {history.length > 0 ? (
                  <button
                    type="button"
                    onClick={handleClearHistory}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-slate-300 transition hover:border-rose-500/40 hover:text-rose-200"
                  >
                    Clear saved checks
                  </button>
                ) : null}
              </div>

              {latestHistory.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-800 bg-slate-950/40 p-6 text-center text-sm text-slate-500">
                  No saved checks.
                </div>
              ) : (
                <div className="overflow-hidden rounded-lg border border-slate-800">
                  <div className="max-h-80 overflow-auto">
                    <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
                      <thead className="sticky top-0 bg-slate-950 text-xs uppercase tracking-wider text-slate-500">
                        <tr>
                          <th className="px-3 py-3">When</th>
                          <th className="px-3 py-3">Page</th>
                          <th className="px-3 py-3">Feel</th>
                          <th className="px-3 py-3">Smoothness</th>
                          <th className="px-3 py-3">Pauses</th>
                          <th className="px-3 py-3">Compare</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800 bg-slate-950/40">
                        {latestHistory.map((run) => {
                          const rating = getRating(run.score);

                          return (
                            <tr key={run.id}>
                              <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-400">
                                {new Date(run.createdAt).toLocaleTimeString()}
                              </td>
                              <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-200">
                                {run.targetLabel}
                                {run.isSampleSet ? ` (${run.runCount} checks)` : ''}
                              </td>
                              <td className={`px-3 py-3 font-semibold ${rating.tone}`}>
                                <div>{run.score}</div>
                                {run.isSampleSet ? (
                                  <div className="mt-1 text-[11px] font-normal text-slate-500">
                                    {run.scoreMin}-{run.scoreMax}
                                  </div>
                                ) : null}
                              </td>
                              <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-300">
                                {formatMs(run.p95FrameMs)}
                              </td>
                              <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-300">
                                {formatMs(run.p95LagMs)}
                              </td>
                              <td className="px-3 py-3">
                                {baselineId === run.id ? (
                                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-200">
                                    saved
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleSetBaseline(run)}
                                    className="rounded-full border border-slate-700 px-2 py-1 text-[11px] text-slate-300 transition hover:border-emerald-500/40 hover:text-emerald-200"
                                  >
                                    save
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          </div>
        ) : null}

        <section className="max-w-xl rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="grid gap-4">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Page to check
              </span>
              <select
                value={targetPath}
                onChange={(event) => setTargetPath(event.target.value)}
                disabled={isRunning}
                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white outline-none transition focus:border-cyan-500 disabled:opacity-50"
              >
                {TARGET_ROUTES.map((route) => (
                  <option key={route.path} value={route.path}>
                    {route.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Check length
              </span>
              <select
                value={durationMs}
                onChange={(event) => setDurationMs(Number(event.target.value))}
                disabled={isRunning}
                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white outline-none transition focus:border-cyan-500 disabled:opacity-50"
              >
                {DURATION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Number of checks
              </span>
              <select
                value={sampleCount}
                onChange={(event) => setSampleCount(Number(event.target.value))}
                disabled={isRunning}
                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white outline-none transition focus:border-cyan-500 disabled:opacity-50"
              >
                {SAMPLE_SET_OPTIONS.map((count) => (
                  <option key={count} value={count}>
                    {count} checks
                  </option>
                ))}
              </select>
            </label>

            <p className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs text-slate-400">
              Good base: 5 checks at 5 seconds. Use 10 checks when you want extra confidence.
            </p>

            <button
              type="button"
              onClick={runSampleSet}
              disabled={isRunning}
              className="w-full rounded-lg bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isRunning ? 'Checking...' : 'Check speed'}
            </button>

            <button
              type="button"
              onClick={runRouteBenchmark}
              disabled={isRunning}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-sm font-semibold text-slate-100 transition hover:border-slate-500 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Quick single check
            </button>

            <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm text-slate-300">
              Status: <span className="text-white">{runStatus}</span>
            </div>

            {error ? (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                {error}
              </div>
            ) : null}
          </div>
        </section>

        <iframe
          ref={iframeRef}
          title="Hidden app speed check page"
          aria-hidden="true"
          tabIndex={-1}
          style={{
            position: 'fixed',
            left: '-10000px',
            top: 0,
            width: '390px',
            height: '640px',
            opacity: 0,
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  );
}
