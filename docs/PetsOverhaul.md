# Pets Overhaul

## Goal

This document captures the pet-system overhaul that was implemented in this environment, why it was needed, what changed, and how to validate it properly once the project is back in a working Node/npm environment.

The pet work was intentionally kept **isolated to the pet system**. No non-pet transaction, admin, import, reconciliation, or email workflows were intentionally changed.

---

## Why the overhaul was needed

The previous pet implementation had a few structural problems:

1. **Pet identity was unstable**
   - Pet visuals could drift or change unexpectedly across refreshes.
   - Switching users could cause appearance/state bleed between Tony and Nugs.
   - Pet appearance was too loosely tied to derived state like level/type rather than a stable persisted identity.

2. **Hydration and sync were fragile**
   - Local storage hydration, Firebase sync, and legacy migration all interacted in ways that could overwrite or merge pet state unexpectedly.
   - There was no strong per-user identity layer to protect one user’s pet from the other user’s data.

3. **Rendering and state were too entangled**
   - The pet renderer lived inline inside `components/CreditCardApp.jsx`.
   - Animation state was not modeled explicitly enough for predictable behavior like feeding or mood-driven motion.

4. **The old system did not support richer pet UX well**
   - Mood was too simple.
   - Animations were limited.
   - It was difficult to extend toward a more cozy, companion-style pet loop.

---

## Files added or changed

### New files

- `docs/PetsOverhaul.md`
- `utils/petConfig.js`
- `components/PetCompanion.jsx`

### Changed files

- `utils/petProgression.js`
- `utils/petProfileSync.js`
- `components/CreditCardApp.jsx`
- `pages/pet-testing.jsx`
- `scripts/verify-pet-progression.mjs`
- `scripts/verify-pet-profile-sync.mjs`

---

## Summary of the implemented changes

## 1. Stable per-user pet identity

Added `utils/petConfig.js` to define explicit pet identity presets.

### Current identity model

Each user now has a deterministic default pet identity:

- **Tony**
  - name: `Maple`
  - palette: `maple`
  - companionStyle: `cat`
  - homeAnchor: `left`

- **Nugs**
  - name: `Mochi`
  - palette: `mochi`
  - companionStyle: `dog`
  - homeAnchor: `right`

### Why this matters

This separates:

- **who the pet is**  
from
- **how the pet currently feels or animates**

That split is important because refreshes and sync should never randomly change pet identity.

---

## 2. Versioned pet profile model

The normalized pet state now includes:

- `profileVersion`
- `identity`
  - `name`
  - `palette`
  - `companionStyle`
  - `homeAnchor`
- progression values
  - `coins`
  - `food`
  - `hp`
  - `xp`
  - `streak`
- timing values
  - `updatedAt`
  - `lastFedDate`
  - `lastHpDecayDate`
  - `lastStreakDate`
- `mood`
- `missions`
- `animation`
  - `mode`
  - `until`
  - `activeMood`
  - `bounce`
  - `lastEvent`

This was implemented in `utils/petProgression.js`.

---

## 3. Richer mood model

The pet mood system was expanded from the older simpler states into:

- `excited`
- `content`
- `sleepy`
- `hungry`
- `neglected`

### Mood logic

Mood is now derived more intentionally from:

- HP
- time since feeding
- streak/activity

This gives a better base for:

- different animation styles
- care feedback
- future UX expansion

---

## 4. Explicit pet animation state

The new animation modes are:

- `idle`
- `walk`
- `feed`
- `celebrate`
- `sleep`
- `sad`

### Current behavior

- **feed**: temporary animation when feeding
- **celebrate**: temporary animation for positive reward moments
- **sleep**: fallback when pet mood is sleepy
- **sad**: fallback when pet mood is neglected
- **walk**: normal active baseline
- **idle**: available as a neutral state

### Important design decision

Temporary animations use `animation.until`, so they can play briefly and then return to a normal baseline state.

---

## 5. New cozy renderer extracted from the main app

The old inline pet canvas code in `components/CreditCardApp.jsx` was replaced with a dedicated component:

- `components/PetCompanion.jsx`

### What the new renderer does

- draws a cozy companion in code instead of depending on production sprite images
- supports:
  - walking
  - feeding
  - celebration
  - sleep
  - sad/neglected state
- uses palette-based styling
- draws a distinct silhouette per `companionStyle`
- respects the pet’s home anchor
- is designed to be replaceable later with real sprite assets

### Variants

`companionStyle` is no longer metadata only — each style has its own drawn
silhouette, matched to the concept sheet in `public/pet-testing/pet-variants.svg`:

| Variant | Style | Palette | Distinguishing art |
| --- | --- | --- | --- |
| Maple | `cat` | `maple` | Pointed ears, whiskers, curled upright tail |
| Mochi | `dog` | `mochi` | Long floppy ears, rounded muzzle, stubby wagging tail |
| Bluebell | `blob` | `bluebell` | Earless mass, leaf sprout, small nub arms |
| Ember | `fox` | `ember` | Tall dark-tipped ears, dark socks, white-tipped bushy tail |

Styles and palettes are registered in `utils/petConfig.js`
(`VALID_COMPANION_STYLES`, `VALID_PET_PALETTES`, `PET_VARIANTS`). Adding a new
variant means adding it there plus a renderer entry in `STYLE_RENDERERS`.

### Walk cycle

