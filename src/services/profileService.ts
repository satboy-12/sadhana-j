import { deleteUser, updateProfile } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase/firebase';
import type { UserProfile } from '../types/api';
import { BLUEPRINT_LIMITS, BLUEPRINT_PATTERNS } from '../utils/validation';
import { ensureUserAccountAndProfile } from './authService';
import { DEFAULT_CALORIE_TARGET, DEFAULT_WATER_TARGET_ML } from './profileBuilder';
import { OperationType, requireAuthenticatedUser, wrapFirestoreError } from './firestoreErrors';

const SUBCOLLECTIONS = ['periods', 'symptoms', 'wellness', 'nutrition', 'water', 'journal'] as const;

export const profileService = {
  async get(): Promise<UserProfile> {
    const user = requireAuthenticatedUser('Cloud Firestore · profile', 'GET');
    try {
      return await ensureUserAccountAndProfile(user);
    } catch (err) {
      wrapFirestoreError(
        err,
        'Cloud Firestore · profile',
        'GET',
        'Failed to load your profile.',
        `users/${user.uid}`,
        OperationType.GET,
      );
    }
  },

  async update(payload: Partial<UserProfile>): Promise<UserProfile> {
    const user = requireAuthenticatedUser('Cloud Firestore · profile', 'PATCH');
    try {
      const existing = await ensureUserAccountAndProfile(user);
      const userDocRef = doc(db, 'users', user.uid);
      const privateDocRef = doc(db, 'users', user.uid, 'private', 'profile');

      const accountUpdates: Record<string, unknown> = {};
      if (payload.fullName !== undefined && payload.fullName.trim()) {
        const cleanName = payload.fullName.trim().slice(0, BLUEPRINT_LIMITS.FULL_NAME_MAX);
        accountUpdates.fullName = cleanName;
        await updateProfile(user, { displayName: cleanName }).catch(() => {});
      }
      if (payload.preferences) {
        const currentPrefs = existing.preferences;
        accountUpdates.cycleReminders =
          payload.preferences.cycleReminders !== undefined
            ? Boolean(payload.preferences.cycleReminders)
            : Boolean(currentPrefs.cycleReminders);
        accountUpdates.medicationAlerts =
          payload.preferences.medicationAlerts !== undefined
            ? Boolean(payload.preferences.medicationAlerts)
            : Boolean(currentPrefs.medicationAlerts);
        accountUpdates.hydrationNudges =
          payload.preferences.hydrationNudges !== undefined
            ? Boolean(payload.preferences.hydrationNudges)
            : Boolean(currentPrefs.hydrationNudges);
        accountUpdates.dailyCalorieTarget =
          payload.preferences.dailyCalorieTarget !== undefined
            ? Math.max(
                BLUEPRINT_LIMITS.TARGET_MIN,
                Math.min(BLUEPRINT_LIMITS.TARGET_MAX, Math.round(Number(payload.preferences.dailyCalorieTarget))),
              )
            : Number(currentPrefs.dailyCalorieTarget ?? DEFAULT_CALORIE_TARGET);
        accountUpdates.dailyWaterTargetMl =
          payload.preferences.dailyWaterTargetMl !== undefined
            ? Math.max(
                BLUEPRINT_LIMITS.TARGET_MIN,
                Math.min(BLUEPRINT_LIMITS.TARGET_MAX, Math.round(Number(payload.preferences.dailyWaterTargetMl))),
              )
            : Number(currentPrefs.dailyWaterTargetMl ?? DEFAULT_WATER_TARGET_ML);
      }

      if (Object.keys(accountUpdates).length > 0) {
        accountUpdates.updatedAt = serverTimestamp();
        await updateDoc(userDocRef, accountUpdates);
      }

      const privateUpdates: Record<string, unknown> = {};
      if (payload.email !== undefined && payload.email.trim()) {
        const cleanEmail = payload.email.trim().slice(0, BLUEPRINT_LIMITS.EMAIL_MAX);
        if (BLUEPRINT_PATTERNS.EMAIL.test(cleanEmail)) {
          privateUpdates.email = cleanEmail;
        }
      }
      if (payload.dateOfBirth !== undefined) {
        const cleanDob = payload.dateOfBirth.trim().slice(0, BLUEPRINT_LIMITS.DATE_LEN);
        if (cleanDob === '' || BLUEPRINT_PATTERNS.ISO_DATE.test(cleanDob)) {
          privateUpdates.dateOfBirth = cleanDob;
        }
      }
      if (payload.phoneNumber !== undefined) {
        privateUpdates.phoneNumber = payload.phoneNumber.trim().slice(0, BLUEPRINT_LIMITS.PHONE_MAX);
      }

      if (Object.keys(privateUpdates).length > 0) {
        privateUpdates.updatedAt = serverTimestamp();
        await updateDoc(privateDocRef, privateUpdates);
      }

      return this.get();
    } catch (err) {
      wrapFirestoreError(
        err,
        'Cloud Firestore · profile',
        'PATCH',
        'Failed to save profile changes.',
        `users/${user.uid}`,
        OperationType.UPDATE,
      );
    }
  },

  async deleteAccount(): Promise<void> {
    const user = requireAuthenticatedUser('Cloud Firestore · profile', 'DELETE');
    try {
      for (const sub of SUBCOLLECTIONS) {
        const snap = await getDocs(
          query(collection(db, 'users', user.uid, sub), where('userId', '==', user.uid)),
        );
        await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
      }
      await deleteDoc(doc(db, 'users', user.uid, 'private', 'profile')).catch(() => {});
      await deleteDoc(doc(db, 'users', user.uid));
      await deleteUser(user);
    } catch (err) {
      wrapFirestoreError(
        err,
        'Cloud Firestore · profile',
        'DELETE',
        'Failed to delete account.',
        `users/${user.uid}`,
        OperationType.DELETE,
      );
    }
  },
};
