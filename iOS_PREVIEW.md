# Credit Card App - iOS Demo Preview

## What You'll See When Live

### Screen 1: Home Screen (Dark Theme)
```
┌─────────────────────────────────┐
│  💳 Credit Card Consolidation   │
│  Assign transactions and        │
│  resolve conflicts              │
│                                 │
│  ┌────────────────────────────┐ │
│  │ Upload CSV                 │ │
│  └────────────────────────────┘ │
│                                 │
│  Choose User:                   │
│  ┌──────────┐  ┌──────────┐   │
│  │  Tony    │  │  Nugs    │   │
│  └──────────┘  └──────────┘   │
│                                 │
│  Stats:                         │
│  Total: 10    Assigned: 2       │
│  Conflicts: 1 Pending: 7        │
└─────────────────────────────────┘
```

### Screen 2: Transaction List (After CSV Upload)

```
┌─────────────────────────────────┐
│ 2026-04-03  VELOCITY REWARDS FEE│
│ Amount: $75.00                  │
│                                 │
│ User Assignments:               │
│ Tony: —                Nugs: —  │
│                                 │
│ ┌─────────────────────────────┐ │
│ │ ➕ Assign                   │ │
│ └─────────────────────────────┘ │
└─────────────────────────────────┘

┌─────────────────────────────────┐
│ 2026-04-03  CARD FEE           │
│ Amount: $295.00                 │
│ ⚠️ CONFLICT                     │
│                                 │
│ User Assignments:               │
│ Tony: Tony        Nugs: Nugs   │
│                                 │
│ ┌─────────────────────────────┐ │
│ │ ✏️ Edit                     │ │
│ └─────────────────────────────┘ │
└─────────────────────────────────┘
```

### Screen 3: Assigning a Transaction (Tap "➕ Assign")

```
┌─────────────────────────────────┐
│ 2026-04-03  aliexpress          │
│ Amount: $32.21                  │
│                                 │
│ User Assignments:               │
│ Tony: —                Nugs: —  │
│                                 │
│ ┌──────────┐  ┌──────────┐    │
│ │  Tony    │  │  Nugs    │    │
│ └──────────┘  └──────────┘    │
│                                 │
│ ┌──────────┐  ┌──────────┐    │
│ │  Split   │  │  Other   │    │
│ └──────────┘  └──────────┘    │
│                                 │
│ ┌──────────┐                   │
│ │  Cancel  │                   │
│ └──────────┘                   │
└─────────────────────────────────┘
```

### Screen 4: Summary After Assignments

```
┌─────────────────────────────────┐
│         Summary                 │
│                                 │
│  Resolved:                      │
│  8                              │
│                                 │
│  Remaining:                     │
│  2                              │
│                                 │
│ ⚠️ 1 transaction(s) have        │
│ conflicts that need resolution  │
└─────────────────────────────────┘
```

---

## Colors & Visual Cues

**Yellow Border** = Needs action (pending)
**Green Border** = Done (both users agreed)
**Red Border** = Conflict (users disagreed)

**Badges:**
- ✓ ASSIGNED = Green checkmark, transaction resolved
- ⚠️ CONFLICT = Red warning, needs fixing
- ➕ ASSIGN = Button to add assignment
- ✏️ EDIT = Button to change your mind

---

## How It Works on iOS

1. **Open URL** in Safari (Vercel link you'll get)
2. **Upload CSV** from your Westpac export
3. **Tap your name** (Tony or Nugs)
4. **Tap ➕ Assign** on each transaction
5. **Choose owner** (Tony, Nugs, Split, Other)
6. **Share URL** with other person
7. **They do same** - auto-detects conflicts!

---

## Data Persistence on iOS

✓ All submissions saved locally (even if you close Safari)
✓ Data shared between users on same device
✓ Survives page refresh
✓ Automatic sync with localStorage

---

## Why It's Better Than an App

- ✓ No App Store approval (live in 20 mins)
- ✓ Works on all devices (iPhone, Android, Web, Desktop)
- ✓ Free hosting forever (Vercel)
- ✓ Update CSVs daily via GitHub
- ✓ Zero installation needed

Just visit a URL. Done.
