/**
 * StravaConnectModal Component
 * 
 * Provides an interactive modal for connecting, authenticating, verifying,
 * and testing real Strava Cloud Auto-Sync credentials.
 */

import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  Alert,
  Linking,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import {
  isStravaConnected,
  getStravaTokens,
  saveStravaTokens,
  disconnectStrava,
  setStravaAutoSyncEnabled,
  verifyStravaConnection,
  uploadWorkoutToStrava,
  getStravaAuthUrl,
  exchangeStravaAuthCode,
} from '../services/stravaService';

interface StravaConnectModalProps {
  visible: boolean;
  onClose: () => void;
  isPremium: boolean;
  onShowPaywall: () => void;
  onConnectionChange: (connected: boolean) => void;
}

export default function StravaConnectModal({
  visible,
  onClose,
  isPremium,
  onShowPaywall,
  onConnectionChange,
}: StravaConnectModalProps) {
  const [connected, setConnected] = useState(isStravaConnected());
  const [tokens, setTokens] = useState(getStravaTokens());
  const [accessTokenInput, setAccessTokenInput] = useState('');
  const [athleteName, setAthleteName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [testSuccessMessage, setTestSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      const isConn = isStravaConnected();
      setConnected(isConn);
      const curTokens = getStravaTokens();
      setTokens(curTokens);
      if (curTokens?.accessToken) {
        setAccessTokenInput(curTokens.accessToken);
        void handleVerifyExisting(curTokens.accessToken);
      }

      // Listen for OAuth deep link return (orbitapp://strava-callback?code=...)
      const handleDeepLink = async (event: { url: string }) => {
        if (!event.url || !event.url.includes('strava-callback')) return;
        
        try {
          const codeMatch = event.url.match(/[?&]code=([^&#]+)/);
          const code = codeMatch ? decodeURIComponent(codeMatch[1]) : null;
          if (code) {
            setIsLoading(true);
            const res = await exchangeStravaAuthCode(code, isPremium);
            setIsLoading(false);
            if (res.success) {
              setConnected(true);
              setAthleteName(res.athleteName || 'Strava Athlete');
              setTokens(getStravaTokens());
              onConnectionChange(true);
              Alert.alert(
                'Strava Connected! 🚴‍♂️',
                `Successfully authorized with Strava!\nAthlete: ${res.athleteName}\n\nCompleted workouts will now automatically sync to your Strava feed!`
              );
            } else {
              Alert.alert('Authorization Failed', res.error || 'Failed to exchange Strava token.');
            }
          }
        } catch (err) {
          console.warn('OAuth deep link parse error:', err);
        }
      };

      const sub = Linking.addEventListener('url', handleDeepLink);
      void Linking.getInitialURL().then((url) => {
        if (url) handleDeepLink({ url });
      });

      return () => {
        sub.remove();
      };
    }
  }, [visible, isPremium]);

  const handleVerifyExisting = async (token: string) => {
    const res = await verifyStravaConnection();
    if (res.valid) {
      setAthleteName(res.athleteName || 'Strava Athlete');
    }
  };

  const handleOAuthLogin = async () => {
    if (!isPremium) {
      onClose();
      onShowPaywall();
      return;
    }

    const authUrl = getStravaAuthUrl();
    
    try {
      await Linking.openURL(authUrl);
    } catch {
      Alert.alert(
        'Connect with Strava',
        'Could not open Strava login directly. Please verify you have an internet connection or enter your token below.'
      );
    }
  };

  const handleSaveAndVerifyToken = async () => {
    if (!isPremium) {
      onClose();
      onShowPaywall();
      return;
    }

    const rawInput = accessTokenInput.trim();
    if (!rawInput) {
      Alert.alert('Missing Input', 'Please enter your Strava Access Token or Authorization Code.');
      return;
    }

    setIsLoading(true);
    setTestSuccessMessage(null);

    // If user pasted a URL or string containing ?code= or &code=
    let code: string | null = null;
    if (rawInput.includes('code=')) {
      const match = rawInput.match(/[?&]code=([^&#]+)/);
      code = match ? decodeURIComponent(match[1]) : null;
    }

    if (code) {
      // Exchange authorization code for a full activity:write token
      const exchangeRes = await exchangeStravaAuthCode(code, isPremium);
      setIsLoading(false);
      if (exchangeRes.success) {
        setConnected(true);
        setAthleteName(exchangeRes.athleteName || 'Strava Athlete');
        setTokens(getStravaTokens());
        onConnectionChange(true);
        Alert.alert(
          'Strava Connected! 🚴‍♂️',
          `Successfully authorized with Strava write permissions!\nAthlete: ${exchangeRes.athleteName}\n\nCompleted workouts will now automatically sync to your Strava feed!`
        );
        return;
      }
    }

    const futureExpiry = Math.floor(Date.now() / 1000) + 21600; // 6 hours
    const newTokens = {
      accessToken: rawInput,
      refreshToken: rawInput,
      expiresAt: futureExpiry,
      athleteId: 'athlete_pending',
    };

    saveStravaTokens(newTokens);

    const check = await verifyStravaConnection();
    setIsLoading(false);

    if (check.valid) {
      setConnected(true);
      setAthleteName(check.athleteName || 'Strava Athlete');
      setTokens(getStravaTokens());
      setStravaAutoSyncEnabled(true, isPremium);
      onConnectionChange(true);
      Alert.alert(
        'Strava Connected! 🚴‍♂️',
        `Successfully verified with Strava!\n\nConnected Athlete: ${check.athleteName}\nAthlete ID: ${check.athleteId}\n\nNote: If sending an activity fails with an Authorization Error, please tap "🟠 Log in with Strava" to grant activity write permissions!`
      );
    } else {
      Alert.alert(
        'Strava Verification Failed',
        `Could not verify this token with Strava API:\n${check.error || 'Invalid token'}\n\nPlease check that the token was copied correctly.`
      );
    }
  };

  const handleSendTestWorkout = async () => {
    if (!isPremium) {
      onClose();
      onShowPaywall();
      return;
    }

    setIsLoading(true);
    setTestSuccessMessage(null);

    const dummyWorkout = {
      id: `test_workout_${Date.now()}`,
      startTime: Date.now() - 600000,
      endTime: Date.now(),
      mode: 'outdoor' as const,
      totalLaps: 3,
      steps: 1200,
      cadence: 162,
      strideLength: 1.05,
      yawDrift: 0.2,
    };

    const res = await uploadWorkoutToStrava(dummyWorkout, [], isPremium);
    setIsLoading(false);

    if (res.success) {
      setTestSuccessMessage(`Activity #${res.activityId || 'Live'} created on your Strava profile!`);
      Alert.alert(
        'Test Activity Created! 🚴‍♂️',
        `Successfully pushed a test workout to your Strava feed!\n\nActivity ID: ${res.activityId}\n\nYou can open the Strava app to view it right now!`,
        [
          { text: 'View on Strava', onPress: () => Linking.openURL('https://www.strava.com/athlete/training') },
          { text: 'Done', style: 'cancel' },
        ]
      );
    } else {
      Alert.alert('Test Upload Failed', res.error || 'Failed to upload test activity.');
    }
  };

  const handleDisconnect = () => {
    disconnectStrava();
    setConnected(false);
    setTokens(null);
    setAthleteName(null);
    setAccessTokenInput('');
    setTestSuccessMessage(null);
    onConnectionChange(false);
    Alert.alert('Strava Disconnected', 'Your Strava credentials have been removed from this device.');
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
            {/* Header */}
            <View style={styles.headerRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={styles.stravaLogo}>🟠</Text>
                <Text style={styles.modalTitle}>Strava Cloud Sync</Text>
              </View>
              <Pressable onPress={onClose} style={styles.closeBtn}>
                <Text style={styles.closeBtnText}>✕</Text>
              </Pressable>
            </View>

            <Text style={styles.subtitle}>
              Hands-free auto-sync: Automatically upload your lap splits, cadence, and GPS route to your Strava activity feed!
            </Text>

            {/* Connection Status Card */}
            {connected && tokens ? (
              <View style={styles.connectedCard}>
                <View style={styles.statusBadge}>
                  <Text style={styles.statusBadgeText}>✓ CONNECTED & VERIFIED</Text>
                </View>
                <Text style={styles.athleteText}>
                  Athlete: <Text style={{ fontWeight: 'bold', color: '#fff' }}>{athleteName || tokens.athleteId || 'Connected Athlete'}</Text>
                </Text>
                <Text style={styles.tokenStatusText}>
                  🛡️ Auto-Upload: Enabled on workout completion
                </Text>
                <Text style={styles.tokenStatusText}>
                  💾 Offline Queue: Active (zero workout loss)
                </Text>

                {testSuccessMessage && (
                  <View style={styles.testSuccessBox}>
                    <Text style={styles.testSuccessText}>✅ {testSuccessMessage}</Text>
                  </View>
                )}

                <Pressable
                  onPress={handleSendTestWorkout}
                  disabled={isLoading}
                  style={[styles.testActivityBtn, isLoading && { opacity: 0.6 }]}
                >
                  {isLoading ? (
                    <ActivityIndicator color="#ffffff" size="small" />
                  ) : (
                    <Text style={styles.testActivityBtnText}>⚡ Send Test Activity to Strava</Text>
                  )}
                </Pressable>

                <Pressable onPress={handleDisconnect} style={styles.disconnectBtn}>
                  <Text style={styles.disconnectBtnText}>Disconnect Strava Account</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.notConnectedCard}>
                <Text style={styles.notConnectedTitle}>Connect Your Strava Account</Text>
                <Text style={styles.notConnectedDesc}>
                  Link your Strava account to automatically sync every workout.
                </Text>

                {/* Primary 1-Tap OAuth Login Button */}
                <Pressable
                  onPress={handleOAuthLogin}
                  style={styles.connectPrimaryBtn}
                >
                  <Text style={styles.connectPrimaryBtnText}>🟠 Log in with Strava</Text>
                </Pressable>

                <View style={styles.dividerRow}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>OR</Text>
                  <View style={styles.dividerLine} />
                </View>

                {/* Advanced Manual Token Section */}
                <Pressable
                  onPress={() => setShowAdvanced(!showAdvanced)}
                  style={{ alignItems: 'center', paddingVertical: 6 }}
                >
                  <Text style={styles.advancedToggleText}>
                    {showAdvanced ? '▲ Hide Token Input' : '▼ Advanced: Enter Custom API Token'}
                  </Text>
                </Pressable>

                {showAdvanced && (
                  <View style={styles.advancedBox}>
                    <Text style={styles.stepTitle}>📌 Manual Token Setup:</Text>
                    <Text style={styles.stepText}>1. Open your Strava API page:</Text>
                    <Pressable
                      onPress={() => Linking.openURL('https://www.strava.com/settings/api')}
                      style={styles.linkButton}
                    >
                      <Text style={styles.linkButtonText}>🌐 Open strava.com/settings/api ↗</Text>
                    </Pressable>
                    <Text style={styles.stepText}>2. Copy your "Your Access Token" and paste below:</Text>

                    <TextInput
                      style={styles.textInput}
                      placeholder="Paste your Strava Access Token here..."
                      placeholderTextColor="#64748b"
                      value={accessTokenInput}
                      onChangeText={setAccessTokenInput}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />

                    <Pressable
                      onPress={handleSaveAndVerifyToken}
                      disabled={isLoading}
                      style={[styles.verifyTokenBtn, isLoading && { opacity: 0.6 }]}
                    >
                      {isLoading ? (
                        <ActivityIndicator color="#ffffff" size="small" />
                      ) : (
                        <Text style={styles.verifyTokenBtnText}>Verify & Save Token</Text>
                      )}
                    </Pressable>
                  </View>
                )}
              </View>
            )}

            {/* Privacy & Security Note */}
            <View style={styles.securityBox}>
              <Text style={styles.securityTitle}>🔒 Privacy & Token Security</Text>
              <Text style={styles.securityText}>
                Your authorization token is stored strictly inside your on-device local SQLite database. It communicates directly with Strava's official HTTPS API.
              </Text>
            </View>
          </ScrollView>

          <Pressable onPress={onClose} style={styles.doneBtn}>
            <Text style={styles.doneBtnText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContent: {
    backgroundColor: '#0f172a',
    borderRadius: 24,
    padding: 20,
    width: '100%',
    maxWidth: 440,
    maxHeight: '90%',
    borderWidth: 1,
    borderColor: 'rgba(252, 76, 2, 0.3)',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  stravaLogo: {
    fontSize: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#f8fafc',
  },
  closeBtn: {
    padding: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  closeBtnText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 13,
    color: '#94a3b8',
    lineHeight: 18,
    marginBottom: 16,
  },
  connectedCard: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderWidth: 1,
    borderColor: '#10b981',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#10b981',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 10,
  },
  statusBadgeText: {
    color: '#022c22',
    fontWeight: '800',
    fontSize: 11,
  },
  athleteText: {
    color: '#cbd5e1',
    fontSize: 14,
    marginBottom: 6,
  },
  tokenStatusText: {
    color: '#6ee7b7',
    fontSize: 12,
    marginTop: 4,
  },
  testSuccessBox: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
  },
  testSuccessText: {
    color: '#34d399',
    fontSize: 12,
    fontWeight: '700',
  },
  testActivityBtn: {
    marginTop: 14,
    backgroundColor: '#fc4c02',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  testActivityBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
  },
  disconnectBtn: {
    marginTop: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: '#ef4444',
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
  },
  disconnectBtnText: {
    color: '#f87171',
    fontWeight: '700',
    fontSize: 13,
  },
  notConnectedCard: {
    backgroundColor: 'rgba(252, 76, 2, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(252, 76, 2, 0.3)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  notConnectedTitle: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  notConnectedDesc: {
    color: '#94a3b8',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
  },
  connectPrimaryBtn: {
    backgroundColor: '#fc4c02',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    shadowColor: '#fc4c02',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  connectPrimaryBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 14,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  dividerText: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 8,
  },
  advancedToggleText: {
    color: '#94a3b8',
    fontSize: 12,
    textDecorationLine: 'underline',
  },
  advancedBox: {
    marginTop: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  stepTitle: {
    color: '#fb923c',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  stepText: {
    color: '#cbd5e1',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 4,
  },
  linkButton: {
    backgroundColor: 'rgba(252, 76, 2, 0.15)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginVertical: 4,
    borderWidth: 1,
    borderColor: '#fc4c02',
  },
  linkButtonText: {
    color: '#fb923c',
    fontSize: 12,
    fontWeight: '700',
  },
  textInput: {
    backgroundColor: '#1e293b',
    color: '#f8fafc',
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    marginTop: 8,
    marginBottom: 10,
  },
  verifyTokenBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  verifyTokenBtnText: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '700',
  },
  securityBox: {
    backgroundColor: 'rgba(30, 41, 59, 0.6)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  securityTitle: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  securityText: {
    color: '#64748b',
    fontSize: 11,
    lineHeight: 16,
  },
  doneBtn: {
    marginTop: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  doneBtnText: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700',
  },
});
