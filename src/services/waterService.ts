import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase/firebase';
import type { WaterIntakeRecord, WaterTrackerResponse } from '../types/api';
import { BLUEPRINT_LIMITS } from '../utils/validation';
import { ensureUserAccountAndProfile } from './authService';
import { OperationType, requireAuthenticatedUser, wrapFirestoreError } from './firestoreErrors';

const DEFAULT_WATER_GOAL_ML = 2500;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export const waterService = {
  async getDaily(date?: string): Promise<WaterTrackerResponse> {
    const user = requireAuthenticatedUser('Cloud Firestore · water', 'GET');
    const targetDate = date || todayIso();
    const colPath = `users/${user.uid}/water`;
    try {
      await ensureUserAccountAndProfile(user);
      const [waterSnap, accountSnap] = await Promise.all([
        getDocs(query(collection(db, colPath), where('userId', '==', user.uid))),
        getDoc(doc(db, 'users', user.uid)),
      ]);

      let dailyTargetMl = DEFAULT_WATER_GOAL_ML;
      let remindersEnabled = true;

      if (accountSnap.exists()) {
        const p = accountSnap.data() || {};
        if (p.dailyWaterTargetMl !== undefined && Number(p.dailyWaterTargetMl) > 0) {
          dailyTargetMl = Number(p.dailyWaterTargetMl);
        }
        if (p.hydrationNudges !== undefined) {
          remindersEnabled = Boolean(p.hydrationNudges);
        }
      }

      let totalIntakeMl = 0;
      const entries: WaterIntakeRecord[] = [];
      const docsData = waterSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })) as Array<
        Record<string, unknown> & { id: string }
      >;

      for (const item of docsData) {
        if (item.date === targetDate && Number(item.amountMl) > 0) {
          const amountMl = Number(item.amountMl);
          totalIntakeMl += amountMl;
          entries.push({
            id: item.id,
            date: String(item.date),
            amountMl,
            loggedAt: item.loggedAt ? String(item.loggedAt) : '',
          });
        }
      }

      const weeklyHistory: Array<{ date: string; dayLabel: string; totalMl: number }> = [];
      const anchor = new Date(`${targetDate}T00:00:00Z`);
      for (let i = 6; i >= 0; i -= 1) {
        const d = new Date(anchor);
        d.setUTCDate(anchor.getUTCDate() - i);
        const iso = d.toISOString().slice(0, 10);
        const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });

        let dayTotal = 0;
        for (const item of docsData) {
          if (item.date === iso && Number(item.amountMl) > 0) {
            dayTotal += Number(item.amountMl);
          }
        }
        weeklyHistory.push({ date: iso, dayLabel, totalMl: dayTotal });
      }

      return {
        date: targetDate,
        dailyTargetMl,
        totalIntakeMl,
        remindersEnabled,
        entries,
        weeklyHistory,
      };
    } catch (err) {
      wrapFirestoreError(
        err,
        'Cloud Firestore · water',
        'GET',
        'Failed to load water intake.',
        colPath,
        OperationType.LIST,
      );
    }
  },

  async getStatus(date?: string): Promise<WaterTrackerResponse> {
    return this.getDaily(date);
  },

  async logIntake(payload: { date: string; amountMl: number }): Promise<WaterTrackerResponse> {
    const user = requireAuthenticatedUser('Cloud Firestore · water', 'POST');
    const targetDate = payload.date || todayIso();
    const colPath = `users/${user.uid}/water`;
    try {
      await ensureUserAccountAndProfile(user);
      const amountMl = Math.max(
        BLUEPRINT_LIMITS.WATER_MIN_ML,
        Math.min(BLUEPRINT_LIMITS.WATER_MAX_ML, Math.round(Number(payload.amountMl) || 0)),
      );
      const loggedAt = (
        new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }) || '12:00'
      ).slice(0, 40);

      await addDoc(collection(db, colPath), {
        userId: user.uid,
        date: targetDate,
        amountMl,
        loggedAt,
        createdAt: serverTimestamp(),
      });

      return this.getDaily(targetDate);
    } catch (err) {
      wrapFirestoreError(
        err,
        'Cloud Firestore · water',
        'POST',
        'Failed to log water intake.',
        colPath,
        OperationType.CREATE,
      );
    }
  },

  async updatePreferences(prefs: {
    dailyTargetMl?: number;
    remindersEnabled?: boolean;
  }): Promise<WaterTrackerResponse> {
    const user = requireAuthenticatedUser('Cloud Firestore · water', 'PATCH');
    const docPath = `users/${user.uid}`;
    try {
      await ensureUserAccountAndProfile(user);
      const updates: Record<string, unknown> = {};
      if (prefs.dailyTargetMl !== undefined) {
        updates.dailyWaterTargetMl = Math.max(
          BLUEPRINT_LIMITS.TARGET_MIN,
          Math.min(BLUEPRINT_LIMITS.TARGET_MAX, Math.round(Number(prefs.dailyTargetMl))),
        );
      }
      if (prefs.remindersEnabled !== undefined) {
        updates.hydrationNudges = Boolean(prefs.remindersEnabled);
      }
      if (Object.keys(updates).length > 0) {
        updates.updatedAt = serverTimestamp();
        await updateDoc(doc(db, docPath), updates);
      }
      return this.getStatus(todayIso());
    } catch (err) {
      wrapFirestoreError(
        err,
        'Cloud Firestore · water',
        'PATCH',
        'Failed to update hydration settings.',
        docPath,
        OperationType.UPDATE,
      );
    }
  },
};
