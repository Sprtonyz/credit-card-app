const DEFAULT_MOOD = 'okay';
const VALID_MOODS = ['happy', 'okay', 'hungry', 'neglected'];
const VALID_PET_TYPES = ['classic', 'shiny', 'ember'];
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const HP_DECAY_PER_UNFED_DAY = 12;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isDateKey(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseDateKey(dateKey) {
  if (!isDateKey(dateKey)) return null;
  const parsed = Date.parse(`${dateKey}T00:00:00Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractDateKeyFromResetKey(resetKey, prefix) {
  if (typeof resetKey !== 'string') return null;
  if (!resetKey.startsWith(prefix)) return null;
  const value = resetKey.slice(prefix.length);
  return isDateKey(value) ? value : null;
}

function diffDays(currentDateKey, previousDateKey) {
  const currentMs = parseDateKey(currentDateKey);
  const previousMs = parseDateKey(previousDateKey);
  if (currentMs === null || previousMs === null) return null;
  return Math.round((currentMs - previousMs) / MS_PER_DAY);
}

function applyHpDecay(rawState, dateKey) {
  const hp = clamp(toFiniteNumber(rawState?.hp, 60), 0, 100);
  const currentDateKey = isDateKey(dateKey) ? dateKey : null;
  if (!currentDateKey) {
    return {
      hp,
      lastHpDecayDate: isDateKey(rawState?.lastHpDecayDate) ? rawState.lastHpDecayDate : null,
    };
  }

  const lastHpDecayDate = isDateKey(rawState?.lastHpDecayDate)
    ? rawState.lastHpDecayDate
    : isDateKey(rawState?.lastFedDate)
      ? rawState.lastFedDate
      : currentDateKey;
  const elapsedDays = Math.max(0, diffDays(currentDateKey, lastHpDecayDate) || 0);

  return {
    hp: clamp(hp - elapsedDays * HP_DECAY_PER_UNFED_DAY, 0, 100),
    lastHpDecayDate: currentDateKey,
  };
}

export function buildMissionResetKey(dateKey) {
  return `daily:${dateKey}`;
}

function buildWeeklyResetKey(dateKey) {
  const parsed = parseDateKey(dateKey);
  if (parsed === null) return `weekly:${dateKey}`;

  const date = new Date(parsed);
  const utcDay = date.getUTCDay();
  const diffToMonday = (utcDay + 6) % 7;
  date.setUTCDate(date.getUTCDate() - diffToMonday);
  return `weekly:${date.toISOString().slice(0, 10)}`;
}

export function getPetLevel(xp) {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 10)) + 1;
}

export function getXpForLevel(level) {
  return level * level * 10;
}

export function normalizePetType(value) {
  if (VALID_PET_TYPES.includes(value)) return value;
  return 'classic';
}

function normalizeMood(value) {
  if (VALID_MOODS.includes(value)) return value;
  return DEFAULT_MOOD;
}

export function getMoodLabel(mood) {
  if (mood === 'happy') return 'Very happy';
  if (mood === 'okay') return 'Happy';
  if (mood === 'hungry') return 'Hungry';
  if (mood === 'neglected') return 'Neglected';
  return 'Happy';
}

function createMissionTemplate({ id, type, title, target, reward, resetKey }) {
  return {
    id,
    type,
    title,
    progress: 0,
    target,
    reward,
    completed: false,
    resetKey,
  };
}

const DAILY_MISSION_POOL = [
  {
    id: 'feed-1',
    type: 'feed_pet',
    title: 'Feed the pet once',
    target: 1,
    reward: { food: 1, xp: 3 },
  },
  {
    id: 'feed-2',
    type: 'feed_pet',
    title: 'Feed the pet twice',
    target: 2,
    reward: { food: 1, xp: 4 },
  },
  {
    id: 'actions-3',
    type: 'pet_actions',
    title: 'Do 3 pet actions',
    target: 3,
    reward: { coins: 1, xp: 4 },
  },
  {
    id: 'actions-5',
    type: 'pet_actions',
    title: 'Do 5 pet actions',
    target: 5,
    reward: { coins: 2, xp: 6 },
  },
  {
    id: 'coins-2',
    type: 'earn_coins',
    title: 'Earn 2 coins from assignments',
    target: 2,
    reward: { food: 1, xp: 3 },
  },
  {
    id: 'coins-5',
    type: 'earn_coins',
    title: 'Earn 5 coins from assignments',
    target: 5,
    reward: { coins: 1, food: 1, xp: 6 },
  },
  {
    id: 'buyfood-1',
    type: 'buy_food',
    title: 'Buy 1 food',
    target: 1,
    reward: { coins: 1, xp: 3 },
  },
];

function getDaySequenceIndex(dateKey, length) {
  if (!isDateKey(dateKey) || length <= 0) return 0;
  const dayIndex = Math.floor(parseDateKey(dateKey) / MS_PER_DAY);
  const stride = 3;
  return (((dayIndex * stride) % length) + length) % length;
}

export function createDailyPetMissions(dateKey) {
  const resetKey = buildMissionResetKey(dateKey);
  const weeklyResetKey = buildWeeklyResetKey(dateKey);
  const startIndex = getDaySequenceIndex(dateKey, DAILY_MISSION_POOL.length);
  const dailyMissions = Array.from({ length: 3 }, (_, index) => {
    const missionIndex = (startIndex + index) % DAILY_MISSION_POOL.length;
    return DAILY_MISSION_POOL[missionIndex];
  });

  return [
    ...dailyMissions.map((mission) =>
      createMissionTemplate({
        ...mission,
        resetKey,
      })
    ),
    createMissionTemplate({
      id: 'close-5',
      type: 'close_transactions',
      title: 'Close 5 transactions this week',
      target: 5,
      reward: { coins: 2, food: 1, xp: 6 },
      resetKey: weeklyResetKey,
    }),
  ];
}

function normalizeMission(mission, template) {
  if (!mission || typeof mission !== 'object') return { ...template };

  const progress = clamp(toFiniteNumber(mission.progress, 0), 0, template.target);
  return {
    ...template,
    progress,
    completed: progress >= template.target,
  };
}

export function normalizePetState(rawState, dateKey) {
  const sourceMissions = Array.isArray(rawState?.missions) ? rawState.missions : [];
  const fallbackDailyResetKey = sourceMissions.find(
    (mission) => typeof mission?.resetKey === 'string' && mission.resetKey.startsWith('daily:')
  )?.resetKey;
  const fallbackDateKey =
    (isDateKey(dateKey) && dateKey) ||
    (isDateKey(rawState?.lastFedDate) && rawState.lastFedDate) ||
    (isDateKey(rawState?.lastStreakDate) && rawState.lastStreakDate) ||
    extractDateKeyFromResetKey(fallbackDailyResetKey, 'daily:') ||
    '1970-01-01';
  const templates = createDailyPetMissions(fallbackDateKey);
  const missionMap = new Map(sourceMissions.map((mission) => [mission?.id, mission]));
  const decayedHp = applyHpDecay(rawState, fallbackDateKey);

  const missions = templates.map((template) => {
    const saved = missionMap.get(template.id);
    if (!saved || saved.resetKey !== template.resetKey) return { ...template };
    return normalizeMission(saved, template);
  });

  return {
    coins: Math.max(0, toFiniteNumber(rawState?.coins, 0)),
    food: Math.max(0, toFiniteNumber(rawState?.food, 0)),
    hp: decayedHp.hp,
    xp: Math.max(0, toFiniteNumber(rawState?.xp, 0)),
    updatedAt: Math.max(0, Math.floor(toFiniteNumber(rawState?.updatedAt, 0))),
    petType: normalizePetType(rawState?.petType),
    streak: Math.max(0, Math.floor(toFiniteNumber(rawState?.streak, 0))),
    lastStreakDate: isDateKey(rawState?.lastStreakDate) ? rawState.lastStreakDate : null,
    mood: normalizeMood(rawState?.mood),
    lastFedDate: isDateKey(rawState?.lastFedDate) ? rawState.lastFedDate : null,
    lastHpDecayDate: decayedHp.lastHpDecayDate,
    missions,
  };
}

export function markPetStateUpdated(rawState, dateKey, updatedAt = Date.now()) {
  const normalized = normalizePetState(rawState, dateKey);
  const previousUpdatedAt = Math.max(0, Math.floor(toFiniteNumber(normalized.updatedAt, 0)));
  const nextUpdatedAt = Math.max(
    previousUpdatedAt + 1,
    Math.max(0, Math.floor(toFiniteNumber(updatedAt, Date.now())))
  );

  return {
    ...normalized,
    updatedAt: nextUpdatedAt,
  };
}

export function resolvePetType(petType, level, streak) {
  const baseType = normalizePetType(petType);
  if (baseType === 'ember') return 'ember';
  if (level >= 10 || streak >= 7) return 'ember';
  if (baseType === 'shiny') return 'shiny';
  if (level >= 5 || streak >= 3) return 'shiny';
  return 'classic';
}

export function derivePetMood(profile, dateKey) {
  const hp = clamp(toFiniteNumber(profile?.hp, 60), 0, 100);
  if (hp >= 100) return 'happy';
  if (hp >= 80) return 'okay';
  if (hp >= 40) return 'hungry';
  return 'neglected';
}

export function getFeedBenefits(mood) {
  if (mood === 'happy') return { hp: 12, xp: 12 };
  if (mood === 'hungry') return { hp: 9, xp: 9 };
  if (mood === 'neglected') return { hp: 8, xp: 8 };
  return { hp: 10, xp: 10 };
}

function getStreakBonus(streak) {
  if (streak > 0 && streak % 7 === 0) return { coins: 1, food: 1, xp: 2 };
  if (streak > 0 && streak % 5 === 0) return { xp: 3 };
  if (streak > 0 && streak % 3 === 0) return { food: 1 };
  return { coins: 1 };
}

function addReward(target, reward = {}) {
  target.coins += Math.max(0, toFiniteNumber(reward.coins, 0));
  target.food += Math.max(0, toFiniteNumber(reward.food, 0));
  target.xp += Math.max(0, toFiniteNumber(reward.xp, 0));
}

function bumpMission(mission, amount) {
  const nextProgress = clamp(mission.progress + amount, 0, mission.target);
  return {
    ...mission,
    progress: nextProgress,
    completed: mission.completed || nextProgress >= mission.target,
  };
}

export function applyPetActionProgress(profile, payload) {
  const dateKey = payload?.dateKey;
  const next = normalizePetState(profile, dateKey);

  const isMeaningfulAction = payload?.kind === 'assign' || payload?.kind === 'feed';
  if (isMeaningfulAction && next.lastStreakDate !== dateKey) {
    const daysBetween = diffDays(dateKey, next.lastStreakDate);
    next.streak = daysBetween === 1 ? next.streak + 1 : 1;
    next.lastStreakDate = dateKey;
    addReward(next, getStreakBonus(next.streak));
  }

  if (payload?.kind === 'feed') {
    next.food = Math.max(0, next.food - 1);
    next.lastFedDate = dateKey;
    next.lastHpDecayDate = dateKey;
    next.hp = clamp(next.hp + Math.max(0, toFiniteNumber(payload.hpGain, 0)), 0, 100);
    next.xp += Math.max(0, toFiniteNumber(payload.xpGain, 0));
  }

  if (payload?.kind === 'assign') {
    addReward(next, {
      coins: payload.coinReward,
      xp: payload.xpReward,
      food: payload.foodReward,
    });
  }

  next.missions = next.missions.map((mission) => {
    let updated = mission;

    if (payload?.kind === 'buy_food' && mission.type === 'buy_food') {
      updated = bumpMission(updated, 1);
    }

    if (payload?.kind === 'assign' && payload.coinReward > 0 && mission.type === 'close_transactions') {
      updated = bumpMission(updated, 1);
    }

    if (payload?.kind === 'feed' && mission.type === 'feed_pet') {
      updated = bumpMission(updated, 1);
    }

    if (
      (payload?.kind === 'feed' || payload?.kind === 'assign' || payload?.kind === 'buy_food') &&
      mission.type === 'pet_actions'
    ) {
      updated = bumpMission(updated, 1);
    }

    if (payload?.coinReward > 0 && mission.type === 'earn_coins') {
      updated = bumpMission(updated, payload.coinReward);
    }

    if (!mission.completed && updated.completed) {
      addReward(next, updated.reward);
    }

    return updated;
  });

  next.mood = derivePetMood(next, dateKey);
  next.petType = resolvePetType(next.petType, getPetLevel(next.xp), next.streak);

  return {
    pet: next,
  };
}
