import { uploadWorkoutToStrava, setStravaAutoSyncEnabled } from '../src/services/stravaService';
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
});
