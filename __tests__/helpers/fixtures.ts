import { Fingerprint } from '../../src/logic/fingerprint';

/**
 * Build a Fingerprint from a list of [deviceId, rssi] pairs and an optional
 * magnetic-field magnitude. Keeps test bodies small and readable.
 */
export function fp(
  pairs: Array<[string, number]>,
  magneticMagnitude = 50
): Fingerprint {
  return {
    bleDevices: new Map(pairs),
    magneticMagnitude,
  };
}

/**
 * Mutate a fingerprint to look like a "different place" by dropping `dropN`
 * devices and adding `addN` synthetic ones. Used to simulate the user
 * walking away from point A.
 */
export function awayFrom(base: Fingerprint, dropN = 2, addN = 3): Fingerprint {
  const ids = [...base.bleDevices.keys()];
  const kept = new Map(base.bleDevices);
  for (let i = 0; i < dropN && i < ids.length; i++) {
    kept.delete(ids[i]);
  }
  for (let i = 0; i < addN; i++) {
    kept.set(`away-${i}`, -75);
  }
  return {
    bleDevices: kept,
    magneticMagnitude: base.magneticMagnitude + 15, // outside threshold
  };
}
