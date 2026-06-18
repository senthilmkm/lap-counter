import { cacheDirectory, writeAsStringAsync, EncodingType } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';

export interface ExporterPoint {
  latitude: number;
  longitude: number;
  accuracy?: number;
  timestamp: number; // unix timestamp in ms
}

export interface ExporterLap {
  lapNumber: number;
  durationSeconds: number;
  steps: number;
  cadence: number;
  yawDrift?: number; // drift in meters/radians relative to starting point
  /** For outdoor GPS laps: estimated distance in meters (total GPS / laps). */
  distanceMeters?: number;
}

/**
 * Translates outdoor GPS tracking coordinates into a standardized GPX (XML) schema.
 * This GPX output is fully compatible with Strava, Garmin, and Apple Health.
 */
export function generateGPX(gpsPath: ExporterPoint[], startTimeMs: number): string {
  const isoTime = new Date(startTimeMs).toISOString();
  let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Lap Counter App" 
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
     xmlns="http://www.topografix.com/GPX/1/1" 
     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>Lap Counter Session</name>
    <time>${isoTime}</time>
  </metadata>
  <trk>
    <name>Lap Counter Outdoor Activity</name>
    <type>9</type> <!-- Run/Walk activity type code -->
    <trkseg>
`;

  gpsPath.forEach((pt) => {
    const ptIso = new Date(pt.timestamp).toISOString();
    gpx += `      <trkpt lat="${pt.latitude.toFixed(6)}" lon="${pt.longitude.toFixed(6)}">
        <time>${ptIso}</time>
      </trkpt>\n`;
  });

  gpx += `    </trkseg>
  </trk>
</gpx>`;

  return gpx;
}

/**
 * Translates workout lap summaries into a CSV spreadsheet.
 */
export function generateCSV(laps: ExporterLap[]): string {
  const isOutdoor = laps.some(l => l.distanceMeters !== undefined);

  if (isOutdoor) {
    let csv = 'Lap Number,Duration (s),Distance (m),Estimated Pace (min/km)\n';
    laps.forEach((lap) => {
      const distM = lap.distanceMeters ?? 0;
      const paceMinKm = distM > 0 && lap.durationSeconds > 0
        ? ((lap.durationSeconds / 60) / (distM / 1000)).toFixed(2)
        : '—';
      csv += `${lap.lapNumber},${lap.durationSeconds},${distM.toFixed(1)},${paceMinKm}\n`;
    });
    return csv;
  }

  // Indoor CSV with steps / cadence / drift
  let csv = 'Lap Number,Duration (s),Steps,Average Cadence (spm),Relative Drift (m)\n';
  laps.forEach((lap) => {
    const driftText = lap.yawDrift !== undefined && !isNaN(lap.yawDrift)
      ? lap.yawDrift.toFixed(2)
      : '—';
    csv += `${lap.lapNumber},${lap.durationSeconds},${lap.steps},${Math.round(lap.cadence)},${driftText}\n`;
  });
  return csv;
}

/**
 * Writes the file content locally into the app cache directory and triggers the OS Share Sheet.
 * Safe for offline triggers and handles target OS share validations.
 */
export async function exportWorkoutFile(fileName: string, fileContent: string): Promise<boolean> {
  try {
    const isSharingAvailable = await Sharing.isAvailableAsync();
    if (!isSharingAvailable) {
      Alert.alert('Sharing Unavailable', 'This device does not support native file sharing.');
      return false;
    }

    const fileUri = `${cacheDirectory}${fileName}`;
    
    // Write text string to temporary cache
    await writeAsStringAsync(fileUri, fileContent, {
      encoding: EncodingType.UTF8,
    });

    // Launch sharing controller sheet
    await Sharing.shareAsync(fileUri, {
      mimeType: fileName.endsWith('.gpx') ? 'application/gpx+xml' : 'text/csv',
      dialogTitle: `Export Workout File: ${fileName}`,
    });

    return true;
  } catch (error) {
    console.warn('Failed to export workout file:', error);
    Alert.alert('Export Error', 'An unexpected error occurred while compiling and sharing your file.');
    return false;
  }
}
