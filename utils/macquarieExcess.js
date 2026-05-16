export const MACQUARIE_EXCESS_THRESHOLD = 800;

const MACQUARIE_EXCESS_SHARE_RATIOS = {
  Tony: 2 / 3,
  Nugs: 1 / 3,
};

export function getMacquarieExcessAmount(macquarieTotal) {
  const total = Number(macquarieTotal) || 0;
  return Math.max(0, total - MACQUARIE_EXCESS_THRESHOLD);
}

export function getMacquarieExcessShare(profileName, macquarieTotal) {
  const ratio = MACQUARIE_EXCESS_SHARE_RATIOS[profileName] || 0;
  return getMacquarieExcessAmount(macquarieTotal) * ratio;
}

export function buildMacquarieExcessShares(profileNames, macquarieTotal) {
  return Object.fromEntries(
    profileNames.map((profileName) => [profileName, getMacquarieExcessShare(profileName, macquarieTotal)])
  );
}

function getBreakdownEntryAmount(entry) {
  const amount = Number(entry?.countedAmount ?? entry?.amount ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

export function buildMacquarieExcessEntryShares(entries = [], profileName, macquarieTotal) {
  const excessAmount = getMacquarieExcessAmount(macquarieTotal);
  const shareRatio = MACQUARIE_EXCESS_SHARE_RATIOS[profileName] || 0;
  if (excessAmount <= 0 || shareRatio <= 0) return [];

  let remainingExcess = excessAmount;

  return [...entries]
    .sort((left, right) => getBreakdownEntryAmount(right) - getBreakdownEntryAmount(left))
    .map((entry) => {
      const macquarieAmount = getBreakdownEntryAmount(entry);
      const availableForExcess = Math.max(0, macquarieAmount);
      if (remainingExcess <= 0 || availableForExcess <= 0) return null;

      const macquarieExcessAmount = Math.min(availableForExcess, remainingExcess);
      remainingExcess = Math.max(0, remainingExcess - macquarieExcessAmount);

      return {
        ...entry,
        macquarieAmount,
        macquarieExcessAmount,
        countedAmount: macquarieExcessAmount * shareRatio,
        amount: macquarieExcessAmount * shareRatio,
        assignmentState: 'Mac excess',
      };
    })
    .filter(Boolean);
}
