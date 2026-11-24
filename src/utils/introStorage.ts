export const INTRO_COMPLETED_KEY = 'hhj_intro_completed';

export interface StorageReader {
  getItem(key: string): string | null;
}

export interface StorageWriter extends StorageReader {
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let fallbackCompletedWithoutStorage = false;

export function getSessionStorage(): StorageWriter | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function isAutostartBypass(search?: string): boolean {
  const query = search ?? (typeof window !== 'undefined' ? window.location.search : '');
  if (!query) return false;
  try {
    return new URLSearchParams(query).get('autostart') === '1';
  } catch {
    return false;
  }
}

export function hasCompletedIntro(storage: StorageReader | null = getSessionStorage()): boolean {
  if (!storage) return fallbackCompletedWithoutStorage;
  try {
    const val = storage.getItem(INTRO_COMPLETED_KEY);
    return val === 'true' || val === '1';
  } catch {
    return fallbackCompletedWithoutStorage;
  }
}

export function markIntroCompleted(storage: StorageWriter | null = getSessionStorage()): void {
  if (!storage) {
    fallbackCompletedWithoutStorage = true;
    return;
  }
  try {
    storage.setItem(INTRO_COMPLETED_KEY, 'true');
  } catch {
    fallbackCompletedWithoutStorage = true;
  }
}

export function clearIntroCompleted(storage: StorageWriter | null = getSessionStorage()): void {
  fallbackCompletedWithoutStorage = false;
  if (!storage) return;
  try {
    storage.removeItem(INTRO_COMPLETED_KEY);
  } catch {
    // Ignore storage access errors in restricted frames
  }
}

/**
 * Shows the cinematic intro only once per browser tab session (backed by sessionStorage),
 * unless ?autostart=1 is explicitly supplied for automated UI checks.
 */
export function shouldShowCinematicIntro(options: {
  autostartBypass?: boolean;
  storage?: StorageReader | null;
} = {}): boolean {
  if (options.autostartBypass) return false;
  const storage = options.storage !== undefined ? options.storage : getSessionStorage();
  return !hasCompletedIntro(storage);
}
