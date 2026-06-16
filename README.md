# Lap Counter

A single-page Expo iOS app that auto-counts laps on a closed walking path —
**indoor or outdoor**. You pick the mode, enter a target lap count, tap
**Start**, walk your laps, and the counter auto-increments each time you
return to your starting point. When the counter hits the target, it stops
automatically.

Two detection strategies, one unified UX:

- **Indoor** — fuses ambient Bluetooth fingerprinting, the local magnetic
  field, and inertial dead-reckoning. Works with any indoor walking shape
  (circular, elliptical, figure-eight, etc.) as long as the route returns
  near the start.
- **Outdoor** — uses GPS positioning. Counts a lap each time you return to
  within ~15 m of your start point after going at least ~40 m away.
  Buildable entirely from Windows via EAS Build.

> See `indoor_lap_counter_883b088d.plan.md` for the full design rationale,
> tunable thresholds, and known limitations.

---

## UX (three states)

```
┌──────────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   1. Setup           │→ │   2. Running    │→ │   3. Finished   │
│                      │  │                 │  │                 │
│ Where will you walk? │  │ 🏠 INDOOR       │  │ 10 / 10 (100%)  │
│ [●Indoor] [○Outdoor] │  │ Target: 10 laps │  │ ▓▓▓▓▓▓▓▓▓▓▓▓    │
│                      │  │                 │  │  🎉 Complete!   │
│ How many laps?       │  │ 3 / 10  (30%)   │  │                 │
│   [   10   ]         │  │ ▓▓▓▓▓░░░░░░░░   │  │ [↻ Start Over]  │
│                      │  │ Walking lap…    │  │                 │
│   [▶ Start]          │  │ [Stop] [Reset]  │  │                 │
└──────────────────────┘  └─────────────────┘  └─────────────────┘
```

---

## Project layout

```
lap-counter/
├─ App.tsx                       single-screen UI
├─ index.ts                      Expo entry point
├─ app.json                      iOS bundle id, permissions, plugins
├─ eas.json                      EAS Build profiles
├─ jest.setup.ts                 jest setup + mocks for native modules
├─ package.json
├─ tsconfig.json
├─ __mocks__/
│  ├─ expo-sensors.ts                  controllable sensor stream mocks
│  ├─ expo-location.ts                  controllable GPS stream + permission flow
│  ├─ expo-haptics.ts                   records every haptic call for assertions
│  ├─ expo-notifications.ts             scheduled-notification + permission state
│  ├─ expo-task-manager.ts              in-memory task definitions + registry
│  ├─ expo-background-fetch.ts          status + register/unregister
│  └─ react-native-ble-plx.ts           controllable BleManager mock
├─ __tests__/
│  ├─ App.test.tsx                       <App /> Setup / Running / Finished + mode toggle
│  ├─ e2e-session.test.ts                indoor full multi-lap reducer simulation
│  ├─ e2e-outdoor-session.test.ts        outdoor full multi-lap GPS reducer simulation
│  ├─ e2e-side-effects.test.tsx          hook-level e2e: indoor side effects
│  ├─ e2e-outdoor-side-effects.test.tsx  hook-level e2e: outdoor mode end-to-end
│  └─ helpers/fixtures.ts                shared Fingerprint test fixtures
├─ src/
│  ├─ sensors/
│  │  ├─ bleScanner.ts            react-native-ble-plx wrapper + aggregator (indoor)
│  │  ├─ motionTracker.ts         Magnetometer + DeviceMotion + Pedometer (indoor)
│  │  ├─ locationTracker.ts       expo-location wrapper + permission flow (outdoor)
│  │  └─ __tests__/               sensor wrapper tests
│  ├─ services/
│  │  ├─ haptics.ts               lap + target-reached + control haptics
│  │  ├─ notifications.ts         permission + scheduling + cancel helpers
│  │  ├─ backgroundTask.ts        TaskManager.defineTask + register/unregister
│  │  └─ __tests__/               unit tests for each service
│  ├─ logic/
│  │  ├─ fingerprint.ts           Fingerprint type, similarity, refinement (indoor)
│  │  ├─ lapDetector.ts           Indoor pure reducer / state machine
│  │  ├─ outdoorLapDetector.ts    Outdoor pure reducer + Haversine distance
│  │  └─ __tests__/               reducer unit tests for both modes
│  └─ state/
│     ├─ useLapCounter.ts         React hook unifying indoor + outdoor modes
│     └─ __tests__/               hook tests with mocked sensors + side effects
└─ indoor_lap_counter_883b088d.plan.md
```

---

## Setup (from Windows)

