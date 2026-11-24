import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User as FirebaseUser,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase/firebase';
import type { AuthResponse, AuthUser, LoginPayload, RegisterPayload, UserProfile } from '../types/api';
import { BLUEPRINT_LIMITS, BLUEPRINT_PATTERNS } from '../utils/validation';
import {
  buildInitialProfileRecord,
  DEFAULT_CALORIE_TARGET,
  DEFAULT_WATER_TARGET_ML,
  mapRtdbProfileToUserProfile,
} from './profileBuilder';
import { OperationType, wrapFirestoreError } from './firestoreErrors';

export { buildInitialProfileRecord, mapRtdbProfileToUserProfile };

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function sanitizeEmailForBlueprint(email: string | null | undefined, uid: string): string {
  const trimmed = (email || '').trim().slice(0, BLUEPRINT_LIMITS.EMAIL_MAX);
  if (trimmed.length >= 3 && BLUEPRINT_PATTERNS.EMAIL.test(trimmed)) {
    return trimmed;
  }
  return `${uid}@users.local`.slice(0, BLUEPRINT_LIMITS.EMAIL_MAX);
}

function sanitizeMemberSince(creationTime?: string): string {
  if (creationTime) {
    const parsed = new Date(creationTime);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }
  return new Date().toISOString().slice(0, 10);
}

export function getFirebaseErrorMessage(codeOrMessage: string): string {
  if (codeOrMessage.includes('auth/email-already-in-use')) {
    return 'This email address is already registered. Please sign in instead.';
  }
  if (codeOrMessage.includes('auth/invalid-email')) {
    return 'Please enter a valid email address.';
  }
  if (codeOrMessage.includes('auth/weak-password')) {
    return 'Password is too weak. Please use at least 8 characters with letters and numbers.';
  }
  if (codeOrMessage.includes('auth/wrong-password') || codeOrMessage.includes('auth/invalid-credential')) {
    return 'Invalid email or password. Please check your credentials and try again.';
  }
  if (codeOrMessage.includes('auth/user-not-found')) {
    return 'No account exists with this email address. Please register first.';
  }
  if (codeOrMessage.includes('auth/too-many-requests')) {
    return 'Too many unsuccessful attempts. Access temporarily blocked for security. Please try again later or reset password.';
  }
  if (codeOrMessage.includes('auth/operation-not-allowed')) {
    return 'Email/Password sign-in is not enabled for this Firebase project. Enable Email/Password in Firebase Console → Authentication → Sign-in method.';
  }
  if (codeOrMessage.includes('auth/unauthorized-domain')) {
    const host = typeof window !== 'undefined' ? window.location.hostname : 'this domain';
    return `This domain (${host}) is not authorized in Firebase Console → Authentication → Settings → Authorized domains.`;
  }
  if (codeOrMessage.includes('auth/network-request-failed')) {
    return 'Network connection error. Please verify your internet connection.';
  }
  return codeOrMessage;
}

function mapFirestoreDocsToUserProfile(
  uid: string,
  accountData: Record<string, unknown>,
  privateData: Record<string, unknown>,
  fbUser?: FirebaseUser | null,
): UserProfile {
  return {
    id: uid,
    fullName: String(
      accountData.fullName || fbUser?.displayName || fbUser?.email?.split('@')[0] || 'Member',
    ),
    email: String(privateData.email || fbUser?.email || ''),
    dateOfBirth: String(privateData.dateOfBirth || ''),
    phoneNumber: String(privateData.phoneNumber || ''),
    memberSince: String(accountData.memberSince || new Date().toISOString().slice(0, 10)),
    accountTier: String(accountData.accountTier || 'Firebase Cloud'),
    preferences: {
      cycleReminders:
        accountData.cycleReminders !== undefined ? Boolean(accountData.cycleReminders) : true,
      medicationAlerts:
        accountData.medicationAlerts !== undefined ? Boolean(accountData.medicationAlerts) : true,
      hydrationNudges:
        accountData.hydrationNudges !== undefined ? Boolean(accountData.hydrationNudges) : true,
      dailyCalorieTarget: clampInt(
        accountData.dailyCalorieTarget,
        BLUEPRINT_LIMITS.TARGET_MIN,
        BLUEPRINT_LIMITS.TARGET_MAX,
        DEFAULT_CALORIE_TARGET,
      ),
      dailyWaterTargetMl: clampInt(
        accountData.dailyWaterTargetMl,
        BLUEPRINT_LIMITS.TARGET_MIN,
        BLUEPRINT_LIMITS.TARGET_MAX,
        DEFAULT_WATER_TARGET_ML,
      ),
    },
  };
}

