import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { db } from '../firebase/firebase';
import type {
  MealCategory,
  NutritionMealItem,
  NutritionSummaryResponse,
  NutritionTargets,
} from '../types/api';
import { BLUEPRINT_LIMITS, sanitizeBoundedText } from '../utils/validation';
import { ensureUserAccountAndProfile } from './authService';
import { OperationType, requireAuthenticatedUser, wrapFirestoreError } from './firestoreErrors';

const DEFAULT_TARGETS: NutritionTargets = {
  calories: 2000,
  proteinGrams: 75,
  carbsGrams: 220,
  fatGrams: 60,
  fiberGrams: 30,
};

const VALID_MEAL_TYPES = new Set<MealCategory>(['Breakfast', 'Lunch', 'Dinner', 'Snacks']);

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function mapDocToMeal(id: string, item: Record<string, unknown>): NutritionMealItem {
  return {
    id,
    date: String(item.date || ''),
    mealType: VALID_MEAL_TYPES.has(item.mealType as MealCategory)
      ? (item.mealType as MealCategory)
      : 'Breakfast',
    foodName: String(item.foodName || 'Meal'),
    portion: String(item.portion || '1 serving'),
    calories: Number(item.calories) || 0,
    proteinGrams: Number(item.proteinGrams) || 0,
    carbsGrams: Number(item.carbsGrams) || 0,
    fatGrams: Number(item.fatGrams) || 0,
    fiberGrams: Number(item.fiberGrams) || 0,
    loggedTime: item.loggedTime ? String(item.loggedTime) : undefined,
  };
}

export const nutritionService = {
  async list(date?: string): Promise<NutritionMealItem[]> {
    const user = requireAuthenticatedUser('Cloud Firestore · nutrition', 'GET');
    const colPath = `users/${user.uid}/nutrition`;
    try {
      const snap = await getDocs(query(collection(db, colPath), where('userId', '==', user.uid)));
      if (snap.empty) return [];

      const records = snap.docs.map((d) => mapDocToMeal(d.id, d.data() || {}));
      if (date) {
        return records.filter((r) => r.date === date);
      }
      return records.sort((a, b) => b.date.localeCompare(a.date));
    } catch (err) {
      wrapFirestoreError(
        err,
        'Cloud Firestore · nutrition',
        'GET',
        'Failed to load meal logs.',
        colPath,
        OperationType.LIST,
      );
    }
  },

  async getSummary(date?: string): Promise<NutritionSummaryResponse> {
    const user = requireAuthenticatedUser('Cloud Firestore · nutrition', 'GET');
    const targetDate = date || todayIso();
    const colPath = `users/${user.uid}/nutrition`;
    try {
      await ensureUserAccountAndProfile(user);
      const [nutritionSnap, accountSnap] = await Promise.all([
        getDocs(query(collection(db, colPath), where('userId', '==', user.uid))),
        getDoc(doc(db, 'users', user.uid)),
      ]);

      const rawTarget = accountSnap.exists()
        ? Number(accountSnap.data()?.dailyCalorieTarget)
        : DEFAULT_TARGETS.calories;
      const calTarget =
        Number.isFinite(rawTarget) && rawTarget > 0 ? rawTarget : DEFAULT_TARGETS.calories;

      const targets: NutritionTargets = {
        ...DEFAULT_TARGETS,
        calories: calTarget,
      };

      const allMeals = nutritionSnap.docs.map((d) => mapDocToMeal(d.id, d.data() || {}));
      const meals = allMeals.filter((m) => m.date === targetDate);

      const weeklyTotals: Array<{ date: string; label: string; calories: number; status: string }> = [];
      const anchor = new Date(`${targetDate}T00:00:00Z`);
      for (let i = 6; i >= 0; i -= 1) {
        const d = new Date(anchor);
        d.setUTCDate(anchor.getUTCDate() - i);
        const iso = d.toISOString().slice(0, 10);
        const label = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
        const cal = allMeals
          .filter((m) => m.date === iso)
          .reduce((acc, m) => acc + (m.calories || 0), 0);
        weeklyTotals.push({
          date: iso,
          label,
          calories: cal,
          status: cal > targets.calories ? 'Over Target' : cal > 0 ? 'On Track' : 'Unlogged',
        });
      }

      return {
        date: targetDate,
        targets,
        meals,
        weeklyTotals,
      };
    } catch (err) {
      wrapFirestoreError(
        err,
        'Cloud Firestore · nutrition',
        'GET',
        'Failed to load nutrition summary.',
        colPath,
        OperationType.LIST,
      );
    }
  },

  async create(payload: Omit<NutritionMealItem, 'id'>): Promise<NutritionMealItem> {
    const user = requireAuthenticatedUser('Cloud Firestore · nutrition', 'POST');
    const colPath = `users/${user.uid}/nutrition`;
    try {
      await ensureUserAccountAndProfile(user);
      const mealType = VALID_MEAL_TYPES.has(payload.mealType) ? payload.mealType : 'Breakfast';
      const foodName =
        sanitizeBoundedText(payload.foodName, BLUEPRINT_LIMITS.FOOD_NAME_MAX) || 'Meal';
      const portion =
        sanitizeBoundedText(payload.portion || '1 serving', BLUEPRINT_LIMITS.PORTION_MAX) ||
        '1 serving';
      const calories = Math.max(0, Math.min(10000, Number(payload.calories) || 0));
      const proteinGrams = Math.max(0, Math.min(1000, Number(payload.proteinGrams) || 0));
      const carbsGrams = Math.max(0, Math.min(1000, Number(payload.carbsGrams) || 0));
      const fatGrams = Math.max(0, Math.min(1000, Number(payload.fatGrams) || 0));
      const fiberGrams = Math.max(0, Math.min(1000, Number(payload.fiberGrams) || 0));
      const loggedTime = (
        payload.loggedTime ||
        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      ).slice(0, 40);

      const docRef = await addDoc(collection(db, colPath), {
        userId: user.uid,
        date: payload.date,
        mealType,
        foodName,
        portion,
        calories,
        proteinGrams,
        carbsGrams,
        fatGrams,
        fiberGrams,
        loggedTime,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      return {
        id: docRef.id,
        date: payload.date,
        mealType,
        foodName,
        portion,
        calories,
        proteinGrams,
        carbsGrams,
        fatGrams,
        fiberGrams,
        loggedTime,
      };
    } catch (err) {
      wrapFirestoreError(
        err,
        'Cloud Firestore · nutrition',
        'POST',
        'Failed to save meal entry.',
        colPath,
        OperationType.CREATE,
      );
    }
  },

  async createMeal(payload: Omit<NutritionMealItem, 'id'>): Promise<NutritionMealItem> {
    return this.create(payload);
  },

  async remove(id: string): Promise<void> {
    const user = requireAuthenticatedUser('Cloud Firestore · nutrition', 'DELETE');
    const docPath = `users/${user.uid}/nutrition/${id}`;
    try {
      await deleteDoc(doc(db, docPath));
    } catch (err) {
      wrapFirestoreError(
        err,
        'Cloud Firestore · nutrition',
        'DELETE',
        'Failed to delete meal entry.',
        docPath,
        OperationType.DELETE,
      );
    }
  },

  async removeMeal(id: string): Promise<void> {
    return this.remove(id);
  },
};