```powershell
cd C:\Users\senth\OneDrive\Documents\lap-counter

# 1. Install JS dependencies. The --legacy-peer-deps flag is needed
#    because react-native-ble-plx's published peer ranges are stricter
#    than necessary; the install is otherwise correct.
npm install --legacy-peer-deps

# 2. Install EAS CLI globally and log in (free Apple ID is fine).
npm install -g eas-cli
eas login

# 3. Configure EAS for this project (one-time).
eas build:configure

# 4. Build the iOS dev client in the cloud (~10–15 min).
eas build --platform ios --profile development
```

### Verifying the install

```powershell
npx expo-doctor      # 21/21 checks should pass
npm run typecheck    # tsc --noEmit
npm test             # jest, 131 tests across 13 suites
```

EAS will:

1. Prompt for Apple ID credentials.
2. Register your iPhone's UDID interactively.
3. Provision dev certificates automatically.
4. Run the iOS build in the cloud.
5. Give you a QR code / link to install the `.ipa` on your iPhone.

For day-to-day code changes you only need Metro:

```powershell
npx expo start --dev-client
```

…then scan the QR from the dev-client app on your iPhone. A full EAS rebuild
is only needed when native dependencies change.

---

## Using the app

1. Stand at your starting point (call it **point A**).
2. Open the app. Pick **Indoor** or **Outdoor**. Enter your target lap count
   (default 10). Tap **Start**.
3. Status will show calibration:
   - Indoor: **"Calibrating point A — stand still…"** (~5 seconds, capturing
     ambient BLE + magnetic fingerprint).
   - Outdoor: **"Locking onto GPS — stand still…"** (~8 seconds, capturing
     a tight GPS fix weighted by accuracy).
4. Once it shows **"Walking lap…"**, walk your closed route normally.
5. When you return to A the counter increments and the stored start-point
   data gets refined toward the new observation, so the app gets more
   reliable the more laps you do.
6. When the counter reaches your target, the screen flips to the
   **Complete!** state and the sensors auto-stop.

Toggle the **Debug** switch at the bottom of the screen to see live signal
values:

- Indoor: BLE similarity, magnetic field delta (μT), IMU displacement (m).
- Outdoor: distance from start (m), GPS accuracy (m), rejected-fix count,
  point-A coordinates.

Useful when tuning thresholds for your specific gym or park.

---

## Tunable thresholds

### Indoor (`src/logic/lapDetector.ts`)

| Threshold                  | Default | What it means                                      |
|----------------------------|---------|----------------------------------------------------|
| `similarityNearThreshold`  | 0.75    | BLE+RSSI similarity ≥ this counts as "at A"        |
| `similarityFarThreshold`   | 0.40    | Similarity ≤ this counts as "left A"               |
| `magneticDeltaThreshold`   | 5 μT    | Magnetic field magnitude must be within this of A  |
| `displacementThreshold`    | 6 m     | IMU dead-reckoned displacement must be within this |
| `lapDebounceMs`            | 10 s    | Minimum time between counted laps                  |
| `calibrationMs`            | 5 s     | How long to capture A's fingerprint at startup     |

### Outdoor (`src/logic/outdoorLapDetector.ts`)

| Threshold                  | Default | What it means                                      |
|----------------------------|---------|----------------------------------------------------|
| `nearRadiusM`              | 15 m    | Distance ≤ this from A counts as "at A"            |
| `farRadiusM`               | 40 m    | Distance ≥ this counts as "left A"                 |
| `lapDebounceMs`            | 15 s    | Minimum time between counted laps                  |
| `calibrationMs`            | 8 s     | How long to capture pointA via weighted GPS samples |
| `maxAcceptableAccuracyM`   | 25 m    | Reject fixes whose reported radius is worse than this |
| `refinementAlpha`          | 0.2     | EMA weight when blending the latest fix into pointA |

Adjust in code, rebuild with Metro, and re-test in your venue. Tighter
parks with reliable GPS can drop `nearRadiusM` to 10 m; large outdoor tracks
might want `farRadiusM` of 60 m.

---

## Test suite

```powershell
npm test                  # run once
npm run test:watch        # watch mode
npm run test:coverage     # with coverage report
```

What's covered:

