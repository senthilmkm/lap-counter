/**
 * Feature Flags Configuration for Orbit
 * 
 * Allows toggling new modules, external integrations, and experimental features.
 * Toggling flags can be published instantly over-the-air via `eas update`
 * without requiring a new App Store binary review.
 */
export const FEATURE_FLAGS = {
  /**
   * Enables the "Connected Apps & Strava" section in Settings,
   * Strava auto-sync on workout completion, and orange synced badges in History.
   * Set to `true` to enable or `false` to completely hide from users.
   */
  ENABLE_STRAVA_INTEGRATION: true,
};
