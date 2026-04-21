import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import { db } from '../config/firebase';
import { onDisconnect, onValue, ref, remove, set } from 'firebase/database';
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

const USERS = ['Tony', 'Nugs'];
const ASSIGN_OPTS = ['Unsure', 'Macquarie', 'Tony', 'Nugs'];
const STORAGE_KEY = 'cc_v4_subs';
const USER_KEY = 'cc_v4_user';
const PET_STORAGE_KEY = 'cc_v4_pet_state';
const PRESENCE_ROOT = 'cc_v4_presence';
const PRESENCE_TTL_MS = 12000;
const APP_STATE_ROOT = 'cc_v4_app_state';
const SHARED_DAY_OFFSET_KEY = `${APP_STATE_ROOT}/simulatedDayOffset`;
const APP_VERSION = 'r3.19';
const VERSION_KEY = 'cc_version';

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

function getOtherUser(user) {
  return USERS.find((x) => x !== user);
}

function getSubValue(sub, user) {
  return sub?.[user]?.value ?? null;
}

function getSubTs(sub, user) {
  return sub?.[user]?.ts ?? null;
}

function getSubmissionDay(sub, user) {
  const dayValue = sub?.[user]?.day;
  if (dayValue === undefined || dayValue === null || dayValue === '') return null;
  const parsed = Number(dayValue);
  return Number.isFinite(parsed) ? parsed : null;
}

function getSurfacedSubmissionValue(sub, user, day) {
  const submittedDay = getSubmissionDay(sub, user);
  if (submittedDay === null || submittedDay >= day) return null;
  return getSubValue(sub, user);
}

function getSurfacedSubmissionStatus(sub, day) {
  const values = USERS.map((u) => getSurfacedSubmissionValue(sub, u, day)).filter(Boolean);
  const hasUnsure = values.includes('Unsure');

  return {
    conflict: values.length === USERS.length && !hasUnsure && new Set(values).size > 1,
    unsure: hasUnsure,
  };
}

function getOptionClassName(value) {
  if (value === 'Macquarie') return 'mac-btn';
  if (value === 'Unsure') return 'unsure-btn';
  if (value === 'Tony') return 'tony-btn';
  if (value === 'Nugs') return 'nugs-btn';
  return '';
}

function formatAssignmentLabel(value) {
  return value === 'Macquarie' ? 'MAC' : value;
}

function getDefaultPetState(user) {
  return {
    coins: 0,
    food: 0,
    hp: 60,
    xp: 0,
    petType: 'classic',
  };
}

function getPetLevel(xp) {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 10)) + 1;
}

function getXpForLevel(level) {
  return level * level * 10;
}

function normalizePetType(value) {
  if (value === 'shiny' || value === 'ember' || value === 'classic') return value;
  return 'classic';
}

function hasConflict(sub) {
  const picks = USERS.map((u) => getSubValue(sub, u)).filter((value) => value && value !== 'Unsure');
  return picks.length === USERS.length && new Set(picks).size > 1;
}

function getSubmissionStatus(sub) {
  const values = USERS.map((u) => getSubValue(sub, u)).filter(Boolean);
  const hasUnsure = values.includes('Unsure');
  const allPicked = values.length === USERS.length;
  const resolved = allPicked && !hasUnsure && new Set(values).size === 1;

  return {
    resolved,
    conflict: allPicked && !hasUnsure && new Set(values).size > 1,
    unsure: hasUnsure,
    anyPicked: values.length > 0,
  };
}

function isVisibleForUser(tx, submissions, user, day) {
  if (!user) return true;

  const sub = submissions[tx.id] || {};
  const { resolved } = getSubmissionStatus(sub);
  const submittedDay = getSubmissionDay(sub, user);
  const submittedToday = submittedDay !== null && submittedDay === day;

  return !resolved && !submittedToday;
}