| Suite                                 | What it tests                                                              |
|---------------------------------------|----------------------------------------------------------------------------|
| `src/logic/__tests__/fingerprint.test.ts`        | Jaccard, RSSI cosine, weighted similarity, magnetic delta, refinement   |
| `src/logic/__tests__/lapDetector.test.ts`        | Indoor reducer: idle→calibrating→armed→away→approaching→lap→finished |
| `src/logic/__tests__/outdoorLapDetector.test.ts` | Outdoor reducer: Haversine, accuracy-weighted calibration, reject-bad-fix path, near/far radius transitions, debounce, capped pointA refinement |
| `src/sensors/__tests__/locationTracker.test.ts`  | GPS permission flow, services-disabled, NaN-skipping, accuracy floor, snapshot, watcher cleanup |
| `src/state/__tests__/useLapCounter.test.ts`      | Hook lifecycle (indoor): keep-awake, BLE aggregation, calibration, lap haptic, notification on target, background task register / unregister |
| `src/services/__tests__/haptics.test.ts`         | Haptic wrappers + graceful degradation on web / engine errors           |
| `src/services/__tests__/notifications.test.ts`   | Permission flow, Android channel, schedule + cancel, error swallowing   |
| `src/services/__tests__/backgroundTask.test.ts`  | `defineTask` at module load, register / unregister idempotency, denied / failure paths, task-body invocation |
| `__tests__/App.test.tsx`                          | UI: Setup / Running / Finished, mode toggle (Indoor/Outdoor), help-text swap, GPS-specific debug panel |
| `__tests__/e2e-session.test.ts`                   | Indoor reducer e2e: full multi-lap sessions with synthetic BLE/magnetic/IMU (clean walk, lingering at A, partial wandering, fingerprint refinement, noisy BLE) |
| `__tests__/e2e-outdoor-session.test.ts`           | Outdoor reducer e2e: 5-lap GPS simulation around a 25m-radius circle, ±2m & ±5m noise tolerance, rejection of cold-start garbage fixes, partial-wander negative case, perimeter sanity |
| `__tests__/e2e-side-effects.test.tsx`             | Hook-level indoor e2e: 3-lap session, haptic per lap, single success haptic, single notification, no double-fire on re-render, bg-task lifecycle |
| `__tests__/e2e-outdoor-side-effects.test.tsx`     | Hook-level outdoor e2e: GPS permission flow, denied → idle, 1-lap full session, 3-lap haptic count, GPS-only sensors (no BLE/IMU), watcher cleanup, mode-switch guard |

Native modules (`react-native-ble-plx`, `expo-sensors`, `expo-location`,
`expo-keep-awake`, `react-native-safe-area-context`, `expo-haptics`,
`expo-notifications`, `expo-task-manager`, `expo-background-fetch`) are
replaced with controllable mocks under `__mocks__/` and `jest.setup.ts`,
so the suite runs entirely on Windows without needing a device or simulator.

---

## Feedback channels (haptic + notification + background)

- **Lap haptic** — every counted lap triggers a medium-impact haptic so
  you can feel laps without looking at the phone.
- **Target-reached haptic** — a distinct success notification haptic
  fires once the moment your target is hit.
- **Local notification** — when the target is reached, a banner /
  notification ("You completed all N of N laps. Nice work.") is posted
  via `expo-notifications`. Permission is requested at session start;
  if denied, the rest of the app keeps working silently.
- **Background fetch** — `expo-task-manager` + `expo-background-fetch`
  register a periodic wake-up task at session start so iOS treats the
  app as "active enough" to keep BLE alive. The task body is a
  heartbeat today; iOS only fires it ~every 15 minutes regardless of
  the requested interval. Foreground (with keep-awake) is still the
  reliable counting path.

## Known limitations

### Indoor
- **iOS background BLE scans are throttled.** Keep the app foregrounded —
  `expo-keep-awake` is activated automatically during a session. The
  background-fetch task helps the OS keep us alive but doesn't promise
  real-time lap counting in the background.
- **Reliability depends on BLE density** in your gym. AirPods, smartwatches,
  cardio equipment, TVs all help. If density is too low, expect false
  positives/negatives.
- **No simulator support for indoor mode** — BLE + magnetometer + pedometer
  all need a real device.
- **Sub-meter precision is not achievable software-only.** Expect ~3–8 m
  effective resolution.

### Outdoor
- **GPS needs a clear view of the sky.** Indoors, deep urban canyons, or
  tunnels will produce loose fixes that the detector rejects (raising the
  `rejected fixes` debug counter). The first fix after cold-start is often
  worse than 25 m and gets discarded — that's expected.
- **Backgrounding works only if "Always Allow" is granted.** With "While Using"
  permission, lap counting pauses when the screen sleeps. `expo-keep-awake`
  keeps the screen on while the app is foregrounded.
- **Tight loops may be missed.** If your loop fits inside `nearRadiusM`
  (15 m default), you never leave the "near" zone and laps don't count.
  Use a larger circle, or lower `nearRadiusM` to e.g. 8 m.

If outdoor reliability is unsatisfactory after tuning, the easiest improvement
is to widen `farRadiusM` so brief GPS jitter into the "away" zone doesn't
trip false transitions.

If indoor reliability is unsatisfactory after tuning, the recommended fallback
is a single iBeacon (~$15) — the BLE scanning code is already there; we'd
just filter to the known iBeacon UUID.
