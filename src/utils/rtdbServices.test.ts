import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildInitialProfileRecord, mapRtdbProfileToUserProfile } from '../services/profileBuilder';
import { buildDashboardSummary } from '../services/dashboardSummaryBuilder';

describe('RTDB profile provisioning & dashboard summary builders', () => {
  it('builds a valid initial profile with non-empty fullName and default preferences', () => {
    const initial = buildInitialProfileRecord(
      {
        uid: 'client-uid-123',
        displayName: null,
        email: 'client.one@example.com',
        metadata: { creationTime: '2026-05-01T10:00:00Z' },
      },
      'Sophia Laurent',
      '2026-05-01T10:00:00.000Z',
    );

    assert.equal(initial.fullName, 'Sophia Laurent');
    assert.equal(initial.email, 'client.one@example.com');
    assert.equal(initial.memberSince, '2026-05-01');
    assert.equal(initial.preferences.dailyCalorieTarget, 2000);
    assert.equal(initial.preferences.dailyWaterTargetMl, 2500);
    assert.equal(initial.preferences.hydrationNudges, true);

    const mapped = mapRtdbProfileToUserProfile('client-uid-123', initial);
    assert.equal(mapped.id, 'client-uid-123');
    assert.equal(mapped.fullName, 'Sophia Laurent');
  });

  it('derives fallback display name from email prefix when displayName is missing', () => {
    const initial = buildInitialProfileRecord({
      uid: 'client-uid-456',
      displayName: '',
      email: 'amara.chen@example.com',
    });
    assert.equal(initial.fullName, 'amara.chen');
  });

  it('returns strictly null/empty metrics (zero fabricated values) for a brand-new empty client account', () => {
    const summary = buildDashboardSummary({
      userName: 'Sophia Laurent',
      todayIso: '2026-05-15',
      periods: [],
      symptoms: [],
      wellnessEntries: [],
      nutritionSummary: null,
      waterStatus: null,
      journalEntries: [],
    });

    assert.equal(summary.userName, 'Sophia Laurent');
    assert.equal(summary.cycleSummary.currentDay, null);
    assert.equal(summary.cycleSummary.phase, 'Uncharted');
    assert.equal(summary.cycleSummary.daysUntilNextPeriod, null);
    assert.equal(summary.cycleSummary.nextPeriodDate, null);
    assert.equal(summary.cycleSummary.averageCycleLength, null);
    assert.deepEqual(summary.cycleSummary.cycleHistory, []);

    assert.equal(summary.wellnessSummary.mood, null);
    assert.equal(summary.wellnessSummary.sleepHours, null);
    assert.equal(summary.wellnessSummary.energyLevel, null);
    assert.equal(summary.wellnessSummary.insight, null);

    assert.equal(summary.waterSummary.intakeMl, 0);
    assert.equal(summary.waterSummary.targetMl, 2500);
    assert.equal(summary.latestSymptom, null);
    assert.equal(summary.nutritionSummary.caloriesConsumed, 0);
    assert.equal(summary.nutritionSummary.antiInflammatoryScore, null);
    assert.equal(summary.nutritionSummary.sugarStatus, null);
    assert.deepEqual(summary.recentJournalEntries, []);
  });

  it('computes real cycle, wellness, hydration, and nutrition metrics when user has logged records', () => {
    const summary = buildDashboardSummary({
      userName: 'Maya Patel',
      todayIso: '2026-05-15',
      periods: [
        {
          id: 'p2',
          startDate: '2026-05-02',
          endDate: '2026-05-06',
          cycleLengthDays: 29,
          flowIntensity: 'Moderate',
          symptoms: [],
        },
        {
          id: 'p1',
          startDate: '2026-04-03',
          endDate: '2026-04-07',
          flowIntensity: 'Moderate',
          symptoms: [],
        },
      ],
      symptoms: [
        {
          id: 's1',
          date: '2026-05-14',
          symptoms: ['Fatigue'],
          severity: 2,
          painLevel: 1,
          energyLevel: 4,
          observations: 'Mild morning tiredness',
        },
      ],
      wellnessEntries: [
        {
          id: 'w1',
          date: '2026-05-15',
          mood: 'Radiant',
          sleepHours: 8,
          sleepQuality: 'Good/Restful',
          stressLevel: 2,
          notes: 'Slept peacefully',
        },
      ],
      nutritionSummary: {
        date: '2026-05-15',
        targets: { calories: 1900, proteinGrams: 75, carbsGrams: 220, fatGrams: 60, fiberGrams: 30 },
        meals: [
          {
            id: 'm1',
            date: '2026-05-15',
            mealType: 'Breakfast',
            foodName: 'Oatmeal',
            portion: '1 bowl',
            calories: 420,
            proteinGrams: 14,
            carbsGrams: 65,
            fatGrams: 9,
            fiberGrams: 8,
          },
        ],
        weeklyTotals: [],
      },
      waterStatus: {
        date: '2026-05-15',
        dailyTargetMl: 2200,
        totalIntakeMl: 1250,
        remindersEnabled: true,
        entries: [],
        weeklyHistory: [],
      },
      journalEntries: [
        {
          id: 'j1',
          title: 'Energy Check',
          content: 'Feeling steady today',
          category: 'General Reflection',
          entryDate: '2026-05-15T09:00:00Z',
        },
      ],
    });

    assert.equal(summary.cycleSummary.currentDay, 14);
    assert.equal(summary.cycleSummary.averageCycleLength, 29);
    assert.deepEqual(summary.cycleSummary.cycleHistory, [{ month: 'May', lengthDays: 29 }]);
    assert.equal(summary.wellnessSummary.mood, 'Radiant');
    assert.equal(summary.wellnessSummary.sleepHours, 8);
    assert.equal(summary.wellnessSummary.energyLevel, 'High');
    assert.equal(summary.waterSummary.intakeMl, 1250);
    assert.equal(summary.waterSummary.targetMl, 2200);
    assert.equal(summary.nutritionSummary.caloriesConsumed, 420);
    assert.equal(summary.nutritionSummary.caloriesTarget, 1900);
    assert.equal(summary.recentJournalEntries.length, 1);
  });
});
