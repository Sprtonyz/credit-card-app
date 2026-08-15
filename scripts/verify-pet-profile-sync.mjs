import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const petProgressionPath = path.join(rootDir, 'utils', 'petProgression.js');
const petProfileSyncPath = path.join(rootDir, 'utils', 'petProfileSync.js');
const petConfigPath = path.join(rootDir, 'utils', 'petConfig.js');

// Inline the real config rather than restating it, so new palettes/styles are
// always covered by these checks instead of silently drifting out of sync.
const configSource = fs.readFileSync(petConfigPath, 'utf8').replace(/^export /gm, '');

const petProgressionSource = fs
  .readFileSync(petProgressionPath, 'utf8')
  .replace(/export function /g, 'function ');
const petProfileSyncSource = fs
  .readFileSync(petProfileSyncPath, 'utf8')
  .replace(/^import[^\n]*petProgression[^\n]*\r?\n/m, '')
  .replace(/^import[^\n]*petConfig[^\n]*\r?\n/m, '')
  .replace(/export function /g, 'function ');

const loadPetSync = new Function(
  `${configSource}\n${petProgressionSource.replace(/import[\s\S]*?from '\.\/petConfig';\r?\n\r?\n/, '')}\n${petProfileSyncSource}\nreturn { markPetStateUpdated, comparePetProfiles, mergePetProfileMaps, normalizePetProfilesMap };`
);
const { markPetStateUpdated, comparePetProfiles, mergePetProfileMaps, normalizePetProfilesMap } = loadPetSync();

function run(name, fn) {
  fn();
  console.log(`ok - ${name}`);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label || 'value'}: expected ${expected}, got ${actual}`);
  }
}

function assertGreaterThan(actual, expected, label) {
  if (!(actual > expected)) {
    throw new Error(`${label || 'value'}: expected ${actual} to be greater than ${expected}`);
  }
}

run('newer pet profile wins even after spending gold', () => {
  const dateKey = '2026-05-15';
  const staleRemote = {
    coins: 25,
    food: 0,
    hp: 100,
    xp: 640,
    updatedAt: 1000,
  };
  const localPurchase = markPetStateUpdated(
    {
      ...staleRemote,
      coins: 24,
      food: 1,
    },
    dateKey,
    1000
  );

  assertGreaterThan(comparePetProfiles(localPurchase, staleRemote, dateKey), 0, 'profile comparison');

  const merged = mergePetProfileMaps(
    { Tony: staleRemote },
    { Tony: localPurchase },
    dateKey
  );

  assertEqual(merged.Tony.coins, 24, 'coins');
  assertEqual(merged.Tony.food, 1, 'food');
  assertEqual(merged.Tony.updatedAt, 1001, 'updatedAt');
});

run('legacy untimestamped profiles keep the existing stat-based merge', () => {
  const dateKey = '2026-05-15';
  const remote = { coins: 25, food: 0, hp: 100, xp: 640 };
  const local = { coins: 24, food: 1, hp: 100, xp: 640 };
  const merged = mergePetProfileMaps({ Tony: remote }, { Tony: local }, dateKey);

  assertEqual(merged.Tony.coins, 25, 'coins');
  assertEqual(merged.Tony.food, 0, 'food');
});

run('normalization injects stable user identities for separate pets', () => {
  const normalized = normalizePetProfilesMap(
    {
      Tony: { xp: 5 },
      Nugs: { xp: 7 },
    },
    '2026-05-15'
  );

  assertEqual(normalized.Tony.identity.name, 'Maple', 'Tony name');
  assertEqual(normalized.Nugs.identity.name, 'Mochi', 'Nugs name');
});

console.log('pet profile sync verification passed');
