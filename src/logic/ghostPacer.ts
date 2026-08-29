/**
 * Ghost Pacer Engine
 * 
 * Provides real-time pacing calculations comparing current workout progress
 * against a target ghost runner (e.g. personal best PR from SQLite, negative split strategy,
 * or manual target pace).
 */

export type GhostMode = 'none' | 'manual_target' | 'pr_ghost' | 'negative_split';

export interface GhostPacerConfig {
  mode: GhostMode;
  targetLapSeconds?: number;      // Target duration per lap in seconds (e.g. 90s)
  prLapSeconds?: number;          // Historical best lap duration in seconds
  negativeSplitFactor?: number;   // E.g. 0.02 = 2% faster each consecutive lap
}

export interface GhostPacerState {
  currentLap: number;
  elapsedLapSeconds: number;
  expectedLapSeconds: number;
  splitDeltaSeconds: number;      // Negative = ahead of ghost (green), Positive = behind ghost (red)
  isAhead: boolean;
  coachCue: string | null;
}

/**
 * Computes the target duration for a specific lap number based on the selected mode.
 */
export function calculateLapTarget(
  lapNumber: number,
  config: GhostPacerConfig
): number {
  if (config.mode === 'pr_ghost' && config.prLapSeconds && config.prLapSeconds > 0) {
    return config.prLapSeconds;
  }

  const baseTarget = config.targetLapSeconds && config.targetLapSeconds > 0
    ? config.targetLapSeconds
    : 90; // Default 90s/lap if unspecified

  if (config.mode === 'negative_split') {
    const factor = config.negativeSplitFactor ?? 0.02; // 2% faster each lap
    // Lap 1 is baseTarget, Lap 2 is baseTarget * (1 - factor), etc.
    const multiplier = Math.max(0.7, 1 - (lapNumber - 1) * factor);
    return Math.round(baseTarget * multiplier);
  }

  return baseTarget;
}

/**
 * Calculates real-time split delta and speech coach cues.
 */
export function evaluateGhostPacer(params: {
  lapNumber: number;
  lapElapsedSeconds: number;
  config: GhostPacerConfig;
}): GhostPacerState {
  const { lapNumber, lapElapsedSeconds, config } = params;

  if (config.mode === 'none') {
    return {
      currentLap: lapNumber,
      elapsedLapSeconds: lapElapsedSeconds,
      expectedLapSeconds: 0,
      splitDeltaSeconds: 0,
      isAhead: true,
      coachCue: null,
    };
  }

  const expectedLapSeconds = calculateLapTarget(lapNumber, config);
  const splitDeltaSeconds = lapElapsedSeconds - expectedLapSeconds;
  const isAhead = splitDeltaSeconds <= 0;

  let coachCue: string | null = null;
  const absDelta = Math.abs(splitDeltaSeconds);
  const formattedDelta = absDelta >= 60 
    ? `${Math.floor(absDelta / 60)}m ${Math.round(absDelta % 60)}s`
    : `${Math.round(absDelta)} seconds`;

  if (isAhead) {
    coachCue = config.mode === 'pr_ghost'
      ? `Lap ${lapNumber} complete. ${formattedDelta} ahead of your PR!`
      : `Lap ${lapNumber} complete. ${formattedDelta} ahead of target pace!`;
  } else {
    coachCue = config.mode === 'pr_ghost'
      ? `Lap ${lapNumber} complete. ${formattedDelta} behind your PR.`
      : `Lap ${lapNumber} complete. ${formattedDelta} behind target pace.`;
  }

  return {
    currentLap: lapNumber,
    elapsedLapSeconds: lapElapsedSeconds,
    expectedLapSeconds,
    splitDeltaSeconds,
    isAhead,
    coachCue,
  };
}
