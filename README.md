# Project Hercules 🏛️

A personal strength-training tracker that turns showing up into a game worth playing.

Log a set in two taps on your phone; it syncs to the cloud, an XP/leveling engine
scores the one thing that actually matters — **consistency** — you climb a ladder
of **21 Greek ranks** from _Initiate_ to _Kratos_, and a muscle body map lights up
(or goes cold) so your blind spots are impossible to ignore. A desktop app charts
the whole history. No Android Studio, no Play Store, no in-app analytics, no ads.

---

## What it does

- **Fast logging.** Pick a muscle group → an exercise → nudge weight/reps with big
  thumb-friendly steppers. It remembers your last weight _and_ reps per exercise
  and prefills them. One tap = one logged set.
- **Your own exercise library.** A user-extensible registry of 17 muscle groups and
  exercises, each with a _weighted_ muscle mapping (a bench press credits chest
  fully, shoulders and triceps partially) plus a second **movement-pattern** tag
  (push / pull / squat / hinge / carry / core / isolation), synced across devices.
- **XP & leveling that can't be farmed.** A pure function over your training log:
  - **Consistency** (the spine) — sessions/week vs. a target, with time **decay**
    so it reflects _recent_ adherence. You can't fake showing up for a month.
  - **Progression that holds** — beating a trailing 4-week per-exercise baseline,
    but a PR only counts once you've **repeated it in two sessions**. Ego lifts
    don't score.
  - **Volume** — a **saturating** curve, so the 3rd working set counts and the 8th
    earns almost nothing. Junk-set farming has nothing to farm.
  - **Maturation** — reward shifts from progression → consistency as you advance,
    because near your ceiling, _maintaining_ is the achievement.
  - Nothing is stored — XP, levels, and streaks are computed on read, so the whole
    model is retunable with zero migrations.
- **Ranks you have to defend.** The same XP drives a **21-tier Greek ladder**
  (Initiate → Hoplite → Myrmidon → … → Zeus → Nike → **Kratos**), three divisions
  each, with hand-drawn **medallions** — animated on the phone, whose material
  climbs by _density_ (gravel → neutronium) as you rise. XP only ever _banks_, but
  miss an un-excused week and you **slip a division** and lose your progress within
  it, MOBA-style: a rank is a standing you keep, not a trophy you own. Rank, like
  XP, is recomputed from your log — nothing stored.
- **Cardio.** Treadmill / elliptical / bike, logged by **duration**. It counts
  toward consistency (a session is a session) but never inflates strength volume or
  progression, and it warms your legs on the body map.
- **Muscle body map.** Front + back figures tinted by each group's level — cold
  where you've neglected, warm where you've worked. It holds the _complete_ body as
  the constant and surfaces the delta.
- **Desktop stats app.** A dashboard (KPIs, weekly volume per group, exercise
  progression / estimated 1RM, muscle balance, PR table, level, \*\*your current rank
  - medallion**, a **push/pull movement-pattern** balance, cardio minutes, and the
    same body map) reading your data via the Firebase Admin SDK — runnable with Python
    or as a **standalone Windows `.exe`\*\*.

## How it works

```
┌──────────────────┐   writes   ┌──────────────────┐   reads    ┌─────────────────────┐
│  Expo app (phone)│ ─────────▶ │  Cloud Firestore │ ◀───────── │  Desktop stats app  │
│  React Native    │            │  per-user data   │            │  Dash + Admin SDK   │
│  Firebase JS SDK │            │  security rules  │            │  (.exe or python)   │
└──────────────────┘            └──────────────────┘            └─────────────────────┘
         │                                                                 ▲
         └──────── the XP *and* rank engines run on BOTH sides ─────────────┘
              (pure functions, implemented in TypeScript AND Python,
               kept in exact parity by shared test-vector suites)
```

The phone only reads/writes its own account's data (enforced by Firestore rules).
The desktop side uses the Admin SDK, which bypasses rules — its power lives in a
service-account key that never leaves your machine and is never committed.

## Repository layout

| Dir                        | What                                                              | Stack                                            |
| -------------------------- | ----------------------------------------------------------------- | ------------------------------------------------ |
| [`app/`](./app/)           | The Expo (React Native) app — logging, accounts, levels, body map | Expo SDK 57, React Native, Firebase JS SDK       |
| [`firebase/`](./firebase/) | Firestore security rules (owner-only per-account)                 | —                                                |
| [`desktop/`](./desktop/)   | The stats dashboard + standalone `.exe` packaging                 | Python, Dash/Plotly, firebase-admin, PyInstaller |
| [`pull/`](./pull/)         | A Python script that exports the log to CSV                       | Python, firebase-admin                           |

The XP engine lives in `app/src/progress.ts` + `desktop/progress.py`, and the rank
engine in `app/src/rank/` + `desktop/rank_engine.py` — deliberate two-language pairs
kept identical by shared vectors (`desktop/phase9_vectors.json`, `rank_vectors.json`).
The 21 medallions are authored once and dumped to `desktop/medallion_art.json` so the
phone (react-native-svg) and desktop (server-side SVG) draw the same art.

## Getting started

**Prerequisites:** Node (v20+), Python 3.9+, and a free Firebase project.

**1. Firebase setup (once):** create a project, enable **Email/Password** auth and
**Cloud Firestore** (production mode), deploy the rules in
[`firebase/firestore.rules`](./firebase/firestore.rules), then grab:

- your **web config** → `app/.env.local` as `EXPO_PUBLIC_FIREBASE_*` vars,
- an **Admin service-account key** → `pull/serviceAccountKey.json`.

Both are gitignored and must never be committed — the service-account key grants
full backend access (it bypasses the security rules), so keep it off git entirely.

**2. Run the app (dev):**

```bash
cd app
npm install
npx expo start --web        # fast iteration in the browser
```

On-device is a sideloaded APK built in Expo's cloud (Expo Go can't run SDK 57):

```bash
npm install -g eas-cli && eas login
eas build --platform android --profile preview   # → an installable .apk
```

**3. Run the desktop stats app:**

```bash
pip install -r desktop/requirements.txt
python desktop/app.py                 # opens http://127.0.0.1:8050
```

Or build the standalone Windows app (drop `serviceAccountKey.json` next to the exe):

```bash
pip install pyinstaller pywebview
pyinstaller desktop/hercules_stats.spec   # → desktop/dist/HerculesStats/HerculesStats.exe
```

## Data model

One flat `workouts` collection (one document per set) plus two registry
collections, all owned by your account:

```
workouts/{id}      uid, date, session, exercise, weight, reps, set, ts
                   (cardio sets carry kind:"cardio" + duration in place of weight/reps/set)
exercises/{id}     uid, name, muscles: [{ group, role, weight }], kind?, pattern?, lastWeight
muscleGroups/{id}  uid, name, order
```

Muscle attribution, levels, **and rank** are all derived from these at read time —
never stored as authoritative fields, so the whole scoring model retunes with zero
migrations.

## Status

**Built:** accounts; the exercise/muscle registry (17 groups — Back split into
lats / upper / lower, the hips split out of glutes — plus the movement-pattern axis);
the XP/leveling engine **and** the rank engine, each in TypeScript and Python at
shared-vector parity; the **21-tier rank ladder** with animated medallions on the
phone and a rank panel on the desktop; **cardio** (duration-based, consistency-only);
the muscle body map and the desktop dashboard (+ standalone `.exe`) on both platforms;
a refined dark UI, remember-me, the Hercules icon, and the "juice" (level-up moments,
streak flame, decay nudges).
