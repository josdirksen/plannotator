/**
 * Seam tests: ConfigStore server-sync override + loadFromBackend re-hydration.
 *
 * Test 1 (serverSync seam): configStore.set on a server-synced key calls the
 *   installed sync fn instead of the default POST /api/config.
 *   resetServerSync() restores the default fn.
 *
 * Test 2 (loadFromBackend seam): install a fake StorageBackend with a
 *   prefetched setting, call loadFromBackend() — the store now returns the
 *   prefetched value.
 *
 * No DOM required.
 *
 * IMPORTANT: function references are captured at module-load time (top-level)
 * so they remain valid even when configure.test.ts's mock.module() replaces
 * the module exports later during test execution.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { configStore } from './index';
import * as storageModule from '../utils/storage';

// Capture real storage functions at import time (before configure.test.ts's
// mock.module('./utils/storage', ...) replaces them with no-op spies).
const setStorageBackend = storageModule.setStorageBackend;
const resetStorageBackend = storageModule.resetStorageBackend;

afterEach(() => {
  configStore.resetServerSync();
  resetStorageBackend();
});

// ---------------------------------------------------------------------------
// 1. serverSync seam
// ---------------------------------------------------------------------------
describe('configStore.setServerSync seam', () => {
  it('routes server write-back through the installed sync fn', async () => {
    const synced: Array<Record<string, unknown>> = [];
    const fakeSync = (payload: Record<string, unknown>) => {
      synced.push(payload);
    };

    configStore.setServerSync(fakeSync);

    // 'displayName' is a server-synced setting (serverKey: 'displayName')
    configStore.set('displayName', 'test-tater');

    // Server write-back is debounced at 300 ms — wait for the timer to fire.
    await new Promise<void>((resolve) => setTimeout(resolve, 350));

    expect(synced.length).toBeGreaterThanOrEqual(1);
    // The payload must contain the displayName key from toServer().
    const merged = Object.assign({}, ...synced) as Record<string, unknown>;
    expect(merged).toHaveProperty('displayName', 'test-tater');
  });

  it('resetServerSync() restores the default fn (no longer calls the fake)', async () => {
    const fakeCalled: boolean[] = [];
    configStore.setServerSync((_: Record<string, unknown>) => { fakeCalled.push(true); });
    configStore.resetServerSync();

    configStore.set('displayName', 'another-tater');
    await new Promise<void>((resolve) => setTimeout(resolve, 350));

    expect(fakeCalled).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. loadFromBackend seam
// ---------------------------------------------------------------------------
describe('configStore.loadFromBackend seam', () => {
  it('re-hydrates settings from the installed StorageBackend', () => {
    // Install a fake StorageBackend that returns a specific displayName.
    // settings.ts reads 'plannotator-identity' for the displayName setting.
    const prefetched = new Map<string, string>([
      ['plannotator-identity', 'prefetched-workspace-user'],
    ]);
    const fakeBackend = {
      getItem: (key: string) => prefetched.get(key) ?? null,
      setItem: () => {},
      removeItem: () => {},
    };

    setStorageBackend(fakeBackend);
    configStore.loadFromBackend();

    // The store should now reflect the prefetched value.
    expect(configStore.get('displayName')).toBe('prefetched-workspace-user');
  });

  it('keys absent from the backend are left at their prior value (not overwritten with undefined)', () => {
    // First set a known value for 'displayName'.
    configStore.set('displayName', 'prior-value');

    // Install a backend that returns null for every key (simulates a backend
    // that has no opinion on this setting).
    const emptyBackend = {
      getItem: (_key: string) => null,
      setItem: () => {},
      removeItem: () => {},
    };

    setStorageBackend(emptyBackend);
    configStore.loadFromBackend();

    // 'prior-value' must be preserved — loadFromBackend only overwrites when
    // fromCookie() returns a non-undefined result.
    expect(configStore.get('displayName')).toBe('prior-value');
  });
});
