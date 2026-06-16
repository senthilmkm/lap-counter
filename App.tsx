import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import {
  Alert,
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
  } = useLapCounter();

  const [targetInput, setTargetInput] = useState(
    String(defaultConfig.targetLaps)
  );
  const [showDebug, setShowDebug] = useState(false);

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
    await start({ mode, targetLaps: parsed });
  };

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
              />
            )}

            {isRunning && (
              <RunningCard
                mode={mode}
                count={state.count}
                target={target}
                status={status}
                progressPct={progressPct}
                onStop={stop}
                onReset={reset}
              />
            )}

            {isFinished && (
              <FinishedCard count={state.count} target={target} onReset={reset} />
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
                <IndoorDebugPanel state={state as DetectorState} />
              ) : (
                <OutdoorDebugPanel state={state as OutdoorDetectorState} />
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
}) {
  return (
    <View style={styles.card}>
      <ModePicker mode={props.mode} onChange={props.onModeChange} />

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
          ? 'Stand at your starting point before tapping Start. The app calibrates for ~5 seconds, then counts laps using ambient Bluetooth + magnetic field.'
          : 'Stand at your starting point before tapping Start. The app locks onto GPS for ~8 seconds, then counts laps each time you return within 15 m of the start.'}
      </Text>
    </View>
  );
}

function RunningCard(props: {
  mode: LapMode;
  count: number;
  target: number;
  status: string;
  progressPct: number;
  onStop: () => void;
  onReset: () => void;
}) {
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

function IndoorDebugPanel({ state }: { state: DetectorState }) {
  return (
    <View style={styles.debugPanel}>
      <Text style={styles.debugHeader}>Debug · Indoor</Text>
      <DebugRow label="phase" value={state.phase} />
      <DebugRow
        label="BLE similarity"
        value={`${state.lastSimilarity.toFixed(3)}  (≥ ${state.config.similarityNearThreshold})`}
      />
      <DebugRow
        label="Magnetic Δ (μT)"
        value={`${state.lastMagneticDelta.toFixed(2)}  (≤ ${state.config.magneticDeltaThreshold})`}
      />
      <DebugRow
        label="Displacement (m)"
        value={`${state.lastDisplacementMagnitude.toFixed(2)}  (≤ ${state.config.displacementThreshold})`}
      />
    </View>
  );
}

function OutdoorDebugPanel({ state }: { state: OutdoorDetectorState }) {
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
});
