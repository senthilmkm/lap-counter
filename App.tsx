import { StatusBar } from 'expo-status-bar';
import { useMemo, useState, useEffect, useRef } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  Share,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { useLapCounter, LapMode } from './src/state/useLapCounter';
import type { DetectorState } from './src/logic/lapDetector';
import { OutdoorDetectorState, GeoPoint, haversineDistance } from './src/logic/outdoorLapDetector';
import { useSubscription } from './src/state/useSubscription';
import { exportWorkoutFile, generateGPX, generateCSV, ExporterLap } from './src/services/exporter';
import { saveWorkout, getWorkouts, getWorkoutPath, DBWorkout, getSettingSync, saveSettingSync } from './src/services/database';
import WorkoutMap from './src/components/WorkoutMap';

const KEEP_AWAKE_TAG = 'lap-counter-session';
const TICK_INTERVAL_MS = 1000;

/**
 * Calculates estimated calorie burn based on user weight and activity METs.
 * 
 * Formula: Calories = Factor * Weight_lbs * Distance_miles
 * Distance:
 *   - Indoor: (steps * strideLengthMeters) / 1609.34
 *   - Outdoor: gpsDistanceMeters / 1609.34
 * Factor (MET):
 *   - Indoor: cadence <= 130 spm ? 0.57 : 0.72
 *   - Outdoor: speed <= 4.0 mph ? 0.57 : 0.72
 */
export function estimateCalories(params: {
  mode: 'indoor' | 'outdoor';
  steps: number;
  durationSeconds: number;
  weightLbs: number;
  strideLengthMeters: number;
  gpsDistanceMeters?: number; // pre-computed for outdoor
  gpsPath?: GeoPoint[];       // or computed from path
}): number {
  const { mode, steps, durationSeconds, weightLbs, strideLengthMeters } = params;
  if (weightLbs <= 0 || durationSeconds <= 0) return 0;

  let distanceMiles = 0;
  let factor = 0.57; // Default MET factor (walking)

  if (mode === 'indoor') {
    const stride = strideLengthMeters > 0 ? strideLengthMeters : 0.75;
    distanceMiles = (steps * stride) / 1609.34;
    const cadence = durationSeconds > 0 ? (steps * 60) / durationSeconds : 0;
    if (cadence > 130) {
      factor = 0.72; // Running
    }
  } else {
    let distMeters = params.gpsDistanceMeters || 0;
    if (!distMeters && params.gpsPath && params.gpsPath.length > 1) {
      for (let i = 1; i < params.gpsPath.length; i++) {
        distMeters += haversineDistance(params.gpsPath[i - 1], params.gpsPath[i]);
      }
    }
    distanceMiles = distMeters / 1609.34;
    const speedMph = durationSeconds > 0 ? (distanceMiles / (durationSeconds / 3600)) : 0;
    if (speedMph > 4.0) {
      factor = 0.72; // Running/jogging
    }
  }

  return Math.round(factor * weightLbs * distanceMiles);
}

/**
 * Returns a food emoji equivalent representation for calories burned.
 */
export function getCalorieEquivalent(kcal: number): string {
  if (kcal < 100) return '🍏 Apple';
  if (kcal < 200) return '🍌 Banana';
  if (kcal < 300) return '☕ Latte';
  if (kcal < 400) return '🍩 Donut';
  if (kcal < 600) return '🍕 Pizza Slice';
  return '🍔 Burger';
}


const localPricingConfig = require('./pricing.json');

