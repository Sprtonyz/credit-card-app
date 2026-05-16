import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/router';
import { db } from '../config/firebase';
import { get, onDisconnect, onValue, ref, remove, set, update } from 'firebase/database';
import { AdminPasswordModal, hasStoredAdminAccess } from './AdminPasswordGate';
import {
  clearSavedSimulatedDay,
  formatLocalDate,
  formatLocalDateTime,
  getSavedSimulatedDay,
  getSimulatedNow,
  SIMULATED_DAY_KEY,
  setSavedSimulatedDay,
} from '../utils/simulationDate';
import { ensureAnonymousAuth } from '../utils/firebaseAuth';
import {
  buildDashboardMetrics,
  formatShortDate,
  normalizeFirebaseTransaction,
} from '../utils/creditCardAppData';
import { buildMacquarieExcessEntryShares, buildMacquarieExcessShares } from '../utils/macquarieExcess';
import {
  getSubmissionDateKeyEntry,
  getOtherUser,
  getSurfacedSubmissionStatus,
  getSurfacedSubmissionValue,
  getGroupedTallyBreakdownEntries,
  getTallyBreakdownEntries,
  groupTallyBreakdownEntries,
} from '../utils/reconciliation';
import { useTransactionAssignments } from '../hooks/useTransactionAssignments';
import {
  applyPetActionProgress,
  getFeedBenefits,
  getMoodLabel,
  derivePetMood,
  getPetLevel,
  getXpForLevel,
  markPetStateUpdated,
  normalizePetState,
  resolvePetType,
} from '../utils/petProgression';
import {
  comparePetProfiles,
  getPetMissionSignature,
  getPetProfileSignature,
  getPetProfilesMapSignature,
  mergePetProfileMaps,
  normalizePetProfilesMap,
} from '../utils/petProfileSync';

const USERS = ['Tony', 'Nugs'];
const ASSIGN_OPTS = ['Unsure', 'Macquarie', 'Tony', 'Nugs'];
const SWIPE_ASSIGNMENTS = {
  left: { value: 'Split', label: 'Split' },
  right: { value: 'Macqbill', label: 'Macqbill' },
};
const SWIPE_TRIGGER_PX = 86;
const SWIPE_MAX_PX = 124;
const SWIPE_INTENT_PX = 8;
const TALLY_UNGROUP_SWIPE_TRIGGER_PX = 68;
const TALLY_UNGROUP_SWIPE_MAX_PX = 104;
const STORAGE_KEY = 'cc_v5_subs';
const USER_KEY = 'cc_v5_user';
const PET_STORAGE_KEY = 'cc_v5_pet_state';
const PRESENCE_ROOT = 'cc_v5_presence';
const PRESENCE_TTL_MS = 12000;
const APP_STATE_ROOT = 'cc_v5_app_state';
const PET_PROFILES_ROOT = `${APP_STATE_ROOT}/petProfiles`;
const SHARED_DAY_OFFSET_KEY = `${APP_STATE_ROOT}/simulatedDayOffset`;
const ASSIGNMENT_COMMENTS_ROOT = `${APP_STATE_ROOT}/assignmentComments`;
const TALLY_UNGROUPS_ROOT = `${APP_STATE_ROOT}/tallyUngroups`;
const USER_ACTIVITY_ROOT = `${APP_STATE_ROOT}/userActivity`;
const LEGACY_PET_ROOT = 'pet';
const LEGACY_FOOD_ROOT = 'food';
const APP_VERSION = '5.7';
const VERSION_KEY = 'cc_version';
const ASSIGNMENT_COMMENT_MAX_LENGTH = 180;
const ASSIGNMENT_NOTE_DRAFTS_KEY = 'cc_v5_assignment_note_drafts';
const TALLY_UNGROUP_UNDO_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;
const COMMENTS_FIREBASE_DELAY_MS = 3500;
const PRESENCE_FIREBASE_DELAY_MS = 6500;
const PET_FIREBASE_DELAY_MS = 12000;
const STARTUP_STORAGE_WRITE_DELAY_MS = 12000;
const NON_CRITICAL_IDLE_TIMEOUT_MS = 6000;
const SPRITE_PET = {
  width: 208,
  height: 229,
  frameDuration: 500,
  frames: ['/sprite/1.png', '/sprite/2.png', '/sprite/3.png'],
};
const DASHBOARD_ASSIGNEES = ['Macquarie', 'Macqbill'];
const EMPTY_RECORD = Object.freeze({});
const EMPTY_DASHBOARD_METRICS = Object.freeze({
  sections: Object.freeze([]),
  anyVisible: false,
  remainingByUser: Object.freeze({}),
  userTallies: Object.freeze({}),
  assigneeTotals: Object.freeze({}),
});

const DEMO_DAYS = {
  '0': [
    { id: 'd0-0', amount: 75.0, desc: 'VELOCITY REWARDS FEE' },
    { id: 'd0-1', amount: 295.0, desc: 'CARD FEE' },
    { id: 'd0-2', amount: 32.21, desc: 'ALIEXPRESS North Sydney' },
    { id: 'd0-3', amount: 18.5, desc: 'UBER EATS Melbourne' },
    { id: 'd0-4', amount: 12.9, desc: 'MCDONALDS Sunshine' },
  ],
  '1': [
    { id: 'd1-0', amount: 1468.0, desc: 'FOREIGN FEE AUD 8.01' },
    { id: 'd1-1', amount: 275.05, desc: 'KICKSTARTER.COM Tsimshatsui' },
    { id: 'd1-2', amount: 54.4, desc: 'SPOTIFY PREMIUM' },
    { id: 'd1-3', amount: 11.0, desc: 'GOOGLE ONE Storage' },
  ],
  '2': [
    { id: 'd2-0', amount: 98.0, desc: 'GU HEALTH REWARDS Camberwell' },
    { id: 'd2-1', amount: 89.5, desc: 'COLES Footscray' },
    { id: 'd2-2', amount: 45.0, desc: 'BUNNINGS Warehouse' },
  ],
  '3': [
    { id: 'd3-0', amount: 210.0, desc: 'ELECTRICITY BILL AGL' },
    { id: 'd3-1', amount: 9.99, desc: 'NETFLIX.COM' },
    { id: 'd3-2', amount: 65.0, desc: 'INTERNET BILL Aussie BB' },
  ],
  '4': [
    { id: 'd4-0', amount: 330.0, desc: 'QANTAS AIRWAYS Sydney' },
    { id: 'd4-1', amount: 42.8, desc: 'SHELL COLES EXPRESS Footscray' },
    { id: 'd4-2', amount: 149.0, desc: 'OFFICEWORKS Footscray' },
  ],
};

const DONE = [
  { emoji: '\u{1F389}', title: 'All done!', sub: 'Every transaction sorted. Legends.' },
  { emoji: '\u{1F3C6}', title: 'Clean sweep!', sub: 'Nothing left to action today.' },
  { emoji: '\u2728', title: "That's everything!", sub: "You're both on top of it." },
  { emoji: '\u{1F680}', title: 'Done and dusted!', sub: 'Go enjoy the rest of your day.' },
];

function getOptionClassName(value) {
  if (value === 'Macquarie') return 'mac-btn';
  if (value === 'Unsure') return 'unsure-btn';
  if (value === 'Tony') return 'tony-btn';
  if (value === 'Nugs') return 'nugs-btn';
  if (value === 'Split') return 'split-btn';
  if (value === 'Macqbill') return 'macqbill-btn';
  return '';
}

function formatAssignmentLabel(value) {
  return value === 'Macquarie' ? 'MAC' : value;
}

function normalizeAssignmentComment(comment) {
  return String(comment || '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, ASSIGNMENT_COMMENT_MAX_LENGTH);
}

function readAssignmentNoteDrafts() {
  if (typeof window === 'undefined') return {};

  try {
    const raw = localStorage.getItem(ASSIGNMENT_NOTE_DRAFTS_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function getAssignmentNoteDraft(txId, user) {
  if (!txId || !user || typeof window === 'undefined') return '';

  const drafts = readAssignmentNoteDrafts();
  return normalizeAssignmentComment(drafts?.[txId]?.[user] || '');
}

function setAssignmentNoteDraft(txId, user, draft) {
  if (!txId || !user || typeof window === 'undefined') return;

  try {
    const normalizedDraft = normalizeAssignmentComment(draft);
    const drafts = readAssignmentNoteDrafts();
    const nextDrafts = { ...drafts };
    const txDrafts = { ...(nextDrafts[txId] || {}) };

    if (normalizedDraft) {
      txDrafts[user] = normalizedDraft;
    } else {
      delete txDrafts[user];
    }

    if (Object.keys(txDrafts).length > 0) {
      nextDrafts[txId] = txDrafts;
    } else {
      delete nextDrafts[txId];
    }

    localStorage.setItem(ASSIGNMENT_NOTE_DRAFTS_KEY, JSON.stringify(nextDrafts));
  } catch {
    // Ignore note draft persistence failures; the Firebase assignment save still works.
  }
}

function getAssignmentCommentEntry(submission, user) {
  const entry = submission?.[user];
  const comment = normalizeAssignmentComment(entry?.comment);
  if (!entry?.value || !comment) return null;

  return {
    user,
    value: entry.value,
    comment,
    dateKey: getSubmissionDateKeyEntry(entry),
    ts: Number(entry?.ts) || 0,
  };
}

function getSharedAssignmentCommentEntry(comments, fallbackSubmission, user) {
  const sharedEntry = comments?.[user];
  const sharedComment = normalizeAssignmentComment(sharedEntry?.comment);

  if (sharedComment) {
    return {
      user,
      value: sharedEntry.value || fallbackSubmission?.[user]?.value,
      comment: sharedComment,
      dateKey: getSubmissionDateKeyEntry(sharedEntry),
      ts: Number(sharedEntry?.ts) || 0,
    };
  }

  return getAssignmentCommentEntry(fallbackSubmission, user);
}

function buildSharedAssignmentCommentPayload({ comment, submission, value, dateKey }) {
  const normalizedComment = normalizeAssignmentComment(comment);
  if (!normalizedComment) return null;

  const payload = {
    comment: normalizedComment,
    ts: Date.now(),
  };
  const assignmentValue = value || submission?.value;
  const assignmentDateKey = dateKey || getSubmissionDateKeyEntry(submission);

  if (assignmentValue) payload.value = assignmentValue;
  if (assignmentDateKey) payload.dateKey = assignmentDateKey;

  return payload;
}

function sanitizeFirebaseKeyPart(value) {
  return String(value || 'unknown').replace(/[.#$\[\]\/]/g, '_');
}

function getTallyUngroupKey(assignee, txId) {
  return `${sanitizeFirebaseKeyPart(assignee)}__${sanitizeFirebaseKeyPart(txId)}`;
}

function getTallyUngroupRecords(ungroups = {}, assignee = null) {
  return Object.entries(ungroups || {})
    .map(([id, record]) => ({
      id,
      ...(record || {}),
    }))
    .filter((record) => {
      if (!record.txId || record.deletedAt) return false;
      if (assignee && record.assignee !== assignee) return false;
      return true;
    });
}

function getUndoableTallyUngroupRecords(ungroups = {}, assignee = null, now = Date.now()) {
  const cutoff = now - TALLY_UNGROUP_UNDO_WINDOW_MS;
  return getTallyUngroupRecords(ungroups, assignee)
    .filter((record) => Number(record.createdAt || 0) >= cutoff)
    .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0));
}

function sortAssignmentCommentEntries(entries) {
  return [...entries].sort((left, right) => {
    const leftTs = Number(left?.ts) || 0;
    const rightTs = Number(right?.ts) || 0;
    if (leftTs !== rightTs) return leftTs - rightTs;
    return USERS.indexOf(left?.user) - USERS.indexOf(right?.user);
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getNextMinuteRefreshDelay(nowMs = Date.now()) {
  return Math.max(1000, 60000 - (nowMs % 60000) + 50);
}

function getNextDateRefreshDelay(now = new Date()) {
  const nextDate = new Date(now);
  nextDate.setHours(24, 0, 1, 0);
  return Math.max(1000, nextDate.getTime() - now.getTime());
}

function useMinuteNow() {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let timer = null;

    const schedule = () => {
      timer = window.setTimeout(() => {
        setNowMs(Date.now());
        schedule();
      }, getNextMinuteRefreshDelay());
    };

    schedule();
    return () => window.clearTimeout(timer);
  }, []);

  return useMemo(() => new Date(nowMs), [nowMs]);
}

function useDateAnchorNow() {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let timer = null;

    const schedule = () => {
      timer = window.setTimeout(() => {
        setNowMs(Date.now());
        schedule();
      }, getNextDateRefreshDelay());
    };

    schedule();
    return () => window.clearTimeout(timer);
  }, []);

  return useMemo(() => new Date(nowMs), [nowMs]);
}

function scheduleIdleTask(callback, timeoutMs = NON_CRITICAL_IDLE_TIMEOUT_MS) {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    const taskId = window.requestIdleCallback(callback, { timeout: timeoutMs });
    return () => window.cancelIdleCallback?.(taskId);
  }

  const timer = window.setTimeout(callback, 0);
  return () => window.clearTimeout(timer);
}

function useIdleDelayedReady(
  enabled,
  delayMs,
  resetToken = '',
  idleTimeoutMs = NON_CRITICAL_IDLE_TIMEOUT_MS
) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setReady(false);
      return undefined;
    }

    setReady(false);
    let cancelled = false;
    let cancelIdleTask = null;

    const timer = window.setTimeout(() => {
      cancelIdleTask = scheduleIdleTask(() => {
        if (!cancelled) setReady(true);
      }, idleTimeoutMs);
    }, delayMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      cancelIdleTask?.();
    };
  }, [delayMs, enabled, idleTimeoutMs, resetToken]);

  return ready;
}

