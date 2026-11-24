import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearIntroCompleted,
  hasCompletedIntro,
  INTRO_COMPLETED_KEY,
  isAutostartBypass,
  markIntroCompleted,
  shouldShowCinematicIntro,
  type StorageWriter,
} from './introStorage';

function createMemorySessionStorage(): StorageWriter {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

test('new tab session shows intro initially, does not mark completed prematurely, and suppresses after finish/refresh', () => {
  const tabSession = createMemorySessionStorage();

  // First visit in new session: intro displays, nothing persisted yet
  assert.equal(shouldShowCinematicIntro({ storage: tabSession }), true);
  assert.equal(hasCompletedIntro(tabSession), false);
  assert.equal(tabSession.getItem(INTRO_COMPLETED_KEY), null);

  // Strict Mode / re-render before completion still does not persist completion
  assert.equal(shouldShowCinematicIntro({ storage: tabSession }), true);

  // Only after animation completes is sessionStorage marked
  markIntroCompleted(tabSession);
  assert.equal(tabSession.getItem(INTRO_COMPLETED_KEY), 'true');
  assert.equal(hasCompletedIntro(tabSession), true);

  // Refreshing or navigating routes in the same session does not replay intro
  assert.equal(shouldShowCinematicIntro({ storage: tabSession }), false);
});

test('opening a new tab or new browser session has isolated empty sessionStorage and shows intro again', () => {
  const firstTab = createMemorySessionStorage();
  markIntroCompleted(firstTab);
  assert.equal(shouldShowCinematicIntro({ storage: firstTab }), false);

  const secondTab = createMemorySessionStorage();
  assert.equal(shouldShowCinematicIntro({ storage: secondTab }), true);

  clearIntroCompleted(firstTab);
  assert.equal(shouldShowCinematicIntro({ storage: firstTab }), true);
});

test('autostartBypass skips intro without marking session completed', () => {
  const tabSession = createMemorySessionStorage();
  assert.equal(isAutostartBypass('?autostart=1'), true);
  assert.equal(isAutostartBypass('?foo=bar'), false);
  assert.equal(shouldShowCinematicIntro({ autostartBypass: true, storage: tabSession }), false);
  assert.equal(tabSession.getItem(INTRO_COMPLETED_KEY), null);
});
