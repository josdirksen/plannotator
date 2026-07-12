import { useEffect, useRef, useState } from 'react';
import { useWorkerPool } from '@pierre/diffs/react';

const POOL_READY_TIMEOUT_MS = 5_000;

/** True once the configured worker pool is ready, or immediately when no provider is mounted. */
export function useIsWorkerPoolReadyOrDisabled(): boolean {
  const workerPool = useWorkerPool();
  const [isReady, setIsReady] = useState(() => workerPool?.isInitialized() ?? true);
  const isReadyRef = useRef(isReady);
  useEffect(() => {
    if (workerPool == null) return;
    const timeout = setTimeout(() => {
      if (!isReadyRef.current) {
        console.warn('Plannotator: highlight worker pool not ready after 5s — rendering without waiting.');
        isReadyRef.current = true;
        setIsReady(true);
      }
    }, POOL_READY_TIMEOUT_MS);
    const unsubscribe = workerPool.subscribeToStatChanges((stats) => {
      const ready = stats.managerState === 'initialized';
      if (ready && !isReadyRef.current) {
        isReadyRef.current = ready;
        setIsReady(ready);
      }
    });
    return () => {
      clearTimeout(timeout);
      unsubscribe();
    };
  }, [workerPool]);
  return workerPool == null ? true : isReady;
}

let lastSyncedTheme = '';

/** Keep a mounted worker pool's syntax themes in step with the review theme. */
export function useWorkerPoolThemeSync(theme: { dark: string; light: string } | undefined): void {
  const workerPool = useWorkerPool();
  useEffect(() => {
    if (workerPool == null || theme == null) return;
    const key = `${theme.dark}\0${theme.light}`;
    if (key === lastSyncedTheme) return;
    lastSyncedTheme = key;
    workerPool.setRenderOptions({ theme }).catch((err: unknown) => {
      if (lastSyncedTheme === key) lastSyncedTheme = '';
      console.warn('Plannotator: failed to sync highlight theme to worker pool', err);
    });
  }, [workerPool, theme?.dark, theme?.light]); // eslint-disable-line react-hooks/exhaustive-deps
}
