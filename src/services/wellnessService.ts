import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  where,
} from 'firebase/firestore';
import { db } from '../firebase/firebase';
import type { MoodOption, SleepQualityOption, WellnessEntry } from '../types/api';
import { BLUEPRINT_LIMITS, sanitizeBoundedText } from '../utils/validation';
import { ensureUserAccountAndProfile } from './authService';
import { OperationType, requireAuthenticatedUser, wrapFirestoreError } from './firestoreErrors';

const VALID_MOODS = new Set<MoodOption>(['Radiant', 'Calm', 'Fatigued', 'Anxious', 'Low']);
const VALID_SLEEP_QUALITIES = new Set<SleepQualityOption>([
  'Restless',
  'Good/Restful',
  'Deep/Healing',
]);

function toIsoString(val: unknown): string {
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (typeof val === 'string') return val;
  return '';
}

export const wellnessService = {
  async list(): Promise<WellnessEntry[]> {
    const user = requireAuthenticatedUser('Cloud Firestore · wellness', 'GET');
    const colPath = `users/${user.uid}/wellness`;
    try {
      const snap = await getDocs(query(collection(db, colPath), where('userId', '==', user.uid)));
      if (snap.empty) return [];

      const records: WellnessEntry[] = snap.docs.map((d) => {
        const item = d.data() || {};
        return {
          id: d.id,
          date: String(item.date || ''),
          mood: VALID_MOODS.has(item.mood as MoodOption) ? (item.mood as MoodOption) : 'Calm',
          sleepHours: item.sleepHours !== undefined ? Number(item.sleepHours) : 0,
          sleepQuality: VALID_SLEEP_QUALITIES.has(item.sleepQuality as SleepQualityOption)
            ? (item.sleepQuality as SleepQualityOption)
            : 'Good/Restful',
          stressLevel: item.stressLevel !== undefined ? Number(item.stressLevel) : 3,
          notes: String(item.notes || ''),
          createdAt: toIsoString(item.createdAt),
        };
      });

      return records.sort((a, b) => b.date.localeCompare(a.date));
    } catch (err) {
      wrapFirestoreError(
        err,
        'Cloud Firestore · wellness',
        'GET',
        'Failed to load wellness logs.',
        colPath,
        OperationType.LIST,
      );
    }
  },

  async create(payload: Omit<WellnessEntry, 'id'>): Promise<WellnessEntry> {
    const user = requireAuthenticatedUser('Cloud Firestore · wellness', 'POST');
    const colPath = `users/${user.uid}/wellness`;
    try {
      await ensureUserAccountAndProfile(user);
      const mood = VALID_MOODS.has(payload.mood) ? payload.mood : 'Calm';
      const sleepHours = Math.max(0, Math.min(24, Number(payload.sleepHours) || 0));
      const sleepQuality = VALID_SLEEP_QUALITIES.has(payload.sleepQuality)
        ? payload.sleepQuality
        : 'Good/Restful';
      const stressLevel = Math.max(1, Math.min(10, Math.round(Number(payload.stressLevel) || 1)));
      const notes = sanitizeBoundedText(payload.notes || '', BLUEPRINT_LIMITS.NOTES_MAX);

      const docRef = await addDoc(collection(db, colPath), {
        userId: user.uid,
        date: payload.date,
        mood,
        sleepHours,
        sleepQuality,
        stressLevel,
        notes,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      return {
        id: docRef.id,
        date: payload.date,
        mood,
        sleepHours,
        sleepQuality,
        stressLevel,
        notes,
        createdAt: new Date().toISOString(),
      };
    } catch (err) {
      wrapFirestoreError(
        err,
        'Cloud Firestore · wellness',
        'POST',
        'Failed to save wellness log.',
        colPath,
        OperationType.CREATE,
      );
    }
  },

  async remove(id: string): Promise<void> {
    const user = requireAuthenticatedUser('Cloud Firestore · wellness', 'DELETE');
    const docPath = `users/${user.uid}/wellness/${id}`;
    try {
      await deleteDoc(doc(db, docPath));
    } catch (err) {
      wrapFirestoreError(
        err,
        'Cloud Firestore · wellness',
        'DELETE',
        'Failed to delete wellness log.',
        docPath,
        OperationType.DELETE,
      );
    }
  },
};