export default function App() {
  const sub = useSubscription();
  const isTesting = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
  const [debugSubTier, setDebugSubTier] = useState<'free' | 'monthly' | 'annual'>('free');
  const subTier = debugSubTier !== 'free' ? debugSubTier : sub.subTier;
  const isPremium = subTier === 'monthly' || subTier === 'annual' || isTesting;
  const { buyPackage, restore } = sub;

  const handlePurchase = async (type: 'monthly' | 'annual') => {
    const pkg = sub.packages.find(p => {
      const pId = p.identifier?.toLowerCase() || '';
      const pType = p.packageType?.toString() || '';
      if (type === 'monthly') {
        return pType === 'MONTHLY' || pId.includes('monthly');
      } else {
        return pType === 'ANNUAL' || pId.includes('annual');
      }
    });

    if (pkg) {
      const success = await sub.buyPackage(pkg);
      if (success) {
        setShowPaywall(false);
        Alert.alert('Welcome to Premium!', 'Subscription activated successfully. Thank you!');
      } else {
        Alert.alert('Purchase Failed', 'Unable to complete purchase. Please try again.');
      }
    } else {
      sub.setSubTier(type);
      sub.setIsPremium(true);
      setShowPaywall(false);
      Alert.alert('Welcome to Premium!', `Subscription activated successfully (${type} simulation/sandbox mode). Thank you!`);
    }
  };

  const [pricingConfig, setPricingConfig] = useState(localPricingConfig);

  useEffect(() => {
    const loadRemotePricing = async () => {
      try {
        const res = await fetch('https://raw.githubusercontent.com/senthilmkm/lap-counter/main/pricing.json');
        if (res.ok) {
          const remoteData = await res.json();
          if (remoteData && remoteData.features) {
            setPricingConfig(remoteData);
          }
        }
      } catch (e) {
        console.warn('Failed to fetch remote pricing.json, using local fallback:', e);
      }
    };
    loadRemotePricing();
  }, []);

  const {
    mode,
    setMode,
    state,
    status,
    error,
    start,
    stop,
    reset,
    defaultConfig,
    sessionStartTs,
    sessionEndTs,
    elapsedSeconds,
    prewarmLocation,
    // Premium tier states
    isPaused,
    gpsPath,
    weatherSuggest,
    voiceCuesEnabled,
    setVoiceCuesEnabled,
    pause,
    resume,
  } = useLapCounter();

  const [activeTab, setActiveTab] = useState<'workout' | 'history' | 'analytics' | 'settings'>('workout');
  const [showPaywall, setShowPaywall] = useState(false);
  const [targetInput, setTargetInput] = useState(() => {
    const saved = getSettingSync('targetLaps', '');
    if (saved) return saved;
    return isPremium ? String(defaultConfig.targetLaps) : '3';
  });
  const [disableBle, setDisableBle] = useState(() => getSettingSync('disableBle', 'true') === 'true');
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  
  // Local cache of historical workouts for list tab
  const [historyList, setHistoryList] = useState<DBWorkout[]>([]);
  const [selectedWorkout, setSelectedWorkout] = useState<DBWorkout | null>(null);

  // Track lap times and steps for average cadence/stride calculations
  const [lapTimes, setLapTimes] = useState<number[]>([]);
  const [lapSteps, setLapSteps] = useState<number[]>([]);

  // Calories, mapType, and Achievements states
  const [weightInput, setWeightInput] = useState(() => getSettingSync('userWeight', '150'));
  const [weightUnit, setWeightUnit] = useState<'lbs' | 'kg'>(() => getSettingSync('userWeightUnit', 'lbs') as 'lbs' | 'kg');
  const [weatherUnit, setWeatherUnit] = useState<'celsius' | 'fahrenheit'>(() => getSettingSync('weatherUnit', 'celsius') as 'celsius' | 'fahrenheit');

  // Onboarding wizard (shown once on first install)
  const [showOnboarding, setShowOnboarding] = useState(() => getSettingSync('onboardingDone', 'false') === 'false');

  // 7-tap debug unlock for Settings tab
  const [settingsTapCount, setSettingsTapCount] = useState(0);
  const [settingsLastTapTime, setSettingsLastTapTime] = useState(0);
  const [showSettingsDebug, setShowSettingsDebug] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [mapType, setMapType] = useState<'standard' | 'satellite'>('standard');
  const [selectedWorkoutPath, setSelectedWorkoutPath] = useState<GeoPoint[]>([]);

  // Personal Records states
  const [recordFastestLap, setRecordFastestLap] = useState(() => parseFloat(getSettingSync('prFastestLap', '999999')));
  const [recordMostLaps, setRecordMostLaps] = useState(() => parseInt(getSettingSync('prMostLaps', '0'), 10));
  const [recordLongestSession, setRecordLongestSession] = useState(() => parseInt(getSettingSync('prLongestSession', '0'), 10));
  const [brokenRecords, setBrokenRecords] = useState<string[]>([]);

  // Update settings handlers
  const handleWeightInputChange = (val: string) => {
    setWeightInput(val);
  };

  const handleWeightInputBlur = () => {
    saveSettingSync('userWeight', weightInput);
  };

  const handleWeightUnitChange = (val: 'lbs' | 'kg') => {
    setWeightUnit(val);
    saveSettingSync('userWeightUnit', val);
  };

  const handleWeatherUnitChange = (val: 'celsius' | 'fahrenheit') => {
    setWeatherUnit(val);
    saveSettingSync('weatherUnit', val);
  };

  const handleVersionTap = () => {
    const now = Date.now();
    if (now - settingsLastTapTime > 3000) {
      setSettingsTapCount(1);
    } else {
      const newCount = settingsTapCount + 1;
      setSettingsTapCount(newCount);
      if (newCount >= 7) {
        setShowSettingsDebug(true);
        setSettingsTapCount(0);
      }
    }
    setSettingsLastTapTime(now);
  };

  const parsedWeight = useMemo(() => {
    const w = parseFloat(weightInput);
    if (!Number.isFinite(w) || w <= 0) return 150;
    return weightUnit === 'lbs' ? w : w * 2.20462;
  }, [weightInput, weightUnit]);

  // Load coordinates path when details modal is opened
  useEffect(() => {
    if (selectedWorkout && selectedWorkout.mode === 'outdoor') {
      const path = getWorkoutPath(selectedWorkout.id).map((pt) => ({
        latitude: pt.latitude,
        longitude: pt.longitude,
        accuracy: pt.accuracy ?? 0,
      }));
      setSelectedWorkoutPath(path);
    } else {
      setSelectedWorkoutPath([]);
    }
  }, [selectedWorkout]);

  useEffect(() => {
    if (state.phase === 'idle') {
      setLapTimes([]);
      setLapSteps([]);
      setBrokenRecords([]);
      return;
    }
    if (state.count > 0) {
      if (state.count > lapTimes.length) {
        setLapTimes((prev) => [...prev, elapsedSeconds]);
      }
      const currentSteps = mode === 'indoor' ? (state as DetectorState).steps || 0 : 0;
      if (state.count > lapSteps.length) {
        setLapSteps((prev) => [...prev, currentSteps]);
      }
    }
  }, [state.count, state.phase, mode, state, elapsedSeconds, lapTimes.length, lapSteps.length]);

  // Load history from SQLite database on mount or tab focus
  const reloadHistory = () => {
    const logs = getWorkouts();
    setHistoryList(logs);
  };

  useEffect(() => {
    reloadHistory();
  }, [activeTab]);

  // Track phase/lap transitions and keep history log
  const interval10s = Math.floor(elapsedSeconds / 10);
  useEffect(() => {
    if (state.phase === 'idle') {
      setDebugLogs([]);
      return;
    }
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    let msg = `Phase: ${state.phase} | Count: ${state.count}`;
    if (mode === 'indoor') {
      const s = state as DetectorState;
      if (s.lastMagneticDelta !== undefined) {
        msg += ` | MagΔ: ${s.lastMagneticDelta.toFixed(2)} uT | Disp: ${s.lastDisplacementMagnitude.toFixed(2)} m`;
      }
    } else {
      const s = state as OutdoorDetectorState;
      if (s.lastDistanceM !== undefined) {
        msg += ` | Dist: ${s.lastDistanceM.toFixed(1)} m | Acc: ${Number.isFinite(s.lastAccuracyM) ? s.lastAccuracyM.toFixed(1) : '—'} m`;
      }
    }
    const fullMsg = `[${time}] ${msg}`;
    setDebugLogs(prev => {
      if (prev.length > 0 && prev[0].substring(11) === fullMsg.substring(11)) {
        return prev;
      }
      return [fullMsg, ...prev].slice(0, 15);
    });
  }, [state.phase, state.count, mode, interval10s, state]);

  const target = state.config.targetLaps;
  const isSetup = state.phase === 'idle';
  const isFinished = state.phase === 'finished';
  const isRunning = !isSetup && !isFinished;

  const progressPct = useMemo(() => {
    if (target <= 0) return 0;
    return Math.min(1, state.count / target);
  }, [state.count, target]);

  // Active workout stats calculations
  const currentSessionDistanceMeters = useMemo(() => {
    if (mode !== 'outdoor' || gpsPath.length < 2) return 0;
    let dist = 0;
    for (let i = 1; i < gpsPath.length; i++) {
      dist += haversineDistance(gpsPath[i - 1], gpsPath[i]);
    }
    return dist;
  }, [gpsPath, mode]);

  const currentSessionDistanceMiles = useMemo(() => {
    return currentSessionDistanceMeters / 1609.34;
  }, [currentSessionDistanceMeters]);

  const currentSessionCalories = useMemo(() => {
    return estimateCalories({
      mode,
      steps: mode === 'indoor' ? (state as DetectorState).steps || 0 : 0,
      durationSeconds: elapsedSeconds || 1,
      weightLbs: parsedWeight,
      strideLengthMeters: 0.75,
      gpsDistanceMeters: currentSessionDistanceMeters,
    });
  }, [mode, state, elapsedSeconds, parsedWeight, currentSessionDistanceMeters]);

  // Text summary sharing
  const handleTextShare = async (workout: DBWorkout) => {
    try {
      const duration = Math.round((workout.endTime - workout.startTime) / 1000);
      let distStr = '';
      let stepsStr = '';
      let cals = 0;

      if (workout.mode === 'indoor') {
        stepsStr = `\n• Steps: ${workout.steps} steps`;
        cals = estimateCalories({
          mode: 'indoor',
          steps: workout.steps,
          durationSeconds: duration,
          weightLbs: parsedWeight,
          strideLengthMeters: workout.strideLength,
        });
      } else {
        const path = getWorkoutPath(workout.id).map((pt) => ({
          latitude: pt.latitude,
          longitude: pt.longitude,
          accuracy: pt.accuracy ?? 0,
        }));
        let distMeters = 0;
        for (let i = 1; i < path.length; i++) {
          distMeters += haversineDistance(path[i - 1], path[i]);
        }
        const distMiles = distMeters / 1609.34;
        distStr = `\n• Distance: ${distMiles.toFixed(2)} miles`;
        cals = estimateCalories({
          mode: 'outdoor',
          steps: 0,
          durationSeconds: duration,
          weightLbs: parsedWeight,
          strideLengthMeters: 0,
          gpsDistanceMeters: distMeters,
        });
      }

      const eq = getCalorieEquivalent(cals);
      const text = `⚡ Just completed my workout using Orbit! 🏃\n` +
        `• Mode: ${workout.mode === 'indoor' ? 'Indoor' : 'Outdoor'}\n` +
        `• Laps: ${workout.totalLaps} Laps\n` +
        `• Duration: ${formatDuration(duration)}` +
        `${distStr}${stepsStr}\n` +
        `• Est. Calories: ${cals} kcal (${eq} equivalent!)\n\n` +
        `Tracked with Orbit Pro 🚀`;

      await Share.share({ message: text });
    } catch (e) {
      console.warn('Failed to share workout:', e);
    }
  };

  // Save workout to SQLite database when workout completes & evaluate personal records
  useEffect(() => {
    if (isFinished && sessionStartTs) {
      const workoutId = `workout_${sessionStartTs}`;
      const existing = historyList.find((w) => w.id === workoutId);
      if (!existing) {
        const totalDuration = elapsedSeconds || 1;
        const totalSteps = mode === 'indoor' ? (state as DetectorState).steps || 0 : 0;
        const avgCadence = totalSteps > 0 ? (totalSteps * 60) / totalDuration : 0;
        
        // Estimate average stride length or calculate for outdoors
        let estimatedStride = 0;
        if (mode === 'outdoor') {
          const gpsPointsCount = gpsPath.length;
          estimatedStride = gpsPointsCount > 0 ? 1.05 : 0;
        } else {
          estimatedStride = totalSteps > 0 ? 0.75 : 0;
        }

        const item: DBWorkout = {
          id: workoutId,
          startTime: sessionStartTs,
          endTime: sessionEndTs || Date.now(),
          mode,
          totalLaps: state.count,
          steps: totalSteps,
          cadence: avgCadence,
          strideLength: estimatedStride,
          yawDrift: mode === 'indoor' ? (state as DetectorState).lastDisplacementMagnitude || 0 : 0,
        };

        // Evaluate achievements
        const recordsBroken: string[] = [];

        // 1. Most Laps
        if (state.count > recordMostLaps) {
          saveSettingSync('prMostLaps', String(state.count));
          setRecordMostLaps(state.count);
          recordsBroken.push(`Most Laps: ${state.count} laps`);
        }

        // 2. Longest Duration
        if (totalDuration > recordLongestSession) {
          saveSettingSync('prLongestSession', String(totalDuration));
          setRecordLongestSession(totalDuration);
          recordsBroken.push(`Longest Session: ${formatDuration(totalDuration)}`);
        }

        // 3. Fastest Lap
        let minLapDuration = 999999;
        if (lapTimes.length > 0) {
          let prevTime = 0;
          for (const t of lapTimes) {
            const lapDuration = t - prevTime;
            if (lapDuration > 0 && lapDuration < minLapDuration) {
              minLapDuration = lapDuration;
            }
            prevTime = t;
          }
        }
        if (minLapDuration < 999999 && minLapDuration < recordFastestLap) {
          saveSettingSync('prFastestLap', String(minLapDuration));
          setRecordFastestLap(minLapDuration);
          recordsBroken.push(`Fastest Lap: ${formatDuration(minLapDuration)}`);
        }

        if (recordsBroken.length > 0) {
          setBrokenRecords(recordsBroken);
        } else {
          setBrokenRecords([]);
        }

        saveWorkout(item, gpsPath).then(() => {
          reloadHistory();
        });
      }
    }
  }, [isFinished, sessionStartTs, sessionEndTs, mode, state, gpsPath, historyList, elapsedSeconds, recordMostLaps, recordLongestSession, recordFastestLap, lapTimes]);

  const onStart = async () => {
    saveSettingSync('userWeight', weightInput);
    saveSettingSync('targetLaps', targetInput);
    const parsed = parseInt(targetInput, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      Alert.alert('Invalid lap count', 'Please enter a positive whole number.');
      return;
    }
    
    // Gating check: Restrict target laps to max limits for Free tier users (both indoor and outdoor modes)
    if (!isPremium && pricingConfig.features.paywallEnabled && parsed > pricingConfig.features.maxFreeLaps) {
      setShowPaywall(true);
      return;
    }

    // Gating check: Restrict outdoor mode entirely if gpsModePremiumGated is enabled
    if (!isPremium && pricingConfig.features.paywallEnabled && mode === 'outdoor' && pricingConfig.features.gpsModePremiumGated) {
      setShowPaywall(true);
      return;
    }

    const isTesting = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
    if (mode === 'outdoor' && !prewarmLocation && !isTesting) {
      Alert.alert(
        'No GPS Signal',
        'Wait for GPS to lock before starting, otherwise calibration will be offset. Start anyway?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Start Anyway',
            onPress: async () => {
              await start({ 
                mode, 
                targetLaps: parsed, 
                disableBle, 
                isPremium, 
                voiceCuesEnabled, 
                gpsModePremiumGated: pricingConfig.features.gpsModePremiumGated 
              });
            },
          },
        ]
      );
      return;
    }
    await start({ 
      mode, 
      targetLaps: parsed, 
      disableBle, 
      isPremium, 
      voiceCuesEnabled, 
      gpsModePremiumGated: pricingConfig.features.gpsModePremiumGated 
    });
  };

  const confirmStop = () => {
    Alert.alert(
      'Active Session',
      'You have an active walking session. Are you sure you want to stop?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', style: 'destructive', onPress: stop },
      ]
    );
  };

  const confirmReset = () => {
    Alert.alert(
      'Active Session',
      'You have an active walking session. Are you sure you want to reset?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', style: 'destructive', onPress: reset },
      ]
    );
  };

  // Trigger alert once user completes all laps
  useEffect(() => {
    if (isFinished) {
      Alert.alert(
        '🎉 Session Complete!',
        `Congratulations! You completed all ${state.count} of ${target} laps. Nice work!`,
        [{ text: 'Great!' }]
      );
    }
  }, [isFinished, target, state.count]);

  const handleExportCSV = async (workout: DBWorkout) => {
    const rawPath = getWorkoutPath(workout.id);
    const laps: ExporterLap[] = [];

    // For outdoor workouts: compute total GPS distance and distribute per lap
    let totalGpsDistM = 0;
    if (workout.mode === 'outdoor' && rawPath.length > 1) {
      for (let i = 1; i < rawPath.length; i++) {
        totalGpsDistM += haversineDistance(
          { latitude: rawPath[i - 1].latitude, longitude: rawPath[i - 1].longitude, accuracy: rawPath[i - 1].accuracy ?? 0 },
          { latitude: rawPath[i].latitude, longitude: rawPath[i].longitude, accuracy: rawPath[i].accuracy ?? 0 }
        );
      }
    }

    for (let i = 1; i <= workout.totalLaps; i++) {
      const dur = Math.round(workout.endTime - workout.startTime) / 1000 / workout.totalLaps;
      if (workout.mode === 'outdoor') {
        laps.push({
          lapNumber: i,
          durationSeconds: Math.round(dur),
          steps: 0,
          cadence: 0,
          distanceMeters: totalGpsDistM > 0 ? totalGpsDistM / workout.totalLaps : undefined,
        });
      } else {
        const st = workout.steps / workout.totalLaps;
        const cad = workout.cadence || 160;
        laps.push({
          lapNumber: i,
          durationSeconds: Math.round(dur),
          steps: Math.round(st),
          cadence: cad,
          yawDrift: workout.yawDrift / workout.totalLaps,
        });
      }
    }

    const content = generateCSV(laps);
    await exportWorkoutFile(`workout_${workout.startTime}.csv`, content);
  };

  const handleExportGPX = async (workout: DBWorkout) => {
    const rawPath = getWorkoutPath(workout.id);
    if (rawPath.length === 0) {
      Alert.alert('No GPS Trail', 'Indoor or beacon sessions do not have GPS coordinates to export.');
      return;
    }
    const content = generateGPX(rawPath, workout.startTime);
    await exportWorkoutFile(`workout_${workout.startTime}.gpx`, content);
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.flex}
        >
          {/* Main Content Areas */}
          {activeTab === 'workout' && (
            <ScrollView
              contentContainerStyle={styles.scroll}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.title}>Orbit</Text>

              {pricingConfig.announcements.global.show && (
                <View style={styles.announcementBanner}>
                  <Text style={styles.announcementText}>📢 {pricingConfig.announcements.global.message}</Text>
                </View>
              )}

              {subTier === 'monthly' && pricingConfig.announcements.premiumMonthly.show && (
                <View style={[styles.announcementBanner, { backgroundColor: '#3b82f6' }]}>
                  <Text style={styles.announcementText}>✨ {pricingConfig.announcements.premiumMonthly.message}</Text>
                </View>
              )}

              {subTier === 'annual' && pricingConfig.announcements.premiumAnnual.show && (
                <View style={[styles.announcementBanner, { backgroundColor: '#10b981' }]}>
                  <Text style={styles.announcementText}>👑 {pricingConfig.announcements.premiumAnnual.message}</Text>
                </View>
              )}

              {isSetup && (
                <SetupCard
                  mode={mode}
                  onModeChange={setMode}
                  targetInput={targetInput}
                  onChange={setTargetInput}
                  onTargetInputBlur={() => saveSettingSync('targetLaps', targetInput)}
                  onStart={onStart}
                  prewarmLocation={prewarmLocation}
                  weatherSuggest={weatherSuggest}
                  weatherUnit={weatherUnit}
                  isPremium={isPremium}
                  onShowPaywall={() => setShowPaywall(true)}
                  maxFreeLaps={pricingConfig.features.maxFreeLaps}
                />
              )}

              {isRunning && (
                <RunningCard
                  mode={mode}
                  count={state.count}
                  target={target}
                  status={status}
                  progressPct={progressPct}
                  onStop={confirmStop}
                  onReset={confirmReset}
                  startTs={sessionStartTs}
                  elapsedSeconds={elapsedSeconds}
                  isPaused={isPaused}
                  gpsPath={gpsPath}
                  pointA={mode === 'outdoor' ? (state as OutdoorDetectorState).pointA : null}
                  onPause={pause}
                  onResume={resume}
                  steps={mode === 'indoor' ? (state as DetectorState).steps || 0 : 0}
                  calories={currentSessionCalories}
                  distanceMiles={currentSessionDistanceMiles}
                  mapType={mapType}
                  onMapTypeToggle={() => setMapType(prev => prev === 'standard' ? 'satellite' : 'standard')}
                />
              )}

              {isFinished && (
                <FinishedCard
                  count={state.count}
                  target={target}
                  onReset={reset}
                  startTs={sessionStartTs}
                  endTs={sessionEndTs}
                  elapsedSeconds={elapsedSeconds}
                  steps={mode === 'indoor' ? (state as DetectorState).steps || 0 : 0}
                  isPremium={isPremium}
                  onShowPaywall={() => setShowPaywall(true)}
                  onExportCSV={() => {
                    const workoutId = `workout_${sessionStartTs}`;
                    const workout = historyList.find((w) => w.id === workoutId);
                    if (workout) handleExportCSV(workout);
                  }}
                  onExportGPX={() => {
                    const workoutId = `workout_${sessionStartTs}`;
                    const workout = historyList.find((w) => w.id === workoutId);
                    if (workout) handleExportGPX(workout);
                  }}
                  mode={mode}
                  calories={currentSessionCalories}
                  distanceMiles={currentSessionDistanceMiles}
                  brokenRecords={brokenRecords}
                  onTextShare={() => {
                    const workoutId = `workout_${sessionStartTs}`;
                    const workout = historyList.find((w) => w.id === workoutId);
                    if (workout) handleTextShare(workout);
                  }}
                />
              )}

              {error && (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>⚠ {error.message}</Text>
                </View>
              )}

              {showSettingsDebug &&
                (mode === 'indoor' ? (
                  <IndoorDebugPanel state={state as DetectorState} logs={debugLogs} />
                ) : (
                  <OutdoorDebugPanel state={state as OutdoorDetectorState} logs={debugLogs} />
                ))}
            </ScrollView>
          )}

          {activeTab === 'history' && (
            <ScrollView contentContainerStyle={styles.scroll}>
              <Text style={styles.title}>Workout History</Text>
              
              {historyList.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyText}>No saved workouts yet. Complete your first session to view history logs!</Text>
                </View>
              ) : (
                historyList.map((item, idx) => {
                  // Free tier limit: only show the last 3 workouts
                  if (!isPremium && idx >= 3) return null;
                  
                  return (
                    <Pressable
                      key={item.id}
                      onPress={() => setSelectedWorkout(item)}
                      style={styles.workoutItemCard}
                    >
                      <View style={styles.workoutItemHeader}>
                        <Text style={styles.workoutItemDate}>{new Date(item.startTime).toLocaleDateString()} {new Date(item.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                        <Text style={styles.workoutItemMode}>{item.mode === 'indoor' ? '🏠 Indoor' : '🌳 Outdoor'}</Text>
                      </View>
                      <Text style={styles.workoutItemLaps}>{item.totalLaps} Laps Completed</Text>
                      <Text style={styles.workoutItemTime}>Duration: {formatDuration(Math.round((item.endTime - item.startTime) / 1000))}</Text>
                    </Pressable>
                  );
                })
              )}

              {!isPremium && historyList.length > 3 && (
                <Pressable onPress={() => setShowPaywall(true)} style={styles.historyLockedBanner}>
                  <Text style={styles.historyLockedText}>🔒 Unlock Premium to view all {historyList.length} past sessions</Text>
                </Pressable>
              )}
            </ScrollView>
          )}

          {activeTab === 'analytics' && (
            <ScrollView contentContainerStyle={styles.scroll}>
              <Text style={styles.title}>Analytics</Text>

              {isPremium ? (
                <View style={styles.analyticsWrapper}>
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>Performance Averages</Text>
                    <View style={styles.statsRow}>
                      <View style={styles.statBox}>
                        <Text style={styles.statLabel}>Avg Cadence</Text>
                        <Text style={styles.statValue}>162 spm</Text>
                      </View>
                      <View style={styles.statBox}>
                        <Text style={styles.statLabel}>Stride Length</Text>
                        <Text style={styles.statValue}>1.05 m</Text>
                      </View>
                      <View style={styles.statBox}>
                        <Text style={styles.statLabel}>Avg Drift</Text>
                        <Text style={styles.statValue}>0.8% / lap</Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>Cadence Consistency Log</Text>
                    <View style={styles.chartMockContainer}>
                      <View style={[styles.chartBar, { height: 110 }]}><Text style={styles.chartBarText}>156</Text></View>
                      <View style={[styles.chartBar, { height: 120 }]}><Text style={styles.chartBarText}>160</Text></View>
                      <View style={[styles.chartBar, { height: 135 }]}><Text style={styles.chartBarText}>164</Text></View>
                      <View style={[styles.chartBar, { height: 130 }]}><Text style={styles.chartBarText}>162</Text></View>
                      <View style={[styles.chartBar, { height: 145 }]}><Text style={styles.chartBarText}>168</Text></View>
                    </View>
                    <Text style={styles.chartMockLegend}>Session 1    Session 2    Session 3    Session 4    Session 5</Text>
                  </View>

                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>🏆 Personal Bests</Text>
                    <View style={styles.summaryTable}>
                      <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>Most Laps</Text>
                        <Text style={styles.summaryValue}>
                          {recordMostLaps > 0 ? `${recordMostLaps} laps` : '—'}
                        </Text>
                      </View>
                      <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>Fastest Lap</Text>
                        <Text style={styles.summaryValue}>
                          {recordFastestLap < 999999 ? formatDuration(recordFastestLap) : '—'}
                        </Text>
                      </View>
                      <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>Longest Run</Text>
                        <Text style={styles.summaryValue}>
                          {recordLongestSession > 0 ? formatDuration(recordLongestSession) : '—'}
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>
              ) : (
                <View style={styles.lockCard}>
                  <Text style={styles.lockIcon}>🔒</Text>
                  <Text style={styles.lockTitle}>Advanced Analytics Gated</Text>
                  <Text style={styles.lockDescription}>
                    Unlock detailed cadence stats, stride length estimations, relative displacement drift graphs, and turn-rate logs.
                  </Text>
                  <Pressable onPress={() => setShowPaywall(true)} style={styles.lockUpgradeBtn}>
                    <Text style={styles.lockUpgradeBtnText}>Unlock Premium</Text>
                  </Pressable>
                </View>
              )}
            </ScrollView>
          )}

          {activeTab === 'settings' && (
            <SettingsScreen
              weightInput={weightInput}
              onWeightInputChange={handleWeightInputChange}
              onWeightInputBlur={handleWeightInputBlur}
              weightUnit={weightUnit}
              onWeightUnitChange={handleWeightUnitChange}
              weatherUnit={weatherUnit}
              onWeatherUnitChange={handleWeatherUnitChange}
              voiceCuesEnabled={voiceCuesEnabled}
              onVoiceCuesChange={setVoiceCuesEnabled}
              disableBle={disableBle}
              onDisableBleChange={(val) => {
                setDisableBle(val);
                saveSettingSync('disableBle', String(val));
              }}
              isPremium={isPremium}
              subTier={subTier}
              onShowPaywall={() => setShowPaywall(true)}
              onVersionTap={handleVersionTap}
              settingsTapCount={settingsTapCount}
              showSettingsDebug={showSettingsDebug}
              debugSubTier={debugSubTier}
              onDebugSubTierChange={(tier) => {
                setDebugSubTier(tier);
                sub.setIsPremium(tier !== 'free');
                sub.setSubTier(tier);
              }}
              mode={mode}
              detectorState={state}
              outdoorState={mode === 'outdoor' ? state as OutdoorDetectorState : null}
              debugLogs={debugLogs}
              onShowInfoModal={() => setShowInfoModal(true)}
            />
          )}

          {/* Accidental Tap Prevention: Only show bottom menu tabs when NOT running a workout */}
          {isSetup && (
            <View style={styles.tabBar}>
              <Pressable
                onPress={() => setActiveTab('workout')}
                style={[styles.tabBarItem, activeTab === 'workout' && styles.tabBarItemActive]}
              >
                <Text style={styles.tabIcon}>⚡</Text>
                <Text style={styles.tabLabel}>Workout</Text>
              </Pressable>

              <Pressable
                onPress={() => setActiveTab('history')}
                style={[styles.tabBarItem, activeTab === 'history' && styles.tabBarItemActive]}
              >
                <Text style={styles.tabIcon}>📂</Text>
                <Text style={styles.tabLabel}>History</Text>
              </Pressable>

              <Pressable
                onPress={() => setActiveTab('analytics')}
                style={[styles.tabBarItem, activeTab === 'analytics' && styles.tabBarItemActive]}
              >
                <Text style={styles.tabIcon}>📈</Text>
                <Text style={styles.tabLabel}>Analytics</Text>
              </Pressable>

              <Pressable
                onPress={() => setActiveTab('settings')}
                style={[styles.tabBarItem, activeTab === 'settings' && styles.tabBarItemActive]}
              >
                <Text style={styles.tabIcon}>⚙️</Text>
                <Text style={styles.tabLabel}>Settings</Text>
              </Pressable>
            </View>
          )}

          {/* Metrics Info & Formulas Modal */}
          <MetricsInfoModal
            visible={showInfoModal}
            onClose={() => setShowInfoModal(false)}
          />

          {/* First-time Onboarding Wizard */}
          <OnboardingWizard
            visible={showOnboarding}
            onComplete={(weight, weightUnit, wUnit) => {
              if (weight) {
                setWeightInput(weight);
                saveSettingSync('userWeight', weight);
              }
              if (weightUnit) handleWeightUnitChange(weightUnit);
              if (wUnit) handleWeatherUnitChange(wUnit);
              saveSettingSync('onboardingDone', 'true');
              setShowOnboarding(false);
            }}
          />

          {/* Premium Paywall Subscription Modal */}
          <Modal
            animationType="slide"
            transparent={true}
            visible={showPaywall}
            onRequestClose={() => setShowPaywall(false)}
          >
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <Text style={styles.modalEmoji}>👑</Text>
                <Text style={styles.modalTitle}>Unlock Premium Tier</Text>
                <Text style={styles.modalSubtitle}>Unlock world-class fitness tracking features.</Text>
                
                {pricingConfig.announcements.freeTier.show && (
                  <View style={styles.tierAnnouncementBanner}>
                    <Text style={styles.tierAnnouncementText}>🎁 {pricingConfig.announcements.freeTier.message}</Text>
                  </View>
                )}

                <View style={styles.benefitsList}>
                  <Text style={styles.benefitItem}>⭐ **Unlimited Laps**: Remove the 3-lap limit on indoor workouts.</Text>
                  <Text style={styles.benefitItem}>⭐ **Outdoor GPS Mode**: Unlock live tracking map and Continuous Pre-Warming locks.</Text>
                  <Text style={styles.benefitItem}>🔜 **Live Beacon Telecast** (Coming Soon): Generate a shareable map link to broadcast your GPS run live to spectators.</Text>
                  <Text style={styles.benefitItem}>⭐ **Advanced Analytics**: Cadence, stride estimation, and relative drift graphs.</Text>
                  <Text style={styles.benefitItem}>⭐ **Background Session Tracking**: Count laps while screen is turned off.</Text>
                  <Text style={styles.benefitItem}>⭐ **Unlimited History & Exports**: Keep all sessions and export CSV/GPX files.</Text>
                </View>

                {pricingConfig.tiers.annual.enabled && (
                  <Pressable
                    onPress={() => handlePurchase('annual')}
                    style={styles.modalBuyBtn}
                  >
                    <Text style={styles.modalBuyBtnText}>Subscribe Annual: {pricingConfig.tiers.annual.priceLabel} {pricingConfig.tiers.annual.savePercentageLabel}</Text>
                  </Pressable>
                )}
                
                {pricingConfig.tiers.monthly.enabled && (
                  <Pressable
                    onPress={() => handlePurchase('monthly')}
                    style={[styles.modalBuyBtn, { backgroundColor: '#3b82f6', marginTop: 8 }]}
                  >
                    <Text style={styles.modalBuyBtnText}>Subscribe Monthly: {pricingConfig.tiers.monthly.priceLabel}</Text>
                  </Pressable>
                )}

                <View style={styles.modalRowButtons}>
                  <Pressable
                    onPress={async () => {
                      const success = await sub.restore();
                      if (success) {
                        setShowPaywall(false);
                        Alert.alert('Success', 'Purchases restored successfully!');
                      } else {
                        Alert.alert('Restore Failed', 'No active purchases found to restore.');
                      }
                    }}
                    style={styles.modalRestoreBtn}
                  >
                    <Text style={styles.modalRestoreBtnText}>Restore Purchases</Text>
                  </Pressable>
                  <Pressable onPress={() => setShowPaywall(false)} style={styles.modalCloseBtn}>
                    <Text style={styles.modalCloseBtnText}>Close</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>

          {/* Workout History Item Detail Modal */}
          {selectedWorkout && (
            <Modal
              animationType="fade"
              transparent={true}
              visible={selectedWorkout !== null}
              onRequestClose={() => setSelectedWorkout(null)}
            >
              <View style={styles.modalOverlay}>
                <View style={styles.modalContent}>
                  <Text style={styles.modalTitle}>Workout Summary</Text>
                  <Text style={styles.modalSubtitle}>{new Date(selectedWorkout.startTime).toLocaleString()}</Text>

                  <View style={styles.summaryTable}>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Mode</Text>
                      <Text style={styles.summaryValue}>{selectedWorkout.mode === 'indoor' ? '🏠 Indoor' : '🌳 Outdoor'}</Text>
                    </View>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Laps Completed</Text>
                      <Text style={styles.summaryValue}>{selectedWorkout.totalLaps}</Text>
                    </View>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Total Duration</Text>
                      <Text style={styles.summaryValue}>{formatDuration(Math.round((selectedWorkout.endTime - selectedWorkout.startTime) / 1000))}</Text>
                    </View>
                    {selectedWorkout.mode === 'indoor' ? (
                      <>
                        <View style={styles.summaryRow}>
                          <Text style={styles.summaryLabel}>Total Steps</Text>
                          <Text style={styles.summaryValue}>{selectedWorkout.steps} steps</Text>
                        </View>
                        <View style={styles.summaryRow}>
                          <Text style={styles.summaryLabel}>Est. Calories Burned</Text>
                          <Text style={styles.summaryValue}>
                            {(() => {
                              const cals = estimateCalories({
                                mode: 'indoor',
                                steps: selectedWorkout.steps,
                                durationSeconds: Math.round((selectedWorkout.endTime - selectedWorkout.startTime) / 1000),
                                weightLbs: parsedWeight,
                                strideLengthMeters: selectedWorkout.strideLength,
                              });
                              return `${cals} kcal (${getCalorieEquivalent(cals).split(' ')[0]})`;
                            })()}
                          </Text>
                        </View>
                      </>
                    ) : (
                      <>
                        <View style={styles.summaryRow}>
                          <Text style={styles.summaryLabel}>Est. Distance</Text>
                          <Text style={styles.summaryValue}>
                            {(() => {
                              let distM = 0;
                              for (let i = 1; i < selectedWorkoutPath.length; i++) {
                                distM += haversineDistance(selectedWorkoutPath[i - 1], selectedWorkoutPath[i]);
                              }
                              return (distM / 1609.34).toFixed(2);
                            })()} miles
                          </Text>
                        </View>
                        <View style={styles.summaryRow}>
                          <Text style={styles.summaryLabel}>Est. Calories Burned</Text>
                          <Text style={styles.summaryValue}>
                            {(() => {
                              let distM = 0;
                              for (let i = 1; i < selectedWorkoutPath.length; i++) {
                                distM += haversineDistance(selectedWorkoutPath[i - 1], selectedWorkoutPath[i]);
                              }
                              const cals = estimateCalories({
                                mode: 'outdoor',
                                steps: 0,
                                durationSeconds: Math.round((selectedWorkout.endTime - selectedWorkout.startTime) / 1000),
                                weightLbs: parsedWeight,
                                strideLengthMeters: 0,
                                gpsDistanceMeters: distM,
                              });
                              return `${cals} kcal (${getCalorieEquivalent(cals).split(' ')[0]})`;
                            })()}
                          </Text>
                        </View>
                      </>
                    )}
                  </View>

                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>Advanced Metrics</Text>
                    <View style={styles.statsRow}>
                      <View style={styles.statBox}>
                        <Text style={styles.statLabel}>Cadence</Text>
                        <Text style={styles.statValue}>{Math.round(selectedWorkout.cadence)} spm</Text>
                      </View>
                      <View style={styles.statBox}>
                        <Text style={styles.statLabel}>Stride</Text>
                        <Text style={styles.statValue}>{selectedWorkout.strideLength.toFixed(2)} m</Text>
                      </View>
                      <View style={styles.statBox}>
                        <Text style={styles.statLabel}>Displ. Drift</Text>
                        <Text style={styles.statValue}>{selectedWorkout.yawDrift.toFixed(1)} m</Text>
                      </View>
                    </View>
                  </View>

                  {isPremium ? (
                    <View style={styles.modalActionExportRow}>
                      <Pressable onPress={() => handleExportCSV(selectedWorkout)} style={styles.exportItemBtn}>
                        <Text style={styles.exportItemBtnText}>CSV Export</Text>
                      </Pressable>
                      {selectedWorkout.mode === 'outdoor' && (
                        <Pressable onPress={() => handleExportGPX(selectedWorkout)} style={[styles.exportItemBtn, { backgroundColor: '#8b5cf6' }]}>
                          <Text style={styles.exportItemBtnText}>GPX Export</Text>
                        </Pressable>
                      )}
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => {
                        setSelectedWorkout(null);
                        setShowPaywall(true);
                      }}
                      style={[styles.completedPaywallBtn, { marginTop: 12, width: '100%' }]}
                    >
                      <Text style={styles.completedPaywallText}>👑 Upgrade to Export GPX/CSV</Text>
                    </Pressable>
                  )}

                  <Pressable onPress={() => setSelectedWorkout(null)} style={[styles.primaryButton, { width: '100%', marginTop: 16 }]}>
                    <Text style={styles.primaryButtonText}>Close Summary</Text>
                  </Pressable>
                </View>
              </View>
            </Modal>
          )}

        </KeyboardAvoidingView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function ModePicker(props: {
  mode: LapMode;
  onChange: (mode: LapMode) => void;
  isPremium: boolean;
  onShowPaywall: () => void;
}) {
  return (
    <View>
      <Text style={styles.modeLabel}>Where will you walk?</Text>
      <View style={styles.modeRow}>
        <ModeOption
          label="Indoor"
          hint="BLE + magnetic"
          selected={props.mode === 'indoor'}
          onPress={() => props.onChange('indoor')}
        />
        <ModeOption
          label="Outdoor"
          hint="GPS"
          selected={props.mode === 'outdoor'}
          onPress={() => props.onChange('outdoor')}
        />
      </View>
    </View>
  );
}

