export const PRIZE_GAME_ROUND_FIRST = 1;
export const PRIZE_GAME_ROUND_SECOND = 2;

export function buildPrizeLoseState(state, now = Date.now(), secondChanceDelayMs = 15000) {
  return {
    ...(state || {}),
    attemptCount: (state?.attemptCount || 0) + 1,
    consumed: false,
    completedAt: null,
    lastOutcome: 'lose',
    round: PRIZE_GAME_ROUND_SECOND,
    secondChanceAt: now + secondChanceDelayMs,
  };
}

export function buildPrizeWinState(state, now = Date.now()) {
  return {
    ...(state || {}),
    attemptCount: (state?.attemptCount || 0) + 1,
    consumed: false,
    completedAt: now,
    lastOutcome: 'win',
    round: PRIZE_GAME_ROUND_SECOND,
    secondChanceAt: null,
  };
}

export function shouldShowPrizeReady(state, phase) {
  const secondChanceAt = Number(state?.secondChanceAt || 0);
  return (
    state?.lastOutcome === 'lose' &&
    secondChanceAt <= 0 &&
    state?.round === PRIZE_GAME_ROUND_SECOND &&
    phase !== 'winning' &&
    phase !== 'won'
  );
}

