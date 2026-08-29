import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { DBWorkout } from '../services/database';
import { SocialCardData, shareWorkoutStory } from '../services/shareService';

interface ShareableLapCardProps {
  visible: boolean;
  onClose: () => void;
  data: SocialCardData;
}

export default function ShareableLapCard({
  visible,
  onClose,
  data,
}: ShareableLapCardProps) {
  const {
    workout,
    formattedDuration,
    calories,
    fastestLapFormatted,
    lapSplits = [],
    brokenRecords = [],
    distanceMiles,
  } = data;

  const handleShare = async () => {
    await shareWorkoutStory(data);
  };

  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.cardContainer}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            {/* Story Card Poster */}
            <View style={styles.storyPoster}>
              {/* Top Brand Bar */}
              <View style={styles.brandRow}>
                <View style={styles.logoBadge}>
                  <Text style={styles.logoBadgeText}>⚡</Text>
                </View>
                <View>
                  <Text style={styles.brandTitle}>ORBIT</Text>
                  <Text style={styles.brandSubtitle}>LAP COUNTER</Text>
                </View>
                <View style={styles.modeTag}>
                  <Text style={styles.modeTagText}>
                    {workout.mode === 'indoor' ? '🏠 INDOOR' : '🌳 OUTDOOR'}
                  </Text>
                </View>
              </View>

              {/* Celebration Hero Badge */}
              <View style={styles.heroSection}>
                <Text style={styles.heroLaps}>{workout.totalLaps}</Text>
                <Text style={styles.heroLapsLabel}>LAPS COMPLETED</Text>
                <Text style={styles.heroDuration}>⏱ {formattedDuration}</Text>
              </View>

              {/* Achievements / Records */}
              {brokenRecords.length > 0 && (
                <View style={styles.prBadge}>
                  <Text style={styles.prBadgeEmoji}>🏆</Text>
                  <Text style={styles.prBadgeText}>
                    NEW RECORD: {brokenRecords.join(' • ')}
                  </Text>
                </View>
              )}

              {/* Split Metrics Matrix */}
              <View style={styles.metricsGrid}>
                <View style={styles.metricItem}>
                  <Text style={styles.metricLabel}>CALORIES</Text>
                  <Text style={styles.metricValue}>{calories} kcal</Text>
                </View>
                <View style={styles.metricItem}>
                  <Text style={styles.metricLabel}>CADENCE</Text>
                  <Text style={styles.metricValue}>
                    {Math.round(workout.cadence || 160)} spm
                  </Text>
                </View>
                {distanceMiles !== undefined && distanceMiles > 0 ? (
                  <View style={styles.metricItem}>
                    <Text style={styles.metricLabel}>DISTANCE</Text>
                    <Text style={styles.metricValue}>
                      {distanceMiles.toFixed(2)} mi
                    </Text>
                  </View>
                ) : (
                  <View style={styles.metricItem}>
                    <Text style={styles.metricLabel}>TOTAL STEPS</Text>
                    <Text style={styles.metricValue}>{workout.steps || 0}</Text>
                  </View>
                )}
                {fastestLapFormatted && (
                  <View style={styles.metricItem}>
                    <Text style={styles.metricLabel}>FASTEST LAP</Text>
                    <Text style={[styles.metricValue, { color: '#fbbf24' }]}>
                      🔥 {fastestLapFormatted}
                    </Text>
                  </View>
                )}
              </View>

              {/* Lap Split Matrix Visualization */}
              {lapSplits.length > 0 && (
                <View style={styles.splitsSection}>
                  <Text style={styles.splitsTitle}>LAP SPLIT BREAKDOWN</Text>
                  <View style={styles.splitsList}>
                    {lapSplits.slice(0, 8).map((sec, idx) => {
                      const mins = Math.floor(sec / 60);
                      const s = sec % 60;
                      const timeStr = `${mins}:${s < 10 ? '0' : ''}${s}`;
                      return (
                        <View key={idx} style={styles.splitRow}>
                          <Text style={styles.splitIndex}>Lap {idx + 1}</Text>
                          <View style={styles.splitBar}>
                            <View
                              style={[
                                styles.splitBarFill,
                                {
                                  width: `${Math.min(
                                    100,
                                    Math.max(20, (sec / (lapSplits[0] || 60)) * 60)
                                  )}%`,
                                },
                              ]}
                            />
                          </View>
                          <Text style={styles.splitTime}>{timeStr}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}

              {/* Watermark Footer */}
              <View style={styles.footerRow}>
                <Text style={styles.footerText}>
                  Tracked with Orbit Lap Counter • orbitapp.fit
                </Text>
              </View>
            </View>

            {/* Action Buttons */}
            <Pressable
              onPress={handleShare}
              style={({ pressed }) => [
                styles.shareBtn,
                pressed && styles.btnPressed,
              ]}
            >
              <Text style={styles.shareBtnText}>📲 Share to Instagram / Socials</Text>
            </Pressable>

            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>Close</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  cardContainer: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '90%',
    backgroundColor: '#090d16',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    overflow: 'hidden',
  },
  scrollContent: {
    padding: 16,
    alignItems: 'center',
  },
  storyPoster: {
    width: '100%',
    backgroundColor: '#0e1626',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.4)',
    shadowColor: '#8b5cf6',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 10,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  logoBadge: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#8b5cf6',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  logoBadgeText: {
    fontSize: 18,
    color: '#fff',
  },
  brandTitle: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 1,
  },
  brandSubtitle: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  modeTag: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginLeft: 'auto',
  },
  modeTagText: {
    color: '#38bdf8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  heroSection: {
    alignItems: 'center',
    marginVertical: 14,
    paddingVertical: 12,
    backgroundColor: 'rgba(30, 41, 59, 0.5)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  heroLaps: {
    fontSize: 56,
    fontWeight: '900',
    color: '#a78bfa',
    letterSpacing: -1,
  },
  heroLapsLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#94a3b8',
    letterSpacing: 2,
    marginTop: -4,
  },
  heroDuration: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f8fafc',
    marginTop: 8,
  },
  prBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.4)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 14,
  },
  prBadgeEmoji: {
    fontSize: 16,
    marginRight: 6,
  },
  prBadgeText: {
    color: '#fbbf24',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 14,
  },
  metricItem: {
    width: '48%',
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  metricLabel: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  metricValue: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '800',
  },
  splitsSection: {
    marginTop: 6,
    marginBottom: 14,
  },
  splitsTitle: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 8,
  },
  splitsList: {
    gap: 6,
  },
  splitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  splitIndex: {
    width: 44,
    color: '#64748b',
    fontSize: 11,
    fontWeight: '600',
  },
  splitBar: {
    flex: 1,
    height: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  splitBarFill: {
    height: '100%',
    backgroundColor: '#8b5cf6',
    borderRadius: 4,
  },
  splitTime: {
    width: 44,
    color: '#f8fafc',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'right',
  },
  footerRow: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    paddingTop: 12,
    alignItems: 'center',
  },
  footerText: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  shareBtn: {
    width: '100%',
    backgroundColor: '#8b5cf6',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 16,
    shadowColor: '#8b5cf6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  btnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  shareBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  closeBtn: {
    width: '100%',
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 6,
  },
  closeBtnText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '600',
  },
});
