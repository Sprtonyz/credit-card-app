export const PET_PROFILE_VERSION = 2;

export const PET_IDENTITY_PRESETS = Object.freeze({
  Tony: Object.freeze({
    name: 'Maple',
    palette: 'maple',
    companionStyle: 'cat',
    homeAnchor: 'left',
  }),
  Nugs: Object.freeze({
    name: 'Mochi',
    palette: 'mochi',
    companionStyle: 'dog',
    homeAnchor: 'right',
  }),
});

export const PET_DEFAULT_IDENTITY = Object.freeze({
  name: 'Cozy',
  palette: 'maple',
  companionStyle: 'cat',
  homeAnchor: 'left',
});

export const VALID_PET_PALETTES = ['maple', 'mochi', 'bluebell', 'ember'];
export const VALID_COMPANION_STYLES = ['cat', 'dog', 'blob', 'fox'];
export const VALID_HOME_ANCHORS = ['left', 'right'];

export const PET_VARIANTS = Object.freeze([
  Object.freeze({
    id: 'maple',
    name: 'Maple',
    palette: 'maple',
    companionStyle: 'cat',
    blurb: 'Warm amber cat with pointed ears and a curled upright tail.',
  }),
  Object.freeze({
    id: 'mochi',
    name: 'Mochi',
    palette: 'mochi',
    companionStyle: 'dog',
    blurb: 'Soft blush pup with long floppy ears and a stubby wagging tail.',
  }),
  Object.freeze({
    id: 'bluebell',
    name: 'Bluebell',
    palette: 'bluebell',
    companionStyle: 'blob',
    blurb: 'Earless blob with a leaf sprout that reads clearly at small scale.',
  }),
  Object.freeze({
    id: 'ember',
    name: 'Ember',
    palette: 'ember',
    companionStyle: 'fox',
    blurb: 'Tall tipped ears, dark socks, and a white-tipped bushy tail.',
  }),
]);

export const PET_MOODS = ['excited', 'content', 'sleepy', 'hungry', 'neglected'];
export const PET_ANIMATION_MODES = ['idle', 'walk', 'feed', 'celebrate', 'sleep', 'sad'];

export function getPetIdentityPreset(user) {
  return PET_IDENTITY_PRESETS[user] || PET_DEFAULT_IDENTITY;
}
