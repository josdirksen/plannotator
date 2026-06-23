import { afterAll, describe, expect, it, mock, spyOn } from 'bun:test';

import * as ImageThumbnail from './components/ImageThumbnail';
import * as InlineMarkdown from './components/InlineMarkdown';
import * as storage from './utils/storage';
import * as identity from './utils/identity';
import * as useFileBrowser from './hooks/useFileBrowser';
import * as useAnnotationDraft from './hooks/useAnnotationDraft';
import * as useExternalAnnotations from './hooks/useExternalAnnotations';
import * as useAIChat from './hooks/useAIChat';
import { configStore } from './config';

import type { ImageSrcResolver } from './components/ImageThumbnail';
import type { DocPreviewFetcher } from './components/InlineMarkdown';
import type { StorageBackend } from './utils/storage';
import type { IdentityProvider } from './utils/identity';
import type { FileTreeBackend } from './hooks/useFileBrowser';
import type { DraftTransport } from './hooks/useAnnotationDraft';
import type { ExternalAnnotationTransport } from './hooks/useExternalAnnotations';
import type { AITransport } from './hooks/useAIChat';

// Spy on each setter. We re-export the REAL module verbatim and override ONLY the
// setter with a spy, so other test files importing other exports stay intact
// (Bun's mock.module replacement is process-global — dropping exports would break
// sibling suites). The spies route to no-ops; we assert configure wired them.
const setImageSrcResolver = mock((_: ImageSrcResolver) => {});
const setDocPreviewFetcher = mock((_: DocPreviewFetcher) => {});
const setStorageBackend = mock((_: StorageBackend) => {});
const setIdentityProvider = mock((_: IdentityProvider) => {});
const setFileTreeBackend = mock((_: FileTreeBackend) => {});
const setDraftTransport = mock((_: DraftTransport) => {});
const setExternalAnnotationTransport = mock((_: ExternalAnnotationTransport<{ id: string; source?: string }>) => {});
const setAITransport = mock((_: AITransport) => {});

mock.module('./components/ImageThumbnail', () => ({ ...ImageThumbnail, setImageSrcResolver }));
mock.module('./components/InlineMarkdown', () => ({ ...InlineMarkdown, setDocPreviewFetcher }));
mock.module('./utils/storage', () => ({ ...storage, setStorageBackend }));
mock.module('./utils/identity', () => ({ ...identity, setIdentityProvider }));
mock.module('./hooks/useFileBrowser', () => ({ ...useFileBrowser, setFileTreeBackend }));
mock.module('./hooks/useAnnotationDraft', () => ({ ...useAnnotationDraft, setDraftTransport }));
mock.module('./hooks/useExternalAnnotations', () => ({ ...useExternalAnnotations, setExternalAnnotationTransport }));
mock.module('./hooks/useAIChat', () => ({ ...useAIChat, setAITransport }));

// configStore is shared with sibling suites — spy on the real instance methods
// (restored in afterAll) instead of replacing the ./config module.
const setServerSync = spyOn(configStore, 'setServerSync');
const loadFromBackend = spyOn(configStore, 'loadFromBackend').mockImplementation(() => {});

const { configurePlannotatorUI } = await import('./configure');

// Shape-correct fakes (only need to satisfy the front door's optional fields).
const imageSrcResolver: ImageSrcResolver = (path) => path;
const docPreviewFetcher: DocPreviewFetcher = async () => null;
const storageBackend: StorageBackend = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const identityProvider: IdentityProvider = { getIdentity: () => 'tater', isCurrentUser: () => false };
const fileTreeBackend: FileTreeBackend = {
  loadTree: async () => new Response('{}'),
  loadVaultTree: async () => new Response('{}'),
  watchTrees: () => undefined,
};
const draftTransport: DraftTransport = {
  load: async () => ({ data: null, generation: null }),
  save: async () => {},
  remove: async () => {},
};
const externalAnnotationTransport: ExternalAnnotationTransport<{ id: string; source?: string }> = {
  subscribe: () => () => {},
  getSnapshot: async () => null,
  add: async () => {},
  remove: async () => {},
  update: async () => {},
  clear: async () => {},
};
const aiTransport: AITransport = {
  session: async () => new Response(),
  query: async () => new Response(),
  abort: () => {},
  permission: () => {},
};
const serverSync = (_payload: Record<string, unknown>) => {};

afterAll(() => mock.restore());

describe('configurePlannotatorUI routing', () => {
  it('routes each provided seam to its underlying setter', () => {
    configurePlannotatorUI({
      imageSrcResolver,
      storageBackend,
      docPreviewFetcher,
      fileTreeBackend,
      identityProvider,
      draftTransport,
      externalAnnotationTransport,
      aiTransport,
      serverSync,
      loadSettingsFromBackend: true,
    });

    expect(setImageSrcResolver).toHaveBeenCalledWith(imageSrcResolver);
    expect(setDocPreviewFetcher).toHaveBeenCalledWith(docPreviewFetcher);
    expect(setStorageBackend).toHaveBeenCalledWith(storageBackend);
    expect(setIdentityProvider).toHaveBeenCalledWith(identityProvider);
    expect(setFileTreeBackend).toHaveBeenCalledWith(fileTreeBackend);
    expect(setDraftTransport).toHaveBeenCalledWith(draftTransport);
    expect(setExternalAnnotationTransport).toHaveBeenCalledWith(externalAnnotationTransport);
    expect(setAITransport).toHaveBeenCalledWith(aiTransport);
    expect(setServerSync).toHaveBeenCalledWith(serverSync);
    expect(loadFromBackend).toHaveBeenCalledTimes(1);

    // load-bearing order: storageBackend installed before loadFromBackend re-hydrates.
    expect(setStorageBackend.mock.invocationCallOrder[0]).toBeLessThan(
      loadFromBackend.mock.invocationCallOrder[0],
    );
  });

  it('skips setters for omitted fields', () => {
    [
      setImageSrcResolver, setDocPreviewFetcher, setStorageBackend, setIdentityProvider,
      setFileTreeBackend, setDraftTransport, setExternalAnnotationTransport, setAITransport,
      setServerSync, loadFromBackend,
    ].forEach((m) => m.mockClear());

    configurePlannotatorUI({ storageBackend });

    expect(setStorageBackend).toHaveBeenCalledTimes(1);
    expect(setImageSrcResolver).not.toHaveBeenCalled();
    expect(setAITransport).not.toHaveBeenCalled();
    expect(loadFromBackend).not.toHaveBeenCalled();
  });
});