const inFlightProfileSync = new Map<string, Promise<UserProfile>>();

/**
 * Ensures `users/{uid}` and `users/{uid}/private/profile` exist in Cloud Firestore
 * for the authenticated and email-verified user. Deduplicates concurrent calls per UID
 * and never overwrites existing profile data.
 */
export function ensureUserAccountAndProfile(
  fbUser: FirebaseUser,
  preferredFullName?: string,
): Promise<UserProfile> {
  const existingPromise = inFlightProfileSync.get(fbUser.uid);
  if (existingPromise) {
    return existingPromise;
  }

  const run = syncUserAccountAndProfile(fbUser, preferredFullName).finally(() => {
    inFlightProfileSync.delete(fbUser.uid);
  });
  inFlightProfileSync.set(fbUser.uid, run);
  return run;
}

async function syncUserAccountAndProfile(
  fbUser: FirebaseUser,
  preferredFullName?: string,
): Promise<UserProfile> {
  const uid = fbUser.uid;
  const userPath = `users/${uid}`;
  const privatePath = `users/${uid}/private/profile`;
  const userDocRef = doc(db, 'users', uid);
  const privateDocRef = doc(db, 'users', uid, 'private', 'profile');

  let accountSnap;
  try {
    accountSnap = await getDoc(userDocRef);
  } catch (err) {
    wrapFirestoreError(
      err,
      'Cloud Firestore · profile',
      'GET',
      'Failed to read your user account.',
      userPath,
      OperationType.GET,
    );
  }

  let accountData: Record<string, unknown>;
  const fallbackName = (
    preferredFullName?.trim() ||
    fbUser.displayName?.trim() ||
    fbUser.email?.split('@')[0] ||
    'Member'
  ).slice(0, BLUEPRINT_LIMITS.FULL_NAME_MAX);

  if (!accountSnap.exists()) {
    const initialAccount = {
      userId: uid,
      fullName: fallbackName || 'Member',
      memberSince: sanitizeMemberSince(fbUser.metadata?.creationTime),
      accountTier: 'Firebase Cloud',
      cycleReminders: true,
      medicationAlerts: true,
      hydrationNudges: true,
      dailyCalorieTarget: DEFAULT_CALORIE_TARGET,
      dailyWaterTargetMl: DEFAULT_WATER_TARGET_ML,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    try {
      await setDoc(userDocRef, initialAccount);
      accountSnap = await getDoc(userDocRef);
      accountData = (accountSnap.data() || initialAccount) as Record<string, unknown>;
    } catch (createErr) {
      // If a concurrent session/tab created the doc first, a second setDoc hits `allow update`
      // and is rejected; try reading once before surfacing the error.
      try {
        const retrySnap = await getDoc(userDocRef);
        if (retrySnap.exists()) {
          accountData = retrySnap.data() as Record<string, unknown>;
        } else {
          wrapFirestoreError(
            createErr,
            'Cloud Firestore · profile',
            'POST',
            'Failed to initialize your user account.',
            userPath,
            OperationType.CREATE,
          );
        }
      } catch {
        wrapFirestoreError(
          createErr,
          'Cloud Firestore · profile',
          'POST',
          'Failed to initialize your user account.',
          userPath,
          OperationType.CREATE,
        );
      }
    }
  } else {
    accountData = accountSnap.data() as Record<string, unknown>;
    if (!accountData.fullName || typeof accountData.fullName !== 'string' || !accountData.fullName.trim()) {
      const nextName = fallbackName || 'Member';
      try {
        await updateDoc(userDocRef, {
          fullName: nextName,
          updatedAt: serverTimestamp(),
        });
        accountData = { ...accountData, fullName: nextName };
      } catch (err) {
        wrapFirestoreError(
          err,
          'Cloud Firestore · profile',
          'PATCH',
          'Failed to update your account display name.',
          userPath,
          OperationType.UPDATE,
        );
      }
    }
  }

  let privateSnap;
  try {
    privateSnap = await getDoc(privateDocRef);
  } catch (err) {
    wrapFirestoreError(
      err,
      'Cloud Firestore · profile',
      'GET',
      'Failed to read your private profile.',
      privatePath,
      OperationType.GET,
    );
  }

  let privateData: Record<string, unknown>;
  if (!privateSnap.exists()) {
    const initialPrivate = {
      userId: uid,
      email: sanitizeEmailForBlueprint(fbUser.email, uid),
      dateOfBirth: '',
      phoneNumber: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    try {
      await setDoc(privateDocRef, initialPrivate);
      privateSnap = await getDoc(privateDocRef);
      privateData = (privateSnap.data() || initialPrivate) as Record<string, unknown>;
    } catch (createErr) {
      try {
        const retrySnap = await getDoc(privateDocRef);
        if (retrySnap.exists()) {
          privateData = retrySnap.data() as Record<string, unknown>;
        } else {
          wrapFirestoreError(
            createErr,
            'Cloud Firestore · profile',
            'POST',
            'Failed to initialize your private profile.',
            privatePath,
            OperationType.CREATE,
          );
        }
      } catch {
        wrapFirestoreError(
          createErr,
          'Cloud Firestore · profile',
          'POST',
          'Failed to initialize your private profile.',
          privatePath,
          OperationType.CREATE,
        );
      }
    }
  } else {
    privateData = privateSnap.data() as Record<string, unknown>;
  }

  return mapFirestoreDocsToUserProfile(uid, accountData, privateData, fbUser);
}

export function mapFirebaseUserToAuthUser(
  fbUser: FirebaseUser,
  profileData?: Partial<UserProfile>,
): AuthUser {
  return {
    id: fbUser.uid,
    fullName: profileData?.fullName || fbUser.displayName || fbUser.email?.split('@')[0] || 'Member',
    email: fbUser.email || '',
    memberSince: profileData?.memberSince || new Date().toISOString().slice(0, 10),
    accountTier: profileData?.accountTier || 'Firebase Cloud',
  };
}

export const authService = {
  async register(payload: RegisterPayload): Promise<AuthResponse> {
    const { fullName, email, password } = payload;
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
    const user = cred.user;

    await updateProfile(user, { displayName: fullName.trim() });
    const profile = user.emailVerified
      ? await ensureUserAccountAndProfile(user, fullName.trim())
      : undefined;

    const token = await user.getIdToken();
    const authUser = mapFirebaseUserToAuthUser(user, profile);
    return { token, tokenType: 'Bearer', user: authUser };
  },

  async login(payload: LoginPayload): Promise<AuthResponse> {
    const { email, password } = payload;
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
    const user = cred.user;

    const profile = user.emailVerified ? await ensureUserAccountAndProfile(user) : undefined;
    const token = await user.getIdToken();
    const authUser = mapFirebaseUserToAuthUser(user, profile);

    return { token, tokenType: 'Bearer', user: authUser };
  },

  async logout(): Promise<void> {
    await signOut(auth);
  },

  async sendPasswordReset(email: string): Promise<void> {
    await sendPasswordResetEmail(auth, email.trim());
  },

  getCurrentUser(): FirebaseUser | null {
    return auth.currentUser;
  },

  onAuthChange(callback: (user: FirebaseUser | null) => void) {
    return onAuthStateChanged(auth, callback);
  },

  async getUserProfile(uid: string): Promise<UserProfile | null> {
    try {
      const accountSnap = await getDoc(doc(db, 'users', uid));
      if (!accountSnap.exists()) return null;
      const privateSnap = await getDoc(doc(db, 'users', uid, 'private', 'profile'));
      return mapFirestoreDocsToUserProfile(
        uid,
        accountSnap.data() as Record<string, unknown>,
        (privateSnap.exists() ? privateSnap.data() : {}) as Record<string, unknown>,
      );
    } catch (err) {
      wrapFirestoreError(
        err,
        'Cloud Firestore · profile',
        'GET',
        'Failed to read user profile.',
        `users/${uid}`,
        OperationType.GET,
      );
    }
  },
};
