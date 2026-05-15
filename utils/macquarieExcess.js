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