function Landing({ onSelect }) {
  return (
    <div className="landing">
      <div className="landing-card">
        <p className="landing-eyebrow">Credit Card</p>
        <h1 className="landing-title">Who are you?</h1>
        <p className="landing-sub">Select your name to continue</p>
        <p className="who-label">I am...</p>
        {USERS.map((u) => (
          <button key={u} className="user-btn" onClick={() => onSelect(u)}>
            <span className="user-initial">{u[0]}</span>
            {u}
          </button>
        ))}
        <p className="landing-footer">Westpac - Transaction reconciliation</p>
      </div>
    </div>
  );
}

function SwitchOverlay({ currentUser, onSelect, onClose }) {
  return (
    <div className="switch-overlay" onClick={onClose}>
      <div className="switch-card" onClick={(e) => e.stopPropagation()}>
        <p className="switch-title">Switch user</p>
        <p className="switch-sub">Signed in as {currentUser}</p>
        {USERS.map((u) => (
          <button
            key={u}
            className="user-btn"
            style={{ opacity: u === currentUser ? 0.3 : 1 }}
            onClick={() => {
              onSelect(u);
              onClose();
            }}
          >
            <span className="user-initial">{u[0]}</span>
            {u}
          </button>
        ))}
      </div>
    </div>
  );
}

function LiveClockMeta({ day, dayLabel }) {
  const now = useMinuteNow();
  const simulatedNow = useMemo(() => getSimulatedNow(now, day), [now, day]);
  const visibleNowLabel = useMemo(
    () =>
      simulatedNow.toLocaleTimeString('en-AU', {
        hour: 'numeric',
        minute: '2-digit',
      }),
    [simulatedNow]
  );
  const visibleDateLabel = useMemo(
    () =>
      simulatedNow.toLocaleDateString('en-AU', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }),
    [simulatedNow]
  );

  return (
    <div className="top-meta-main">
      <span className="meta-chip">
        <strong>{visibleNowLabel}</strong>
      </span>
      <span className="meta-chip">{visibleDateLabel}</span>
      <span className="meta-chip">Melbourne {dayLabel}</span>
    </div>
  );
}

function DevClockPanel({ day, dayLabel }) {
  const now = useMinuteNow();
  const liveDateTimeLabel = useMemo(() => formatLocalDateTime(getSimulatedNow(now, day)), [now, day]);

  return (
    <div className="clock-panel">
      <span className="day-display">{liveDateTimeLabel}</span>
      <span className="clock-note">Melbourne {dayLabel}</span>
    </div>
  );
}

const ConfettiCanvas = forwardRef(function ConfettiCanvas(_, ref) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const resizeRef = useRef(null);
  const particlesRef = useRef([]);

  useImperativeHandle(ref, () => ({
    launch() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const colors = ['#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#fb923c'];
      const rnd = (a, b) => Math.random() * (b - a) + a;

      const resize = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      };

      const spawn = (count) => {
        for (let i = 0; i < count; i += 1) {
          particlesRef.current.push({
            x: rnd(0.15, 0.85) * canvas.width,
            y: rnd(-60, -5),
            vx: rnd(-3, 3),
            vy: rnd(3, 8),
            rot: rnd(0, Math.PI * 2),
            rv: rnd(-0.12, 0.12),
            w: rnd(7, 14),
            h: rnd(4, 8),
            col: colors[Math.floor(Math.random() * colors.length)],
            a: 1,
          });
        }
      };

      const frame = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particlesRef.current = particlesRef.current.filter((p) => p.a > 0.02);
        particlesRef.current.forEach((p) => {
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.15;
          p.rot += p.rv;
          if (p.y > canvas.height * 0.65) p.a -= 0.022;
          ctx.save();
          ctx.globalAlpha = p.a;
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.col;
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        });

        if (particlesRef.current.length) {
          animRef.current = requestAnimationFrame(frame);
        } else {
          canvas.style.display = 'none';
        }
      };

      resize();
      canvas.style.display = 'block';
      particlesRef.current = [];
      resizeRef.current = resize;
      spawn(100);
      if (animRef.current) cancelAnimationFrame(animRef.current);
      animRef.current = requestAnimationFrame(frame);
      setTimeout(() => spawn(65), 350);
      window.addEventListener('resize', resize);
    },
  }));

  useEffect(
    () => () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      if (resizeRef.current) window.removeEventListener('resize', resizeRef.current);
    },
    []
  );

  return <canvas ref={canvasRef} id="confetti-canvas" style={{ display: 'none' }} />;
});

