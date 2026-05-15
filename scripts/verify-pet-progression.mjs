import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const petPath = path.join(rootDir, 'utils', 'petProgression.js');

const source = fs
  .readFileSync(petPath, 'utf8')
  .replace(/export function /g, 'function ');

const loadPetProgression = new Function(
  `${source}\nreturn { normalizePetState, markPetStateUpdated, applyPetActionProgress, derivePetMood };`
);
const { normalizePetState, markPetStateUpdated, applyPetActionProgress, derivePetMood } = loadPetProgression();

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

console.log('pet progression verification passed');