function shouldCountForAssignee(sub, assignee, day) {
  const values = USERS.map((u) => {
    const submittedDay = getSubmissionDay(sub, u);
    return submittedDay !== null && submittedDay === day ? getSubValue(sub, u) : null;
  }).filter(Boolean);
  if (values.includes('Unsure')) return false;
  return values.includes(assignee);
}

function normalizeFirebaseTransaction(id, tx) {
  return {
    id,
    desc: tx.merchant || tx.desc || 'Untitled transaction',
    amount: Number(tx.amount) || 0,
    date: tx.date || null,
    isPending: Boolean(tx.isPending) || !tx.date,
    uploadedDate: tx.uploadedDate || null,
    uploadedDay: tx.uploadedDay || null,
    category: tx.category || null,
    source: tx.source || 'image',
    raw: tx,
  };
}

function groupTransactionsByDate(transactions) {
  return transactions.reduce((groups, tx) => {
    const key = tx.date || 'undated';
    if (!groups[key]) groups[key] = [];
    groups[key].push(tx);
    return groups;
  }, {});
}

function sortDateKeys(keys) {
  return [...keys].sort((a, b) => {
    if (a === 'undated') return 1;
    if (b === 'undated') return -1;

    const ta = new Date(a).getTime();
    const tb = new Date(b).getTime();
    if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) {
      return tb - ta;
    }

    return String(b).localeCompare(String(a));
  });
}