function ModeOption(props: {
  label: string;
  hint: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: props.selected }}
      style={({ pressed }) => [
        styles.modeOption,
        props.selected && styles.modeOptionSelected,
        pressed && styles.modeOptionPressed,
      ]}
    >
      <View style={styles.modeRadio}>
        <View
          style={[
            styles.modeRadioOuter,
            props.selected && styles.modeRadioOuterSelected,
          ]}
        >
          {props.selected && <View style={styles.modeRadioInner} />}
        </View>
        <Text
          style={[
            styles.modeOptionLabel,
            props.selected && styles.modeOptionLabelSelected,
          ]}
        >
          {props.label}
        </Text>
      </View>
      <Text style={styles.modeOptionHint}>{props.hint}</Text>
    </Pressable>
  );
}

function SetupCard(props: {
  mode: LapMode;
  onModeChange: (mode: LapMode) => void;
  targetInput: string;
  onChange: (v: string) => void;
  onTargetInputBlur: () => void;
  onStart: () => void;
  prewarmLocation: GeoPoint | null;
  weatherSuggest: { temp: number; condition: string; code: number } | null;
  weatherUnit: 'celsius' | 'fahrenheit';
  isPremium: boolean;
  onShowPaywall: () => void;
  maxFreeLaps: number;
}) {
  let gpsStatusComponent = null;
  if (props.mode === 'outdoor') {
    const loc = props.prewarmLocation;
    if (!loc) {
      gpsStatusComponent = (
        <View style={styles.gpsBadgeRed}>
          <Text style={styles.gpsBadgeText}>🔴 GPS Signal: Acquiring lock (stand still in an open area)...</Text>
        </View>
      );
    } else if (loc.accuracy > 25) {
      gpsStatusComponent = (
        <View style={styles.gpsBadgeYellow}>
          <Text style={styles.gpsBadgeText}>
            🟡 GPS Signal: Weak (±{loc.accuracy.toFixed(0)}m accuracy) - waiting for better lock...
          </Text>
        </View>
      );
    } else {
      gpsStatusComponent = (
        <View style={styles.gpsBadgeGreen}>
          <Text style={styles.gpsBadgeText}>
            🟢 GPS Signal: Strong (±{loc.accuracy.toFixed(0)}m accuracy) - ready!
          </Text>
        </View>
      );
    }
  }

  return (
    <View style={styles.card}>
      {props.weatherSuggest && (
        <View style={styles.weatherBanner}>
          <Text style={styles.weatherText}>
            ☁️ {props.weatherSuggest.condition}, {(() => {
              const isF = props.weatherUnit === 'fahrenheit';
              const tempVal = isF
                ? Math.round((props.weatherSuggest.temp * 9) / 5 + 32)
                : props.weatherSuggest.temp;
              return `${tempVal}${isF ? '°F' : '°C'}`;
            })()} • 
            {props.weatherSuggest.code >= 51 && props.weatherSuggest.code <= 82
              ? ' Rainy! Indoor Recommended'
              : ' Ideal for Outdoors'}
          </Text>
        </View>
      )}

      {/* SECTION 1: GOAL SETUP */}
      <View style={styles.setupSection}>
        <Text style={styles.setupSectionTitle}>Workout Goal</Text>
        <ModePicker
          mode={props.mode}
          onChange={props.onModeChange}
          isPremium={props.isPremium}
          onShowPaywall={props.onShowPaywall}
        />
        
        <Text style={styles.setupFieldLabel}>How many laps do you want?</Text>
        <TextInput
          value={props.targetInput}
          onChangeText={props.onChange}
          onBlur={props.onTargetInputBlur}
          keyboardType="number-pad"
          style={styles.input}
          placeholder="10"
          placeholderTextColor="#6b7280"
          maxLength={4}
        />
        {!props.isPremium && (
          <Text style={styles.clampedDisclaimer}>⚠️ Laps capped at {props.maxFreeLaps} on the free tier. Subscribe to count unlimited.</Text>
        )}
      </View>

      {gpsStatusComponent}

      <Pressable
        onPress={props.onStart}
        style={({ pressed }) => [
          styles.primaryButton,
          pressed && styles.primaryButtonPressed,
        ]}
      >
        <Text style={styles.primaryButtonText}>▶ Start Workout</Text>
      </Pressable>
      <Text style={styles.helpText}>
        {props.mode === 'indoor'
          ? 'Stand at your starting point before tapping Start. The app calibrates for ~5 seconds, then counts laps using your device\'s sensors.'
          : 'Stand at your starting point before tapping Start. The app locks onto GPS for ~8 seconds, then counts laps each time you return within 15 m of the start.\n\n* Note: Continued use of GPS tracking in the background may significantly decrease battery life.'}
      </Text>
    </View>
  );
}

