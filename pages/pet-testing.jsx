import Head from 'next/head';
import { useMemo, useState } from 'react';
import PetCompanion from '../components/PetCompanion';
import { PET_VARIANTS, VALID_PET_PALETTES } from '../utils/petConfig';
import { normalizePetState } from '../utils/petProgression';

const SANDBOX_PRESETS = {
  Tony: normalizePetState(
    {
      xp: 120,
      food: 3,
      hp: 98,
      streak: 4,
      mood: 'excited',
      animation: { mode: 'walk', until: 0, activeMood: 'excited' },
    },
    '2026-08-14',
    'Tony'
  ),
  Nugs: normalizePetState(
    {
      xp: 62,
      food: 1,
      hp: 58,
      streak: 1,
      mood: 'sleepy',
      animation: { mode: 'sleep', until: Date.now() + 999999, activeMood: 'sleepy' },
    },
    '2026-08-14',
    'Nugs'
  ),
};

const MODES = ['walk', 'idle', 'feed', 'celebrate', 'sleep', 'sad'];
const MOODS = ['excited', 'content', 'sleepy', 'hungry', 'neglected'];
const PALETTES = VALID_PET_PALETTES;

export default function PetTestingPage() {
  const [user, setUser] = useState('Tony');
  const [mode, setMode] = useState('walk');
  const [mood, setMood] = useState('content');
  const [variantId, setVariantId] = useState('maple');
  const [palette, setPalette] = useState('maple');
  const [scale, setScale] = useState(100);

  const variant = useMemo(
    () => PET_VARIANTS.find((entry) => entry.id === variantId) || PET_VARIANTS[0],
    [variantId]
  );

  const selectVariant = (entry) => {
    setVariantId(entry.id);
    setPalette(entry.palette);
  };

  const pet = useMemo(() => {
    const base = SANDBOX_PRESETS[user];
    return {
      ...base,
      mood,
      identity: {
        ...base.identity,
        name: variant.name,
        palette,
        companionStyle: variant.companionStyle,
      },
      animation: {
        ...base.animation,
        mode,
        activeMood: mood,
        // Pin every previewed mode so the sandbox shows the state you picked
        // instead of falling back to the mood-derived baseline.
        until: Date.now() + 9999999,
      },
    };
  }, [mode, mood, palette, user, variant]);

  return (
    <>
      <Head>
        <title>Pet Testing</title>
        <meta
          name="description"
          content="Sandbox for the upgraded cozy pet renderer, animation states, and per-user pet identity."
        />
      </Head>

      <div className="min-h-screen bg-[linear-gradient(180deg,#f6efe5_0%,#efe3d0_100%)] text-[#2f2418]">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          <header className="border-b border-[#d9c3a5] pb-5">
            <p className="text-[0.62rem] font-semibold uppercase tracking-[0.28em] text-[#8f6d47]">
              Cozy Pet Sandbox
            </p>
            <h1 className="mt-2 font-serif text-4xl font-semibold tracking-tight text-[#2b2015]">
              Pet Testing
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#6f5a43]">
              This route now previews the upgraded code-drawn pet renderer, per-user pet identity,
              mood styling, and animation states without touching the rest of the app.
            </p>
          </header>

          <main className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
            <section className="rounded-[1.5rem] border border-[#dcc7af] bg-white/70 p-5 shadow-[0_18px_48px_rgba(86,58,27,0.08)]">
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8a6b48]">User pet</p>
                  <div className="mt-2 flex gap-2">
                    {['Tony', 'Nugs'].map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setUser(value)}
                        className={`rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.18em] ${
                          user === value
                            ? 'border-[#9f7242] bg-[#4a331f] text-[#fff7eb]'
                            : 'border-[#dcc8b1] bg-white text-[#785d43]'
                        }`}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8a6b48]">Animation</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {MODES.map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setMode(value)}
                        className={`rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.18em] ${
                          mode === value
                            ? 'border-[#9f7242] bg-[#fff4e5] text-[#5f452d]'
                            : 'border-[#dcc8b1] bg-white text-[#785d43]'
                        }`}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8a6b48]">Mood</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {MOODS.map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setMood(value)}
                        className={`rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.18em] ${
                          mood === value
                            ? 'border-[#9f7242] bg-[#fff4e5] text-[#5f452d]'
                            : 'border-[#dcc8b1] bg-white text-[#785d43]'
                        }`}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8a6b48]">Variant</p>
                  <div className="mt-2 grid gap-2">
                    {PET_VARIANTS.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => selectVariant(entry)}
                        className={`rounded-[0.9rem] border px-3 py-2 text-left ${
                          variantId === entry.id
                            ? 'border-[#9f7242] bg-[#fff4e5]'
                            : 'border-[#dcc8b1] bg-white'
                        }`}
                      >
                        <span className="block text-sm font-semibold text-[#4a331f]">
                          {entry.name}
                          <span className="ml-2 text-[0.65rem] uppercase tracking-[0.16em] text-[#9a7448]">
                            {entry.companionStyle}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-xs leading-5 text-[#785d43]">{entry.blurb}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8a6b48]">Palette</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {PALETTES.map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setPalette(value)}
                        className={`rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.18em] ${
                          palette === value
                            ? 'border-[#9f7242] bg-[#fff4e5] text-[#5f452d]'
                            : 'border-[#dcc8b1] bg-white text-[#785d43]'
                        }`}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8a6b48]">
                    Scale {scale}%
                  </label>
                  <input
                    className="mt-2 w-full"
                    type="range"
                    min="60"
                    max="160"
                    step="5"
                    value={scale}
                    onChange={(event) => setScale(Number(event.target.value) || 100)}
                  />
                </div>

                <div className="rounded-[1.1rem] border border-[#e4d4c0] bg-[#fffaf3] p-4 text-sm leading-6 text-[#6a543e]">
                  <p><strong>Name:</strong> {pet.identity.name}</p>
                  <p><strong>Style:</strong> {pet.identity.companionStyle}</p>
                  <p><strong>Anchor:</strong> {pet.identity.homeAnchor}</p>
                  <p><strong>Animation:</strong> {pet.animation.mode}</p>
                  <p><strong>Mood:</strong> {pet.mood}</p>
                </div>
              </div>
            </section>

            <section className="rounded-[1.7rem] border border-[#dcc7af] bg-[linear-gradient(180deg,rgba(255,252,247,0.95),rgba(250,244,235,0.98))] p-5 shadow-[0_20px_52px_rgba(86,58,27,0.08)]">
              <div className="mb-4">
                <p className="text-[0.62rem] font-semibold uppercase tracking-[0.26em] text-[#8d6b47]">
                  Live preview
                </p>
                <h2 className="mt-2 font-serif text-3xl font-semibold text-[#2b2015]">
                  {pet.identity.name} for {user}
                </h2>
                <p className="mt-1 text-sm leading-6 text-[#6f5a43]">
                  Previewing the new renderer in isolation, including the temporary feed/celebrate
                  states and mood-driven behavior.
                </p>
              </div>
              <div className="overflow-hidden rounded-[1.4rem] border border-[#e2d2bd] bg-[#13202d]">
                <PetCompanion pet={pet} footerHeight={190} scalePercent={scale} />
              </div>
            </section>
          </main>
        </div>
      </div>
    </>
  );
}
