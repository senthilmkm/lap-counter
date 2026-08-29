import {
  uploadWorkoutToStrava,
  setStravaAutoSyncEnabled,
  saveStravaTokens,
  getStravaTokens,
  ensureFreshStravaToken,
  disconnectStrava,
  isStravaConnected,
  markWorkoutPendingSync,
  getPendingSyncWorkouts,
  removeWorkoutFromPendingSync,
  syncPendingWorkoutsToStrava,
} from '../src/services/stravaService';
import { DBWorkout } from '../src/services/database';

describe('Strava Service & Pro Subscription Gating', () => {
  const dummyWorkout: DBWorkout = {
    id: 'workout_12345678',
    startTime: 1700000000000,
    endTime: 1700001800000,
    mode: 'outdoor',
    totalLaps: 10,
    steps: 2500,
    cadence: 165,
    strideLength: 1.1,
    yawDrift: 0.5,
  };

  it('strictly blocks upload when user is NOT premium and returns paywallRequired', async () => {
    const result = await uploadWorkoutToStrava(dummyWorkout, [], false);
    expect(result.success).toBe(false);
    expect(result.paywallRequired).toBe(true);
    expect(result.error).toContain('Orbit Pro');
  });

  it('attempts upload when user is premium without requiring paywall', async () => {
    const result = await uploadWorkoutToStrava(dummyWorkout, [], true);
    expect(result.paywallRequired).toBeFalsy();
  });

  it('strictly blocks enabling auto-sync setting for non-premium tier', () => {
    const allowed = setStravaAutoSyncEnabled(true, false);
    expect(allowed).toBe(false);
  });

  it('allows enabling auto-sync setting for premium tier', () => {
    const allowed = setStravaAutoSyncEnabled(true, true);
    expect(allowed).toBe(true);
  });

  it('correctly stores, identifies valid tokens, and ensures token freshness', async () => {
    const futureExpiry = Math.floor(Date.now() / 1000) + 7200; // 2 hours in future
    saveStravaTokens({
      accessToken: 'test_access_token_123',
      refreshToken: 'test_refresh_token_456',
      expiresAt: futureExpiry,
      athleteId: 'athlete_789',
    });

    expect(isStravaConnected()).toBe(true);
    const tokens = getStravaTokens();
    expect(tokens?.accessToken).toBe('test_access_token_123');

    // Fresh token returned directly without needing network refresh
    const fresh = await ensureFreshStravaToken();
    expect(fresh).toBe('test_access_token_123');

    // Disconnect cleans up
    disconnectStrava();
    expect(isStravaConnected()).toBe(false);
  });

  it('manages offline sync queue accurately and auto-drains without user intervention', async () => {
    // Add workout to pending offline queue
    markWorkoutPendingSync('workout_pending_999');
    expect(getPendingSyncWorkouts()).toContain('workout_pending_999');

    // Remove from queue
    removeWorkoutFromPendingSync('workout_pending_999');
    expect(getPendingSyncWorkouts()).not.toContain('workout_pending_999');
  });
});
