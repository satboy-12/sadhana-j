import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase/firebase';
import type { JournalCategory, JournalEntry } from '../types/api';
import { BLUEPRINT_LIMITS, sanitizeBoundedText } from '../utils/validation';
import { ensureUserAccountAndProfile } from './authService';
import { OperationType, requireAuthenticatedUser, wrapFirestoreError } from './firestoreErrors';

const VALID_CATEGORIES = new Set<JournalCategory>([
  'General Reflection',
  'PCOS Symptom Log',
  'Cycle Tracking',
  'Nutrition & Diet',
  'Mental Wellness',
]);

function toIsoString(val: unknown): string | undefined {
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (typeof val === 'string') return val;
  return undefined;
}

export const journalService = {
  async list(searchQuery?: string): Promise<JournalEntry[]> {
    const user = requireAuthenticatedUser('Cloud Firestore · journal', 'GET');
    const colPath = `users/${user.uid}/journal`;
    try {
      const snap = await getDocs(query(collection(db, colPath), where('userId', '==', user.uid)));
      if (snap.empty) return [];

      const records: JournalEntry[] = snap.docs.map((d) => {
        const item = d.data() || {};
        const cat = VALID_CATEGORIES.has(item.category as JournalCategory)
          ? (item.category as JournalCategory)
          : 'General Reflection';
        return {
          id: d.id,
          title: String(item.title || 'Untitled Entry'),
          content: String(item.content || ''),
          category: cat,
          entryDate: String(item.entryDate || new Date().toISOString()),
          updatedAt: toIsoString(item.updatedAt) || toIsoString(item.createdAt),
        };
      });

      const sorted = records.sort((a, b) => b.entryDate.localeCompare(a.entryDate));
      if (!searchQuery?.trim()) return sorted;

      const q = searchQuery.trim().toLowerCase();
      return sorted.filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.content.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q),
      );
    } catch (err) {
      wrapFirestoreError(
        err,
        'Cloud Firestore · journal',
        'GET',
        'Failed to load journal entries.',
        colPath,
        OperationType.LIST,
      );
    }
  },

  async create(payload: Omit<JournalEntry, 'id'>): Promise<JournalEntry> {
    const user = requireAuthenticatedUser('Cloud Firestore · journal', 'POST');
    const colPath = `users/${user.uid}/journal`;
    try {
      await ensureUserAccountAndProfile(user);
      const title =
        sanitizeBoundedText(payload.title || 'Untitled Entry', BLUEPRINT_LIMITS.TITLE_MAX) ||
        'Untitled Entry';
      const content =
        sanitizeBoundedText(payload.content || '', BLUEPRINT_LIMITS.CONTENT_MAX) || ' ';
      const category = VALID_CATEGORIES.has(payload.category)
        ? payload.category
        : 'General Reflection';
      const entryDate = (payload.entryDate || new Date().toISOString()).slice(
        0,
        BLUEPRINT_LIMITS.DATETIME_MAX,
      );

      const docRef = await addDoc(collection(db, colPath), {
        userId: user.uid,
        title,
        content,
        category,
        entryDate,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      return {
        id: docRef.id,
        title,
        content,
        category,
        entryDate,
        updatedAt: new Date().toISOString(),
      };
    } catch (err) {
      wrapFirestoreError(
        err,
        'Cloud Firestore · journal',
        'POST',
        'Failed to create journal entry.',
        colPath,
        OperationType.CREATE,
      );
    }
  },

  async update(id: string, payload: Omit<JournalEntry, 'id'>): Promise<JournalEntry> {
    const user = requireAuthenticatedUser('Cloud Firestore · journal', 'PATCH');
    const docPath = `users/${user.uid}/journal/${id}`;
    try {
      const title =
        sanitizeBoundedText(payload.title || 'Untitled Entry', BLUEPRINT_LIMITS.TITLE_MAX) ||
        'Untitled Entry';
      const content =
        sanitizeBoundedText(payload.content || '', BLUEPRINT_LIMITS.CONTENT_MAX) || ' ';
      const category = VALID_CATEGORIES.has(payload.category)
        ? payload.category
        : 'General Reflection';
      const entryDate = (payload.entryDate || new Date().toISOString()).slice(
        0,
        BLUEPRINT_LIMITS.DATETIME_MAX,
      );

      await updateDoc(doc(db, docPath), {
        title,
        content,
        category,
        entryDate,
        updatedAt: serverTimestamp(),
      });

      return {
        id,
        title,
        content,
        category,
        entryDate,
        updatedAt: new Date().toISOString(),
      };
    } catch (err) {
      wrapFirestoreError(
        err,
        'Cloud Firestore · journal',
        'PATCH',
        'Failed to update journal entry.',
        docPath,
        OperationType.UPDATE,
      );
    }
  },

  async remove(id: string): Promise<void> {
    const user = requireAuthenticatedUser('Cloud Firestore · journal', 'DELETE');
    const docPath = `users/${user.uid}/journal/${id}`;
    try {
      await deleteDoc(doc(db, docPath));
    } catch (err) {
      wrapFirestoreError(
        err,
        'Cloud Firestore · journal',
        'DELETE',
        'Failed to delete journal entry.',
        docPath,
        OperationType.DELETE,
      );
    }
  },
};
