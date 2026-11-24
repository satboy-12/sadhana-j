import {
  addDoc,
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
import type { PeriodRecord } from '../types/api';
import { calculateCycleLengths } from '../utils/healthCalculations';
import { BLUEPRINT_LIMITS, sanitizeBoundedText, sanitizeSymptomList } from '../utils/validation';
import { ensureUserAccountAndProfile } from './authService';
import { OperationType, requireAuthenticatedUser, wrapFirestoreError } from './firestoreErrors';

const VALID_FLOWS = new Set<PeriodRecord['flowIntensity']>(['Spotting', 'Light', 'Moderate', 'Heavy']);

export const periodsService = {
  async list(): Promise<PeriodRecord[]> {
    const user = requireAuthenticatedUser('Cloud Firestore · periods', 'GET');
    const colPath = `users/${user.uid}/periods`;
    try {
      const snap = await getDocs(query(collection(db, colPath), where('userId', '==', user.uid)));
      if (snap.empty) return [];

      const rawRecords: PeriodRecord[] = snap.docs.map((d) => {
        const item = d.data() || {};
        return {
          id: d.id,
          startDate: String(item.startDate || ''),
          endDate: String(item.endDate || ''),
          flowIntensity: VALID_FLOWS.has(item.flowIntensity as PeriodRecord['flowIntensity'])
            ? (item.flowIntensity as PeriodRecord['flowIntensity'])
            : 'Moderate',
          symptoms: Array.isArray(item.symptoms) ? item.symptoms.map(String) : [],
          notes: item.notes ? String(item.notes) : '',
        };
      });

      const sortedAsc = [...rawRecords].sort((a, b) => a.startDate.localeCompare(b.startDate));
      const computedLengths = calculateCycleLengths(sortedAsc);
      const lengthMap = new Map<string, number>();
      for (let i = 1; i < sortedAsc.length; i += 1) {
        if (computedLengths[i - 1] != null) {
          lengthMap.set(sortedAsc[i].id, computedLengths[i - 1]);
        }
      }

      return rawRecords
        .map((record) => ({
          ...record,
          cycleLengthDays: lengthMap.get(record.id),
        }))
        .sort((a, b) => b.startDate.localeCompare(a.startDate));
    } catch (err) {
      wrapFirestoreError(
        err,
        'Cloud Firestore · periods',
        'GET',
        'Failed to load period logs.',
        colPath,
        OperationType.LIST,
      );
    }
  },

  async create(payload: Omit<PeriodRecord, 'id'>): Promise<PeriodRecord> {
    const user = requireAuthenticatedUser('Cloud Firestore · periods', 'POST');
    const colPath = `users/${user.uid}/periods`;
    try {
      await ensureUserAccountAndProfile(user);
      const flowIntensity = VALID_FLOWS.has(payload.flowIntensity)
        ? payload.flowIntensity
        : 'Moderate';
      const symptoms = sanitizeSymptomList(payload.symptoms);
      const notes = sanitizeBoundedText(payload.notes || '', BLUEPRINT_LIMITS.NOTES_MAX);

      const docRef = await addDoc(collection(db, colPath), {
        userId: user.uid,
        startDate: payload.startDate,
        endDate: payload.endDate,
        flowIntensity,
        symptoms,
        notes,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      return {
        id: docRef.id,
        startDate: payload.startDate,
        endDate: payload.endDate,
        flowIntensity,
        symptoms,
        notes,
      };
    } catch (err) {
      wrapFirestoreError(
        err,
        'Cloud Firestore · periods',
        'POST',
        'Failed to save period log.',
        colPath,
        OperationType.CREATE,
      );
    }
  },

  async update(id: string, payload: Omit<PeriodRecord, 'id'>): Promise<PeriodRecord> {
    const user = requireAuthenticatedUser('Cloud Firestore · periods', 'PATCH');
    const docPath = `users/${user.uid}/periods/${id}`;
    try {
      const flowIntensity = VALID_FLOWS.has(payload.flowIntensity)
        ? payload.flowIntensity
        : 'Moderate';
      const symptoms = sanitizeSymptomList(payload.symptoms);
      const notes = sanitizeBoundedText(payload.notes || '', BLUEPRINT_LIMITS.NOTES_MAX);

      await updateDoc(doc(db, docPath), {
        startDate: payload.startDate,
        endDate: payload.endDate,
        flowIntensity,
        symptoms,
        notes,
        updatedAt: serverTimestamp(),
      });

      return {
        id,
        startDate: payload.startDate,
        endDate: payload.endDate,
        flowIntensity,
        symptoms,
        notes,
      };
    } catch (err) {
      wrapFirestoreError(
        err,
        'Cloud Firestore · periods',
        'PATCH',
        'Failed to update period log.',
        docPath,
        OperationType.UPDATE,
      );
    }
  },

  async remove(id: string): Promise<void> {
    const user = requireAuthenticatedUser('Cloud Firestore · periods', 'DELETE');
    const docPath = `users/${user.uid}/periods/${id}`;
    try {
      await deleteDoc(doc(db, docPath));
    } catch (err) {
      wrapFirestoreError(
        err,
        'Cloud Firestore · periods',
        'DELETE',
        'Failed to delete period log.',
        docPath,
        OperationType.DELETE,
      );
    }
  },
};
