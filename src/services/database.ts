import * as SQLite from 'expo-sqlite';

export interface DBWorkout {
  id: string;
  startTime: number;
  endTime: number;
  mode: 'indoor' | 'outdoor';
  totalLaps: number;
  steps: number;
  cadence: number;
  strideLength: number;
  yawDrift: number;
}

export interface DBGpsPoint {
  latitude: number;
  longitude: number;
  accuracy?: number;
  timestamp: number;
}

let dbInstance: SQLite.SQLiteDatabase | null = null;

/**
 * Initializes and retrieves the SQLite database instance.
 * Automatically creates tables if they do not exist.
 */
export function getDatabase(): SQLite.SQLiteDatabase | null {
  if (dbInstance) return dbInstance;
  try {
    const db = SQLite.openDatabaseSync('lapcounter.db');
    db.execSync(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS workouts (
        id TEXT PRIMARY KEY,
        startTime INTEGER,
        endTime INTEGER,
        mode TEXT,
        totalLaps INTEGER,
        steps INTEGER,
        cadence REAL,
        strideLength REAL,
        yawDrift REAL
      );
      CREATE TABLE IF NOT EXISTS gps_points (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workoutId TEXT,
        latitude REAL,
        longitude REAL,
        accuracy REAL,
        timestamp INTEGER,
        FOREIGN KEY(workoutId) REFERENCES workouts(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
    dbInstance = db;
    return db;
  } catch (error) {
    console.warn('Failed to open/initialize SQLite database:', error);
    return null;
  }
}

/**
 * Saves a completed workout session and its corresponding GPS coordinate trail.
 * Uses a single database transaction for safety.
 */
export async function saveWorkout(workout: DBWorkout, path: DBGpsPoint[]): Promise<boolean> {
  const db = getDatabase();
  if (!db) return false;

  try {
    // Write workout summary
    db.runSync(
      `INSERT OR REPLACE INTO workouts (id, startTime, endTime, mode, totalLaps, steps, cadence, strideLength, yawDrift) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        workout.id,
        workout.startTime,
        workout.endTime,
        workout.mode,
        workout.totalLaps,
        workout.steps,
        workout.cadence,
        workout.strideLength,
        workout.yawDrift,
      ]
    );

    // Write GPS coordinate trail points
    if (path.length > 0) {
      // Execute inserts in batch using SQLite transaction features
      db.withTransactionSync(() => {
        path.forEach((pt) => {
          db.runSync(
            `INSERT INTO gps_points (workoutId, latitude, longitude, accuracy, timestamp) 
             VALUES (?, ?, ?, ?, ?)`,
            [workout.id, pt.latitude, pt.longitude, pt.accuracy ?? 0, pt.timestamp]
          );
        });
      });
    }

    return true;
  } catch (e) {
    console.warn('Failed to save workout to SQLite:', e);
    return false;
  }
}

/**
 * Retrieves the complete list of workout summaries, sorted chronologically (latest first).
 */
export function getWorkouts(): DBWorkout[] {
  const db = getDatabase();
  if (!db) return [];

  try {
    return db.getAllSync<DBWorkout>(`SELECT * FROM workouts ORDER BY startTime DESC`);
  } catch (e) {
    console.warn('Failed to query workouts list:', e);
    return [];
  }
}

/**
 * Retrieves the GPS trail coordinates associated with a specific workout.
 */
export function getWorkoutPath(workoutId: string): DBGpsPoint[] {
  const db = getDatabase();
  if (!db) return [];

  try {
    return db.getAllSync<DBGpsPoint>(
      `SELECT latitude, longitude, accuracy, timestamp FROM gps_points WHERE workoutId = ? ORDER BY timestamp ASC`,
      [workoutId]
    );
  } catch (e) {
    console.warn('Failed to query GPS path details:', e);
    return [];
  }
}

/**
 * Deletes a workout record and cascades the deletion to delete all associated path points.
 */
export function deleteWorkout(workoutId: string): boolean {
  const db = getDatabase();
  if (!db) return false;

  try {
    db.runSync(`DELETE FROM workouts WHERE id = ?`, [workoutId]);
    return true;
  } catch (e) {
    console.warn('Failed to delete workout from SQLite:', e);
    return false;
  }
}

/**
 * Retrieves a persistent key-value setting synchronously from the database.
 */
export function getSettingSync(key: string, defaultValue: string): string {
  const db = getDatabase();
  if (!db) return defaultValue;
  try {
    const row = db.getFirstSync<{ value: string }>(
      'SELECT value FROM settings WHERE key = ?',
      [key]
    );
    return row ? row.value : defaultValue;
  } catch (e) {
    console.warn(`Failed to get setting ${key}:`, e);
    return defaultValue;
  }
}

/**
 * Saves a persistent key-value setting synchronously in the database.
 */
export function saveSettingSync(key: string, value: string): boolean {
  const db = getDatabase();
  if (!db) return false;
  try {
    db.runSync(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
      [key, value]
    );
    return true;
  } catch (e) {
    console.warn(`Failed to save setting ${key}:`, e);
    return false;
  }
}

