import { DeviceMotion, Magnetometer, Pedometer } from 'expo-sensors';

type RemovableSubscription = { remove: () => void };

export type MotionSnapshot = {
  /** Magnitude of the magnetic field vector in microtesla (μT). */
  magneticMagnitude: number;
  /** Cumulative yaw rotation since session start, radians (wraps). */
  yaw: number;
  /** Steps counted since session start. */
  steps: number;
  /**
   * Estimated dead-reckoned displacement from start in 2-D meters.
   * x = east-ish, y = north-ish (relative to the user's initial heading).
   */
  displacement: { x: number; y: number };
  /** Magnitude of the displacement vector, meters. */
  displacementMagnitude: number;
};

export type MotionTrackerHandle = {
  /** Returns the latest snapshot synchronously. */
  snapshot: () => MotionSnapshot;
  /** Reset the cumulative yaw / displacement / step baseline. */
  resetBaseline: () => void;
  /** Tear down all sensor subscriptions. */
  stop: () => void;
};

const STRIDE_LENGTH_M = 0.7; // average adult walking stride

/**
 * Spin up Magnetometer + DeviceMotion + Pedometer subscriptions and
 * fuse them into a continuously-updated MotionSnapshot. The snapshot
 * is read synchronously by the lap detector at its own cadence.
 */
export async function startMotionTracker(): Promise<MotionTrackerHandle> {
  let magneticMagnitude = 0;
  let lastYaw = 0;
  let cumulativeYaw = 0;
  let yawBaseline = 0;
  let stepBaseline: number | null = null;
  let steps = 0;
  let displacement = { x: 0, y: 0 };
  let lastStepCount = 0;

  Magnetometer.setUpdateInterval(100);
  const magSub = Magnetometer.addListener(({ x, y, z }) => {
    magneticMagnitude = Math.sqrt(x * x + y * y + z * z);
  });

  DeviceMotion.setUpdateInterval(20);
  const motionSub = DeviceMotion.addListener((event) => {
    const yaw = event?.rotation?.alpha;
    if (typeof yaw === 'number') {
      // Track delta to support unwrapping across the +/- pi boundary.
      let delta = yaw - lastYaw;
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta < -Math.PI) delta += 2 * Math.PI;
      cumulativeYaw += delta;
      lastYaw = yaw;
    }
  });

  let pedSub: RemovableSubscription | null = null;
  const pedAvailable = await Pedometer.isAvailableAsync().catch(() => false);
  if (pedAvailable) {
    pedSub = Pedometer.watchStepCount(({ steps: rawSteps }) => {
      if (stepBaseline == null) stepBaseline = rawSteps;
      const sessionSteps = rawSteps - stepBaseline;
      const newSteps = sessionSteps - lastStepCount;
      lastStepCount = sessionSteps;
      steps = sessionSteps;

      if (newSteps > 0) {
        // Project new steps onto current heading (relative to baseline yaw).
        const heading = cumulativeYaw - yawBaseline;
        const dx = Math.sin(heading) * newSteps * STRIDE_LENGTH_M;
        const dy = Math.cos(heading) * newSteps * STRIDE_LENGTH_M;
        displacement = { x: displacement.x + dx, y: displacement.y + dy };
      }
    });
  }

  const handle: MotionTrackerHandle = {
    snapshot: () => {
      const dx = displacement.x;
      const dy = displacement.y;
      return {
        magneticMagnitude,
        yaw: cumulativeYaw - yawBaseline,
        steps,
        displacement: { x: dx, y: dy },
        displacementMagnitude: Math.sqrt(dx * dx + dy * dy),
      };
    },
    resetBaseline: () => {
      yawBaseline = cumulativeYaw;
      stepBaseline = null;
      lastStepCount = 0;
      steps = 0;
      displacement = { x: 0, y: 0 };
    },
    stop: () => {
      magSub.remove();
      motionSub.remove();
      pedSub?.remove();
    },
  };

  return handle;
}
