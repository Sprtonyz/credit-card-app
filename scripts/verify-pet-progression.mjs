import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const petPath = path.join(rootDir, 'utils', 'petProgression.js');
const petConfigPath = path.join(rootDir, 'utils', 'petConfig.js');

// Inline the real config rather than restating it, so new palettes/styles are
// always covered by these checks instead of silently drifting out of sync.
const configSource = fs.readFileSync(petConfigPath, 'utf8').replace(/^export /gm, '');

const source = fs
  .readFileSync(petPath, 'utf8')
  .replace(/export function /g, 'function ');

const loadPetProgression = new Function(
  `${configSource}\n${source.replace(/import[\s\S]*?from '\.\/petConfig';\r?\n\r?\n/, '')}\nreturn { normalizePetState, markPetStateUpdated, applyPetActionProgress, derivePetMood, resolvePetAnimationMode, VALID_PET_PALETTES, VALID_COMPANION_STYLES, PET_VARIANTS };`
);
const {
  normalizePetState,
  markPetStateUpdated,
  applyPetActionProgress,
  derivePetMood,
  resolvePetAnimationMode,
  VALID_PET_PALETTES,
  VALID_COMPANION_STYLES,
  PET_VARIANTS,
} = loadPetProgression();

function run(name, fn) {
  fn();
  console.log(`ok - ${name}`);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label || 'value'}: expected ${expected}, got ${actual}`);
  }
}

run('decays hp once for each unfed day', () => {
  const pet = normalizePetState(
    {
      hp: 100,
      lastFedDate: '2026-04-28',
    },
    '2026-05-01'
  );

  assertEqual(pet.hp, 64, 'hp');
  assertEqual(pet.lastHpDecayDate, '2026-05-01', 'lastHpDecayDate');
  assertEqual(derivePetMood(pet, '2026-05-01'), 'hungry', 'mood');
});

run('does not double decay after state has been normalized for the day', () => {
  const first = normalizePetState(
    {
      hp: 100,
      lastFedDate: '2026-04-28',
    },
    '2026-05-01'
  );
  const second = normalizePetState(first, '2026-05-01');

  assertEqual(second.hp, 64, 'hp');
  assertEqual(second.lastHpDecayDate, '2026-05-01', 'lastHpDecayDate');
});

run('marks pet state updates with a monotonic timestamp', () => {
  const pet = markPetStateUpdated(
    {
      coins: 25,
      food: 0,
      updatedAt: 1000,
    },
    '2026-05-01',
    1000
  );

  assertEqual(pet.updatedAt, 1001, 'updatedAt');
});

run('feeding applies decay first, then restores hp and resets decay date', () => {
  const { pet } = applyPetActionProgress(
    {
      hp: 100,
      food: 1,
      lastFedDate: '2026-04-28',
    },
    {
      dateKey: '2026-05-01',
      kind: 'feed',
      hpGain: 9,
      xpGain: 9,
    }
  );

  assertEqual(pet.hp, 73, 'hp');
  assertEqual(pet.food, 0, 'food');
  assertEqual(pet.lastFedDate, '2026-05-01', 'lastFedDate');
  assertEqual(pet.lastHpDecayDate, '2026-05-01', 'lastHpDecayDate');
});

run('normalizes separate user pet identities deterministically', () => {
  const tonyPet = normalizePetState(null, '2026-05-01', 'Tony');
  const nugsPet = normalizePetState(null, '2026-05-01', 'Nugs');

  assertEqual(tonyPet.identity.name, 'Maple', 'Tony pet name');
  assertEqual(tonyPet.identity.palette, 'maple', 'Tony palette');
  assertEqual(nugsPet.identity.name, 'Mochi', 'Nugs pet name');
  assertEqual(nugsPet.identity.palette, 'mochi', 'Nugs palette');
});

run('fresh pets walk immediately on first load', () => {
  const tonyPet = normalizePetState(null, '2026-05-01', 'Tony');
  const nugsPet = normalizePetState(null, '2026-05-01', 'Nugs');

  assertEqual(resolvePetAnimationMode(tonyPet), 'walk', 'Tony initial animation');
  assertEqual(resolvePetAnimationMode(nugsPet), 'walk', 'Nugs initial animation');
});

run('feeding sets a temporary feed animation before returning to baseline later', () => {
  const { pet } = applyPetActionProgress(
    normalizePetState({ food: 2, hp: 70 }, '2026-05-01', 'Tony'),
    {
      dateKey: '2026-05-01',
      kind: 'feed',
      hpGain: 10,
      xpGain: 10,
      user: 'Tony',
    }
  );

  assertEqual(pet.animation.mode, 'feed', 'animation mode');
  assertEqual(resolvePetAnimationMode(pet, pet.animation.until - 1), 'feed', 'active animation');
  assertEqual(resolvePetAnimationMode(pet, pet.animation.until + 1), 'walk', 'expired animation');
});

run('every published pet variant survives normalization', () => {
  assertEqual(PET_VARIANTS.length, 4, 'variant count');

  PET_VARIANTS.forEach((variant) => {
    if (!VALID_PET_PALETTES.includes(variant.palette)) {
      throw new Error(`${variant.id}: palette ${variant.palette} is not registered`);
    }
    if (!VALID_COMPANION_STYLES.includes(variant.companionStyle)) {
      throw new Error(`${variant.id}: style ${variant.companionStyle} is not registered`);
    }

    const pet = normalizePetState(
      {
        identity: {
          name: variant.name,
          palette: variant.palette,
          companionStyle: variant.companionStyle,
          homeAnchor: 'left',
        },
      },
      '2026-05-01',
      'Tony'
    );

    assertEqual(pet.identity.palette, variant.palette, `${variant.id} palette persisted`);
    assertEqual(
      pet.identity.companionStyle,
      variant.companionStyle,
      `${variant.id} style persisted`
    );
  });
});

run('unknown palettes and styles still fall back to the user preset', () => {
  const pet = normalizePetState(
    { identity: { palette: 'neon', companionStyle: 'dragon' } },
    '2026-05-01',
    'Nugs'
  );

  assertEqual(pet.identity.palette, 'mochi', 'fallback palette');
  assertEqual(pet.identity.companionStyle, 'dog', 'fallback style');
});

console.log('pet progression verification passed');
