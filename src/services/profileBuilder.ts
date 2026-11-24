import type { UserProfile } from '../types/api';

export const DEFAULT_CALORIE_TARGET = 2000;
export const DEFAULT_WATER_TARGET_ML = 2500;

export interface MinimalAuthUserInfo {
  uid: string;
  displayName?: string | null;
  email?: string | null;
  metadata?: {
    creationTime?: string;
  };
}

export function buildInitialProfileRecord(
  fbUser: MinimalAuthUserInfo,
  preferredFullName?: string,
  nowIso = new Date().toISOString(),
) {
  const email = (fbUser.email || '').trim().slice(0, 254);
  const derivedName =
    preferredFullName?.trim() ||
    fbUser.displayName?.trim() ||
    (email ? email.split('@')[0] : '') ||
    'Member';
  const fullName = derivedName.slice(0, 150);
  const memberSince = fbUser.metadata?.creationTime
    ? new Date(fbUser.metadata.creationTime).toISOString().slice(0, 10)
    : nowIso.slice(0, 10);

  return {
    fullName,
    email,
    dateOfBirth: '',
    phoneNumber: '',
    memberSince,
    accountTier: 'Firebase Cloud',
    createdAt: nowIso,
    updatedAt: nowIso,
    preferences: {
      cycleReminders: true,
      medicationAlerts: true,
      hydrationNudges: true,
      dailyCalorieTarget: DEFAULT_CALORIE_TARGET,
      dailyWaterTargetMl: DEFAULT_WATER_TARGET_ML,
    },
  };
}

export function mapRtdbProfileToUserProfile(
  uid: string,
  data: Record<string, unknown>,
  fbUser?: MinimalAuthUserInfo | null,
): UserProfile {
  const rawPrefs = (data.preferences && typeof data.preferences === 'object'
    ? data.preferences
    : {}) as Record<string, unknown>;

  return {
    id: uid,
    fullName: String(data.fullName || fbUser?.displayName || fbUser?.email?.split('@')[0] || 'Member'),
    email: String(data.email || fbUser?.email || ''),
    dateOfBirth: String(data.dateOfBirth || ''),
    phoneNumber: String(data.phoneNumber || ''),
    memberSince: String(data.memberSince || new Date().toISOString().slice(0, 10)),
    accountTier: String(data.accountTier || 'Firebase Cloud'),
    twoFactorEnabled: Boolean(data.twoFactorEnabled || false),
    passwordLastChanged: data.passwordLastChanged ? String(data.passwordLastChanged) : undefined,
    preferences: {
      cycleReminders: rawPrefs.cycleReminders !== undefined ? Boolean(rawPrefs.cycleReminders) : true,
      medicationAlerts: rawPrefs.medicationAlerts !== undefined ? Boolean(rawPrefs.medicationAlerts) : true,
      hydrationNudges: rawPrefs.hydrationNudges !== undefined ? Boolean(rawPrefs.hydrationNudges) : true,
      dailyCalorieTarget: Number(rawPrefs.dailyCalorieTarget ?? DEFAULT_CALORIE_TARGET),
      dailyWaterTargetMl: Number(rawPrefs.dailyWaterTargetMl ?? DEFAULT_WATER_TARGET_ML),
    },
  };
}