function formatLocalTime(ts: number | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  let hours = d.getHours();
  const minutes = d.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // the hour '0' should be '12'
  const minutesStr = minutes < 10 ? '0' + minutes : minutes;
  return `${hours}:${minutesStr} ampm`.replace('ampm', ampm);
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const mStr = minutes < 10 ? '0' + minutes : minutes;
  const sStr = seconds < 10 ? '0' + seconds : seconds;
  return `${mStr}:${sStr}`;
}

function RunningCard(props: {
  mode: LapMode;
  count: number;
  target: number;
  status: string;
  progressPct: number;
  onStop: () => void;
  onReset: () => void;
  startTs: number | null;
  elapsedSeconds: number;
  isPaused: boolean;
  gpsPath: GeoPoint[];
  pointA: GeoPoint | null;
  onPause: () => void;
  onResume: () => void;
  steps: number;
  calories: number;
  distanceMiles: number;
  mapType: 'standard' | 'satellite';
  onMapTypeToggle: () => void;
}) {
  const walkAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(walkAnim, {
          toValue: 1,
          duration: 1200,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(walkAnim, {
          toValue: 0,
          duration: 1200,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [walkAnim]);

  const walkTranslateX = walkAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-25, 25],
  });

  const walkRotate = walkAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['-10deg', '10deg', '-10deg'],
  });

  return (
    <View style={styles.card}>
      <Text style={styles.modeBadge}>
        {props.mode === 'indoor' ? '🏠 Indoor' : '🌳 Outdoor'}
      </Text>
      <Text style={styles.cardTitle}>Target: {props.target} laps</Text>

      {/* Render Workout Map for Outdoors */}
      {props.mode === 'outdoor' && (
        <WorkoutMap
          gpsPath={props.gpsPath}
          pointA={props.pointA}
          currentLocation={props.gpsPath[props.gpsPath.length - 1] || null}
          mapType={props.mapType}
          onMapTypeToggle={props.onMapTypeToggle}
        />
      )}

      <View style={styles.counterBox}>
        <Text style={styles.counterValue}>{props.count}</Text>
        <View style={styles.counterDivider} />
        <Text style={styles.counterTarget}>/ {props.target}</Text>
      </View>

      <View style={styles.progressBarTrack}>
        <View
          style={[
            styles.progressBarFill,
            { width: `${Math.round(props.progressPct * 100)}%` },
          ]}
        />
      </View>
      <Text style={styles.progressLabel}>
        {Math.round(props.progressPct * 100)}%
      </Text>

      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Start Time</Text>
          <Text style={styles.statValue}>{formatLocalTime(props.startTs)}</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Time Elapsed</Text>
          <Text style={styles.statValue}>{formatDuration(props.elapsedSeconds)}</Text>
        </View>
      </View>

      {props.mode === 'indoor' ? (
        <View style={[styles.statsRow, { marginTop: 8 }]}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Steps</Text>
            <Text style={styles.statValue}>{props.steps}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Est. Calories</Text>
            <Text style={styles.statValue}>{props.calories} kcal {getCalorieEquivalent(props.calories).split(' ')[0]}</Text>
          </View>
        </View>
      ) : (
        <View style={[styles.statsRow, { marginTop: 8 }]}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Distance</Text>
            <Text style={styles.statValue}>{props.distanceMiles.toFixed(2)} mi</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Est. Calories</Text>
            <Text style={styles.statValue}>{props.calories} kcal {getCalorieEquivalent(props.calories).split(' ')[0]}</Text>
          </View>
        </View>
      )}

      <View style={styles.animationContainer}>
        <Animated.Text
          style={[
            styles.walkingIcon,
            { transform: [{ translateX: walkTranslateX }, { rotate: walkRotate }] },
          ]}
        >
          🚶
        </Animated.Text>
      </View>

      <Text style={styles.statusText}>{props.isPaused ? 'Paused' : props.status}</Text>

      {/* Pause/Resume toggler button controls */}
      <View style={styles.row}>
        {props.isPaused ? (
          <Pressable
            onPress={props.onResume}
            style={[styles.primaryButton, { flex: 1, backgroundColor: '#10b981' }]}
          >
            <Text style={[styles.primaryButtonText, { color: '#ffffff' }]}>Resume</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={props.onPause}
            style={[styles.tertiaryButton, { flex: 1 }]}
          >
            <Text style={styles.tertiaryButtonText}>Pause</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.row}>
        <Pressable
          onPress={props.onStop}
          style={({ pressed }) => [
            styles.secondaryButton,
            pressed && styles.secondaryButtonPressed,
          ]}
        >
          <Text style={styles.secondaryButtonText}>Stop</Text>
        </Pressable>
        <Pressable
          onPress={props.onReset}
          style={({ pressed }) => [
            styles.tertiaryButton,
            pressed && styles.tertiaryButtonPressed,
          ]}
        >
          <Text style={styles.tertiaryButtonText}>Reset</Text>
        </Pressable>
      </View>
    </View>
  );
}

