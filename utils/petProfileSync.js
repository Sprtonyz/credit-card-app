import { normalizePetState } from './petProgression';

const DEFAULT_PROFILE_NAMES = ['Tony', 'Nugs'];

export function normalizePetProfilesMap(rawProfiles, dateKey, profileNames = DEFAULT_PROFILE_NAMES) {
  if (!rawProfiles || typeof rawProfiles !== 'object') return {};

  return Object.fromEntries(
    Object.entries(rawProfiles)
      .filter(([user]) => profileNames.includes(user))
      .map(([user, state]) => [user, normalizePetState(state, dateKey)])
  );
}

function getMissionProgressTotal(profile) {
  return (profile?.missions || []).reduce(
    (total, mission) => total + Math.max(0, Number(mission?.progress || 0)),
    0
  );
}

export function getPetMissionSignature(mission) {
  if (!mission || typeof mission !== 'object') return '';
  return [
    mission.id || '',
    mission.type || '',
    Number(mission.progress || 0),
    Number(mission.target || 0),
    mission.completed ? 1 : 0,
    mission.resetKey || '',
  ].join(':');
}

export function getPetProfileSignature(rawProfile, dateKey) {
  if (!rawProfile || typeof rawProfile !== 'object') return '';
  const profile = normalizePetState(rawProfile, dateKey);
  return [
    Number(profile.updatedAt || 0),
    Number(profile.coins || 0),
    Number(profile.food || 0),
    Number(profile.hp || 0),
    Number(profile.xp || 0),
    profile.petType || '',
    Number(profile.streak || 0),
    profile.lastStreakDate || '',
    profile.mood || '',
    profile.lastFedDate || '',
    profile.lastHpDecayDate || '',
    (profile.missions || []).map(getPetMissionSignature).join(','),
  ].join('|');
}

export function getPetProfilesMapSignature(rawProfiles, dateKey, profileNames = DEFAULT_PROFILE_NAMES) {
  return Object.entries(rawProfiles || {})
    .filter(([user]) => profileNames.includes(user))
    .sort(([leftUser], [rightUser]) => leftUser.localeCompare(rightUser))
    .map(([user, profile]) => `${user}=${getPetProfileSignature(profile, dateKey)}`)
    .join(';');
}

export function comparePetProfiles(leftRaw, rightRaw, dateKey) {
  const left = normalizePetState(leftRaw, dateKey);
  const right = normalizePetState(rightRaw, dateKey);
  const leftUpdatedAt = Number(left.updatedAt || 0);
  const rightUpdatedAt = Number(right.updatedAt || 0);

  if (leftUpdatedAt || rightUpdatedAt) {
    if (leftUpdatedAt > rightUpdatedAt) return 1;
    if (leftUpdatedAt < rightUpdatedAt) return -1;
  }

  const checks = [
    [left.xp, right.xp],
    [left.coins, right.coins],
    [left.food, right.food],
    [left.streak, right.streak],
    [getMissionProgressTotal(left), getMissionProgressTotal(right)],
    [left.hp, right.hp],
  ];

  for (const [leftValue, rightValue] of checks) {
    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }

  return 0;
}

export function mergePetProfileMaps(baseProfiles, candidateProfiles, dateKey, profileNames = DEFAULT_PROFILE_NAMES) {
  const next = { ...normalizePetProfilesMap(baseProfiles, dateKey, profileNames) };
  const incoming = normalizePetProfilesMap(candidateProfiles, dateKey, profileNames);

  Object.entries(incoming).forEach(([user, profile]) => {
    const current = next[user];
    if (!current || comparePetProfiles(profile, current, dateKey) > 0) {
      next[user] = profile;
    }
  });

  return next;
}
