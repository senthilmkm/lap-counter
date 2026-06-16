/**
 * Fingerprint of a place: which BLE devices are visible and at what RSSI,
 * plus the local magnetic field magnitude. Used to score whether the user
 * has returned to the calibrated start point A.
 */
export type Fingerprint = {
  /** Map<deviceId, averageRssi (dBm, typically -30 to -100)> */
  bleDevices: Map<string, number>;
  /** Magnetic field magnitude in microtesla (μT). */
  magneticMagnitude: number;
};

/** Tunable weights used by `similarity`. */
export type SimilarityWeights = {
  jaccard: number;
  rssiCosine: number;
};

const DEFAULT_WEIGHTS: SimilarityWeights = {
  jaccard: 0.5,
  rssiCosine: 0.5,
};

/**
 * Jaccard set overlap of the device IDs in two fingerprints.
 * 1.0 = identical device sets, 0.0 = disjoint.
 */
function jaccard(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const id of a.keys()) {
    if (b.has(id)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Cosine similarity over the RSSI vectors restricted to the intersection
 * of device IDs. Treats RSSI as a positive "loudness" by adding 100 dBm
 * (so e.g. -60 dBm → 40), which keeps cosine well-defined.
 */
function rssiCosine(a: Map<string, number>, b: Map<string, number>): number {
  const shared: string[] = [];
  for (const id of a.keys()) {
    if (b.has(id)) shared.push(id);
  }
  if (shared.length === 0) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (const id of shared) {
    const va = (a.get(id) ?? -100) + 100;
    const vb = (b.get(id) ?? -100) + 100;
    dot += va * vb;
    magA += va * va;
    magB += vb * vb;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Combined similarity in [0, 1]. Higher = more likely the user is at the
 * same physical location as fingerprint `b`.
 *
 * The RSSI cosine is multiplied by the Jaccard ("coverage") so that a
 * tiny intersection of two well-matching devices can never dominate the
 * decision — the score still has to be earned by overlap of the device
 * SETS, not just signal alignment of a single shared device.
 */
export function similarity(
  a: Fingerprint,
  b: Fingerprint,
  weights: SimilarityWeights = DEFAULT_WEIGHTS
): number {
  const j = jaccard(a.bleDevices, b.bleDevices);
  const c = rssiCosine(a.bleDevices, b.bleDevices);
  const cWeighted = c * j;
  const totalWeight = weights.jaccard + weights.rssiCosine;
  return (j * weights.jaccard + cWeighted * weights.rssiCosine) / totalWeight;
}

/** Absolute delta between two magnetic field magnitudes (μT). */
export function magneticDelta(a: Fingerprint, b: Fingerprint): number {
  return Math.abs(a.magneticMagnitude - b.magneticMagnitude);
}

/**
 * Refine a stored fingerprint using a new observation, weighted as a
 * moving average. Used after each detected lap so the stored point-A
 * fingerprint converges over time.
 */
export function refineFingerprint(
  stored: Fingerprint,
  observation: Fingerprint,
  alpha = 0.3
): Fingerprint {
  const merged = new Map<string, number>();
  const allIds = new Set<string>([
    ...stored.bleDevices.keys(),
    ...observation.bleDevices.keys(),
  ]);
  for (const id of allIds) {
    const s = stored.bleDevices.get(id);
    const o = observation.bleDevices.get(id);
    if (s != null && o != null) {
      merged.set(id, s * (1 - alpha) + o * alpha);
    } else if (s != null) {
      // Fade out devices that didn't show up this time.
      merged.set(id, s - 1);
    } else if (o != null) {
      merged.set(id, o);
    }
  }
  // Drop devices that have faded too far.
  for (const [id, rssi] of merged) {
    if (rssi < -100) merged.delete(id);
  }

  return {
    bleDevices: merged,
    magneticMagnitude:
      stored.magneticMagnitude * (1 - alpha) + observation.magneticMagnitude * alpha,
  };
}

/** Build an empty fingerprint. */
export function emptyFingerprint(): Fingerprint {
  return {
    bleDevices: new Map<string, number>(),
    magneticMagnitude: 0,
  };
}
