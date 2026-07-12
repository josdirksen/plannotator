import React, { type ReactNode } from 'react';
import { WorkerPoolContextProvider } from '@pierre/diffs/react';
import type { WorkerInitializationRenderOptions, WorkerPoolOptions } from '@pierre/diffs/react';
// Vite-inlined worker (base64 blob) — required by the single-file HTML build:
// the review UI ships as one self-contained file, so there is no separate
// asset URL to load a worker script from.
// @ts-expect-error vite ?worker&inline virtual module (no ambient types here)
import DiffsWorker from '@pierre/diffs/worker/worker.js?worker&inline';

const poolOptions: WorkerPoolOptions = {
  poolSize: Math.min(Math.max(1, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1), 3),
  totalASTLRUCacheSize: 100,
  workerFactory: () => new DiffsWorker() as Worker,
};

const highlighterOptions: WorkerInitializationRenderOptions = {
  preferredHighlighter: 'shiki-js',
  useTokenTransformer: true,
  langs: ['typescript', 'tsx', 'javascript', 'json', 'css', 'html', 'python', 'go', 'rust', 'sh', 'yaml', 'markdown'],
};

/** Production syntax-highlighting worker pool. Portable CDN viewers intentionally omit this provider. */
export function ReviewWorkerPoolProvider({ children }: { children: ReactNode }) {
  return (
    <WorkerPoolContextProvider poolOptions={poolOptions} highlighterOptions={highlighterOptions}>
      {children}
    </WorkerPoolContextProvider>
  );
}

export { useIsWorkerPoolReadyOrDisabled, useWorkerPoolThemeSync } from './workerPoolRuntime';
