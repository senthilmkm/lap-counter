/**
 * Share Service & Social Story Generator
 * 
 * Provides aesthetic, high-conversion workout summary templates for Instagram Stories,
 * TikTok, WhatsApp, and Strava.
 * 
 * 🆓 FREE FOR ALL USERS (Viral user-acquisition loop).
 */

import { Share } from 'react-native';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { DBWorkout } from './database';

export interface SocialCardData {
  workout: DBWorkout;
  formattedDuration: string;
  calories: number;
  fastestLapFormatted?: string;
  lapSplits?: number[]; // Array of lap durations in seconds
  brokenRecords?: string[];
  distanceMiles?: number;
}

/**
 * Generates an aesthetic rich text workout summary.
 */
export function generateSocialStoryText(data: SocialCardData): string {
  const { workout, formattedDuration, calories, fastestLapFormatted, distanceMiles, brokenRecords } = data;
  const modeIcon = workout.mode === 'indoor' ? '🏠 Indoor Track' : '🌳 Outdoor GPS';
  
  let text = `⚡ ORBIT LAP WORKOUT SUMMARY ⚡\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `📍 Mode: ${modeIcon}\n`;
  text += `🔄 Laps Completed: ${workout.totalLaps} Laps\n`;
  text += `⏱ Total Duration: ${formattedDuration}\n`;
  
  if (distanceMiles && distanceMiles > 0) {
    text += `🏃 Distance: ${distanceMiles.toFixed(2)} miles\n`;
  }
  
  if (fastestLapFormatted) {
    text += `🔥 Fastest Lap: ${fastestLapFormatted}\n`;
  }
  
  text += `🔥 Calories: ${calories} kcal\n`;
  text += `👟 Cadence: ${Math.round(workout.cadence)} spm\n`;

  if (brokenRecords && brokenRecords.length > 0) {
    text += `🏆 NEW PERSONAL RECORD: ${brokenRecords.join(', ')}\n`;
  }

  text += `━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `Stop counting laps in your head.\n`;
  text += `Tracked automatically with Orbit Lap Counter 🚀\n`;
  text += `📲 Download free on the App Store!`;

  return text;
}

/**
 * Triggers native system share dialog for social channels.
 */
export async function shareWorkoutStory(data: SocialCardData): Promise<boolean> {
  try {
    const text = generateSocialStoryText(data);
    const result = await Share.share({
      message: text,
      title: `Orbit Lap Counter - ${data.workout.totalLaps} Laps Completed!`,
    });
    return result.action === Share.sharedAction;
  } catch (e) {
    console.warn('Error sharing workout story:', e);
    return false;
  }
}
