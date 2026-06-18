import { estimateCalories, getCalorieEquivalent } from '../App';
import { getSettingSync, saveSettingSync, getDatabase } from '../src/services/database';

describe('Calorie Calculation & Settings persistence features', () => {
  describe('estimateCalories', () => {
    it('returns 0 if weight or duration is zero/negative', () => {
      expect(estimateCalories({
        mode: 'indoor',
        steps: 100,
        durationSeconds: 0,
        weightLbs: 150,
        strideLengthMeters: 0.75,
      })).toBe(0);

      expect(estimateCalories({
        mode: 'indoor',
        steps: 100,
        durationSeconds: 60,
        weightLbs: -10,
        strideLengthMeters: 0.75,
      })).toBe(0);
    });

    it('estimates indoor calories using cadence thresholds', () => {
      // Cadence <= 130 spm: MET factor 0.57
      // 100 steps in 60s -> cadence = 100 spm. Stride = 0.75m.
      // distance = (100 * 0.75) / 1609.34 = 0.0466 miles
      // calories = 0.57 * 150 * 0.0466 = 3.98 -> 4 kcal
      const walkingCal = estimateCalories({
        mode: 'indoor',
        steps: 100,
        durationSeconds: 60,
        weightLbs: 150,
        strideLengthMeters: 0.75,
      });
      expect(walkingCal).toBe(4);

      // Cadence > 130 spm: MET factor 0.72
      // 150 steps in 60s -> cadence = 150 spm.
      // distance = (150 * 0.75) / 1609.34 = 0.0699 miles
      // calories = 0.72 * 150 * 0.0699 = 7.55 -> 8 kcal
      const runningCal = estimateCalories({
        mode: 'indoor',
        steps: 150,
        durationSeconds: 60,
        weightLbs: 150,
        strideLengthMeters: 0.75,
      });
      expect(runningCal).toBe(8);
    });

    it('estimates outdoor calories using speed thresholds', () => {
      // Speed <= 4.0 mph: MET factor 0.57
      // 1000m in 600s = 3600s/hr * 1000m/600s = 6000 m/hr = 3.73 mph
      // distance = 1000 / 1609.34 = 0.6214 miles
      // calories = 0.57 * 150 * 0.6214 = 53.13 -> 53 kcal
      const walkingCal = estimateCalories({
        mode: 'outdoor',
        steps: 0,
        durationSeconds: 600,
        weightLbs: 150,
        strideLengthMeters: 0,
        gpsDistanceMeters: 1000,
      });
      expect(walkingCal).toBe(53);

      // Speed > 4.0 mph: MET factor 0.72
      // 1500m in 600s = 3600 * 1500 / 600 = 9000 m/hr = 5.59 mph
      // distance = 1500 / 1609.34 = 0.9320 miles
      // calories = 0.72 * 150 * 0.9320 = 100.66 -> 101 kcal
      const runningCal = estimateCalories({
        mode: 'outdoor',
        steps: 0,
        durationSeconds: 600,
        weightLbs: 150,
        strideLengthMeters: 0,
        gpsDistanceMeters: 1500,
      });
      expect(runningCal).toBe(101);
    });
  });

  describe('getCalorieEquivalent', () => {
    it('returns the correct food representation based on calories burned', () => {
      expect(getCalorieEquivalent(50)).toBe('🍏 Apple');
      expect(getCalorieEquivalent(150)).toBe('🍌 Banana');
      expect(getCalorieEquivalent(250)).toBe('☕ Latte');
      expect(getCalorieEquivalent(350)).toBe('🍩 Donut');
      expect(getCalorieEquivalent(450)).toBe('🍕 Pizza Slice');
      expect(getCalorieEquivalent(650)).toBe('🍔 Burger');
    });
  });

  describe('SQLite Settings Persistence', () => {
    it('correctly falls back to default setting if not stored in SQLite', () => {
      const db = getDatabase();
      const getFirstSpy = jest.spyOn(db!, 'getFirstSync').mockReturnValue(null);
      
      expect(getSettingSync('userWeight', '150')).toBe('150');
      expect(getFirstSpy).toHaveBeenCalledWith(
        'SELECT value FROM settings WHERE key = ?',
        ['userWeight']
      );
      getFirstSpy.mockRestore();
    });

    it('returns setting value from SQLite if found', () => {
      const db = getDatabase();
      const getFirstSpy = jest.spyOn(db!, 'getFirstSync').mockReturnValue({ value: '180' });

      expect(getSettingSync('userWeight', '150')).toBe('180');
      getFirstSpy.mockRestore();
    });

    it('saves setting values securely to SQLite settings table', () => {
      const db = getDatabase();
      const runSpy = jest.spyOn(db!, 'runSync');

      saveSettingSync('userWeightUnit', 'kg');
      expect(runSpy).toHaveBeenCalledWith(
        'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
        ['userWeightUnit', 'kg']
      );
      runSpy.mockRestore();
    });
  });
});