function AssignmentSwipeActions({ txId, onAssign, children, className = '', contentClassName = '' }) {
  const surfaceRef = useRef(null);
  const startRef = useRef({ x: 0, y: 0 });
  const activeRef = useRef(false);
  const horizontalRef = useRef(false);
  const suppressClickRef = useRef(false);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  const resetSwipe = () => {
    activeRef.current = false;
    horizontalRef.current = false;
    setOffset(0);
    setDragging(false);
  };

  const releasePointerCapture = (event) => {
    const surface = surfaceRef.current;
    if (surface?.hasPointerCapture?.(event.pointerId)) {
      surface.releasePointerCapture(event.pointerId);
    }
  };

  const handlePointerDown = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    activeRef.current = true;
    horizontalRef.current = false;
    suppressClickRef.current = false;
    startRef.current = {
      x: event.clientX,
      y: event.clientY,
    };
    setDragging(true);
  };

  const handlePointerMove = (event) => {
    if (!activeRef.current) return;

    const dx = event.clientX - startRef.current.x;
    const dy = event.clientY - startRef.current.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (!horizontalRef.current) {
      if (absX < SWIPE_INTENT_PX && absY < SWIPE_INTENT_PX) return;

      if (absY > absX) {
        releasePointerCapture(event);
        resetSwipe();
        return;
      }

      horizontalRef.current = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }

    suppressClickRef.current = true;
    setOffset(clamp(dx, -SWIPE_MAX_PX, SWIPE_MAX_PX));
  };

  const handlePointerUp = (event) => {
    if (!activeRef.current) return;

    const dx = event.clientX - startRef.current.x;
    const action =
      horizontalRef.current && dx <= -SWIPE_TRIGGER_PX
        ? SWIPE_ASSIGNMENTS.left
        : horizontalRef.current && dx >= SWIPE_TRIGGER_PX
          ? SWIPE_ASSIGNMENTS.right
          : null;

    releasePointerCapture(event);
    resetSwipe();

    if (action) {
      suppressClickRef.current = true;
      onAssign(txId, action.value, { currentTarget: surfaceRef.current });
    }
  };

  const handlePointerCancel = (event) => {
    releasePointerCapture(event);
    resetSwipe();
  };

  const handleClickCapture = (event) => {
    if (!suppressClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  };

  const commitDirection =
    offset <= -SWIPE_TRIGGER_PX ? 'left' : offset >= SWIPE_TRIGGER_PX ? 'right' : null;

  return (
    <div
      ref={surfaceRef}
      className={`assign-swipe ${className} ${dragging ? 'dragging' : ''} ${
        commitDirection ? `ready-${commitDirection}` : ''
      }`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onClickCapture={handleClickCapture}
    >
      <div className="swipe-action swipe-action-macqbill">
        <span>{SWIPE_ASSIGNMENTS.right.label}</span>
      </div>
      <div className="swipe-action swipe-action-split">
        <span>{SWIPE_ASSIGNMENTS.left.label}</span>
      </div>
      <div
        className={`assign-swipe-content ${contentClassName}`}
        style={{
          transform: `translateX(${offset}px)`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function BreakdownUngroupSwipe({ children, onUngroup }) {
  const surfaceRef = useRef(null);
  const startRef = useRef({ x: 0, y: 0 });
  const activeRef = useRef(false);
  const horizontalRef = useRef(false);
  const suppressClickRef = useRef(false);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  const resetSwipe = () => {
    activeRef.current = false;
    horizontalRef.current = false;
    setOffset(0);
    setDragging(false);
  };

  const releasePointerCapture = (event) => {
    const surface = surfaceRef.current;
    if (surface?.hasPointerCapture?.(event.pointerId)) {
      surface.releasePointerCapture(event.pointerId);
    }
  };

  const handlePointerDown = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    activeRef.current = true;
    horizontalRef.current = false;
    suppressClickRef.current = false;
    startRef.current = {
      x: event.clientX,
      y: event.clientY,
    };
    setDragging(true);
  };

  const handlePointerMove = (event) => {
    if (!activeRef.current) return;

    const dx = event.clientX - startRef.current.x;
    const dy = event.clientY - startRef.current.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (!horizontalRef.current) {
      if (absX < SWIPE_INTENT_PX && absY < SWIPE_INTENT_PX) return;

      if (absY > absX) {
        releasePointerCapture(event);
        resetSwipe();
        return;
      }

      horizontalRef.current = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }

    suppressClickRef.current = true;
    setOffset(clamp(dx, -TALLY_UNGROUP_SWIPE_MAX_PX, 0));
  };

  const handlePointerUp = (event) => {
    if (!activeRef.current) return;

    const dx = event.clientX - startRef.current.x;
    const shouldUngroup = horizontalRef.current && dx <= -TALLY_UNGROUP_SWIPE_TRIGGER_PX;

    releasePointerCapture(event);
    resetSwipe();

    if (shouldUngroup) {
      suppressClickRef.current = true;
      onUngroup?.();
    }
  };

  const handlePointerCancel = (event) => {
    releasePointerCapture(event);
    resetSwipe();
  };

  const handleClickCapture = (event) => {
    if (!suppressClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  };

  const ready = offset <= -TALLY_UNGROUP_SWIPE_TRIGGER_PX;

  return (
    <div
      ref={surfaceRef}
      className={`breakdown-ungroup-swipe ${dragging ? 'dragging' : ''} ${ready ? 'ready' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onClickCapture={handleClickCapture}
    >
      <div className="breakdown-ungroup-action">
        <span>ungroup</span>
      </div>
      <div
        className="breakdown-ungroup-content"
        style={{
          transform: `translateX(${offset}px)`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function AssignmentNotePopover({
  isOpen,
  position,
  commentDraft,
  setCommentDraft,
  normalizedDraft,
  viewEntries,
  viewComment,
  isEditing,
  onEdit,
  onClear,
  onDone,
  onClose,
}) {
  const textareaRef = useRef(null);

  useEffect(() => {
    if (!isOpen || !isEditing) return;
    textareaRef.current?.focus();
  }, [isOpen, isEditing]);

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div className="assignment-note-float-layer" onClick={onClose}>
      <div
        className={`assignment-note-popover ${position?.side === 'left' ? 'side-left' : 'side-right'}`}
        style={{
          left: `${position?.left || 12}px`,
          top: `${position?.top || 80}px`,
          width: `${position?.width || 320}px`,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="assignment-note-popover-arrow" />
        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={commentDraft}
            maxLength={ASSIGNMENT_COMMENT_MAX_LENGTH}
            onChange={(event) => setCommentDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
                return;
              }

              if (event.key !== 'Enter' || event.shiftKey) return;
              event.preventDefault();
              onDone();
            }}
            placeholder="Because this was for..."
            rows={4}
          />
        ) : (
          <button type="button" className="assignment-note-view" onClick={onEdit}>
            {viewEntries.length > 0 ? (
              viewEntries.map((entry) => (
                <span key={`${entry.user}-${entry.ts || entry.comment}`} className="assignment-note-view-entry">
                  <span className="assignment-note-view-eyebrow">
                    {entry.user} {entry.isDraft ? 'drafted' : 'left'} a note
                  </span>
                  <span className="assignment-note-view-body">{entry.comment}</span>
                </span>
              ))
            ) : (
              <span className="assignment-note-view-body">No note yet</span>
            )}
          </button>
        )}
        <div className="assignment-note-footer">
          <span>{(isEditing ? normalizedDraft : viewComment).length}/{ASSIGNMENT_COMMENT_MAX_LENGTH}</span>
          <div className="assignment-note-actions">
            {isEditing ? (
              <button type="button" onClick={onClear}>
                clear
              </button>
            ) : (
              <button type="button" onClick={onEdit}>
                edit
              </button>
            )}
            <button type="button" className="assignment-note-done" onClick={onDone}>
              done
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

const TransactionCard = React.memo(function TransactionCard({
  tx,
  sub,
  comments,
  currentUser,
  referenceDateKey,
  onAssign,
  onSaveComment,
}) {
  const otherUser = getOtherUser(currentUser);
  const mySub = getSurfacedSubmissionValue(sub, currentUser, referenceDateKey);
  const otherSub = getSurfacedSubmissionValue(sub, otherUser, referenceDateKey);
  const { conflict, unsure } = getSurfacedSubmissionStatus(sub, referenceDateKey);
  const isRefund = Boolean(tx.isRefund || Number(tx.amount) < 0);
  const amountClass = isRefund ? 'text-emerald-300' : 'text-white';
  const cardClass = isRefund ? 'refund' : '';
  const [noteOpen, setNoteOpen] = useState(false);
  const [notePosition, setNotePosition] = useState(null);
  const [noteEditing, setNoteEditing] = useState(false);
  const [commentDraft, setCommentDraft] = useState(() => getAssignmentNoteDraft(tx.id, currentUser));
  const noteButtonRef = useRef(null);
  const noteDraftBaselineRef = useRef('');
  const noteDraftTouchedRef = useRef(false);
  const noteDraftHydratingRef = useRef(false);
  const myCommentEntry = getSharedAssignmentCommentEntry(comments, sub, currentUser);
  const otherCommentEntry = getSharedAssignmentCommentEntry(comments, sub, otherUser);
  const normalizedDraft = normalizeAssignmentComment(commentDraft);
  const normalizedSavedComment = normalizeAssignmentComment(myCommentEntry?.comment);
  const savedCommentEntries = sortAssignmentCommentEntries([myCommentEntry, otherCommentEntry].filter(Boolean));
  const draftCommentEntry = normalizedDraft
    ? {
        user: currentUser,
        value: mySub || myCommentEntry?.value,
        comment: normalizedDraft,
        dateKey: referenceDateKey,
        ts: Number.MAX_SAFE_INTEGER,
        isDraft: true,
      }
    : null;
  const viewCommentEntries = draftCommentEntry
    ? sortAssignmentCommentEntries([
        ...savedCommentEntries.filter((entry) => entry.user !== currentUser),
        draftCommentEntry,
      ])
    : savedCommentEntries;
  const viewComment = viewCommentEntries.map((entry) => entry.comment).join('\n');
  const savedCommentCount = savedCommentEntries.length;
  const hasVisibleComment = viewCommentEntries.length > 0;
  const updateCommentDraft = (value) => {
    noteDraftTouchedRef.current = true;
    setCommentDraft(value);
  };

  useEffect(() => {
    noteDraftHydratingRef.current = true;
    setCommentDraft(getAssignmentNoteDraft(tx.id, currentUser));
    noteDraftBaselineRef.current = '';
    noteDraftTouchedRef.current = false;
    setNoteOpen(false);
    setNotePosition(null);
    setNoteEditing(false);
  }, [tx.id, currentUser]);

  useEffect(() => {
    if (noteDraftHydratingRef.current) {
      noteDraftHydratingRef.current = false;
      return;
    }

    setAssignmentNoteDraft(
      tx.id,
      currentUser,
      normalizedDraft && normalizedDraft !== normalizedSavedComment ? normalizedDraft : ''
    );
  }, [tx.id, currentUser, normalizedDraft, normalizedSavedComment]);

  const assignWithComment = (value, event, txId = tx.id) => {
    const baseline = noteDraftBaselineRef.current;
    const hasDraftSession = noteDraftTouchedRef.current || noteOpen || normalizedDraft.length > 0;
    let nextComment;

    if (hasDraftSession) {
      if (baseline && normalizedDraft === baseline) {
        nextComment = undefined;
      } else if (normalizedDraft.length > 0) {
        nextComment = normalizedDraft;
      } else if (baseline) {
        nextComment = null;
      } else {
        nextComment = undefined;
      }
    }

    onAssign(txId, value, event, nextComment);
    setCommentDraft('');
    setAssignmentNoteDraft(txId, currentUser, '');
    setNoteOpen(false);
    setNotePosition(null);
    setNoteEditing(false);
    noteDraftBaselineRef.current = '';
    noteDraftTouchedRef.current = false;
  };

  const toggleNoteEditor = () => {
    if (noteOpen) {
      setNoteOpen(false);
      setNotePosition(null);
      setNoteEditing(false);
      return;
    }

    const persistedDraft = getAssignmentNoteDraft(tx.id, currentUser);
    const initialDraft = normalizeAssignmentComment(commentDraft || persistedDraft || myCommentEntry?.comment || '');

    if (!commentDraft && initialDraft) {
      setCommentDraft(initialDraft);
    }

    noteDraftBaselineRef.current = normalizeAssignmentComment(myCommentEntry?.comment || '');
    noteDraftTouchedRef.current = false;

    const rect = noteButtonRef.current?.getBoundingClientRect();
    const popoverWidth = Math.min(320, window.innerWidth - 24);
    const gap = 10;
    const roomRight = rect ? window.innerWidth - rect.right - 12 : 0;
    const roomLeft = rect ? rect.left - 12 : 0;
    const opensRight = roomRight >= popoverWidth || roomRight >= roomLeft;
    const preferredLeft = rect
      ? opensRight
        ? rect.right + gap
        : rect.left - popoverWidth - gap
      : 12;
    const left = Math.min(Math.max(12, preferredLeft), Math.max(12, window.innerWidth - popoverWidth - 12));
    const top = Math.min(
      Math.max(12, rect ? rect.top - 10 : 80),
      Math.max(12, window.innerHeight - 210)
    );

    setNotePosition({ left, top, width: popoverWidth, side: opensRight ? 'right' : 'left' });
    setNoteEditing(false);
    setNoteOpen(true);
  };

  const closeNoteEditor = () => {
    setNoteOpen(false);
    setNotePosition(null);
    setNoteEditing(false);
  };

  const doneNoteEditor = async () => {
    if (noteEditing || normalizedDraft !== normalizedSavedComment) {
      await onSaveComment(tx.id, currentUser, normalizedDraft, sub[currentUser] || null);
      setAssignmentNoteDraft(tx.id, currentUser, '');
      setCommentDraft('');
      noteDraftBaselineRef.current = '';
      noteDraftTouchedRef.current = false;
    }

    closeNoteEditor();
  };

  const noteEditor = (
    <div className={`assignment-note-panel ${noteOpen ? 'open' : ''}`}>
      <button
        ref={noteButtonRef}
        type="button"
        className={`assignment-note-toggle ${noteOpen || hasVisibleComment ? 'active' : ''}`}
        onClick={toggleNoteEditor}
        aria-expanded={noteOpen}
        aria-label={hasVisibleComment ? 'View assignment note' : 'Add assignment note'}
      >
        {hasVisibleComment ? (
          <>
            note added <span className="assignment-note-badge">{Math.max(1, savedCommentCount)}</span>
          </>
        ) : (
          'note'
        )}
      </button>
    </div>
  );

  return (
    <AssignmentSwipeActions
      txId={tx.id}
      onAssign={(txId, value, event) => assignWithComment(value, event, txId)}
      className="tx-card-swipe"
    >
      <div className={`tx-card ${cardClass} ${conflict ? 'conflict' : unsure ? 'unsure' : ''}`}>
        <div className="tx-top">
          <div>
            <div className="tx-meta">
              {isRefund && !conflict && !unsure && (
                <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                  refund
                </span>
              )}
              {conflict && <span className="badge badge-conflict">! conflict</span>}
              {unsure && !conflict && <span className="badge badge-unsure">? unsure</span>}
            </div>
            <p className="tx-desc">{tx.desc}</p>
            {isRefund && (
              <p className="mt-1 text-xs font-medium uppercase tracking-wider text-emerald-300/80">
                Credit applied
              </p>
            )}
          </div>
          <div className="tx-amount-stack">
            <span className={`tx-amount ${amountClass}`}>
              {isRefund ? 'CR ' : ''}
              ${Math.abs(tx.amount).toFixed(2)}
            </span>
            {noteEditor}
          </div>
        </div>

        {conflict || unsure ? (
          <>
            <p className="my-pick-note">
              {otherUser} picked <span className="my-pick-chip">{formatAssignmentLabel(otherSub) || '--'}</span>
              {mySub ? ` | your pick: ${formatAssignmentLabel(mySub)}` : ' | tap to assign'}
            </p>
            <div className="assignment-action-row conflict-action-row">
              <div className="conflict-row">
                {ASSIGN_OPTS.map((opt) => (
                  <button
                    key={opt}
                    className={`conflict-tap-btn ${getOptionClassName(opt)}`}
                    onClick={(event) => assignWithComment(opt, event)}
                  >
                    {formatAssignmentLabel(opt)}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="assignment-action-row">
              <div className="assign-row">
                <span className="assign-label">assign</span>
                <div className="assign-options">
                  {ASSIGN_OPTS.map((opt) => (
                    <button
                      key={opt}
                      className={`tap-btn ${getOptionClassName(opt)}`}
                      onClick={(event) => assignWithComment(opt, event)}
                    >
                      {formatAssignmentLabel(opt)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
      <AssignmentNotePopover
        isOpen={noteOpen}
        position={notePosition}
        commentDraft={commentDraft}
        setCommentDraft={updateCommentDraft}
        normalizedDraft={normalizedDraft}
        viewEntries={viewCommentEntries}
        viewComment={viewComment}
        isEditing={noteEditing}
        onEdit={() => setNoteEditing(true)}
        onClear={() => {
          updateCommentDraft('');
          setAssignmentNoteDraft(tx.id, currentUser, '');
          setNoteEditing(true);
        }}
        onDone={doneNoteEditor}
        onClose={closeNoteEditor}
      />
    </AssignmentSwipeActions>
  );
});

const PetBar = React.memo(function PetBar({
  hp,
  coins,
  food,
  level,
  xp,
  xpNeeded,
  streak,
  mood,
  missions,
  showMissions,
  onToggleMissions,
  onBuyFood,
  onFeedPet,
  petType,
  petFooterHeight,
  petScalePct,
  spriteMetrics,
}) {
  const completedMissions = missions.filter(
    (mission) => Number(mission?.target || 0) > 0 && Number(mission?.progress || 0) >= Number(mission?.target || 0)
  ).length;
  const shopBottom = `${petFooterHeight}px`;
  const missionsBottom = `${petFooterHeight + 48}px`;
  return (
    <>
      <div className="shop-bar" style={{ bottom: shopBottom }}>
        <span className="shop-coins"><span className="coin-inline" aria-hidden="true" /> {coins}</span>
        <span className="shop-food">{'\u{1F356}'} x{food}</span>
        <div className="shop-divider-v" />
        <div className="shop-hp-wrap">
          <span className="shop-hp-label">hp</span>
          <div className="shop-hp-bar">
            <div
              className="shop-hp-fill"
              style={{ width: `${hp}%`, background: hp > 60 ? '#4ade80' : hp > 30 ? '#fbbf24' : '#f87171' }}
            />
          </div>
          <span className="shop-hp-val">{hp}</span>
        </div>
        <span className={`pet-chip pet-mood mood-${mood}`}>mood: {getMoodLabel(mood)}</span>
        <div className="shop-divider-v" />
        <button className="shop-btn buy" disabled={coins < 1} onClick={onBuyFood}>
          buy food 1 <span className="coin-inline" aria-hidden="true" />
        </button>
        <button className="shop-btn feed" disabled={food < 1} onClick={onFeedPet}>
          feed {'\u{1F356}'}
        </button>
        <div className="shop-divider-v" />
        <span className="pet-level">
          Lv.{level} - {xp}/{xpNeeded} xp
        </span>
        <span className={`pet-chip pet-streak ${streak > 0 ? 'is-hot' : ''}`}>streak {streak}</span>
        <button className="pet-chip pet-quests-btn" onClick={onToggleMissions}>
          quests {completedMissions}/{missions.length}
        </button>
      </div>
      {showMissions && (
        <div className="pet-missions-panel" style={{ bottom: missionsBottom }}>
          <div className="pet-missions-head">
            <div>
              <div className="pet-missions-title">daily missions</div>
              <div className="pet-missions-sub">small bonuses that keep the loop warm</div>
            </div>
            <button className="pet-missions-close" onClick={onToggleMissions}>
              hide
            </button>
          </div>
          <div className="pet-missions-list">
            {missions.map((mission) => {
              const progress = mission.target > 0 ? Math.round((mission.progress / mission.target) * 100) : 0;
              const isComplete =
                Number(mission?.target || 0) > 0 && Number(mission?.progress || 0) >= Number(mission?.target || 0);
              return (
                <div key={mission.id} className={`pet-mission ${isComplete ? 'done' : ''}`}>
                  <div className="pet-mission-top">
                    <span className="pet-mission-title">{mission.title}</span>
                    <span className="pet-mission-progress">
                      {mission.progress}/{mission.target}
                    </span>
                  </div>
                  <div className="pet-mission-bar">
                    <div className="pet-mission-fill" style={{ width: `${progress}%` }} />
                  </div>
                  <div className="pet-mission-reward">
                    reward {mission.reward.coins ? `+${mission.reward.coins} coins` : ''}
                    {mission.reward.food ? ` +${mission.reward.food} food` : ''}
                    {mission.reward.xp ? ` +${mission.reward.xp} xp` : ''}
                    {isComplete ? ' done' : ''}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="pet-footer" style={{ height: `${petFooterHeight}px` }}>
        <PetCanvas petType={petType} scalePercent={petScalePct} spriteMetrics={spriteMetrics} />
      </div>
    </>
  );
});

const PET_THEMES = {
  classic: {
    line: '#f4b544',
    fill: 'rgba(244,181,68,0.18)',
    glow: 'rgba(251,191,36,0.24)',
    eye: '#fff7d6',
    trail: 'rgba(245,158,11,0.1)',
  },
  shiny: {
    line: '#7dd3fc',
    fill: 'rgba(56,189,248,0.14)',
    glow: 'rgba(125,211,252,0.24)',
    eye: '#eff6ff',
    trail: 'rgba(56,189,248,0.08)',
  },
  ember: {
    line: '#fb923c',
    fill: 'rgba(251,146,60,0.16)',
    glow: 'rgba(249,115,22,0.24)',
    eye: '#fff1e6',
    trail: 'rgba(249,115,22,0.08)',
  },
};

const PET_VARIANTS = {
  classic: {
    body: { x: 31, y: 22, rx: 18, ry: 11, tilt: -0.08 },
    head: { x: 31, y: 18, w: 28, h: 25 },
    ears: [
      [[24, 8], [21, -1], [29, 6]],
      [[35, 7], [39, -3], [41, 9]],
    ],
    tail: [[45, 22], [57, 12], [54, 3], [50, -2], [46, 4]],
    eyes: [[27.5, 16.5, 1.7, 2.2], [34.5, 16, 1.6, 2.1]],
    mouth: [[24, 22], [30, 25.5], [36, 22.5]],
    legs: [[22, 31], [28, 31], [35, 30.5], [40, 29.5]],
    feetY: [39, 39, 39, 38.5],
    accent: (ctx, theme) => {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(22, 20);
      ctx.quadraticCurveTo(31, 12, 39, 18);
      ctx.stroke();
      ctx.restore();
    },
  },
  shiny: {
    body: { x: 33, y: 23, rx: 16, ry: 10, tilt: -0.14 },
    head: { x: 28, y: 18, w: 24, h: 23 },
    ears: [
      [[21, 10], [18, -8], [24, 7]],
      [[30, 8], [29, -10], [34, 7]],
    ],
    tail: [[47, 19], [58, 15], [61, 7], [58, 1], [50, 3]],
    eyes: [[24.5, 16.2, 1.4, 2.4], [30.5, 15.8, 1.3, 2.3]],
    mouth: [[22, 22], [27, 24.5], [31, 22]],
    legs: [[26, 31], [31, 31], [37, 30.5], [41, 29.5]],
    feetY: [39, 39, 39, 38.5],
    accent: (ctx, theme, tick) => {
      const finLift = Math.sin(tick / 18) * 2;
      ctx.save();
      ctx.strokeStyle = theme.line;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(34, 12);
      ctx.quadraticCurveTo(41, 8 - finLift, 45, 14);
      ctx.stroke();
      ctx.restore();
    },
  },
  ember: {
    body: { x: 31, y: 23, rx: 19, ry: 10, tilt: -0.02 },
    head: { x: 33, y: 18, w: 26, h: 22 },
    ears: [
      [[27, 10], [26, 0], [32, 8]],
      [[36, 9], [42, 2], [41, 11]],
    ],
    tail: [[48, 23], [61, 17], [64, 8], [59, 3], [51, 7]],
    eyes: [[30, 16.5, 1.7, 1.8], [36.5, 16.2, 1.6, 1.7]],
    mouth: [[29, 22], [34, 23.8], [39, 21.6]],
    legs: [[21, 31.5], [27, 31.2], [37, 31], [43, 30]],
    feetY: [39.5, 39, 39, 38.5],
    accent: (ctx, theme, tick) => {
      const flame = Math.sin(tick / 9) * 1.5;
      ctx.save();
      ctx.fillStyle = theme.glow;
      ctx.beginPath();
      ctx.moveTo(58, 7);
      ctx.quadraticCurveTo(63, 0 - flame, 60, -4 - flame);
      ctx.quadraticCurveTo(66, 0, 64, 5 - flame * 0.4);
      ctx.quadraticCurveTo(62, 11, 58, 7);
      ctx.fill();
      ctx.restore();
    },
  },
};

function getSpriteMetrics(scalePercent) {
  const clamped = Math.max(10, Math.min(100, Number(scalePercent) || 25));
  const ratio = clamped / 100;
  const drawWidth = Math.max(1, Math.round(SPRITE_PET.width * ratio));
  const drawHeight = Math.max(1, Math.round(SPRITE_PET.height * ratio));
  return {
    scalePercent: clamped,
    drawWidth,
    drawHeight,
    canvasHeight: Math.max(54, drawHeight + 14),
    floorY: drawHeight + 5,
  };
}

const spriteImageCache = new Map();

function getSpriteFrame(src) {
  if (!spriteImageCache.has(src)) {
    const img = new Image();
    const entry = { img, loaded: false, failed: false };
    img.onload = () => {
      entry.loaded = true;
    };
    img.onerror = () => {
      entry.failed = true;
    };
    img.src = src;
    spriteImageCache.set(src, entry);
  }
  return spriteImageCache.get(src);
}

function PetCanvas({ petType = 'classic', scalePercent = 25, spriteMetrics }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    let raf = 0;
    let x = 20;
    let dir = 1;
    let tick = 0;
    let frameIndex = 0;
    let frameElapsed = 0;
    let lastTs = 0;

    const resize = () => {
      canvas.width = canvas.parentElement?.clientWidth || window.innerWidth;
      canvas.height = petType === 'classic' ? spriteMetrics.canvasHeight : 54;
    };

    const roundedPath = (pathFactory, fill, stroke, blur = 0) => {
      ctx.save();
      if (blur) {
        ctx.shadowBlur = blur;
        ctx.shadowColor = stroke;
      }
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.6;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      pathFactory();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };

    const drawCompanion = (left, baseline, facingLeft, theme, variant) => {
      const bob = Math.sin(tick / 10) * 1.4;
      const tailSwing = Math.sin(tick / 12) * 4;
      const headNod = Math.sin(tick / 14) * 1.2;
      const legOffset = Math.sin(tick / 7) * 1.5;

      ctx.save();
      if (facingLeft) {
        ctx.translate(left + 68, 0);
        ctx.scale(-1, 1);
        ctx.translate(-left, 0);
      }

      ctx.translate(left, baseline + bob);

      roundedPath(() => {
        ctx.beginPath();
        ctx.ellipse(variant.body.x, variant.body.y, variant.body.rx, variant.body.ry, variant.body.tilt, 0, Math.PI * 2);
      }, theme.fill, theme.line, 14);

      roundedPath(() => {
        const halfW = variant.head.w / 2;
        const halfH = variant.head.h / 2;
        ctx.beginPath();
        ctx.moveTo(variant.head.x - halfW * 0.65, variant.head.y - halfH * 0.3);
        ctx.quadraticCurveTo(variant.head.x - halfW, variant.head.y - halfH, variant.head.x, variant.head.y - halfH);
        ctx.quadraticCurveTo(variant.head.x + halfW, variant.head.y - halfH, variant.head.x + halfW * 0.9, variant.head.y);
        ctx.quadraticCurveTo(variant.head.x + halfW * 0.9, variant.head.y + halfH, variant.head.x, variant.head.y + halfH);
        ctx.quadraticCurveTo(variant.head.x - halfW, variant.head.y + halfH, variant.head.x - halfW * 1.02, variant.head.y + 2);
        ctx.quadraticCurveTo(
          variant.head.x - halfW * 1.08,
          variant.head.y - halfH * 0.2,
          variant.head.x - halfW * 0.65,
          variant.head.y - halfH * 0.3
        );
      }, theme.fill, theme.line, 16);

      variant.ears.forEach((points) => {
        roundedPath(() => {
          ctx.beginPath();
          ctx.moveTo(points[0][0], points[0][1]);
          ctx.lineTo(points[1][0], points[1][1]);
          ctx.lineTo(points[2][0], points[2][1]);
          ctx.closePath();
        }, theme.fill, theme.line);
      });

      ctx.save();
      ctx.strokeStyle = theme.line;
      ctx.lineWidth = 1.7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(variant.tail[0][0], variant.tail[0][1]);
      ctx.quadraticCurveTo(
        variant.tail[1][0],
        variant.tail[1][1] + tailSwing * 0.25,
        variant.tail[2][0],
        variant.tail[2][1] + tailSwing
      );
      ctx.quadraticCurveTo(
        variant.tail[3][0],
        variant.tail[3][1] + tailSwing * 0.35,
        variant.tail[4][0],
        variant.tail[4][1] + tailSwing * 0.2
      );
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.fillStyle = theme.eye;
      ctx.shadowBlur = 10;
      ctx.shadowColor = theme.eye;
      ctx.beginPath();
      variant.eyes.forEach(([x, y, rx, ry]) => {
        ctx.ellipse(x, y + headNod * 0.15, rx, ry, 0, 0, Math.PI * 2);
      });
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(variant.mouth[0][0], variant.mouth[0][1]);
      ctx.quadraticCurveTo(variant.mouth[1][0], variant.mouth[1][1], variant.mouth[2][0], variant.mouth[2][1]);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = theme.line;
      ctx.lineWidth = 1.8;
      ctx.lineCap = 'round';
      variant.legs.forEach(([x1, y1], index) => {
        const swing = index % 2 === 0 ? -legOffset : legOffset;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 + swing, variant.feetY[index]);
        ctx.stroke();
      });
      ctx.restore();

      variant.accent?.(ctx, theme, tick);

      ctx.restore();
    };

    const draw = (now = 0) => {
      const delta = lastTs ? Math.min(50, now - lastTs) : 16;
      lastTs = now;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
      bg.addColorStop(0, 'rgba(255,255,255,0.015)');
      bg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (petType === 'classic') {
        SPRITE_PET.frames.forEach(getSpriteFrame);
        const spriteWidth = spriteMetrics.drawWidth;
        const spriteHeight = spriteMetrics.drawHeight;
        const floorY = spriteMetrics.floorY;
        const shadowWidth = Math.max(20, Math.round(spriteWidth * 0.42));
        const shadowY = floorY + 2;
        const maxX = Math.max(6, canvas.width - spriteWidth - 6);
        x = Math.max(6, Math.min(maxX, x + dir * 24 * delta / 1000));
        if (x >= maxX) dir = -1;
        if (x <= 6) dir = 1;
        frameElapsed += delta;
        if (frameElapsed >= SPRITE_PET.frameDuration) {
          frameIndex = (frameIndex + 1) % SPRITE_PET.frames.length;
          frameElapsed = 0;
        }
        const spriteX = Math.round(Math.max(6, Math.min(maxX, x)));
        const shadowX = Math.round(spriteX + spriteWidth / 2);
        const facingLeft = dir < 0;
        const frame = getSpriteFrame(SPRITE_PET.frames[frameIndex]);

        ctx.fillStyle = 'rgba(96,165,250,0.06)';
        ctx.beginPath();
        ctx.ellipse(spriteX + spriteWidth / 2, floorY - 10, spriteWidth * 0.68, 12, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(0, floorY, canvas.width, 1);
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.beginPath();
        ctx.ellipse(shadowX, shadowY, shadowWidth / 2, 3, 0, 0, Math.PI * 2);
        ctx.fill();

        if (frame?.loaded) {
          ctx.save();
          if (facingLeft) {
            ctx.translate(spriteX + spriteWidth, 5);
            ctx.scale(-1, 1);
          } else {
            ctx.translate(spriteX, 5);
          }
          ctx.drawImage(frame.img, 0, 0, spriteWidth, spriteHeight);
          ctx.restore();
        }
      } else {
        const variantKey = petType === 'shiny' ? 'shiny' : 'ember';
        const theme = PET_THEMES[variantKey];
        const variant = PET_VARIANTS[variantKey];
        const spriteWidth = 68;
        const floorY = 45;
        const shadowWidth = 22;
        const shadowY = floorY + 2;
        const spriteX = Math.max(6, Math.min(canvas.width - spriteWidth - 6, x));
        const shadowX = Math.round(spriteX + spriteWidth / 2 - shadowWidth / 2);
        const facingLeft = dir < 0;

        ctx.fillStyle = theme.trail;
        ctx.beginPath();
        ctx.ellipse(spriteX + 34, floorY - 6, 42, 10, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(0, floorY, canvas.width, 1);
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.beginPath();
        ctx.ellipse(shadowX, shadowY, shadowWidth / 2, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.beginPath();
        ctx.ellipse(shadowX, shadowY - 1, shadowWidth / 3, 1.4, 0, 0, Math.PI * 2);
        ctx.fill();

        x += dir * 0.5;
        if (x > canvas.width - spriteWidth - 6) dir = -1;
        if (x < 6) dir = 1;
        tick += 1;

        drawCompanion(Math.round(spriteX), floorY - 39, facingLeft, theme, variant);
      }

      raf = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener('resize', resize);
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [petType, scalePercent, spriteMetrics]);

  return <canvas ref={ref} />;
}

const TxGroup = React.memo(function TxGroup({
  title,
  date,
  dayKey,
  txs,
  submissions,
  assignmentComments,
  currentUser,
  referenceDateKey,
  onAssign,
  onSaveComment,
}) {
  const isPending = title === 'Pending';

  return (
    <div className="day-group">
      <div className="day-group-header">
        {isPending && <span className="attention-dot" />}
        <span className={`day-label-pill ${isPending ? 'past' : 'today'}`}>{title}</span>
        {isPending && <span className="attention-tag">attention</span>}
        <div className={`day-line ${isPending ? 'past' : ''}`} />
      </div>
      {txs.map((tx) => (
        <TransactionCard
          key={tx.id}
          tx={tx}
          sub={submissions[tx.id] || EMPTY_RECORD}
          comments={assignmentComments[tx.id] || EMPTY_RECORD}
          currentUser={currentUser}
          referenceDateKey={referenceDateKey}
          onAssign={onAssign}
          onSaveComment={onSaveComment}
        />
      ))}
    </div>
  );
});

function AllDone({ msg }) {
  return (
    <div className="all-done">
      <div className="all-done-inner">
        <span className="all-done-emoji">{msg.emoji}</span>
        <h2 className="all-done-title">{msg.title}</h2>
        <p className="all-done-sub">{msg.sub}</p>
        <span className="all-done-badge">{'\u{1F4B3}'} all transactions assigned</span>
      </div>
    </div>
  );
}

function formatBreakdownAmount(amount) {
  const value = Number(amount || 0);
  return `${value < 0 ? '-$' : '$'}${Math.abs(value).toFixed(2)}`;
}

function getBreakdownDateLabel(item) {
  return formatShortDate(item.date || item.uploadedDay || '') || 'Pending';
}

function getBreakdownGroupMeta(group) {
  const states = [...new Set(group.items.map((item) => item.assignmentState).filter(Boolean))];
  const dates = [...new Set(group.items.map(getBreakdownDateLabel).filter(Boolean))];

  return {
    state: states.length === 1 ? states[0] : 'Mixed',
    date: dates.length === 1 ? dates[0] : `${dates.length} dates`,
  };
}

function TallyBreakdownModal({
  assignee,
  total,
  groups = [],
  macquarieExcessGroups = [],
  macquarieExcessTotal = 0,
  undoableUngroups = [],
  onUngroupItem,
  onUndoUngroup,
  onClose,
}) {
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  const transactionCount = groups.reduce((sum, group) => sum + group.items.length, 0);
  const macquarieTransactionCount = macquarieExcessGroups.reduce((sum, group) => sum + group.items.length, 0);
  const hasMacquarieExcessGroups = macquarieExcessGroups.length > 0 && macquarieExcessTotal > 0;
  const latestUngroup = undoableUngroups[0] || null;

  const toggleGroup = (groupKey) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  };

  const renderGroup = (group, { section = 'own', allowUngroup = false } = {}) => {
    const groupStateKey = `${section}:${group.key}`;
    const expandable = group.items.length > 1;
    const expanded = expandedGroups.has(groupStateKey);
    const meta = getBreakdownGroupMeta(group);

    return (
      <div
        key={groupStateKey}
        className={`breakdown-group ${expanded ? 'expanded' : ''} ${
          section === 'macquarie' ? 'macquarie' : ''
        }`}
      >
        <button
          type="button"
          className={`breakdown-row breakdown-group-row ${expandable ? 'expandable' : ''}`}
          onClick={() => {
            if (expandable) toggleGroup(groupStateKey);
          }}
          aria-expanded={expandable ? expanded : undefined}
        >
          <div className="breakdown-copy">
            <div className="breakdown-merchant-line">
              {expandable && (
                <span className="breakdown-chevron" aria-hidden="true">
                  {expanded ? '−' : '+'}
                </span>
              )}
              <span className="breakdown-merchant">{group.desc}</span>
            </div>
            <div className="breakdown-meta">
              <span>
                {group.items.length} transaction{group.items.length === 1 ? '' : 's'}
              </span>
              <span>{meta.state}</span>
              <span>{meta.date}</span>
            </div>
          </div>
          <div className={`breakdown-amount ${group.countedAmount < 0 ? 'refund' : ''}`}>
            {formatBreakdownAmount(group.countedAmount)}
          </div>
        </button>

        {expandable && expanded && (
          <div className="breakdown-children">
            {group.items.map((item) => {
              const childRow = (
                <div className="breakdown-child-row">
                  <div className="breakdown-copy">
                    <div className="breakdown-child-merchant">{item.desc}</div>
                    <div className="breakdown-meta">
                      <span>{item.assignmentState}</span>
                      <span>{getBreakdownDateLabel(item)}</span>
                    </div>
                  </div>
                  <div
                    className={`breakdown-child-amount ${
                      (item.countedAmount ?? item.amount) < 0 ? 'refund' : ''
                    }`}
                  >
                    {formatBreakdownAmount(item.countedAmount ?? item.amount)}
                  </div>
                </div>
              );

              return allowUngroup ? (
                <BreakdownUngroupSwipe
                  key={item.id}
                  onUngroup={() => onUngroupItem?.({ assignee, group, item })}
                >
                  {childRow}
                </BreakdownUngroupSwipe>
              ) : (
                <div key={item.id} className="breakdown-child-wrap">
                  {childRow}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="breakdown-overlay" onClick={onClose}>
      <div className="breakdown-modal" onClick={(event) => event.stopPropagation()}>
        <div className="breakdown-header">
          <div>
            <p className="breakdown-eyebrow">{assignee} assignment total</p>
            <h3 className="breakdown-title">${total.toFixed(2)}</h3>
            <p className="breakdown-sub">
              {transactionCount} own transaction{transactionCount === 1 ? '' : 's'} across {groups.length} group
              {groups.length === 1 ? '' : 's'}
              {hasMacquarieExcessGroups
                ? ` + ${macquarieTransactionCount} Macquarie excess item${macquarieTransactionCount === 1 ? '' : 's'}`
                : ''}
            </p>
          </div>
          <div className="breakdown-header-actions">
            {latestUngroup && (
              <button
                type="button"
                className="breakdown-undo"
                onClick={() => onUndoUngroup?.(latestUngroup)}
                aria-label={`Undo ungroup for ${latestUngroup.itemDesc || 'transaction'}`}
                title={`Undo ${latestUngroup.itemDesc || 'latest ungroup'}`}
              >
                {'\u21B6'}
              </button>
            )}
            <button className="breakdown-close" onClick={onClose} aria-label="Close breakdown">
              ×
            </button>
          </div>
        </div>

        {groups.length || hasMacquarieExcessGroups ? (
          <div className="breakdown-list">
            {groups.map((group) => renderGroup(group, { section: 'own', allowUngroup: true }))}
            {hasMacquarieExcessGroups && (
              <div className="breakdown-section-separator">
                <span>Macquarie excess share</span>
                <strong>{formatBreakdownAmount(macquarieExcessTotal)}</strong>
              </div>
            )}
            {hasMacquarieExcessGroups &&
              macquarieExcessGroups.map((group) => renderGroup(group, { section: 'macquarie' }))}
          </div>
        ) : (
          <div className="breakdown-empty">
            No counted transactions for {assignee.toLowerCase()} right now.
          </div>
        )}
      </div>
    </div>
  );
}

function OcrDiagnostics({ processedImages }) {
  if (!processedImages || processedImages.length === 0) return null;

  return (
    <div className="ocr-diagnostics">
      <h3 className="ocr-diagnostics-title">OCR Diagnostics</h3>
      <p className="ocr-diagnostics-sub">
        This shows exactly what Tesseract extracted before anything is written to Firebase.
      </p>
      <div className="ocr-diagnostics-list">
        {processedImages.map((image) => (
          <details key={image.imageHash || image.fileName} className="ocr-diagnostics-item">
            <summary>
              <span>{image.fileName}</span>
              <span>
                {image.error
                  ? 'error'
                  : `${image.originalCount || 0} tx - ${image.transactions?.length || 0} parsed`}
              </span>
            </summary>
            {image.error ? (
              <p className="ocr-diagnostics-error">{image.error}</p>
            ) : (
              <>
                <div className="ocr-diagnostics-meta">
                  <span>Hash: {image.imageHash || 'n/a'}</span>
                  <span>OCR mode: {image.ocrMode || 'balanced'}</span>
                  <span>Preview of raw OCR:</span>
                </div>
                <pre className="ocr-diagnostics-text">
                  {image.extractedText || 'No OCR text extracted.'}
                </pre>
                <div className="ocr-diagnostics-meta">
                  <span>Parsed transactions:</span>
                </div>
                <ul className="ocr-diagnostics-txs">
                  {(image.transactions || []).map((tx, idx) => (
                    <li key={`${image.fileName}-${idx}`}>
                      {tx.merchant} - ${Number(tx.amount || 0).toFixed(2)}
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

export default function CreditCardApp() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState(() => {
    if (typeof window === 'undefined') return null;
    const searchParams = new URLSearchParams(window.location.search);
    const forceLanding = searchParams.get('landing') === '1' || searchParams.get('reset') === '1';
    if (forceLanding) return null;
    return localStorage.getItem(USER_KEY);
  });
  const [submissions, setSubmissions] = useState({});
  const [assignmentComments, setAssignmentComments] = useState({});
  const [tallyUngroups, setTallyUngroups] = useState({});
  const [showSwitch, setShowSwitch] = useState(false);
  const [showMac, setShowMac] = useState(false);
  const [showPetDebug, setShowPetDebug] = useState(false);
  const [showPetMissions, setShowPetMissions] = useState(false);
  const [showDevTools, setShowDevTools] = useState(false);
  const [adminGateRequest, setAdminGateRequest] = useState(null);
  const [petScalePct, setPetScalePct] = useState(25);
  const [petProfiles, setPetProfiles] = useState({});
  const [petProfilesHydrated, setPetProfilesHydrated] = useState(false);
  const [petProfilesRemoteReady, setPetProfilesRemoteReady] = useState(false);
  const [coinPops, setCoinPops] = useState([]);
  const [levelUpMsg, setLevelUpMsg] = useState(null);
  const [day, setDay] = useState(() => getSavedSimulatedDay());
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState({});
  const [firebaseTransactions, setFirebaseTransactions] = useState(null);
  const [breakdownUser, setBreakdownUser] = useState(null);
  const [questDebugLog, setQuestDebugLog] = useState([]);
  const [submissionsHydrated, setSubmissionsHydrated] = useState(false);
  const doneMsg = useRef(DONE[Math.floor(Math.random() * DONE.length)]);
  const confettiRef = useRef(null);
  const confettiFiredRef = useRef(false);
  const presenceTabIdRef = useRef(null);
  const prevPetLevelRef = useRef(1);
  const petLevelReadyRef = useRef(false);
  const lastQuestSnapshotRef = useRef('');
  const localPetProfilesRef = useRef({});
  const remotePetProfilesRef = useRef({});
  const petProfilesRemoteReadyRef = useRef(false);
  const petBootstrapCompleteRef = useRef(false);
  const lastStoredSubmissionsRef = useRef(null);
  const lastStoredPetProfilesRef = useRef(null);
  const commentsFirebaseReady = useIdleDelayedReady(
    authReady && Boolean(currentUser),
    COMMENTS_FIREBASE_DELAY_MS,
    currentUser || ''
  );
  const presenceFirebaseReady = useIdleDelayedReady(
    authReady && Boolean(currentUser),
    PRESENCE_FIREBASE_DELAY_MS,
    currentUser || ''
  );
  const petFirebaseReady = useIdleDelayedReady(
    authReady && Boolean(currentUser),
    PET_FIREBASE_DELAY_MS,
    currentUser || ''
  );
  const submissionsStorageWriteReady = useIdleDelayedReady(
    submissionsHydrated,
    STARTUP_STORAGE_WRITE_DELAY_MS,
    currentUser || ''
  );
  const petStorageWriteReady = useIdleDelayedReady(
    petProfilesHydrated,
    STARTUP_STORAGE_WRITE_DELAY_MS,
    currentUser || ''
  );

  const commitPetProfiles = useCallback((updater) => {
    setPetProfiles((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      localPetProfilesRef.current = next;
      return next;
    });
  }, []);

  const requestProtectedAdminAction = (request) => {
    if (hasStoredAdminAccess()) {
      request.action?.();
      return;
    }

    setAdminGateRequest(request);
  };

  const handleAdminGateAuthorized = () => {
    const action = adminGateRequest?.action;
    setAdminGateRequest(null);
    action?.();
  };

  const handleToolsToggle = () => {
    if (showDevTools) {
      setShowDevTools(false);
      return;
    }

    requestProtectedAdminAction({
      title: 'Tools locked',
      description: 'Enter the admin tools password to open debug controls.',
      action: () => setShowDevTools(true),
    });
  };

  const handleUploadClick = () => {
    requestProtectedAdminAction({
      title: 'Upload locked',
      description: 'Enter the admin tools password to upload and manage imported transactions.',
      action: () => router.push('/admin/upload'),
    });
  };

  const appendQuestDebugLog = useCallback((label, details = {}) => {
    const timestamp = new Date().toISOString();
    const entry = `${timestamp} | ${label} | ${JSON.stringify(details)}`;
    setQuestDebugLog((prev) => [...prev.slice(-79), entry]);
  }, []);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const forceLanding = searchParams.get('landing') === '1' || searchParams.get('reset') === '1';

    if (localStorage.getItem(VERSION_KEY) !== APP_VERSION) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(USER_KEY);
      localStorage.setItem(VERSION_KEY, APP_VERSION);
    }

    if (forceLanding) {
      localStorage.removeItem(USER_KEY);
      setCurrentUser(null);
      return;
    }

    const savedUser = localStorage.getItem(USER_KEY);
    const savedSubs = localStorage.getItem(STORAGE_KEY);
    if (!forceLanding && savedUser) setCurrentUser(savedUser);
    if (savedSubs) {
      try {
        lastStoredSubmissionsRef.current = savedSubs;
        setSubmissions(JSON.parse(savedSubs));
      } catch {
        setSubmissions({});
      }
    }
    setSubmissionsHydrated(true);
  }, []);

  useEffect(() => {
    if (!submissionsHydrated || !submissionsStorageWriteReady) return;

    try {
      const serialized = JSON.stringify(submissions);
      if (serialized === lastStoredSubmissionsRef.current) return;
      localStorage.setItem(STORAGE_KEY, serialized);
      lastStoredSubmissionsRef.current = serialized;
    } catch (error) {
      console.warn('Failed to persist submissions to localStorage:', error);
    }
  }, [submissions, submissionsHydrated, submissionsStorageWriteReady]);

  useEffect(() => {
    setSavedSimulatedDay(day);
  }, [day]);

  useEffect(() => ensureAnonymousAuth({
    onReady: (user) => {
      setFirebaseUser(user);
      setAuthReady(true);
    },
    onError: (error) => {
      console.error('Anonymous Firebase sign-in failed:', error);
      setAuthError('Unable to sign in to Firebase automatically.');
    },
  }), []);

  useEffect(() => {
    const syncDayOffset = (event) => {
      if (event.key !== SIMULATED_DAY_KEY) return;
      const nextDay = getSavedSimulatedDay();
      appendQuestDebugLog('storage_sync_day', { nextDay });
      setDay(nextDay);
    };

    window.addEventListener('storage', syncDayOffset);
    return () => window.removeEventListener('storage', syncDayOffset);
  }, []);

  useEffect(() => {
    if (!authReady) return undefined;

    const dayOffsetRef = ref(db, SHARED_DAY_OFFSET_KEY);
    const unsubscribe = onValue(
      dayOffsetRef,
      (snapshot) => {
        const raw = snapshot.val();
        if (raw === null || raw === undefined || raw === '') {
          const savedDay = getSavedSimulatedDay();
          appendQuestDebugLog('firebase_day_empty', { savedDay });
          setDay(savedDay);
          if (savedDay !== 0) {
            set(dayOffsetRef, savedDay).catch((error) => {
              console.error('Failed to seed shared simulated day:', error);
              appendQuestDebugLog('firebase_seed_failed', {
                savedDay,
                message: error?.message || String(error),
              });
            });
          }
          return;
        }

        const nextDay = Number(raw);
        if (!Number.isFinite(nextDay)) return;
        appendQuestDebugLog('firebase_day_value', { raw, nextDay });
        setSavedSimulatedDay(nextDay);
        setDay(nextDay);
      },
      () => {
        appendQuestDebugLog('firebase_day_read_failed', {
          fallbackDay: getSavedSimulatedDay(),
        });
        setDay(getSavedSimulatedDay());
      }
    );

    return () => unsubscribe();
  }, [authReady]);

  const dateAnchorNow = useDateAnchorNow();
  const simulatedNow = useMemo(() => getSimulatedNow(dateAnchorNow, day), [dateAnchorNow, day]);
  const referenceDateKey = useMemo(() => formatLocalDate(simulatedNow), [simulatedNow]);

  useEffect(() => {
    if (currentUser) localStorage.setItem(USER_KEY, currentUser);
  }, [currentUser]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PET_STORAGE_KEY);
      if (!raw) return;
      lastStoredPetProfilesRef.current = raw;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const todayKey = formatLocalDate(getSimulatedNow());
        const normalized = normalizePetProfilesMap(parsed, todayKey, USERS);
        localPetProfilesRef.current = normalized;
        commitPetProfiles(normalized);
      }
    } catch (error) {
      console.warn('Failed to load pet state from localStorage:', error);
    } finally {
      setPetProfilesHydrated(true);
    }
  }, [commitPetProfiles]);

  useEffect(() => {
    if (!petProfilesHydrated) return;
    localPetProfilesRef.current = petProfiles;
  }, [petProfiles, petProfilesHydrated]);

  useEffect(() => {
    if (!petProfilesHydrated || !petStorageWriteReady) return;

    try {
      const serialized = JSON.stringify(petProfiles);
      if (serialized === lastStoredPetProfilesRef.current) return;
      localStorage.setItem(PET_STORAGE_KEY, serialized);
      lastStoredPetProfilesRef.current = serialized;
    } catch (error) {
      console.warn('Failed to persist pet state to localStorage:', error);
    }
  }, [petProfiles, petProfilesHydrated, petStorageWriteReady]);

  useEffect(() => {
    if (!petFirebaseReady) {
      petProfilesRemoteReadyRef.current = false;
      setPetProfilesRemoteReady(false);
      return undefined;
    }

    const petProfilesRef = ref(db, PET_PROFILES_ROOT);
    const legacyPetRef = ref(db, LEGACY_PET_ROOT);
    const legacyFoodRef = ref(db, LEGACY_FOOD_ROOT);
    petProfilesRemoteReadyRef.current = false;
    setPetProfilesRemoteReady(false);

    const hydrateLegacyPetProfiles = async (baseProfiles, dateKey) => {
      try {
        const [legacyPetSnapshot, legacyFoodSnapshot] = await Promise.all([get(legacyPetRef), get(legacyFoodRef)]);
        const legacyPetProfiles = legacyPetSnapshot.val() || {};
        const legacyFoodProfiles = legacyFoodSnapshot.val() || {};
        const next = { ...baseProfiles };

        USERS.forEach((user) => {
          const legacyPet = legacyPetProfiles?.[user];
          const legacyFood = legacyFoodProfiles?.[user];
          if (!legacyPet && (legacyFood === null || legacyFood === undefined)) return;

          const candidate = normalizePetState(
            {
              ...(next[user] || {}),
              hp: legacyPet?.hp ?? next[user]?.hp,
              xp: legacyPet?.xp ?? next[user]?.xp,
              food: legacyFood ?? next[user]?.food,
              petType: legacyPet?.type ?? legacyPet?.petType ?? next[user]?.petType,
            },
            dateKey
          );

          if (!next[user] || comparePetProfiles(candidate, next[user], dateKey) > 0) {
            next[user] = candidate;
          }
        });

        return next;
      } catch (error) {
        console.warn('Failed to read legacy pet data from Firebase:', error);
        return baseProfiles;
      }
    };

    const unsubscribe = onValue(
      petProfilesRef,
      (snapshot) => {
        const remoteProfiles = normalizePetProfilesMap(snapshot.val(), referenceDateKey, USERS);
        remotePetProfilesRef.current = remoteProfiles;

        void (async () => {
          let mergedProfiles = mergePetProfileMaps(remoteProfiles, localPetProfilesRef.current, referenceDateKey, USERS);

          if (!petBootstrapCompleteRef.current) {
            mergedProfiles = await hydrateLegacyPetProfiles(mergedProfiles, referenceDateKey);
            petBootstrapCompleteRef.current = true;
          }

          commitPetProfiles((prev) =>
            getPetProfilesMapSignature(prev, referenceDateKey, USERS) ===
            getPetProfilesMapSignature(mergedProfiles, referenceDateKey, USERS)
              ? prev
              : mergedProfiles
          );

          if (
            currentUser &&
            mergedProfiles[currentUser] &&
            getPetProfileSignature(remoteProfiles[currentUser], referenceDateKey) !==
            getPetProfileSignature(mergedProfiles[currentUser], referenceDateKey)
          ) {
            const previousRemoteProfiles = remotePetProfilesRef.current;
            remotePetProfilesRef.current = {
              ...remotePetProfilesRef.current,
              [currentUser]: mergedProfiles[currentUser],
            };
            update(petProfilesRef, { [currentUser]: mergedProfiles[currentUser] }).catch((error) => {
              console.error('Failed to sync pet profiles to Firebase:', error);
              remotePetProfilesRef.current = previousRemoteProfiles;
            });
          }

          petProfilesRemoteReadyRef.current = true;
          setPetProfilesRemoteReady(true);
        })();
      },
      (error) => {
        console.error('Failed to subscribe to pet profiles:', error);
        petProfilesRemoteReadyRef.current = true;
        setPetProfilesRemoteReady(true);
      }
    );

    return () => unsubscribe();
  }, [commitPetProfiles, currentUser, petFirebaseReady, referenceDateKey]);

  useEffect(() => {
    if (
      !petFirebaseReady ||
      !petProfilesHydrated ||
      !petProfilesRemoteReady ||
      !petProfilesRemoteReadyRef.current
    ) return;

    const normalizedProfiles = normalizePetProfilesMap(petProfiles, referenceDateKey, USERS);
    const updates = {};

    const profile = currentUser ? normalizedProfiles[currentUser] : null;

    if (!profile) return;

    const remoteProfile = remotePetProfilesRef.current?.[currentUser];
    if (
      getPetProfileSignature(profile, referenceDateKey) !==
      getPetProfileSignature(remoteProfile, referenceDateKey)
    ) {
      updates[currentUser] = profile;
    }

    const updateKeys = Object.keys(updates);
    if (!updateKeys.length) return;

    const previousRemoteProfiles = remotePetProfilesRef.current;
    remotePetProfilesRef.current = {
      ...remotePetProfilesRef.current,
      ...updates,
    };

    update(ref(db, PET_PROFILES_ROOT), updates).catch((error) => {
      console.error('Failed to persist pet profile changes to Firebase:', error);
      remotePetProfilesRef.current = previousRemoteProfiles;
    });
  }, [currentUser, petFirebaseReady, petProfiles, petProfilesHydrated, petProfilesRemoteReady, referenceDateKey]);

  const usingFirebaseTransactions = Array.isArray(firebaseTransactions);
  const sourceTransactions = useMemo(
    () => (usingFirebaseTransactions ? firebaseTransactions : []),
    [usingFirebaseTransactions, firebaseTransactions]
  );
  const transactionsById = useMemo(
    () => Object.fromEntries((sourceTransactions || []).map((tx) => [tx.id, tx])),
    [sourceTransactions]
  );
  const otherUser = currentUser ? getOtherUser(currentUser) : USERS[0];
  const dayLabel = day === 0 ? 'live' : `+${day} day${day === 1 ? '' : 's'}`;

  const syncPetProfilesForDate = useCallback((dateKey, reason = 'sync_pet_profiles') => {
    if (!currentUser) return;
    commitPetProfiles((prev) => {
      const next = { ...prev };
      let changed = false;
      const now = Date.now();

      Object.entries(prev).forEach(([user, state]) => {
        const normalized = normalizePetState(state, dateKey);
        if (getPetProfileSignature(state, dateKey) !== getPetProfileSignature(normalized, dateKey)) {
          const shouldStampDateSync = petProfilesRemoteReadyRef.current || Number(state?.updatedAt || 0) > 0;
          next[user] = shouldStampDateSync ? markPetStateUpdated(normalized, dateKey, now) : normalized;
          changed = true;
        }
      });

      if (!next[currentUser]) {
        next[currentUser] = normalizePetState(null, dateKey);
        changed = true;
      }

      if (!changed) return prev;

      appendQuestDebugLog(reason, {
        currentUser,
        dateKey,
        missionIds: (next[currentUser]?.missions || []).map((mission) => mission.id),
        resetKeys: (next[currentUser]?.missions || []).map((mission) => mission.resetKey),
      });
      return next;
    });
    setLevelUpMsg(null);
    petLevelReadyRef.current = false;
  }, [appendQuestDebugLog, commitPetProfiles, currentUser]);

  useEffect(() => {
    syncPetProfilesForDate(referenceDateKey, 'reference_date_changed');
  }, [referenceDateKey, syncPetProfilesForDate]);

  useEffect(() => {
    if (!authReady) return;
    const txRef = ref(db, 'transactions');
    const unsubscribe = onValue(
      txRef,
      (snapshot) => {
        const next = [];
        snapshot.forEach((child) => {
          const value = child.val();
          if (!value) return;
          if (value.source === 'manual-test') return;
          if ((value.merchant || '').startsWith('FIREBASE TEST')) return;
          next.push(normalizeFirebaseTransaction(child.key, value));
        });
        setFirebaseTransactions(next);
      },
      () => {
        setFirebaseTransactions([]);
      }
    );

    return () => unsubscribe();
  }, [authReady]);

  const petState = currentUser
    ? petProfiles[currentUser] || normalizePetState(null, referenceDateKey)
    : normalizePetState(null, referenceDateKey);
  const petLevel = getPetLevel(petState.xp);
  const xpBase = getXpForLevel(petLevel - 1);
  const xpNeeded = getXpForLevel(petLevel) - xpBase;
  const xpThisLevel = petState.xp - xpBase;
  const coins = petState.coins;
  const food = petState.food;
  const hp = petState.hp;
  const petXp = petState.xp;
  const streak = petState.streak;
  const mood = derivePetMood(petState, referenceDateKey);
  const missions = petState.missions || [];
  const petType = resolvePetType(petState.petType, petLevel, streak);
  const spriteMetrics = useMemo(() => getSpriteMetrics(petScalePct), [petScalePct]);
  const petFooterHeight = petType === 'classic' ? spriteMetrics.canvasHeight : 54;
  const appBottomPadding = Math.max(112, petFooterHeight + 64);

  useEffect(() => {
    const missionSummary = missions.map((mission) => getPetMissionSignature(mission));
    const snapshot = [day, currentUser || '', referenceDateKey, missionSummary.join(',')].join('|');

    if (snapshot === lastQuestSnapshotRef.current) return;
    lastQuestSnapshotRef.current = snapshot;
    appendQuestDebugLog('quest_snapshot', {
      day,
      currentUser,
      referenceDateKey,
      missionSummary: missions.map((mission) => ({
        id: mission.id,
        resetKey: mission.resetKey,
        progress: mission.progress,
        target: mission.target,
      })),
    });
  }, [day, currentUser, referenceDateKey, missions]);

  useEffect(() => {
    if (!petLevelReadyRef.current) {
      prevPetLevelRef.current = petLevel;
      petLevelReadyRef.current = true;
      return undefined;
    }

    if (petLevel <= prevPetLevelRef.current) {
      prevPetLevelRef.current = petLevel;
      return undefined;
    }

    prevPetLevelRef.current = petLevel;
    setLevelUpMsg(`Pet Level ${petLevel}!`);
    confettiRef.current?.launch?.();
    const timer = window.setTimeout(() => setLevelUpMsg(null), 2400);
    return () => window.clearTimeout(timer);
  }, [petLevel]);

  const updateActivePet = useCallback((updater) => {
    if (!currentUser) return;
    commitPetProfiles((prev) => {
      const current = normalizePetState(prev[currentUser] || null, referenceDateKey);
      const nextPet = typeof updater === 'function' ? updater(current) : updater;
      const normalizedNextPet = normalizePetState(nextPet, referenceDateKey);

      if (
        getPetProfileSignature(current, referenceDateKey) ===
        getPetProfileSignature(normalizedNextPet, referenceDateKey)
      ) {
        return prev;
      }

      return {
        ...prev,
        [currentUser]: markPetStateUpdated(normalizedNextPet, referenceDateKey),
      };
    });
  }, [commitPetProfiles, currentUser, referenceDateKey]);

  const addCoinPop = useCallback((event) => {
    if (!event?.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const id = `${Date.now()}-${Math.random()}`;
    setCoinPops((prev) => [
      ...prev,
      {
        id,
        x: rect.left + rect.width / 2,
        y: rect.top,
      },
    ]);
    window.setTimeout(() => {
      setCoinPops((prev) => prev.filter((pop) => pop.id !== id));
    }, 850);
  }, []);

  const { assignmentError, handleAssign, undo, undoStack, setUndoStack } = useTransactionAssignments({
    currentUser,
    day,
    referenceDateKey,
    submissions,
    setSubmissions,
    petProfiles,
    setPetProfiles: commitPetProfiles,
    updateActivePet,
    addCoinPop,
  });

  const saveAssignmentComment = useCallback(async (txId, user, comment, currentSubmission = null) => {
    if (!txId || !user) return;

    const payload = buildSharedAssignmentCommentPayload({
      comment,
      submission: currentSubmission,
      dateKey: referenceDateKey,
    });

    setAssignmentComments((prev) => {
      const next = { ...prev };
      const txComments = { ...(next[txId] || {}) };

      if (payload) {
        txComments[user] = payload;
      } else {
        delete txComments[user];
      }

      if (Object.keys(txComments).length > 0) {
        next[txId] = txComments;
      } else {
        delete next[txId];
      }

      return next;
    });

    if (currentSubmission) {
      setSubmissions((prev) => {
        const next = { ...prev };
        const txSubmissions = { ...(next[txId] || {}) };
        const userSubmission = { ...(txSubmissions[user] || {}) };

        if (payload?.comment) {
          userSubmission.comment = payload.comment;
        } else {
          delete userSubmission.comment;
        }

        txSubmissions[user] = userSubmission;
        next[txId] = txSubmissions;
        return next;
      });
    }

    try {
      await set(ref(db, `${ASSIGNMENT_COMMENTS_ROOT}/${txId}/${user}`), payload);

      if (currentSubmission) {
        await update(ref(db, `submissions/${txId}/${user}`), {
          comment: payload?.comment || null,
        });
      }
    } catch (error) {
      console.error('Failed to sync assignment note:', error);
    }
  }, [referenceDateKey]);

  const handleTallyBreakdownUngroup = useCallback(({ assignee, group, item }) => {
    if (!assignee || !item?.id || !group || group.items.length <= 1) return;

    const key = getTallyUngroupKey(assignee, item.id);
    const record = {
      txId: item.id,
      assignee,
      itemDesc: item.desc || 'Untitled transaction',
      groupKey: group.key || null,
      groupDesc: group.desc || null,
      createdAt: Date.now(),
      createdBy: currentUser || assignee,
    };

    setTallyUngroups((prev) => ({
      ...prev,
      [key]: record,
    }));

    set(ref(db, `${TALLY_UNGROUPS_ROOT}/${key}`), record).catch((error) => {
      console.error('Failed to save tally ungroup:', error);
    });
  }, [currentUser]);

  const handleUndoTallyBreakdownUngroup = useCallback((record) => {
    if (!record?.id) return;

    setTallyUngroups((prev) => {
      if (!prev[record.id]) return prev;
      const next = { ...prev };
      delete next[record.id];
      return next;
    });

    remove(ref(db, `${TALLY_UNGROUPS_ROOT}/${record.id}`)).catch((error) => {
      console.error('Failed to undo tally ungroup:', error);
    });
  }, []);

  const buyFood = useCallback(() => {
    updateActivePet((pet) => {
      if (pet.coins < 1) return pet;
      return applyPetActionProgress(
        {
          ...pet,
          coins: pet.coins - 1,
          food: pet.food + 1,
        },
        {
          dateKey: referenceDateKey,
          kind: 'buy_food',
        }
      ).pet;
    });
  }, [referenceDateKey, updateActivePet]);

  const feedPet = useCallback(() => {
    updateActivePet((pet) => {
      if (pet.food < 1) return pet;
      const feedMood = derivePetMood(pet, referenceDateKey);
      const feedGain = getFeedBenefits(feedMood);
      return applyPetActionProgress(pet, {
        dateKey: referenceDateKey,
        kind: 'feed',
        hpGain: feedGain.hp,
        xpGain: feedGain.xp,
      }).pet;
    });
  }, [referenceDateKey, updateActivePet]);

  const resetActivePetQuests = useCallback(() => {
    if (!currentUser) return;
    updateActivePet((pet) => {
      const fresh = normalizePetState(null, referenceDateKey);
      appendQuestDebugLog('manual_reset_quests', {
        day,
        currentUser,
        referenceDateKey,
        missionIds: fresh.missions.map((mission) => mission.id),
      });
      return {
        ...pet,
        missions: fresh.missions,
      };
    });
  }, [appendQuestDebugLog, currentUser, day, referenceDateKey, updateActivePet]);

  const togglePetMissions = useCallback(() => setShowPetMissions((value) => !value), []);

  useEffect(() => {
    if (!authReady) return;
    const submissionsRef = ref(db, 'submissions');
    const unsubscribe = onValue(
      submissionsRef,
      (snapshot) => {
        setSubmissions(snapshot.val() || {});
      },
      () => {
        // Keep local data if Firebase submissions cannot be read.
      }
    );

    return () => unsubscribe();
  }, [authReady]);

  useEffect(() => {
    if (!commentsFirebaseReady) return;
    const commentsRef = ref(db, ASSIGNMENT_COMMENTS_ROOT);
    const unsubscribe = onValue(
      commentsRef,
      (snapshot) => {
        setAssignmentComments(snapshot.val() || {});
      },
      () => {
        // Existing submission-embedded comments remain available as a fallback.
      }
    );

    return () => unsubscribe();
  }, [commentsFirebaseReady]);

  useEffect(() => {
    if (!authReady) return;
    const tallyUngroupsRef = ref(db, TALLY_UNGROUPS_ROOT);
    const unsubscribe = onValue(
      tallyUngroupsRef,
      (snapshot) => {
        setTallyUngroups(snapshot.val() || {});
      },
      () => {
        // Keep optimistic local tally grouping overrides if Firebase cannot be read.
      }
    );

    return () => unsubscribe();
  }, [authReady]);

  useEffect(() => {
    if (!presenceFirebaseReady) return undefined;

    const presenceRootRef = ref(db, PRESENCE_ROOT);
    const refreshOnlineUsers = (snapshot) => {
      const now = Date.now();
      const active = {};

      snapshot.forEach((child) => {
        const entry = child.val();
        if (!entry || typeof entry !== 'object') return;
        if (!entry.user || !USERS.includes(entry.user)) return;
        if (now - Number(entry.ts || 0) > PRESENCE_TTL_MS) return;
        active[entry.user] = true;
      });

      USERS.forEach((u) => {
        if (!active[u]) active[u] = false;
      });
      setOnlineUsers(active);
    };

    const unsubscribe = onValue(
      presenceRootRef,
      refreshOnlineUsers,
      () => {
        setOnlineUsers({ Tony: false, Nugs: false });
      }
    );

    return () => unsubscribe();
  }, [presenceFirebaseReady]);

  useEffect(() => {
    if (!presenceFirebaseReady) return undefined;

    if (!presenceTabIdRef.current) {
      const savedTabId = sessionStorage.getItem('cc_v5_presence_tab');
      presenceTabIdRef.current = savedTabId || `tab_${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem('cc_v5_presence_tab', presenceTabIdRef.current);
    }

    const presencePath = presenceTabIdRef.current;
    const userPresenceRef = ref(db, `${PRESENCE_ROOT}/${presencePath}`);

    const writePresence = async () => {
      if (!currentUser) {
        await remove(userPresenceRef);
        return;
      }

      const now = Date.now();
      const payload = {
        user: currentUser,
        uid: firebaseUser?.uid || null,
        ts: now,
      };
      await set(userPresenceRef, payload);
      await set(ref(db, `${USER_ACTIVITY_ROOT}/${currentUser}`), {
        user: currentUser,
        lastSeen: now,
      });
      const disconnect = onDisconnect(userPresenceRef);
      await disconnect.remove();
    };

    writePresence().catch((error) => {
      console.error('Failed to update presence:', error);
    });

    const interval = window.setInterval(() => {
      if (!currentUser) return;
      const now = Date.now();
      set(userPresenceRef, {
        user: currentUser,
        uid: firebaseUser?.uid || null,
        ts: now,
      }).catch((error) => {
        console.error('Failed to refresh presence:', error);
      });
      set(ref(db, `${USER_ACTIVITY_ROOT}/${currentUser}`), {
        user: currentUser,
        lastSeen: now,
      }).catch((error) => {
        console.error('Failed to refresh user activity:', error);
      });
    }, 4000);

    return () => {
      window.clearInterval(interval);
      remove(userPresenceRef).catch(() => {
        // ignore cleanup errors
      });
    };
  }, [firebaseUser?.uid, presenceFirebaseReady, currentUser]);

  const dashboardMetrics = useMemo(
    () =>
      usingFirebaseTransactions
        ? buildDashboardMetrics({
            transactions: firebaseTransactions,
            submissions,
            currentUser,
            users: USERS,
            referenceDateKey,
            simulatedNow,
            assignees: DASHBOARD_ASSIGNEES,
          })
        : EMPTY_DASHBOARD_METRICS,
    [usingFirebaseTransactions, firebaseTransactions, submissions, currentUser, referenceDateKey, simulatedNow]
  );

  const authLoading = currentUser && !authReady && !authError;

  const sections = dashboardMetrics.sections;
  const anyVisible = dashboardMetrics.anyVisible;

  useEffect(() => {
    if (!currentUser) return;
    if (!anyVisible) {
      if (!confettiFiredRef.current) {
        confettiFiredRef.current = true;
        confettiRef.current?.launch?.();
      }
    } else {
      confettiFiredRef.current = false;
    }
  }, [anyVisible, currentUser]);

  const myRemaining = dashboardMetrics.remainingByUser[currentUser] || 0;
  const otherRemaining = dashboardMetrics.remainingByUser[otherUser] || 0;
  const userTallies = dashboardMetrics.userTallies;
  const macTally = dashboardMetrics.assigneeTotals.Macquarie || 0;
  const macquarieExcessShares = useMemo(
    () => buildMacquarieExcessShares(USERS, macTally),
    [macTally]
  );
  const macqbillTally = dashboardMetrics.assigneeTotals.Macqbill || 0;
  const activeTallyBreakdownGroups = useMemo(
    () =>
      breakdownUser
        ? getGroupedTallyBreakdownEntries(
            submissions,
            transactionsById,
            breakdownUser,
            referenceDateKey,
            USERS,
            tallyUngroups
          )
        : [],
    [breakdownUser, submissions, transactionsById, referenceDateKey, tallyUngroups]
  );
  const activeMacquarieExcessGroups = useMemo(() => {
    if (!breakdownUser || macTally <= 0) return [];

    const macquarieExcessEntries = buildMacquarieExcessEntryShares(
      getTallyBreakdownEntries(submissions, transactionsById, 'Macquarie', referenceDateKey, USERS),
      breakdownUser,
      macTally
    );

    return groupTallyBreakdownEntries(macquarieExcessEntries);
  }, [breakdownUser, macTally, submissions, transactionsById, referenceDateKey]);
  const activeTallyUndoRecords = useMemo(
    () => (breakdownUser ? getUndoableTallyUngroupRecords(tallyUngroups, breakdownUser) : []),
    [breakdownUser, tallyUngroups]
  );

  const stepDay = useCallback(() => {
    const nextDay = day + 1;
    const nextDateKey = formatLocalDate(getSimulatedNow(new Date(), nextDay));
    appendQuestDebugLog('step_day_clicked', {
      previousDay: day,
      nextDay,
      referenceDateKey,
      nextDateKey,
    });
    syncPetProfilesForDate(nextDateKey, 'step_day_sync_pet_profiles');
    setSavedSimulatedDay(nextDay);
    setDay(nextDay);
    set(ref(db, SHARED_DAY_OFFSET_KEY), nextDay).catch((err) => {
      console.error('Failed to update shared simulated day:', err);
      appendQuestDebugLog('step_day_write_failed', {
        nextDay,
        message: err?.message || String(err),
      });
    });
  }, [appendQuestDebugLog, day, referenceDateKey, syncPetProfilesForDate]);

  const resetDay = useCallback(() => {
    const resetDateKey = formatLocalDate(getSimulatedNow(new Date(), 0));
    appendQuestDebugLog('reset_day_clicked', {
      previousDay: day,
      referenceDateKey,
      resetDateKey,
    });
    syncPetProfilesForDate(resetDateKey, 'reset_day_sync_pet_profiles');
    setSavedSimulatedDay(0);
    setDay(0);
    set(ref(db, SHARED_DAY_OFFSET_KEY), 0).catch((err) => {
      console.error('Failed to reset shared simulated day:', err);
      appendQuestDebugLog('reset_day_write_failed', {
        message: err?.message || String(err),
      });
    });
  }, [appendQuestDebugLog, day, referenceDateKey, syncPetProfilesForDate]);

  const copyQuestDebugLog = async () => {
    const payload = [
      `day=${day}`,
      `referenceDateKey=${referenceDateKey}`,
      `currentUser=${currentUser || ''}`,
      `firebaseUid=${firebaseUser?.uid || ''}`,
      ...questDebugLog,
    ].join('\n');

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = payload;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      appendQuestDebugLog('copied_debug_log', { lines: questDebugLog.length });
    } catch (error) {
      console.error('Failed to copy quest debug log:', error);
      appendQuestDebugLog('copy_debug_log_failed', {
        message: error?.message || String(error),
      });
    }
  };

  const clearCache = async () => {
    if (!window.confirm('Reset all data? This clears ALL devices.')) return;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(PET_STORAGE_KEY);
    setSubmissions({});
    setAssignmentComments({});
    setTallyUngroups({});
    setUndoStack([]);
    setShowMac(false);
    setShowPetDebug(false);
    setShowPetMissions(false);
    setShowDevTools(false);
    setCurrentUser(null);
    setBreakdownUser(null);
    localPetProfilesRef.current = {};
    remotePetProfilesRef.current = {};
    lastStoredSubmissionsRef.current = null;
    lastStoredPetProfilesRef.current = null;
    petProfilesRemoteReadyRef.current = false;
    commitPetProfiles({});
    setPetProfilesRemoteReady(false);
    setLevelUpMsg(null);
    setCoinPops([]);
    setDay(0);
    clearSavedSimulatedDay();

    try {
      await set(ref(db, 'submissions'), null);
      await set(ref(db, ASSIGNMENT_COMMENTS_ROOT), null);
      await set(ref(db, TALLY_UNGROUPS_ROOT), null);
      await set(ref(db, PET_PROFILES_ROOT), null);
    } catch (err) {
      console.error('Failed to clear Firebase app state:', err);
    }
  };

  if (!currentUser) {
    return <Landing onSelect={setCurrentUser} />;
  }

  if (authLoading) {
    return (
      <div className="landing">
        <div className="landing-card">
          <p className="landing-eyebrow">Credit Card</p>
          <h1 className="landing-title">Connecting securely</h1>
          <p className="landing-sub">Signing in silently with Firebase.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {authError && (
        <div className="sync-bar" style={{ justifyContent: 'center' }}>
          <div className="sync-status disconnected">
            <div className="sync-dot disconnected" />
            {authError}
          </div>
        </div>
      )}
      {showSwitch && (
        <SwitchOverlay
          currentUser={currentUser}
          onSelect={setCurrentUser}
          onClose={() => setShowSwitch(false)}
        />
      )}
      <AdminPasswordModal
        open={Boolean(adminGateRequest)}
        title={adminGateRequest?.title || 'Protected tools'}
        description={adminGateRequest?.description || 'Enter the admin tools password to continue.'}
        onAuthorized={handleAdminGateAuthorized}
        onCancel={() => setAdminGateRequest(null)}
      />

      <div className={`sync-bar ${currentUser ? 'connected' : ''}`}>
        <div className={`sync-status connected`}>
          <div className="sync-dot connected" />
          synced {APP_VERSION}
        </div>
        <div className="online-users">
          <span className="online-users-label">Profile Online</span>
          {USERS.map((u) =>
            onlineUsers[u] ? (
              <span key={u} className={`online-chip ${u === currentUser ? 'self' : 'active'}`}>
                {'\u25CF'} {u} Online
              </span>
            ) : null
          )}
        </div>
      </div>

      {assignmentError && (
        <div className="sync-bar" style={{ justifyContent: 'center' }}>
          <div className="sync-status disconnected">
            <div className="sync-dot disconnected" />
            {assignmentError}
          </div>
        </div>
      )}

      <div className="top-meta-bar">
        <LiveClockMeta day={day} dayLabel={dayLabel} />
        <button className="debug-toggle" onClick={handleToolsToggle}>
          tools {showDevTools ? '\u25B2' : '\u25BC'}
        </button>
      </div>

      {showDevTools && (
        <div className="debug-tray">
          <div className="dev-banner">
            <span className="dev-label">dev</span>
            <DevClockPanel day={day} dayLabel={dayLabel} />
            <button className="day-btn" onClick={stepDay}>
              next day +24h {'\u25B6'}
            </button>
            <button className="reset-btn" onClick={resetDay}>
              reset
            </button>
            <span className="dev-sep">|</span>
            <button className="day-btn" onClick={() => updateActivePet((pet) => ({ ...pet, coins: pet.coins + 5 }))}>
              +5 <span className="coin-inline" aria-hidden="true" />
            </button>
            <button className="day-btn" onClick={() => updateActivePet((pet) => ({ ...pet, food: pet.food + 3 }))}>
              +3{'\u{1F356}'}
            </button>
            <button className="reset-btn" onClick={() => updateActivePet((pet) => ({ ...pet, coins: 0 }))}>
              0 <span className="coin-inline" aria-hidden="true" />
            </button>
            <span className="dev-sep">|</span>
            <button
              className="day-btn"
              style={{
                borderColor: showPetDebug ? 'rgba(167,139,250,0.4)' : '',
                background: showPetDebug ? 'rgba(167,139,250,0.1)' : '',
              }}
              onClick={() => setShowPetDebug((v) => !v)}
            >
              pet {showPetDebug ? '\u25B2' : '\u25BC'}
            </button>
            <button className="day-btn" onClick={copyQuestDebugLog}>
              copy debug
            </button>
            <span className="dev-sep">|</span>
            <button className="clear-btn" onClick={clearCache}>
              {'\u{1F5D1}'} clear
            </button>
          </div>

          {showPetDebug && (
            <>
              <div className="pet-debug-row">
                <span className="dev-label">pet type:</span>
                {['classic', 'shiny', 'ember'].map((type) => (
                  <button
                    key={type}
                    className="day-btn"
                    style={{
                      background: petType === type ? 'rgba(96,165,250,0.2)' : '',
                      borderColor: petType === type ? 'rgba(96,165,250,0.4)' : '',
                    }}
                    onClick={() => updateActivePet((pet) => ({ ...pet, petType: type }))}
                  >
                    {type}
                  </button>
                ))}
                <span className="dev-sep">|</span>
                <span className="dev-label">xp:{petXp} lv:{petLevel}</span>
                <button className="day-btn" onClick={() => updateActivePet((pet) => ({ ...pet, xp: pet.xp + 30 }))}>
                  +30xp
                </button>
                <button className="reset-btn" onClick={() => updateActivePet((pet) => ({ ...pet, xp: 0 }))}>
                  0xp
                </button>
                <button className="day-btn" onClick={() => updateActivePet((pet) => ({ ...pet, hp: 100 }))}>
                  +hp
                </button>
                <button className="reset-btn" onClick={() => updateActivePet((pet) => ({ ...pet, hp: pet.hp - 20 }))}>
                  -hp
                </button>
                <span className="dev-sep">|</span>
                <span className="dev-label">size:{petScalePct}%</span>
                <button className="reset-btn" onClick={() => setPetScalePct((value) => Math.max(10, value - 5))}>
                  -5%
                </button>
                <input
                  className="pet-scale-input"
                  type="range"
                  min="10"
                  max="100"
                  step="5"
                  value={petScalePct}
                  onChange={(event) => setPetScalePct(Math.max(10, Math.min(100, Number(event.target.value) || 25)))}
                />
                <button className="day-btn" onClick={() => setPetScalePct((value) => Math.min(100, value + 5))}>
                  +5%
                </button>
                <button className="reset-btn" onClick={() => setPetScalePct(25)}>
                  25%
                </button>
                {petType === 'classic' && (
                  <span className="dev-label">
                    sprite {spriteMetrics.drawWidth}x{spriteMetrics.drawHeight}
                  </span>
                )}
                <button className="reset-btn" onClick={resetActivePetQuests}>
                  reset quests
                </button>
              </div>
              <div
                style={{
                  marginTop: '10px',
                  maxHeight: '180px',
                  overflowY: 'auto',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '10px',
                  padding: '10px',
                  background: 'rgba(5,10,20,0.55)',
                  fontSize: '11px',
                  lineHeight: 1.45,
                  color: 'rgba(255,255,255,0.78)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {questDebugLog.length ? questDebugLog.join('\n') : 'No quest debug entries yet.'}
              </div>
            </>
          )}
        </div>
      )}

      <div className="tally-bar">
        <div className="tally-main">
          {USERS.map((u, i) => {
            const macquarieExcessShare = macquarieExcessShares[u] || 0;

            return (
              <React.Fragment key={u}>
                {i > 0 && <div style={{ width: '1px', background: 'rgba(255,255,255,0.05)' }} />}
                <button
                  type="button"
                  className={`tally-item tally-trigger ${u === currentUser ? 'me' : ''} ${u.toLowerCase()}`}
                  onClick={() => setBreakdownUser(u)}
                >
                  <div className="tally-name">{u}{u === currentUser ? ' (you)' : ''}</div>
                  <div className="tally-amount-row">
                    <span className="tally-amount">${(userTallies[u] || 0).toFixed(2)}</span>
                    {macquarieExcessShare > 0 && !showMac && (
                      <span className="tally-excess">
                        +${macquarieExcessShare.toFixed(2)} <span className="tally-excess-label">(mac)</span>
                      </span>
                    )}
                  </div>
                  <div className="tally-note">own assignments</div>
                </button>
              </React.Fragment>
            );
          })}
        </div>
        {showMac && (
          <>
            <div className="mac-panel">
              <div className="tally-name">Macquarie</div>
              <div className="tally-amount mac">${macTally.toFixed(2)}</div>
              <div className="tally-note">shared</div>
            </div>
            <div className="mac-panel">
              <div className="tally-name">Macqbill</div>
              <div className="tally-amount macqbill">${macqbillTally.toFixed(2)}</div>
              <div className="tally-note">shared</div>
            </div>
          </>
        )}
        <button className="mac-toggle" onClick={() => setShowMac((v) => !v)} title="Toggle Macquarie">
          {showMac ? '\u203A' : '\u2039'}
        </button>
      </div>

      <div className="app" style={{ paddingBottom: `${appBottomPadding}px` }}>
        <div className="app-header">
          <h1 className="app-title">Transactions</h1>
          <div className="header-right">
            <button type="button" className="day-btn header-upload-btn" onClick={handleUploadClick}>
              upload
            </button>
            <button className="undo-btn" disabled={!undoStack.length} onClick={undo}>
              {'\u21A9'} undo
            </button>
            <button className="user-badge" onClick={() => setShowSwitch(true)}>
              {currentUser[0]} {currentUser} {'\u2195'}
            </button>
          </div>
        </div>

        <div className="stats-grid">
          <div className="stat-box me">
            <div className="stat-val">{myRemaining}</div>
            <div className="stat-label">my remaining</div>
          </div>
          <div className="stat-box">
            <div className="stat-val">{otherRemaining}</div>
            <div className="stat-label">{otherUser}'s remaining</div>
          </div>
        </div>

        {sections.map((section) => (
          <TxGroup
            key={section.key}
            title={section.title}
            date={section.date}
            dayKey={section.key}
            txs={section.txs}
            submissions={submissions}
            assignmentComments={assignmentComments}
            currentUser={currentUser}
            referenceDateKey={referenceDateKey}
            onAssign={handleAssign}
            onSaveComment={saveAssignmentComment}
          />
        ))}

      {!anyVisible && <AllDone msg={doneMsg.current} />}
      {levelUpMsg && (
        <div className="levelup-overlay">
          <div className="levelup-badge">✦ {levelUpMsg} ✦</div>
          <div className="levelup-sub">congrats, your pet levelled up</div>
        </div>
      )}
      {coinPops.map((pop) => (
        <div key={pop.id} className="coin-pop" style={{ left: `${pop.x}px`, top: `${pop.y}px` }}>
          <span className="pixel-coin-art" />
          <span className="coin-pop-text">+1</span>
        </div>
      ))}
      {breakdownUser && (
        <TallyBreakdownModal
          assignee={breakdownUser}
          total={(userTallies[breakdownUser] || 0) + (macquarieExcessShares[breakdownUser] || 0)}
          groups={activeTallyBreakdownGroups}
          macquarieExcessGroups={activeMacquarieExcessGroups}
          macquarieExcessTotal={macquarieExcessShares[breakdownUser] || 0}
          undoableUngroups={activeTallyUndoRecords}
          onUngroupItem={handleTallyBreakdownUngroup}
          onUndoUngroup={handleUndoTallyBreakdownUngroup}
          onClose={() => setBreakdownUser(null)}
        />
      )}
      <ConfettiCanvas ref={confettiRef} />
      </div>

      <PetBar
        hp={hp}
        coins={coins}
        food={food}
        level={petLevel}
        xp={xpThisLevel}
        xpNeeded={xpNeeded}
        streak={streak}
        mood={mood}
        missions={missions}
        showMissions={showPetMissions}
        onToggleMissions={togglePetMissions}
        onBuyFood={buyFood}
        onFeedPet={feedPet}
        petType={petType}
        petFooterHeight={petFooterHeight}
        petScalePct={petScalePct}
        spriteMetrics={spriteMetrics}
      />
    </div>
  );
}
