import { StatusBar } from 'expo-status-bar';
import { useMemo, useState, useEffect, useRef } from 'react';
import {
  Alert,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { useLapCounter, LapMode } from './src/state/useLapCounter';
import type { DetectorState } from './src/logic/lapDetector';
import type { OutdoorDetectorState } from './src/logic/outdoorLapDetector';

export default function App() {
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
  } = useLapCounter();

  const [targetInput, setTargetInput] = useState(
    String(defaultConfig.targetLaps)
  );
  const [showDebug, setShowDebug] = useState(false);
  const [disableBle, setDisableBle] = useState(true); // Default to true (Sensors-Only BLE-Free mode)
  const [debugLogs, setDebugLogs] = useState<string[]>([]);

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
      // Avoid duplicate messages with same details
      if (prev.length > 0 && prev[0].substring(11) === fullMsg.substring(11)) {
        return prev;
      }
      return [fullMsg, ...prev].slice(0, 15); // increased limit to 15 logs for more visibility
    });
  }, [state.phase, state.count, mode, interval10s]);

  const target = state.config.targetLaps;
  const isSetup = state.phase === 'idle';
  const isFinished = state.phase === 'finished';
  const isRunning = !isSetup && !isFinished;

  const progressPct = useMemo(() => {
    if (target <= 0) return 0;
    return Math.min(1, state.count / target);
  }, [state.count, target]);

  const onStart = async () => {
    const parsed = parseInt(targetInput, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      Alert.alert('Invalid lap count', 'Please enter a positive whole number.');
      return;
    }
    await start({ mode, targetLaps: parsed, disableBle });
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

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.flex}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.title}>Lap Counter</Text>

            {isSetup && (
              <SetupCard
                mode={mode}
                onModeChange={setMode}
                targetInput={targetInput}
                onChange={setTargetInput}
                onStart={onStart}
                disableBle={disableBle}
                onDisableBleChange={setDisableBle}
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
              />
            )}

            {error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>⚠ {error.message}</Text>
              </View>
            )}

            <View style={styles.debugToggle}>
              <Text style={styles.debugToggleLabel}>Debug</Text>
              <Switch
                value={showDebug}
                onValueChange={setShowDebug}
                trackColor={{ true: '#34d399', false: '#374151' }}
              />
            </View>

            {showDebug &&
              (mode === 'indoor' ? (
                <IndoorDebugPanel state={state as DetectorState} logs={debugLogs} />
              ) : (
                <OutdoorDebugPanel state={state as OutdoorDetectorState} logs={debugLogs} />
              ))}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function ModePicker(props: {
  mode: LapMode;
  onChange: (mode: LapMode) => void;
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
  onStart: () => void;
  disableBle: boolean;
  onDisableBleChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.card}>
      <ModePicker mode={props.mode} onChange={props.onModeChange} />

      {props.mode === 'indoor' && (
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Use BLE Beacons (optional)</Text>
          <Switch
            value={!props.disableBle}
            onValueChange={(val) => props.onDisableBleChange(!val)}
            trackColor={{ true: '#10b981', false: '#374151' }}
          />
        </View>
      )}

      <Text style={styles.cardTitle}>How many laps do you want?</Text>
      <TextInput
        value={props.targetInput}
        onChangeText={props.onChange}
        keyboardType="number-pad"
        style={styles.input}
        placeholder="10"
        placeholderTextColor="#6b7280"
        maxLength={4}
      />
      <Pressable
        onPress={props.onStart}
        style={({ pressed }) => [
          styles.primaryButton,
          pressed && styles.primaryButtonPressed,
        ]}
      >
        <Text style={styles.primaryButtonText}>▶ Start</Text>
      </Pressable>
      <Text style={styles.helpText}>
        {props.mode === 'indoor'
          ? props.disableBle
            ? 'Stand at your starting point before tapping Start. The app calibrates for ~5 seconds, then counts laps using your device\'s magnetometer, gyroscope, and step count (no external hardware needed).'
            : 'Stand at your starting point before tapping Start. The app calibrates for ~5 seconds, then counts laps using nearby BLE beacons + magnetic field.'
          : 'Stand at your starting point before tapping Start. The app locks onto GPS for ~8 seconds, then counts laps each time you return within 15 m of the start.'}
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
  return `${hours}:${minutesStr} ${ampm}`;
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

      <Text style={styles.statusText}>{props.status}</Text>

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
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.completeBanner}>🎉 Complete!</Text>

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
      </View>

      <Pressable
        onPress={props.onReset}
        style={({ pressed }) => [
          styles.primaryButton,
          pressed && styles.primaryButtonPressed,
        ]}
      >
        <Text style={styles.primaryButtonText}>↻ Start Over</Text>
      </Pressable>
    </View>
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

function DebugRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.debugRow}>
      <Text style={styles.debugLabel}>{label}</Text>
      <Text style={styles.debugValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  flex: { flex: 1 },
  scroll: {
    padding: 24,
    gap: 20,
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
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 24,
    gap: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardTitle: {
    color: '#cbd5e1',
    fontSize: 18,
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
    backgroundColor: '#0f172a',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#475569',
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
    borderColor: '#64748b',
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
    color: '#64748b',
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
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    fontSize: 32,
    fontWeight: '700',
    textAlign: 'center',
    borderWidth: 1,
    borderColor: '#475569',
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
    backgroundColor: '#334155',
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
    backgroundColor: '#475569',
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
    backgroundColor: '#0f172a',
    borderRadius: 5,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#334155',
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
    color: '#64748b',
    fontSize: 13,
  },
  debugPanel: {
    backgroundColor: '#020617',
    borderRadius: 12,
    padding: 16,
    gap: 6,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  debugHeader: {
    color: '#64748b',
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
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
  },
  statLabel: {
    color: '#64748b',
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
    backgroundColor: '#0f172a',
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
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    overflow: 'hidden',
  },
  walkingIcon: {
    fontSize: 28,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: 12,
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
    borderTopColor: '#1e293b',
    paddingTop: 8,
    gap: 4,
  },
  logText: {
    color: '#94a3b8',
    fontSize: 10,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },
});