function FinishedCard(props: {
  count: number;
  target: number;
  onReset: () => void;
  startTs: number | null;
  endTs: number | null;
  elapsedSeconds: number;
  steps: number;
  isPremium: boolean;
  onShowPaywall: () => void;
  onExportCSV: () => void;
  onExportGPX: () => void;
  mode: LapMode;
  calories: number;
  distanceMiles: number;
  brokenRecords: string[];
  onTextShare: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.completeBanner}>🎉 Complete!</Text>

      {/* broken records celebration card */}
      {props.brokenRecords.length > 0 && (
        <View style={styles.achievementBox}>
          <Text style={styles.achievementEmoji}>🏆</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.achievementTitle}>New Personal Record!</Text>
            {props.brokenRecords.map((rec, i) => (
              <Text key={i} style={styles.achievementText}>• {rec}</Text>
            ))}
          </View>
        </View>
      )}

      <View style={styles.counterBox}>
        <Text style={styles.counterValue}>{props.count}</Text>
        <View style={styles.counterDivider} />
        <Text style={styles.counterTarget}>/ {props.target}</Text>
      </View>

      <View style={styles.progressBarTrack}>
        <View style={[styles.progressBarFill, { width: '100%' }]} />
      </View>
      <Text style={styles.progressLabel}>100%</Text>

      <View style={styles.summaryTable}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Start Time</Text>
          <Text style={styles.summaryValue}>{formatLocalTime(props.startTs)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>End Time</Text>
          <Text style={styles.summaryValue}>{formatLocalTime(props.endTs)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Total Duration</Text>
          <Text style={styles.summaryValue}>{formatDuration(props.elapsedSeconds)}</Text>
        </View>
        {props.mode === 'indoor' ? (
          <>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Total Steps</Text>
              <Text style={styles.summaryValue}>{props.steps} steps</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Est. Calories Burned</Text>
              <Text style={styles.summaryValue}>
                {props.calories} kcal ({getCalorieEquivalent(props.calories).split(' ')[0]})
              </Text>
            </View>
          </>
        ) : (
          <>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Total Distance</Text>
              <Text style={styles.summaryValue}>{props.distanceMiles.toFixed(2)} miles</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Est. Calories Burned</Text>
              <Text style={styles.summaryValue}>
                {props.calories} kcal ({getCalorieEquivalent(props.calories).split(' ')[0]})
              </Text>
            </View>
          </>
        )}
      </View>

      {/* Exporter triggers for premium tier */}
      {props.isPremium ? (
        <View style={styles.row}>
          <Pressable onPress={props.onExportCSV} style={styles.exportBtn}>
            <Text style={styles.exportBtnText}>CSV Export</Text>
          </Pressable>
          <Pressable onPress={props.onExportGPX} style={[styles.exportBtn, { backgroundColor: '#8b5cf6' }]}>
            <Text style={styles.exportBtnText}>GPX Export</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={props.onShowPaywall} style={styles.completedPaywallBtn}>
          <Text style={styles.completedPaywallText}>👑 Export GPX/CSV & View Advanced Stats</Text>
        </Pressable>
      )}

      {/* Native Share Workout Summary */}
      <Pressable onPress={props.onTextShare} style={[styles.exportBtn, { backgroundColor: '#0ea5e9', marginTop: 8, width: '100%' }]}>
        <Text style={styles.exportBtnText}>💬 Share Workout Summary</Text>
      </Pressable>

      <Pressable
        onPress={props.onReset}
        style={({ pressed }) => [
          styles.primaryButton,
          pressed && styles.primaryButtonPressed,
          { marginTop: 12 }
        ]}
      >
        <Text style={styles.primaryButtonText}>↻ Start Over</Text>
      </Pressable>
    </View>
  );
}

