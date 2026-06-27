import { useCallback, useRef } from 'react';
import {
  useAIChat as useSharedAIChat,
  type AIChatEntry,
  type AskAIParams,
  type PendingPermission,
} from '@plannotator/ui/hooks/useAIChat';
export type { AIChatEntry, PendingPermission };

interface Viewing {
  scope: 'all' | 'file';
  filePath?: string;
}

interface UseAIChatOptions {
  patch: string;
  /** VCS diff type so the agent can inspect changes with git instead of a paste. */
  diffType?: string;
  /** Base branch/ref the diff is computed against. */
  base?: string | null;
  /** What the user is currently viewing (read fresh on each question). */
  viewing?: Viewing;
  providerId?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
}

export function useAIChat({
  patch,
  diffType,
  base,
  viewing,
  providerId,
  model,
  reasoningEffort,
}: UseAIChatOptions) {
  const chat = useSharedAIChat({
    context: {
      mode: 'code-review',
      review: { patch, diffType, base: base ?? undefined },
    },
    providerId,
    model,
    reasoningEffort,
  });

  // View state changes mid-session; the session context is baked once. Read the
  // latest view via a ref and attach it to every question.
  const viewingRef = useRef(viewing);
  viewingRef.current = viewing;

  const ask = useCallback(
    (params: AskAIParams) =>
      chat.ask({ viewing: viewingRef.current, ...params }),
    [chat],
  );

  return { ...chat, ask };
}
