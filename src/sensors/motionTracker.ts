import { DeviceMotion, Magnetometer, Pedometer, Gyroscope } from 'expo-sensors';

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
  /** Raw angular velocity around Z-axis from Gyroscope (rad/s). */
  gyroZRate: number;
  /** Integrated yaw from the Gyroscope (radians). */
  gyroYaw: number;
};

export type MotionTrackerHandle = {
  /** Returns the latest snapshot synchronously. */
  snapshot: () => MotionSnapshot;
  /** Reset the cumulative yaw / displacement / step baseline. */
  resetBaseline: () => void;
  /** Tear down all sensor subscriptions. */
  stop: () => void;
};

export async function startMotionTracker(): Promise<MotionTrackerHandle> {
  let magneticMagnitude = 0;
  let lastYaw = 0;
  let cumulativeYaw = 0;
  let yawBaseline = 0;
  let stepBaseline: number | null = null;
  let steps = 0;
  let displacement = { x: 0, y: 0 };
  let lastStepCount = 0;
  let rawGyroYaw = 0;
  let rawGyroZRate = 0;
  let gyroBaseline = 0;

  let trackerStartTs = Date.now();
  const gyroZRateSamples: number[] = [];
  let gyroBias = 0;

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

  Gyroscope.setUpdateInterval(20);
  const gyroSub = Gyroscope.addListener(({ z }) => {
    rawGyroZRate = z;
    gyroZRateSamples.push(z);
    if (gyroZRateSamples.length > 250) {
      gyroZRateSamples.shift();
    }
    // Integrate Z-axis rotation rate using bias correction
    rawGyroYaw += (z - gyroBias) * 0.02;
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
        // Calculate walking cadence (steps per minute) to adapt stride length
        const elapsed = (Date.now() - trackerStartTs) / 1000;
        const cadence = elapsed > 5 ? (sessionSteps / elapsed) * 60 : 100;

        let strideLength = 0.55; // default average adult walking stride indoors
        if (cadence < 85) {
          strideLength = 0.45; // shorter stride for slow walking indoors
        } else if (cadence > 125) {
          strideLength = 0.7; // longer stride for fast walking/jogging indoors
        } else {
          // Linear interpolation between 0.45m at 85 steps/min and 0.7m at 125 steps/min
          strideLength = 0.45 + ((cadence - 85) / (125 - 85)) * (0.7 - 0.45);
        }

        // Project new steps onto current heading (relative to baseline yaw).
        // Use rawGyroYaw - gyroBaseline (pure integrated gyro heading) to be 100% immune to magnetic anomalies.
        const heading = rawGyroYaw - gyroBaseline;
        const dx = Math.sin(heading) * newSteps * strideLength;
        const dy = Math.cos(heading) * newSteps * strideLength;
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
        gyroZRate: rawGyroZRate,
        gyroYaw: rawGyroYaw - gyroBaseline,
      };
    },
    resetBaseline: () => {
      yawBaseline = cumulativeYaw;
      if (gyroZRateSamples.length > 0) {
        // Compute bias as the average Z-rate while standing still (calibration phase)
        gyroBias = gyroZRateSamples.reduce((sum, val) => sum + val, 0) / gyroZRateSamples.length;
      }
      gyroBaseline = rawGyroYaw;
      stepBaseline = null;
      lastStepCount = 0;
      steps = 0;
      displacement = { x: 0, y: 0 };
      trackerStartTs = Date.now();
    },
    stop: () => {
      magSub.remove();
      motionSub.remove();
      gyroSub.remove();
      pedSub?.remove();
    },
  };

  return handle;
}