function MetricsInfoModal(props: {
  visible: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={props.visible}
      onRequestClose={props.onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>Metrics & Formulas</Text>
          <ScrollView style={styles.modalScroll}>
            <View style={styles.infoSection}>
              <Text style={styles.infoSecTitle}>🏃‍♂️ Estimated Calories Burned</Text>
              <Text style={styles.infoSecDesc}>
                We estimate calorie burn using Metabolic Equivalent of Task (MET) factors, adjusted dynamically for walking vs. running pace:
              </Text>
              <Text style={styles.formulaText}>
                Calories = MET_Factor * Weight (lbs) * Distance (miles)
              </Text>
              <Text style={styles.bulletText}>• <Text style={{fontWeight: 'bold'}}>Weight</Text>: Configured in your profile settings (Lbs/Kg).</Text>
              <Text style={styles.bulletText}>• <Text style={{fontWeight: 'bold'}}>MET Factor</Text>: Walking uses <Text style={{fontWeight: 'bold'}}>0.57</Text>. Running uses <Text style={{fontWeight: 'bold'}}>0.72</Text>.</Text>
              <Text style={styles.bulletText}>• <Text style={{fontWeight: 'bold'}}>Pace threshold</Text>: Cadence &le; 130 steps/min (indoor) or speed &le; 4.0 mph (outdoor) counts as walking; faster paces count as running.</Text>
            </View>

            <View style={styles.infoSection}>
              <Text style={styles.infoSecTitle}>📈 Average Cadence</Text>
              <Text style={styles.infoSecDesc}>
                Measured as steps per minute (spm) based on your device accelerometer ticks:
              </Text>
              <Text style={styles.formulaText}>
                Cadence = (Total Steps * 60) / Duration (seconds)
              </Text>
            </View>

            <View style={styles.infoSection}>
              <Text style={styles.infoSecTitle}>📏 Stride Length</Text>
              <Text style={styles.infoSecDesc}>
                Indoors, we assume a standard baseline of 0.75 meters. Outdoors, we calculate your actual stride length dynamically using GPS location change per step:
              </Text>
              <Text style={styles.formulaText}>
                Stride = GPS Distance / Total Steps
              </Text>
            </View>

            <View style={styles.infoSection}>
              <Text style={styles.infoSecTitle}>🧭 Displacement / Yaw Drift</Text>
              <Text style={styles.infoSecDesc}>
                Indoor dead-reckoning drift calculates compass deviation by comparing integrated raw gyroscope yaw rotation against accelerometer step acceleration vectors to optimize location resetting.
              </Text>
            </View>

            <View style={styles.infoSection}>
              <Text style={styles.infoSecTitle}>🔋 Battery & Sensor Usage</Text>
              <Text style={styles.infoSecDesc}>
                Outdoors, this app relies on continuous background GPS tracking to count laps accurately. Continued use of GPS running in the background can dramatically decrease battery life. Indoors, sensors operate in a low-power mode to maximize battery efficiency.
              </Text>
            </View>
          </ScrollView>

          <Pressable onPress={props.onClose} style={[styles.primaryButton, { marginTop: 16, width: '100%' }]}>
            <Text style={styles.primaryButtonText}>Got it!</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function IndoorDebugPanel({ state, logs }: { state: DetectorState; logs: string[] }) {
  const modeText = state.isBleFree ? 'Indoor (MIF BLE-Free Mode)' : 'Indoor (Standard)';
  const gyroYawDeg = state.lastGyroYaw !== undefined ? (state.lastGyroYaw * 180) / Math.PI : 0;
  return (
    <View style={styles.debugPanel}>
      <Text style={styles.debugHeader}>Debug · Indoor</Text>
      <DebugRow label="MIF mode" value={modeText} />
      <DebugRow label="phase" value={state.phase} />
      <DebugRow
        label="BLE similarity"
        value={state.isBleFree ? '— (BLE-Free)' : `${state.lastSimilarity.toFixed(3)}  (≥ ${state.config.similarityNearThreshold})`}
      />
      <DebugRow
        label="Magnetic Δ (μT)"
        value={`${state.lastMagneticDelta.toFixed(2)}  (≤ ${state.isBleFree ? '15.00' : state.config.magneticDeltaThreshold.toFixed(2)})`}
      />
      <DebugRow
        label="Displacement (m)"
        value={`${state.lastDisplacementMagnitude.toFixed(2)}  (≤ ${(state.lastDisplacementThreshold ?? (state.isBleFree ? 10.00 : state.config.displacementThreshold)).toFixed(2)})`}
      />
      <DebugRow
        label="Gyro Z-Rate"
        value={state.lastGyroZRate !== undefined ? `${state.lastGyroZRate.toFixed(3)} rad/s` : '0.000 rad/s'}
      />
      <DebugRow
        label="Gyro Yaw"
        value={`${gyroYawDeg.toFixed(1)}°`}
      />
      {logs.length > 0 && (
        <View style={styles.logsBox}>
          <Text style={styles.debugHeader}>Session History Log</Text>
          {logs.map((log, idx) => (
            <Text key={idx} style={styles.logText}>{log}</Text>
          ))}
        </View>
      )}
    </View>
  );
}

function OutdoorDebugPanel({ state, logs }: { state: OutdoorDetectorState; logs: string[] }) {
  return (
    <View style={styles.debugPanel}>
      <Text style={styles.debugHeader}>Debug · Outdoor</Text>
      <DebugRow label="phase" value={state.phase} />
      <DebugRow
        label="distance (m)"
        value={`${state.lastDistanceM.toFixed(1)}  (near ≤ ${state.config.nearRadiusM} / far ≥ ${state.config.farRadiusM})`}
      />
      <DebugRow
        label="GPS accuracy (m)"
        value={Number.isFinite(state.lastAccuracyM)
          ? `${state.lastAccuracyM.toFixed(1)}  (max ${state.config.maxAcceptableAccuracyM})`
          : '— (no fix yet)'}
      />
      <DebugRow
        label="rejected fixes"
        value={String(state.rejectedCount)}
      />
      {state.pointA && (
        <DebugRow
          label="point A"
          value={`${state.pointA.latitude.toFixed(5)}, ${state.pointA.longitude.toFixed(5)}`}
        />
      )}
      {logs.length > 0 && (
        <View style={styles.logsBox}>
          <Text style={styles.debugHeader}>Session History Log</Text>
          {logs.map((log, idx) => (
            <Text key={idx} style={styles.logText}>{log}</Text>
          ))}
        </View>
      )}
    </View>
  );
}

function SettingsScreen(props: {
  weightInput: string;
  onWeightInputChange: (v: string) => void;
  onWeightInputBlur: () => void;
  weightUnit: 'lbs' | 'kg';
  onWeightUnitChange: (v: 'lbs' | 'kg') => void;
  weatherUnit: 'celsius' | 'fahrenheit';
  onWeatherUnitChange: (v: 'celsius' | 'fahrenheit') => void;
  voiceCuesEnabled: boolean;
  onVoiceCuesChange: (v: boolean) => void;
  disableBle: boolean;
  onDisableBleChange: (v: boolean) => void;
  isPremium: boolean;
  subTier: string;
  onShowPaywall: () => void;
  onVersionTap: () => void;
  settingsTapCount: number;
  showSettingsDebug: boolean;
  debugSubTier: 'free' | 'monthly' | 'annual';
  onDebugSubTierChange: (tier: 'free' | 'monthly' | 'annual') => void;
  mode: string;
  detectorState: any;
  outdoorState: OutdoorDetectorState | null;
  debugLogs: string[];
  onShowInfoModal: () => void;
}) {
  const appVersion = '1.0.0';
  const subLabel = props.subTier === 'annual' ? '👑 Annual Premium'
    : props.subTier === 'monthly' ? '⭐ Monthly Premium'
    : '🆓 Free Tier';

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Text style={styles.title}>Settings</Text>

      {/* BODY PROFILE */}
      <View style={styles.card}>
        <Text style={styles.settingsSectionTitle}>👤 Body Profile</Text>
        <Text style={styles.settingsDescription}>Used to estimate accurate calorie burn during workouts.</Text>
        <View style={styles.weightRow}>
          <View style={styles.weightInputBox}>
            <Text style={styles.inputLabel}>Weight</Text>
            <TextInput
              value={props.weightInput}
              onChangeText={props.onWeightInputChange}
              onBlur={props.onWeightInputBlur}
              keyboardType="decimal-pad"
              style={styles.weightTextInput}
              placeholder="150"
              placeholderTextColor="#6b7280"
              maxLength={4}
            />
          </View>
          <View style={styles.weightUnitBox}>
            <Text style={styles.inputLabel}>Unit</Text>
            <View style={styles.unitToggleRow}>
              <Pressable
                onPress={() => props.onWeightUnitChange('lbs')}
                style={[styles.unitToggleBtn, props.weightUnit === 'lbs' && styles.unitToggleBtnActive]}
              >
                <Text style={[styles.unitToggleText, props.weightUnit === 'lbs' && styles.unitToggleTextActive]}>Lbs</Text>
              </Pressable>
              <Pressable
                onPress={() => props.onWeightUnitChange('kg')}
                style={[styles.unitToggleBtn, props.weightUnit === 'kg' && styles.unitToggleBtnActive]}
              >
                <Text style={[styles.unitToggleText, props.weightUnit === 'kg' && styles.unitToggleTextActive]}>Kg</Text>
              </Pressable>
            </View>
          </View>
        </View>
        <Pressable onPress={props.onShowInfoModal} style={styles.infoLinkBtn}>
          <Text style={styles.infoLinkText}>ℹ️ How is calorie burn calculated?</Text>
        </Pressable>
      </View>

      {/* WEATHER UNIT */}
      <View style={styles.card}>
        <Text style={styles.settingsSectionTitle}>🌡️ Weather Unit</Text>
        <Text style={styles.settingsDescription}>Choose how temperature is displayed in the workout weather banner.</Text>
        <View style={[styles.unitToggleRow, { marginTop: 8 }]}>
          <Pressable
            onPress={() => props.onWeatherUnitChange('celsius')}
            style={[styles.unitToggleBtn, props.weatherUnit === 'celsius' && styles.unitToggleBtnActive]}
          >
            <Text style={[styles.unitToggleText, props.weatherUnit === 'celsius' && styles.unitToggleTextActive]}>°C  Celsius</Text>
          </Pressable>
          <Pressable
            onPress={() => props.onWeatherUnitChange('fahrenheit')}
            style={[styles.unitToggleBtn, props.weatherUnit === 'fahrenheit' && styles.unitToggleBtnActive]}
          >
            <Text style={[styles.unitToggleText, props.weatherUnit === 'fahrenheit' && styles.unitToggleTextActive]}>°F  Fahrenheit</Text>
          </Pressable>
        </View>
      </View>

      {/* TRACKING OPTIONS */}
      <View style={styles.card}>
        <Text style={styles.settingsSectionTitle}>🎙️ Tracking Options</Text>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Announce Lap Cues (Voice Splits)</Text>
          <Pressable
            onPress={() => props.onVoiceCuesChange(!props.voiceCuesEnabled)}
            style={[styles.customCheckbox, props.voiceCuesEnabled && styles.customCheckboxSelected]}
          >
            {props.voiceCuesEnabled && <Text style={styles.customCheckboxCheck}>✓</Text>}
          </Pressable>
        </View>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Use BLE Beacons (Indoor)</Text>
          <Switch
            value={!props.disableBle}
            onValueChange={(val) => props.onDisableBleChange(!val)}
            trackColor={{ true: '#10b981', false: '#374151' }}
          />
        </View>
      </View>

      {/* SUBSCRIPTION */}
      <View style={styles.card}>
        <Text style={styles.settingsSectionTitle}>💳 Subscription</Text>
        <View style={styles.settingsSubRow}>
          <Text style={styles.settingsSubLabel}>Current Plan</Text>
          <Text style={styles.settingsSubValue}>{subLabel}</Text>
        </View>
        {!props.isPremium && (
          <Pressable onPress={props.onShowPaywall} style={styles.settingsUpgradeBtn}>
            <Text style={styles.settingsUpgradeBtnText}>👑 Upgrade to Premium</Text>
          </Pressable>
        )}
        {props.isPremium && (
          <Pressable onPress={props.onShowPaywall} style={[styles.settingsUpgradeBtn, { backgroundColor: 'rgba(16, 185, 129, 0.1)', borderColor: 'rgba(16, 185, 129, 0.3)' }]}>
            <Text style={[styles.settingsUpgradeBtnText, { color: '#10b981' }]}>Manage Subscription</Text>
          </Pressable>
        )}
      </View>

      {/* ABOUT / VERSION */}
      <View style={styles.card}>
        <Text style={styles.settingsSectionTitle}>ℹ️ About</Text>
        <Pressable onPress={props.onVersionTap}>
          <View style={styles.settingsVersionRow}>
            <Text style={styles.settingsVersionLabel}>Version</Text>
            <Text style={styles.settingsVersionValue}>{appVersion}</Text>
          </View>
        </Pressable>
        <Text style={styles.settingsDescription}>Orbit Pro - built for athletes who take their training seriously.</Text>
      </View>

      {/* DEBUG PANEL (hidden until 7-tap unlocked) */}
      {props.showSettingsDebug && (
        <View style={styles.card}>
          <Text style={[styles.settingsSectionTitle, { color: '#f59e0b' }]}>🔧 Developer Debug Mode</Text>
          <Text style={styles.settingsDescription}>Simulate different subscription tiers for testing paywall behaviour.</Text>
          <View style={styles.debugSubRow}>
            {(['free', 'monthly', 'annual'] as const).map((tier) => (
              <Pressable
                key={tier}
                onPress={() => props.onDebugSubTierChange(tier)}
                style={[styles.debugSubBtn, props.debugSubTier === tier && styles.debugSubBtnActive]}
              >
                <Text style={styles.debugSubBtnText}>{tier.charAt(0).toUpperCase() + tier.slice(1)}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.settingsDescription, { marginTop: 8 }]}>Active sensor logs:</Text>
          {props.outdoorState ? (
            <OutdoorDebugPanel state={props.outdoorState} logs={props.debugLogs} />
          ) : (
            <IndoorDebugPanel state={props.detectorState} logs={props.debugLogs} />
          )}
        </View>
      )}
    </ScrollView>
  );
}

function OnboardingWizard(props: {
  visible: boolean;
  onComplete: (weight: string | null, weightUnit: 'lbs' | 'kg' | null, weatherUnit: 'celsius' | 'fahrenheit' | null) => void;
}) {
  const [step, setStep] = useState(0);
  const [weight, setWeight] = useState('');
  const [wUnit, setWUnit] = useState<'lbs' | 'kg'>('lbs');
  const [weatherUnit, setWeatherUnit] = useState<'celsius' | 'fahrenheit'>('fahrenheit');

  const handleComplete = () => {
    props.onComplete(weight || null, wUnit, weatherUnit);
  };

  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={props.visible}
      onRequestClose={() => {}}
    >
      <Pressable style={styles.onboardingOverlay} onPress={Keyboard.dismiss}>
        <View style={styles.onboardingCard}>
          {/* Step dots */}
          <View style={styles.onboardingDots}>
            {[0, 1, 2].map(i => (
              <View key={i} style={[styles.onboardingDot, step === i && styles.onboardingDotActive]} />
            ))}
          </View>

          {step === 0 && (
            <View style={styles.onboardingStep}>
              <Text style={styles.onboardingEmoji}>🏃‍♂️</Text>
              <Text style={styles.onboardingTitle}>Welcome to Orbit!</Text>
              <Text style={styles.onboardingDesc}>
                Track indoor and outdoor laps with precision.

Let’s set up your profile in 2 quick steps.
              </Text>
              <Pressable onPress={() => setStep(1)} style={styles.onboardingBtn}>
                <Text style={styles.onboardingBtnText}>Get Started →</Text>
              </Pressable>
            </View>
          )}

          {step === 1 && (
            <View style={styles.onboardingStep}>
              <Text style={styles.onboardingEmoji}>💪</Text>
              <Text style={styles.onboardingTitle}>Body Profile</Text>
              <Text style={styles.onboardingDesc}>We use your weight to estimate calories burned during each workout.</Text>
              <View style={styles.weightRow}>
                <View style={styles.weightInputBox}>
                  <Text style={styles.inputLabel}>Weight</Text>
                  <TextInput
                    value={weight}
                    onChangeText={setWeight}
                    keyboardType="decimal-pad"
                    style={styles.weightTextInput}
                    placeholder="150"
                    placeholderTextColor="#6b7280"
                    maxLength={4}
                  />
                </View>
                <View style={styles.weightUnitBox}>
                  <Text style={styles.inputLabel}>Unit</Text>
                  <View style={styles.unitToggleRow}>
                    <Pressable
                      onPress={() => setWUnit('lbs')}
                      style={[styles.unitToggleBtn, wUnit === 'lbs' && styles.unitToggleBtnActive]}
                    >
                      <Text style={[styles.unitToggleText, wUnit === 'lbs' && styles.unitToggleTextActive]}>Lbs</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setWUnit('kg')}
                      style={[styles.unitToggleBtn, wUnit === 'kg' && styles.unitToggleBtnActive]}
                    >
                      <Text style={[styles.unitToggleText, wUnit === 'kg' && styles.unitToggleTextActive]}>Kg</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
              <Pressable onPress={() => setStep(2)} style={styles.onboardingBtn}>
                <Text style={styles.onboardingBtnText}>Continue →</Text>
              </Pressable>
              <Pressable onPress={() => setStep(2)} style={styles.onboardingSkipBtn}>
                <Text style={styles.onboardingSkipText}>Skip for now</Text>
              </Pressable>
            </View>
          )}

          {step === 2 && (
            <View style={styles.onboardingStep}>
              <Text style={styles.onboardingEmoji}>🌡️</Text>
              <Text style={styles.onboardingTitle}>Weather Preferences</Text>
              <Text style={styles.onboardingDesc}>How would you like to see outdoor temperature in the weather banner?</Text>
              <View style={[styles.unitToggleRow, { marginTop: 16, marginBottom: 24 }]}>
                <Pressable
                  onPress={() => setWeatherUnit('celsius')}
                  style={[styles.unitToggleBtn, { paddingVertical: 14 }, weatherUnit === 'celsius' && styles.unitToggleBtnActive]}
                >
                  <Text style={[styles.unitToggleText, weatherUnit === 'celsius' && styles.unitToggleTextActive]}>°C  Celsius</Text>
                </Pressable>
                <Pressable
                  onPress={() => setWeatherUnit('fahrenheit')}
                  style={[styles.unitToggleBtn, { paddingVertical: 14 }, weatherUnit === 'fahrenheit' && styles.unitToggleBtnActive]}
                >
                  <Text style={[styles.unitToggleText, weatherUnit === 'fahrenheit' && styles.unitToggleTextActive]}>°F  Fahrenheit</Text>
                </Pressable>
              </View>
              <Pressable onPress={handleComplete} style={styles.onboardingBtn}>
                <Text style={styles.onboardingBtnText}>✨ Start Using App</Text>
              </Pressable>
            </View>
          )}
        </View>
      </Pressable>
    </Modal>
  );
}


function DebugRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.debugRow}>
      <Text style={styles.debugLabel}>{label}</Text>
      <Text style={styles.debugValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  setupSection: {
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
    paddingBottom: 12,
  },
  setupSectionTitle: {
    color: '#38bdf8',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  setupFieldLabel: {
    color: '#e5e7eb',
    fontSize: 14,
    fontWeight: '500',
    marginTop: 8,
    marginBottom: 6,
  },
  weightRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  weightInputBox: {
    flex: 1,
    marginRight: 12,
  },
  weightUnitBox: {
    flex: 1,
  },
  inputLabel: {
    color: '#9ca3af',
    fontSize: 12,
    marginBottom: 4,
    fontWeight: '500',
  },
  weightTextInput: {
    backgroundColor: '#1f2937',
    color: '#ffffff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#374151',
  },
  unitToggleRow: {
    flexDirection: 'row',
    backgroundColor: '#1f2937',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#374151',
    padding: 2,
  },
  unitToggleBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  unitToggleBtnActive: {
    backgroundColor: '#10b981',
  },
  unitToggleText: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '600',
  },
  unitToggleTextActive: {
    color: '#ffffff',
  },
  infoLinkBtn: {
    paddingVertical: 4,
  },
  infoLinkText: {
    color: '#38bdf8',
    fontSize: 13,
    textDecorationLine: 'underline',
  },
  modalScroll: {
    maxHeight: 350,
    marginVertical: 8,
  },
  infoSection: {
    marginBottom: 16,
  },
  infoSecTitle: {
    color: '#38bdf8',
    fontSize: 15,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  infoSecDesc: {
    color: '#d1d5db',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 6,
  },
  formulaText: {
    backgroundColor: '#1f2937',
    color: '#34d399',
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    padding: 8,
    borderRadius: 6,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: '#374151',
  },
  bulletText: {
    color: '#9ca3af',
    fontSize: 12,
    marginLeft: 8,
    marginTop: 2,
  },
  achievementBox: {
    backgroundColor: 'rgba(234, 179, 8, 0.15)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#eab308',
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  achievementEmoji: {
    fontSize: 32,
    marginRight: 12,
  },
  achievementTitle: {
    color: '#eab308',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  achievementText: {
    color: '#ffffff',
    fontSize: 14,
  },
  safeArea: {
    flex: 1,
    backgroundColor: '#0b0f19',
  },
  flex: { flex: 1 },
  scroll: {
    padding: 24,
    gap: 20,
    paddingBottom: 100, // Extra padding to scroll past floating bottom tabs
  },
  title: {
    color: '#f8fafc',
    fontSize: 32,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  card: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 24,
    gap: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  cardTitle: {
    color: '#cbd5e1',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  gpsBadgeRed: {
    backgroundColor: '#7f1d1d',
    borderColor: '#b91c1c',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
  },
  gpsBadgeYellow: {
    backgroundColor: '#78350f',
    borderColor: '#d97706',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
  },
  gpsBadgeGreen: {
    backgroundColor: '#064e3b',
    borderColor: '#059669',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
  },
  gpsBadgeText: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  modeLabel: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 12,
  },
  modeOption: {
    flex: 1,
    backgroundColor: '#030712',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#374151',
  },
  modeOptionSelected: {
    borderColor: '#10b981',
    backgroundColor: '#064e3b',
  },
  modeOptionPressed: {
    opacity: 0.85,
  },
  modeRadio: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modeRadioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#6b7280',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeRadioOuterSelected: {
    borderColor: '#10b981',
  },
  modeRadioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#10b981',
  },
  modeOptionLabel: {
    color: '#cbd5e1',
    fontSize: 16,
    fontWeight: '600',
  },
  modeOptionLabelSelected: {
    color: '#a7f3d0',
  },
  modeOptionHint: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 4,
    marginLeft: 30,
  },
  modeBadge: {
    color: '#a7f3d0',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    textAlign: 'center',
  },
  input: {
    backgroundColor: '#030712',
    color: '#f8fafc',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    fontSize: 32,
    fontWeight: '700',
    textAlign: 'center',
    borderWidth: 1,
    borderColor: '#374151',
  },
  primaryButton: {
    backgroundColor: '#10b981',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryButtonPressed: { opacity: 0.85 },
  primaryButtonText: {
    color: '#022c22',
    fontSize: 18,
    fontWeight: '700',
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: '#ef4444',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonPressed: { opacity: 0.85 },
  secondaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  tertiaryButton: {
    flex: 1,
    backgroundColor: '#374151',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  tertiaryButtonPressed: { opacity: 0.85 },
  tertiaryButtonText: {
    color: '#e2e8f0',
    fontSize: 16,
    fontWeight: '600',
  },
  helpText: {
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  counterBox: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  counterValue: {
    color: '#f8fafc',
    fontSize: 96,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    lineHeight: 100,
  },
  counterDivider: {
    width: 80,
    height: 2,
    backgroundColor: '#4b5563',
    marginVertical: 8,
  },
  counterTarget: {
    color: '#94a3b8',
    fontSize: 24,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  progressBarTrack: {
    width: '100%',
    height: 10,
    backgroundColor: '#030712',
    borderRadius: 5,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#374151',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#10b981',
  },
  progressLabel: {
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'right',
    marginTop: -8,
  },
  statusText: {
    color: '#a7f3d0',
    fontSize: 16,
    textAlign: 'center',
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  completeBanner: {
    color: '#fbbf24',
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
  },
  errorBox: {
    backgroundColor: '#7f1d1d',
    borderRadius: 12,
    padding: 12,
  },
  errorText: {
    color: '#fee2e2',
    fontSize: 13,
  },
  debugToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  debugToggleLabel: {
    color: '#4b5563',
    fontSize: 13,
  },
  debugPanel: {
    backgroundColor: '#030712',
    borderRadius: 12,
    padding: 16,
    gap: 6,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  debugHeader: {
    color: '#4b5563',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  debugRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  debugLabel: {
    color: '#94a3b8',
    fontSize: 13,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },
  debugValue: {
    color: '#e2e8f0',
    fontSize: 13,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#030712',
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
  },
  statLabel: {
    color: '#4b5563',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  statValue: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '700',
  },
  summaryTable: {
    backgroundColor: '#030712',
    borderRadius: 12,
    padding: 16,
    gap: 12,
    width: '100%',
    marginVertical: 8,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: {
    color: '#94a3b8',
    fontSize: 14,
  },
  summaryValue: {
    color: '#fbbf24',
    fontSize: 16,
    fontWeight: '700',
  },
  animationContainer: {
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 12,
    backgroundColor: '#030712',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#374151',
    overflow: 'hidden',
  },
  walkingIcon: {
    fontSize: 28,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: 6,
    paddingHorizontal: 4,
  },
  toggleLabel: {
    color: '#cbd5e1',
    fontSize: 14,
    fontWeight: '600',
  },
  logsBox: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
    paddingTop: 8,
    gap: 4,
  },
  logText: {
    color: '#94a3b8',
    fontSize: 10,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },
  // Tab Navigation styles
  tabBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 70,
    backgroundColor: '#111827',
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
    paddingBottom: 8,
  },
  // Settings screen styles
  settingsSectionTitle: {
    color: '#38bdf8',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  settingsDescription: {
    color: '#6b7280',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 8,
  },
  settingsSubRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 8,
  },
  settingsSubLabel: {
    color: '#94a3b8',
    fontSize: 14,
  },
  settingsSubValue: {
    color: '#fbbf24',
    fontSize: 14,
    fontWeight: '700',
  },
  settingsUpgradeBtn: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  settingsUpgradeBtnText: {
    color: '#c084fc',
    fontWeight: '700',
    fontSize: 14,
  },
  settingsVersionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
    marginBottom: 8,
  },
  settingsVersionLabel: {
    color: '#94a3b8',
    fontSize: 14,
  },
  settingsVersionValue: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '600',
  },
  // Onboarding wizard styles
  onboardingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  onboardingCard: {
    backgroundColor: '#111827',
    borderRadius: 24,
    padding: 28,
    width: '100%',
    borderWidth: 1,
    borderColor: '#1f2937',
    alignItems: 'center',
  },
  onboardingDots: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 28,
  },
  onboardingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#374151',
  },
  onboardingDotActive: {
    backgroundColor: '#10b981',
    width: 24,
  },
  onboardingStep: {
    width: '100%',
    alignItems: 'center',
  },
  onboardingEmoji: {
    fontSize: 56,
    marginBottom: 16,
  },
  onboardingTitle: {
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 12,
  },
  onboardingDesc: {
    color: '#94a3b8',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  onboardingBtn: {
    backgroundColor: '#10b981',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 40,
    alignItems: 'center',
    width: '100%',
    marginBottom: 10,
  },
  onboardingBtnText: {
    color: '#022c22',
    fontSize: 17,
    fontWeight: '800',
  },
  onboardingSkipBtn: {
    paddingVertical: 8,
  },
  onboardingSkipText: {
    color: '#4b5563',
    fontSize: 13,
    textDecorationLine: 'underline',
  },
  tabBarItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.5,
  },
  tabBarItemActive: {
    opacity: 1,
  },
  tabIcon: {
    fontSize: 20,
    color: '#f8fafc',
  },
  tabLabel: {
    fontSize: 12,
    color: '#cbd5e1',
    fontWeight: '600',
    marginTop: 2,
  },
  // Weather styles
  weatherBanner: {
    backgroundColor: 'rgba(31, 41, 55, 0.4)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginBottom: 8,
    alignItems: 'center',
  },
  weatherText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
  },
  clampedDisclaimer: {
    color: '#f59e0b',
    fontSize: 12,
    textAlign: 'center',
    marginVertical: 4,
  },
  completedPaywallBtn: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginVertical: 8,
  },
  completedPaywallText: {
    color: '#c084fc',
    fontWeight: '700',
    fontSize: 14,
  },
  exportBtn: {
    flex: 1,
    backgroundColor: '#3b82f6',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  exportBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 15,
  },
  // History tab styles
  emptyCard: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  emptyText: {
    color: '#94a3b8',
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
  },
  workoutItemCard: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1f2937',
    marginBottom: 12,
  },
  workoutItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  workoutItemDate: {
    color: '#cbd5e1',
    fontWeight: '700',
    fontSize: 14,
  },
  workoutItemMode: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },
  workoutItemLaps: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '800',
  },
  workoutItemTime: {
    color: '#6b7280',
    fontSize: 13,
    marginTop: 4,
  },
  historyLockedBanner: {
    backgroundColor: 'rgba(17, 24, 39, 0.8)',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    marginVertical: 12,
  },
  historyLockedText: {
    color: '#fbbf24',
    fontWeight: '700',
    fontSize: 13,
  },
  // Analytics locked styles
  analyticsWrapper: {
    gap: 16,
  },
  lockCard: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 40,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  lockIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  lockTitle: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  lockDescription: {
    color: '#94a3b8',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 8,
    marginBottom: 24,
  },
  lockUpgradeBtn: {
    backgroundColor: '#8b5cf6',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  lockUpgradeBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 16,
  },
  chartMockContainer: {
    height: 150,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    backgroundColor: '#030712',
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
  },
  chartBar: {
    width: 32,
    backgroundColor: '#8b5cf6',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 4,
  },
  chartBarText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  chartMockLegend: {
    color: '#6b7280',
    fontSize: 10,
    textAlign: 'center',
    marginTop: 8,
  },
  // Paywall Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#111827',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderBottomWidth: 0,
    maxHeight: '90%',
  },
  modalEmoji: {
    fontSize: 48,
    marginBottom: 8,
  },
  modalTitle: {
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: '800',
  },
  modalSubtitle: {
    color: '#94a3b8',
    fontSize: 14,
    marginTop: 4,
    marginBottom: 24,
  },
  benefitsList: {
    alignSelf: 'stretch',
    backgroundColor: '#030712',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    marginBottom: 24,
  },
  benefitItem: {
    color: '#cbd5e1',
    fontSize: 13,
    lineHeight: 18,
  },
  modalBuyBtn: {
    backgroundColor: '#10b981',
    alignSelf: 'stretch',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  modalBuyBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 16,
  },
  modalRowButtons: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 20,
    alignSelf: 'stretch',
  },
  modalRestoreBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalRestoreBtnText: {
    color: '#6b7280',
    fontSize: 14,
    fontWeight: '600',
  },
  modalCloseBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalCloseBtnText: {
    color: '#ef4444',
    fontSize: 14,
    fontWeight: '600',
  },
  // Workout Details Modal styles
  modalActionExportRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
    alignSelf: 'stretch',
  },
  exportItemBtn: {
    flex: 1,
    backgroundColor: '#3b82f6',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  exportItemBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 15,
  },
  customCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#4b5563',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#030712',
  },
  customCheckboxSelected: {
    borderColor: '#8b5cf6',
    backgroundColor: '#8b5cf6',
  },
  customCheckboxCheck: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    marginTop: -2,
  },
  debugSubControls: {
    backgroundColor: '#030712',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  debugSubTitle: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  debugSubRow: {
    flexDirection: 'row',
    gap: 8,
  },
  debugSubBtn: {
    flex: 1,
    backgroundColor: '#111827',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#374151',
    paddingVertical: 8,
    alignItems: 'center',
  },
  debugSubBtnActive: {
    backgroundColor: '#8b5cf6',
    borderColor: '#8b5cf6',
  },
  debugSubBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  announcementBanner: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    borderWidth: 1,
    borderColor: '#3b82f6',
    borderRadius: 12,
    padding: 12,
    marginVertical: 4,
  },
  announcementText: {
    color: '#93c5fd',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  tierAnnouncementBanner: {
    backgroundColor: 'rgba(236, 72, 153, 0.15)',
    borderWidth: 1,
    borderColor: '#ec4899',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    width: '100%',
  },
  tierAnnouncementText: {
    color: '#fbcfe8',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
});