function formatDayLabel(dayKey, fallbackIndex) {
  if (!dayKey) return fallbackIndex === 0 ? 'today' : `+${fallbackIndex}d`;
  if (dayKey === 'undated') return 'undated';

  const parsed = new Date(`${dayKey}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dayKey;

  return parsed.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function parseLocalDate(dateStr) {
  const parsed = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getLocalDateKey(dateLike) {
  if (!dateLike) return null;
  if (typeof dateLike === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateLike)) return dateLike;
  const parsed = new Date(dateLike);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatLocalDate(parsed);
}

function formatRelativeDayLabel(dateStr, referenceDate) {
  const parsedKey = getLocalDateKey(dateStr);
  if (!parsedKey) return dateStr || 'Unknown';

  const referenceKey = formatLocalDate(referenceDate);
  const refMs = Date.parse(`${referenceKey}T00:00:00Z`);
  const parsedMs = Date.parse(`${parsedKey}T00:00:00Z`);
  const diffDays = Math.round((refMs - parsedMs) / 86400000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays > 1) return `${diffDays}D Ago`;
  if (diffDays === -1) return 'Tomorrow';
  return `${Math.abs(diffDays)}D Ahead`;
}

function formatShortDate(dateStr) {
  const parsed = parseLocalDate(dateStr);
  if (!parsed) return dateStr || '';

  return parsed.toLocaleDateString('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
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

function TransactionCard({ tx, sub, currentUser, currentDay, onAssign }) {
  const otherUser = getOtherUser(currentUser);
  const mySub = getSurfacedSubmissionValue(sub, currentUser, currentDay);
  const otherSub = getSurfacedSubmissionValue(sub, otherUser, currentDay);
  const { conflict, unsure } = getSurfacedSubmissionStatus(sub, currentDay);

  return (
    <div className={`tx-card ${conflict ? 'conflict' : unsure ? 'unsure' : ''}`}>
      <div className="tx-top">
        <div>
          <div className="tx-meta">
            {conflict && <span className="badge badge-conflict">! conflict</span>}
            {unsure && !conflict && <span className="badge badge-unsure">? unsure</span>}
          </div>
          <p className="tx-desc">{tx.desc}</p>
        </div>
        <span className="tx-amount">${tx.amount.toFixed(2)}</span>
      </div>

      {conflict || unsure ? (
        <>
          <p className="my-pick-note">
            {otherUser} picked <span className="my-pick-chip">{formatAssignmentLabel(otherSub) || '--'}</span>
            {mySub ? ` | your pick: ${formatAssignmentLabel(mySub)}` : ' | tap to assign'}
          </p>
          <div className="conflict-row">
            {ASSIGN_OPTS.map((opt) => (
              <button
                key={opt}
                className={`conflict-tap-btn ${getOptionClassName(opt)}`}
                onClick={(event) => onAssign(tx.id, opt, event)}
              >
                {formatAssignmentLabel(opt)}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="assign-row">
          <span className="assign-label">assign</span>
          {ASSIGN_OPTS.map((opt) => (
            <button
              key={opt}
              className={`tap-btn ${getOptionClassName(opt)}`}
              onClick={(event) => onAssign(tx.id, opt, event)}
            >
              {formatAssignmentLabel(opt)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PetBar({ hp, coins, food, level, xp, xpNeeded, onBuyFood, onFeedPet, petType }) {
  return (
    <>
      <div className="shop-bar">
        <span className="shop-coins">{'\u{1FA99}'} {coins}</span>
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
        <div className="shop-divider-v" />
        <button className="shop-btn buy" disabled={coins < 1} onClick={onBuyFood}>
          buy food 1{'\u{1FA99}'}
        </button>
        <button className="shop-btn feed" disabled={food < 1} onClick={onFeedPet}>
          feed {'\u{1F356}'}
        </button>
        <div className="shop-divider-v" />
        <span className="pet-level">
          Lv.{level} - {xp}/{xpNeeded} xp
        </span>
      </div>
      <div className="pet-footer">
        <PetCanvas petType={petType} />
      </div>
    </>
  );
}

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

function PetCanvas({ petType = 'classic' }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    let raf = 0;
    let x = 20;
    let dir = 1;
    let tick = 0;

    const resize = () => {
      canvas.width = canvas.parentElement?.clientWidth || window.innerWidth;
      canvas.height = 54;
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

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const variantKey = petType === 'shiny' ? 'shiny' : petType === 'ember' ? 'ember' : 'classic';
      const theme = PET_THEMES[variantKey];
      const variant = PET_VARIANTS[variantKey];
      const spriteWidth = 68;
      const floorY = 45;
      const shadowWidth = 22;
      const shadowY = floorY + 2;
      const spriteX = Math.max(6, Math.min(canvas.width - spriteWidth - 6, x));
      const shadowX = Math.round(spriteX + spriteWidth / 2 - shadowWidth / 2);
      const facingLeft = dir < 0;

      const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
      bg.addColorStop(0, 'rgba(255,255,255,0.015)');
      bg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

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
      raf = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener('resize', resize);
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [petType]);

  return <canvas ref={ref} />;
}

function TxGroup({ title, date, dayKey, txs, submissions, currentUser, currentDay, onAssign }) {
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
          sub={submissions[tx.id] || {}}
          currentUser={currentUser}
          currentDay={currentDay}
          onAssign={onAssign}
        />
      ))}
    </div>
  );
}

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
  const [currentUser, setCurrentUser] = useState(null);
  const [submissions, setSubmissions] = useState({});
  const [showSwitch, setShowSwitch] = useState(false);
  const [showMac, setShowMac] = useState(false);
  const [showPetDebug, setShowPetDebug] = useState(false);
  const [showDevTools, setShowDevTools] = useState(false);
  const [petProfiles, setPetProfiles] = useState({});
  const [coinPops, setCoinPops] = useState([]);
  const [levelUpMsg, setLevelUpMsg] = useState(null);
  const [day, setDay] = useState(() => getSavedSimulatedDay());
  const [clockTick, setClockTick] = useState(() => Date.now());
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [undoStack, setUndoStack] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState({});
  const [firebaseTransactions, setFirebaseTransactions] = useState(null);
  const [previewOnly, setPreviewOnly] = useState(false);
  const doneMsg = useRef(DONE[Math.floor(Math.random() * DONE.length)]);
  const confettiRef = useRef(null);
  const confettiFiredRef = useRef(false);
  const presenceTabIdRef = useRef(null);
  const prevPetLevelRef = useRef(1);
  const petLevelReadyRef = useRef(false);

  useEffect(() => {
    if (localStorage.getItem(VERSION_KEY) !== APP_VERSION) {
      localStorage.removeItem(USER_KEY);
      localStorage.setItem(VERSION_KEY, APP_VERSION);
    }

    const savedUser = localStorage.getItem(USER_KEY);
    const savedSubs = localStorage.getItem(STORAGE_KEY);
    if (savedUser) setCurrentUser(savedUser);
    if (savedSubs) {
      try {
        setSubmissions(JSON.parse(savedSubs));
      } catch {
        setSubmissions({});
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(submissions));
  }, [submissions]);

  useEffect(() => {
    setSavedSimulatedDay(day);
  }, [day]);

  useEffect(() => ensureAnonymousAuth({
    onReady: () => setAuthReady(true),
    onError: (error) => {
      console.error('Anonymous Firebase sign-in failed:', error);
      setAuthError('Unable to sign in to Firebase automatically.');
    },
  }), []);

  useEffect(() => {
    const syncDayOffset = (event) => {
      if (event.key !== SIMULATED_DAY_KEY) return;
      setDay(getSavedSimulatedDay());
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
        const nextDay = Number.isFinite(Number(raw)) ? Number(raw) : 0;
        setSavedSimulatedDay(nextDay);
        setDay(nextDay);
      },
      () => {
        setDay(getSavedSimulatedDay());
      }
    );

    return () => unsubscribe();
  }, [authReady]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (currentUser) localStorage.setItem(USER_KEY, currentUser);
  }, [currentUser]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PET_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        setPetProfiles(parsed);
      }
    } catch (error) {
      console.warn('Failed to load pet state from localStorage:', error);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(PET_STORAGE_KEY, JSON.stringify(petProfiles));
  }, [petProfiles]);

  useEffect(() => {
    if (!currentUser) return;
    setPetProfiles((prev) => {
      if (prev[currentUser]) {
        const normalized = normalizePetType(prev[currentUser].petType);
        if (normalized === prev[currentUser].petType) return prev;
        return {
          ...prev,
          [currentUser]: {
            ...prev[currentUser],
            petType: normalized,
          },
        };
      }
      return {
        ...prev,
        [currentUser]: getDefaultPetState(currentUser),
      };
    });
    setLevelUpMsg(null);
    petLevelReadyRef.current = false;
  }, [currentUser]);

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

  const petState = currentUser ? petProfiles[currentUser] || getDefaultPetState(currentUser) : getDefaultPetState('Tony');
  const petLevel = getPetLevel(petState.xp);
  const xpBase = getXpForLevel(petLevel - 1);
  const xpNeeded = getXpForLevel(petLevel) - xpBase;
  const xpThisLevel = petState.xp - xpBase;
  const coins = petState.coins;
  const food = petState.food;
  const hp = petState.hp;
  const petXp = petState.xp;
  const petType = normalizePetType(petState.petType);

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

  const updateActivePet = (updater) => {
    if (!currentUser) return;
    setPetProfiles((prev) => {
      const current = prev[currentUser] || getDefaultPetState(currentUser);
      const nextPet = typeof updater === 'function' ? updater(current) : updater;
      return {
        ...prev,
        [currentUser]: nextPet,
      };
    });
  };

  const addCoinPop = (event) => {
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
  };

  const buyFood = () => {
    updateActivePet((pet) => {
      if (pet.coins < 1) return pet;
      return {
        ...pet,
        coins: pet.coins - 1,
        food: pet.food + 1,
      };
    });
  };

  const feedPet = () => {
    updateActivePet((pet) => {
      if (pet.food < 1) return pet;
      return {
        ...pet,
        food: pet.food - 1,
        hp: Math.min(100, Math.max(0, pet.hp + 10)),
        xp: pet.xp + 10,
      };
    });
  };

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
    if (!authReady) return undefined;

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
  }, [authReady]);

  useEffect(() => {
    if (!authReady) return undefined;

    if (!presenceTabIdRef.current) {
      const savedTabId = sessionStorage.getItem('cc_v4_presence_tab');
      presenceTabIdRef.current = savedTabId || `tab_${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem('cc_v4_presence_tab', presenceTabIdRef.current);
    }

    const presencePath = presenceTabIdRef.current;
    const userPresenceRef = ref(db, `${PRESENCE_ROOT}/${presencePath}`);

    const writePresence = async () => {
      if (!currentUser) {
        await remove(userPresenceRef);
        return;
      }

      const payload = {
        user: currentUser,
        ts: Date.now(),
      };
      await set(userPresenceRef, payload);
      const disconnect = onDisconnect(userPresenceRef);
      await disconnect.remove();
    };

    writePresence().catch((error) => {
      console.error('Failed to update presence:', error);
    });

    const interval = window.setInterval(() => {
      if (!currentUser) return;
      set(userPresenceRef, {
        user: currentUser,
        ts: Date.now(),
      }).catch((error) => {
        console.error('Failed to refresh presence:', error);
      });
    }, 4000);

    return () => {
      window.clearInterval(interval);
      remove(userPresenceRef).catch(() => {
        // ignore cleanup errors
      });
    };
  }, [authReady, currentUser]);

  const usingFirebaseTransactions = Array.isArray(firebaseTransactions);
  const sourceTransactions = useMemo(
    () => (usingFirebaseTransactions ? firebaseTransactions : []),
    [usingFirebaseTransactions, firebaseTransactions]
  );
  const transactionsById = useMemo(
    () => Object.fromEntries((sourceTransactions || []).map((tx) => [tx.id, tx])),
    [sourceTransactions]
  );
  const simulatedNow = useMemo(() => getSimulatedNow(new Date(clockTick)), [clockTick, day]);
  const referenceDateKey = useMemo(() => formatLocalDate(simulatedNow), [simulatedNow]);
  const liveDateTimeLabel = useMemo(() => formatLocalDateTime(simulatedNow), [simulatedNow]);
  const otherUser = currentUser ? getOtherUser(currentUser) : USERS[0];
  const dayLabel = day === 0 ? 'live' : `+${day} day${day === 1 ? '' : 's'}`;
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

  const firebaseSections = useMemo(() => {
    if (!usingFirebaseTransactions) return [];

    const pending = [];
    const agedPendingGroups = {};
    const datedTransactions = [];

    firebaseTransactions.forEach((tx) => {
      const visible = isVisibleForUser(tx, submissions, currentUser, day);
      if (!visible) return;

      const isPending = tx.isPending || !tx.date;
      if (isPending) {
        const pendingKey =
          tx.uploadedDay || getLocalDateKey(tx.uploadedDate || tx.date) || referenceDateKey;
        if (pendingKey === referenceDateKey) {
          pending.push(tx);
        } else {
          if (!agedPendingGroups[pendingKey]) agedPendingGroups[pendingKey] = [];
          agedPendingGroups[pendingKey].push(tx);
        }
        return;
      }

      datedTransactions.push(tx);
    });

    const datedGroups = groupTransactionsByDate(datedTransactions);
    const datedKeys = sortDateKeys(Object.keys(datedGroups));
    const agedPendingKeys = sortDateKeys(Object.keys(agedPendingGroups));

    const sections = [];
    if (pending.length > 0) {
      sections.push({
        key: 'pending',
        title: 'Pending',
        date: '',
        txs: pending,
      });
    }

    agedPendingKeys.forEach((dateKey) => {
      const txs = agedPendingGroups[dateKey] || [];
      if (txs.length === 0) return;
      sections.push({
        key: `pending-${dateKey}`,
        title: formatRelativeDayLabel(dateKey, simulatedNow),
        txs,
      });
    });

    datedKeys.forEach((dateKey) => {
      const txs = (datedGroups[dateKey] || []).filter((tx) =>
        isVisibleForUser(tx, submissions, currentUser, day)
      );
      if (txs.length === 0) return;
      sections.push({
        key: dateKey,
        title: formatRelativeDayLabel(dateKey, simulatedNow),
        txs,
      });
    });

    return sections;
  }, [usingFirebaseTransactions, firebaseTransactions, submissions, currentUser, day, simulatedNow]);

  const authLoading = currentUser && !authReady && !authError;

  const sections = firebaseSections;
  const visibleTxs = sections.flatMap((section) => section.txs);
  const anyVisible = visibleTxs.length > 0;

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

  const myRemaining = useMemo(
    () => sourceTransactions.filter((tx) => isVisibleForUser(tx, submissions, currentUser, day)).length,
    [sourceTransactions, submissions, currentUser, day]
  );
  const otherRemaining = useMemo(
    () => sourceTransactions.filter((tx) => isVisibleForUser(tx, submissions, otherUser, day)).length,
    [sourceTransactions, submissions, otherUser, day]
  );

  const userTallies = useMemo(() => {
    const out = {};
    USERS.forEach((u) => {
      out[u] = Object.entries(submissions).reduce((acc, [txId, sub]) => {
        const tx = transactionsById[txId];
        if (!tx || !shouldCountForAssignee(sub, u, day)) return acc;
        return acc + Number(tx.amount || 0);
      }, 0);
    });
    return out;
  }, [submissions, transactionsById, day]);

  const macTally = useMemo(
    () =>
      Object.entries(submissions).reduce((acc, [txId, sub]) => {
        const tx = transactionsById[txId];
        if (!tx || !shouldCountForAssignee(sub, 'Macquarie', day)) return acc;
        return acc + Number(tx.amount || 0);
      }, 0),
    [submissions, transactionsById, day]
  );

  const handleAssign = async (txId, value, event) => {
    if (!currentUser) return;
    const previousValue = submissions[txId]?.[currentUser]?.value ?? null;
    const shouldReward = previousValue !== value;
    setUndoStack((prev) => [
      ...prev,
      { txId, user: currentUser, prev: submissions[txId]?.[currentUser] || null },
    ]);

    setSubmissions((prev) => ({
      ...prev,
      [txId]: {
        ...prev[txId],
        [currentUser]: { value, ts: Date.now() },
      },
    }));

    try {
      await set(ref(db, `submissions/${txId}/${currentUser}`), {
        day,
        ts: Date.now(),
        value,
      });

      if (shouldReward) {
        updateActivePet((pet) => ({
          ...pet,
          coins: pet.coins + 1,
        }));
        addCoinPop(event);
      }
    } catch (err) {
      console.error('Failed to persist submission to Firebase:', err);
    }
  };

  const undo = async () => {
    const last = undoStack[undoStack.length - 1];
    if (!last) return;
    setUndoStack((prev) => prev.slice(0, -1));
    setSubmissions((prev) => {
      const next = { ...prev };
      if (!next[last.txId]) return next;
      if (last.prev) next[last.txId][last.user] = last.prev;
      else delete next[last.txId][last.user];
      return next;
    });

    try {
      if (last.prev) {
        await set(ref(db, `submissions/${last.txId}/${last.user}`), {
          day,
          ts: last.prev.ts || Date.now(),
          value: last.prev.value,
        });
      } else {
        await set(ref(db, `submissions/${last.txId}/${last.user}`), null);
      }
    } catch (err) {
      console.error('Failed to undo submission in Firebase:', err);
    }
  };

  const stepDay = () =>
    set(ref(db, SHARED_DAY_OFFSET_KEY), day + 1).catch((err) => {
      console.error('Failed to update shared simulated day:', err);
    });
  const resetDay = () => {
    set(ref(db, SHARED_DAY_OFFSET_KEY), 0).catch((err) => {
      console.error('Failed to reset shared simulated day:', err);
    });
  };

  const clearCache = async () => {
    if (!window.confirm('Reset all data? This clears ALL devices.')) return;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(PET_STORAGE_KEY);
    setSubmissions({});
    setUndoStack([]);
    setShowMac(false);
    setShowPetDebug(false);
    setShowDevTools(false);
    setCurrentUser(null);
    setPetProfiles({});
    setLevelUpMsg(null);
    setCoinPops([]);
    setDay(0);
    clearSavedSimulatedDay();

    try {
      await set(ref(db, 'submissions'), null);
    } catch (err) {
      console.error('Failed to clear Firebase submissions:', err);
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

      <div className="top-meta-bar">
        <div className="top-meta-main">
          <span className="meta-chip">
            <strong>{visibleNowLabel}</strong>
          </span>
          <span className="meta-chip">{visibleDateLabel}</span>
          <span className="meta-chip">Melbourne {dayLabel}</span>
        </div>
        <button className="debug-toggle" onClick={() => setShowDevTools((v) => !v)}>
          tools {showDevTools ? '\u25B2' : '\u25BC'}
        </button>
      </div>

      {showDevTools && (
        <div className="debug-tray">
          <div className="dev-banner">
            <span className="dev-label">dev</span>
            <div className="clock-panel">
              <span className="day-display">{liveDateTimeLabel}</span>
              <span className="clock-note">Melbourne {dayLabel}</span>
            </div>
            <button className="day-btn" onClick={stepDay}>
              next day +24h {'\u25B6'}
            </button>
            <button className="reset-btn" onClick={resetDay}>
              reset
            </button>
            <span className="dev-sep">|</span>
            <button className="day-btn" onClick={() => updateActivePet((pet) => ({ ...pet, coins: pet.coins + 5 }))}>
              +5{'\u{1FA99}'}
            </button>
            <button className="day-btn" onClick={() => updateActivePet((pet) => ({ ...pet, food: pet.food + 3 }))}>
              +3{'\u{1F356}'}
            </button>
            <button className="reset-btn" onClick={() => updateActivePet((pet) => ({ ...pet, coins: 0 }))}>
              0{'\u{1FA99}'}
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
            <span className="dev-sep">|</span>
            <button className="clear-btn" onClick={clearCache}>
              {'\u{1F5D1}'} clear
            </button>
          </div>

          {showPetDebug && (
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
            </div>
          )}
        </div>
      )}

      <div className="tally-bar">
        <div className="tally-main">
          {USERS.map((u, i) => (
            <React.Fragment key={u}>
              {i > 0 && <div style={{ width: '1px', background: 'rgba(255,255,255,0.05)' }} />}
              <div className={`tally-item ${u === currentUser ? 'me' : ''} ${u.toLowerCase()}`}>
                <div className="tally-name">{u}{u === currentUser ? ' (you)' : ''}</div>
                <div className="tally-amount">${(userTallies[u] || 0).toFixed(2)}</div>
                <div className="tally-note">own assignments</div>
              </div>
            </React.Fragment>
          ))}
        </div>
        {showMac && (
          <div className="mac-panel">
            <div className="tally-name">Macquarie</div>
            <div className="tally-amount mac">${macTally.toFixed(2)}</div>
            <div className="tally-note">shared</div>
          </div>
        )}
        <button className="mac-toggle" onClick={() => setShowMac((v) => !v)} title="Toggle Macquarie">
          {showMac ? '\u203A' : '\u2039'}
        </button>
      </div>

      <div className="app">
        <div className="app-header">
          <h1 className="app-title">Transactions</h1>
          <div className="header-right">
            <Link href="/admin/upload">
              <a className="day-btn header-upload-btn">upload</a>
            </Link>
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
            currentUser={currentUser}
            currentDay={day}
            onAssign={handleAssign}
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
      <ConfettiCanvas ref={confettiRef} />
      </div>

      <PetBar
        hp={hp}
        coins={coins}
        food={food}
        level={petLevel}
        xp={xpThisLevel}
        xpNeeded={xpNeeded}
        onBuyFood={buyFood}
        onFeedPet={feedPet}
        petType={petType}
      />
    </div>
  );
}
