import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GhostMode, GhostPacerState } from '../logic/ghostPacer';

interface GhostPacerHUDProps {
  ghostMode: GhostMode;
  ghostState: GhostPacerState | null;
  lapElapsedSeconds: number;
  currentLap: number;
  targetLapSeconds?: number;
}

export default function GhostPacerHUD({
  ghostMode,
  ghostState,
  lapElapsedSeconds,
  currentLap,
  targetLapSeconds = 90,
}: GhostPacerHUDProps) {
  if (ghostMode === 'none') {
    return null;
  }

  const isPR = ghostMode === 'pr_ghost';
  const isNegativeSplit = ghostMode === 'negative_split';
  const modeLabel = isPR
    ? '👑 PR Ghost Pacer'
    : isNegativeSplit
    ? '👑 Negative Split Strategy'
    : '🎯 Target Pacer';

  const expectedSec = ghostState?.expectedLapSeconds ?? targetLapSeconds;
  const delta = ghostState ? ghostState.splitDeltaSeconds : lapElapsedSeconds - expectedSec;
  const isAhead = delta <= 0;
  const absDelta = Math.abs(delta);

  const deltaMins = Math.floor(absDelta / 60);
  const deltaSecs = Math.floor(absDelta % 60);
  const deltaFormatted = `${deltaMins < 10 ? '0' : ''}${deltaMins}:${deltaSecs < 10 ? '0' : ''}${deltaSecs}`;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.badgeContainer}>
          <Text style={styles.badgeText}>{modeLabel}</Text>
        </View>
        <Text style={styles.targetLapText}>
          Target: {Math.floor(expectedSec / 60)}:{(expectedSec % 60) < 10 ? '0' : ''}{expectedSec % 60}/lap
        </Text>
      </View>

      <View style={styles.mainDeltaRow}>
        <View style={styles.deltaBox}>
          <Text style={styles.deltaSubLabel}>LIVE SPLIT DELTA</Text>
          <Text style={[styles.deltaValue, isAhead ? styles.deltaAhead : styles.deltaBehind]}>
            {isAhead ? `-${deltaFormatted}` : `+${deltaFormatted}`}
          </Text>
        </View>
        <View style={styles.statusBadge}>
          <Text style={styles.statusEmoji}>{isAhead ? '⚡ Ahead' : '🐢 Behind'}</Text>
          <Text style={[styles.statusText, isAhead ? styles.textAhead : styles.textBehind]}>
            {isAhead ? 'Crushing it!' : 'Pick up pace'}
          </Text>
        </View>
      </View>

      {/* Visual Runner vs Ghost Race Track */}
      <View style={styles.trackContainer}>
        <View style={styles.trackBar}>
          <View
            style={[
              styles.runnerAvatar,
              {
                left: `${Math.min(92, Math.max(2, (lapElapsedSeconds / Math.max(1, expectedSec)) * 50))}%`,
              },
            ]}
          >
            <Text style={styles.avatarText}>🏃</Text>
          </View>
          <View style={[styles.ghostAvatar, { left: '50%' }]}>
            <Text style={styles.avatarText}>👻</Text>
          </View>
        </View>
        <View style={styles.trackLabels}>
          <Text style={styles.trackLabelText}>Start</Text>
          <Text style={styles.trackLabelCenter}>Ghost Mark</Text>
          <Text style={styles.trackLabelText}>Finish</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    borderRadius: 16,
    padding: 14,
    marginVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.35)',
    shadowColor: '#8b5cf6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 6,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  badgeContainer: {
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.4)',
  },
  badgeText: {
    color: '#c4b5fd',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  targetLapText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },
  mainDeltaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  deltaBox: {
    flex: 1,
  },
  deltaSubLabel: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  deltaValue: {
    fontSize: 32,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.5,
  },
  deltaAhead: {
    color: '#10b981', // Glowing Green
    textShadowColor: 'rgba(16, 185, 129, 0.4)',
    textShadowRadius: 8,
  },
  deltaBehind: {
    color: '#f43f5e', // Vibrant Rose/Red
    textShadowColor: 'rgba(244, 63, 94, 0.4)',
    textShadowRadius: 8,
  },
  statusBadge: {
    alignItems: 'flex-end',
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  statusEmoji: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '700',
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  textAhead: {
    color: '#34d399',
  },
  textBehind: {
    color: '#fb7185',
  },
  trackContainer: {
    marginTop: 4,
  },
  trackBar: {
    height: 28,
    backgroundColor: 'rgba(30, 41, 59, 0.7)',
    borderRadius: 14,
    position: 'relative',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  runnerAvatar: {
    position: 'absolute',
    top: 2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#8b5cf6',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
    shadowColor: '#8b5cf6',
    shadowOpacity: 0.6,
    shadowRadius: 4,
  },
  ghostAvatar: {
    position: 'absolute',
    top: 2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(148, 163, 184, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  avatarText: {
    fontSize: 12,
  },
  trackLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
    paddingHorizontal: 4,
  },
  trackLabelText: {
    color: '#64748b',
    fontSize: 9,
    fontWeight: '600',
  },
  trackLabelCenter: {
    color: '#a78bfa',
    fontSize: 9,
    fontWeight: '700',
  },
});