Walking is an alternating march rather than a slide: each foot lifts and shifts
on its half of the cycle, the body rises on the push-off, and the head sway,
tail swing, and dog ear flop all trail slightly behind the step phase. The pet
also travels horizontally and mirrors when it turns around.

### Why this is better

- isolates pet rendering logic
- makes behavior easier to reason about
- lets the app keep working while art is still evolving

---

## 6. Safer pet hydration and sync

`utils/petProfileSync.js` and the pet-related logic in `components/CreditCardApp.jsx` were updated so that:

- local storage pet state is normalized per user
- Firebase profiles are normalized per user
- merge logic respects the new profile structure
- legacy profile data still has a migration path
- missing users get seeded into a stable default identity shape

### Intended result

- Tony’s pet stays Tony’s pet
- Nugs’ pet stays Nugs’ pet
- refreshes should not randomly swap appearance or identity
- local/Firebase merges should no longer cause identity bleed

---

## 7. Main app pet UI improvements

`components/CreditCardApp.jsx` was updated to use the new pet model and renderer.

### UI changes

- pet bar now shows:
  - pet name
  - mood
  - animation mode
  - palette/style hint
  - lightweight care hint
- mission panel text is now phrased around the active pet identity

### Debug area

The pet debug controls were shifted away from old sprite/type assumptions and now better reflect:

- identity palette
- mood-driven animation
- new renderer behavior

---

## 8. Sandbox route rebuilt

The old `pages/pet-testing.jsx` was replaced with a more useful live sandbox.

### New sandbox capabilities

- switch between Tony and Nugs
- preview per-user pet identity
- switch animation state manually
- switch mood manually
- switch variant (style + palette) manually
- switch palette manually
- adjust scale
- preview the same renderer used by the main app

Every selected animation mode is pinned while previewing, so `idle`, `sleep`,
and `sad` can be inspected directly instead of falling back to the mood-derived
baseline.

### Why this matters

This should be the first place to test visual/animation iteration before wiring further changes into the main experience.

---

## Validation steps in the correct environment

This environment did **not** have `node` or `npm` available, so proper runtime verification could not be executed here.

When you move back into the correct environment, use the following checklist.

## 1. Run targeted pet scripts

Run:

```bash
npm run test:pet-progression
npm run test:pet-profile-sync
```

These should validate:

- normalized pet identity defaults
- progression behavior
- sync merge behavior
- feed animation metadata behavior

If you want the larger suite:

```bash
npm test
```

---

## 2. Open the pet sandbox

Run the app and visit:

```text
/pet-testing
```

Check all of the following:

1. Switching between **Tony** and **Nugs** shows different stable pet identities.
2. Changing **palette** updates visuals predictably.
3. Changing **animation** switches movement style correctly.
4. Changing **mood** changes the presentation/behavior correctly.
5. Scaling works and does not clip or break layout.

---

## 3. Verify main app persistence behavior

In the main app:

1. Log in as **Tony**
2. Observe Tony’s pet identity and mood
3. Refresh the page
4. Confirm Tony’s pet identity stays the same
5. Switch to **Nugs**
6. Confirm Nugs has a separate pet identity/state
7. Refresh again
8. Confirm Nugs’ pet remains stable
9. Switch back to Tony
10. Confirm Tony’s pet did not inherit Nugs’ appearance or state

This is the most important functional regression check.

---

## 4. Verify feeding flow

In the main app:

1. Ensure the active user has food available
2. Click **feed**
3. Confirm:
   - food decreases by 1
   - HP increases
   - mood updates if applicable
   - animation enters the temporary `feed` state
   - pet returns to baseline behavior after the temporary animation

If this does not happen, inspect:

- `feedPet` in `components/CreditCardApp.jsx`
- `applyPetActionProgress` in `utils/petProgression.js`
- `resolveAnimationState` in `components/PetCompanion.jsx`

---

## 5. Verify mood transitions

Check each mood by manipulating state in the pet sandbox or debug tools:

- `excited`
- `content`
- `sleepy`
- `hungry`
- `neglected`

Expected behavior:

- sleepy -> calmer/resting style
- neglected -> sadder state
- content/excited -> more lively active state

---

## 6. Verify Firebase merge stability

With two browser sessions if possible:

1. Open app as Tony in one browser
2. Open app as Tony in another browser
3. Trigger pet changes in one session
4. Confirm state syncs without changing identity unexpectedly
5. Repeat for Nugs
6. Repeat while switching users and refreshing

Specifically confirm:

- no cross-user identity bleed
- no reset to a different pet appearance after refresh
- no Firebase merge overwriting a newer local pet unexpectedly

---

## 7. Regression checks

Because the request was to avoid tampering with non-pet systems, quickly confirm:

- transaction assignment still works
- user switching still works
- tally bars still render
- admin pages still open
- pet footer does not overlap core UI incorrectly

---

## Known environment limitation during this work

This implementation was completed in an environment where:

- `node` was unavailable
- `npm` was unavailable
- scripts could be edited but not executed

So the correct next step is **runtime verification in the proper local dev environment**.

---

## Recommended next follow-up after validation

If the pet overhaul validates successfully, the next high-value improvements would be:

1. allow per-user pet renaming in the UI
2. add cosmetic unlock progression not tied to identity drift
3. replace or augment code-drawn art with production sprite assets
4. add a cleaner pet profile card/modal
5. add stronger debug controls specifically for animation-state testing

