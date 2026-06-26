import assert from 'node:assert/strict';
import { buildPrizeLoseState, buildPrizeWinState, shouldShowPrizeReady } from '../utils/prizeGame.js';

const now = 1_700_000_000_000;

for (const cupIndex of [0, 1, 2]) {
  const loseState = buildPrizeLoseState({ attemptCount: 0, round: 1 }, now, 15000);
  assert.equal(loseState.lastOutcome, 'lose', `cup ${cupIndex + 1} first pick should lose`);
  assert.equal(loseState.round, 2, `cup ${cupIndex + 1} first pick should open second chance`);
  assert.equal(loseState.secondChanceAt, now + 15000, `cup ${cupIndex + 1} first pick should arm the timer`);
}

const readyState = {
  attemptCount: 1,
  lastOutcome: 'lose',
  secondChanceAt: 0,
  round: 2,
};

assert.equal(shouldShowPrizeReady(readyState, 'countdown'), true, 'second chance should become ready after the timer');

for (const cupIndex of [0, 1, 2]) {
  const winState = buildPrizeWinState({ attemptCount: 1, round: 2 }, now + 15000);
  assert.equal(winState.lastOutcome, 'win', `cup ${cupIndex + 1} second pick should win`);
  assert.equal(winState.round, 2, `cup ${cupIndex + 1} second pick should stay on the second round`);
  assert.equal(winState.secondChanceAt, null, `cup ${cupIndex + 1} second pick should clear the timer`);
}

console.log('Prize game verification passed.');
