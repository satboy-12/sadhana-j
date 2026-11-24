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
import type { PcosSymptomLog } from '../types/api';
import { BLUEPRINT_LIMITS, sanitizeBoundedText, sanitizeSymptomList } from '../utils/validation';
import { ensureUserAccountAndProfile } from './authService';
import { OperationType, requireAuthenticatedUser, wrapFirestoreError } from './firestoreErrors';

function toIsoString(val: unknown): string {
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (typeof val === 'string') return val;
  return '';
}

export const symptomsService = {
  async list(): Promise<PcosSymptomLog[]> {
    const user = requireAuthenticatedUser('Cloud Firestore · symptoms', 'GET');
    const colPath = `users/${user.uid}/symptoms`;
    try {
      const snap = await getDocs(query(collection(db, colPath), where('userId', '==', user.uid)));
      if (snap.empty) return [];

      const records: PcosSymptomLog[] = snap.docs.map((d) => {
        const item = d.data() || {};
        return {
          id: d.id,
          date: String(item.date || ''),
          symptoms: Array.isArray(item.symptoms) ? item.symptoms.map(String) : [],
          severity: Number(item.severity) || 1,
          painLevel: Number(item.painLevel) || 0,
          energyLevel: Number(item.energyLevel) || 3,
          observations: String(item.observations || ''),
          createdAt: toIsoString(item.createdAt),
        };
      });

      return records.sort((a, b) => b.date.localeCompare(a.date));
    } catch (err) {
      wrapFirestoreError(
        err,
        'Cloud Firestore · symptoms',
        'GET',
        'Failed to load symptom logs.',
        colPath,
        OperationType.LIST,
      );
    }
  },

  async create(payload: Omit<PcosSymptomLog, 'id'>): Promise<PcosSymptomLog> {
    const user = requireAuthenticatedUser('Cloud Firestore · symptoms', 'POST');
    const colPath = `users/${user.uid}/symptoms`;
    try {
      await ensureUserAccountAndProfile(user);
      const symptoms = sanitizeSymptomList(payload.symptoms);
      const severity = Math.max(1, Math.min(5, Math.round(Number(payload.severity) || 1)));
      const painLevel = Math.max(0, Math.min(10, Math.round(Number(payload.painLevel ?? 0))));
      const energyLevel = Math.max(1, Math.min(5, Math.round(Number(payload.energyLevel ?? 3))));
      const observations = sanitizeBoundedText(payload.observations || '', BLUEPRINT_LIMITS.NOTES_MAX);

      const docRef = await addDoc(collection(db, colPath), {
        userId: user.uid,
        date: payload.date,
        symptoms,
        severity,
        painLevel,
        energyLevel,
        observations,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      return {
        id: docRef.id,
        date: payload.date,
        symptoms,
        severity,
        painLevel,
        energyLevel,
        observations,
        createdAt: new Date().toISOString(),
      };
    } catch (err) {
      wrapFirestoreError(
        err,
        'Cloud Firestore · symptoms',
        'POST',
        'Failed to save symptom log.',
        colPath,
        OperationType.CREATE,
      );
    }
  },

  async remove(id: string): Promise<void> {
    const user = requireAuthenticatedUser('Cloud Firestore · symptoms', 'DELETE');
    const docPath = `users/${user.uid}/symptoms/${id}`;
    try {
      await deleteDoc(doc(db, docPath));
    } catch (err) {
      wrapFirestoreError(
        err,
        'Cloud Firestore · symptoms',
        'DELETE',
        'Failed to delete symptom log.',
        docPath,
        OperationType.DELETE,
      );
    }
  },
};
