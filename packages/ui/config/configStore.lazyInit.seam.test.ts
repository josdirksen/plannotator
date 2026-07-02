/**
 * Lazy-resolution contract for the configStore singleton.
 *
 * Bun evaluates a fresh module graph per test file, so the store imported here
 * has never been touched: this file can observe first-use behavior. The
 * contract under test: importing the module resolves NOTHING — a host
 * StorageBackend installed before the first settings access receives the
 * initial resolution reads and the default-seeding writes. A configured host
 * therefore never gets plannotator-* cookies written to its origin.
 */
import { describe, test, expect, afterAll } from 'bun:test';
import { setStorageBackend, resetStorageBackend, type StorageBackend } from '../utils/storage';
import { configStore } from './configStore';

describe('configStore lazy resolution', () => {
  const stored = new Map<string, string>();
  const reads: string[] = [];
  const writes: string[] = [];
  const hostBackend: StorageBackend = {
    getItem(key) {
      reads.push(key);
      return stored.get(key) ?? null;
    },
    setItem(key, value) {
      writes.push(key);
      stored.set(key, value);
    },
    removeItem(key) {
      stored.delete(key);
    },
  };

  afterAll(() => {
    resetStorageBackend();
  });

  test('backend installed before first access gets the initial resolution and seeding writes', () => {
    // Install the host backend BEFORE anything reads a setting. If the store
    // had resolved eagerly at module import, none of this traffic would reach
    // the host backend (and the seeding writes would have gone to cookies).
    setStorageBackend(hostBackend);

    const identity = configStore.get('displayName');

    expect(identity.length).toBeGreaterThan(0);
    // Resolution happened lazily, through the live (host) backend:
    expect(reads.length).toBeGreaterThan(0);
    // Missing defaults were seeded into the host backend — including the
    // generated identity — not into document.cookie:
    expect(writes).toContain('plannotator-identity');
    expect(stored.has('plannotator-identity')).toBe(true);
  });

  test('resolution runs once; later reads are served from memory', () => {
    const readsBefore = reads.length;
    const first = configStore.get('displayName');
    const second = configStore.get('displayName');
    expect(second).toBe(first);
    expect(reads.length).toBe(readsBefore);
  });
});
