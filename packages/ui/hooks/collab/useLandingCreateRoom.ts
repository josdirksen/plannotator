import { useCallback, useRef, useState } from 'react';

export interface LandingCreateRoomSubmit {
  displayName: string;
  color: string;
  expiresInDays: 0 | 1 | 7 | 30;
}

export interface UseLandingCreateRoomOptions {
  markdown: string;
  rawHtml?: string;
}

export interface UseLandingCreateRoomReturn {
  inFlight: boolean;
  error: string;
  handleCreate: (submit: LandingCreateRoomSubmit) => Promise<void>;
  handleCancel: () => void;
}

export function useLandingCreateRoom({
  markdown,
  rawHtml,
}: UseLandingCreateRoomOptions): UseLandingCreateRoomReturn {
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setInFlight(false);
  }, []);

  const handleCreate = useCallback(async (submit: LandingCreateRoomSubmit) => {
    setInFlight(true);
    setError('');

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const { createRoom } = await import('@plannotator/shared/collab/client');
      const { bytesToBase64url } = await import('@plannotator/shared/collab');
      const { storeAdminSecret } = await import('@plannotator/ui/utils/adminSecretStorage');

      const baseUrl = window.location.origin;

      const result = await createRoom({
        baseUrl,
        expiresInDays: submit.expiresInDays,
        signal: ctrl.signal,
        initialSnapshot: {
          versionId: 'v1',
          planMarkdown: rawHtml ? '' : markdown,
          annotations: [],
          ...(rawHtml ? { contentType: 'html' as const, rawHtml } : {}),
        },
        user: {
          id: crypto.randomUUID(),
          name: submit.displayName,
          color: submit.color,
        },
      });

      if (ctrl.signal.aborted) return;

      storeAdminSecret(result.roomId, bytesToBase64url(result.adminSecret));

      try {
        await navigator.clipboard.writeText(result.joinUrl);
      } catch { /* best-effort */ }

      const appendFragment = (url: string, param: string): string =>
        `${url}${url.includes('#') ? '&' : '#'}${param}`;
      let safeUrl = result.joinUrl;
      if (submit.displayName) {
        safeUrl = appendFragment(safeUrl, `name=${encodeURIComponent(submit.displayName)}`);
      }
      if (submit.color) {
        safeUrl = appendFragment(safeUrl, `color=${encodeURIComponent(submit.color)}`);
      }

      window.location.replace(safeUrl);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      const { redactRoomSecrets } = await import('@plannotator/shared/collab');
      const msg = err instanceof Error ? err.message : String(err);
      setError(redactRoomSecrets(msg) || 'Failed to create room');
      setInFlight(false);
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
    }
  }, [markdown, rawHtml]);

  return { inFlight, error, handleCreate, handleCancel };
}
