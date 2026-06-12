/**
 * A single frame's live document in the content layer.
 *
 * The iframe is sandboxed (`allow-scripts`, never `allow-same-origin`) and
 * fed via srcdoc, so agent HTML executes in an opaque origin — the same
 * security model as the plan editor's HtmlViewer. The wrapper div is
 * positioned imperatively by the viewport's camera loop; this component
 * deliberately never re-renders on camera changes (React.memo + ref
 * registration), which is what keeps the iframe's state alive (§6 of the
 * spec: re-parenting or remounting an iframe reloads it).
 *
 * The annotation bridge (selection → comment) is injected like HtmlViewer
 * does; the parent gates bridge messages by e.source so multiple frames
 * can't cross-talk.
 */

import React, { useMemo } from "react";
import { ANNOTATION_HIGHLIGHT_CSS, BRIDGE_SCRIPT } from "@plannotator/ui/components/html-viewer/bridge-script";

export interface FrameContentProps {
  frameId: string;
  /** Frame HTML (already fetched); null while loading. */
  html: string | null;
  /** Bumps when a new revision lands — the one legitimate iframe reload. */
  revision: number;
  registerWrapper: (frameId: string, el: HTMLDivElement | null) => void;
  registerIframe: (frameId: string, el: HTMLIFrameElement | null) => void;
  /** Whether the frame's content receives pointer events (active/focused). */
  interactive: boolean;
}

function buildSrcdoc(html: string): string {
  const injection = `<style>${ANNOTATION_HIGHLIGHT_CSS}</style><script>${BRIDGE_SCRIPT}</script>`;
  const headClose = html.indexOf("</head>");
  if (headClose !== -1) {
    return html.slice(0, headClose) + injection + html.slice(headClose);
  }
  return injection + html;
}

const FrameContentImpl: React.FC<FrameContentProps> = ({
  frameId,
  html,
  revision,
  registerWrapper,
  registerIframe,
  interactive,
}) => {
  const srcdoc = useMemo(() => (html === null ? null : buildSrcdoc(html)), [html]);

  return (
    <div
      ref={(el) => registerWrapper(frameId, el)}
      data-frame-content={frameId}
      className="absolute left-0 top-0 overflow-hidden rounded-sm bg-white"
      style={{
        transformOrigin: "0 0",
        pointerEvents: interactive ? "auto" : "none",
        // Initial placement is set by the viewport's camera loop on register.
        visibility: "hidden",
      }}
    >
      {srcdoc === null ? (
        <div className="flex h-full w-full items-center justify-center bg-muted/40 text-xs text-muted-foreground">
          Loading…
        </div>
      ) : (
        <iframe
          key={revision}
          ref={(el) => registerIframe(frameId, el)}
          srcDoc={srcdoc}
          sandbox="allow-scripts"
          title={`Frame ${frameId}`}
          className="h-full w-full border-0"
          style={{ colorScheme: "auto", display: "block" }}
        />
      )}
    </div>
  );
};

export const FrameContent = React.memo(
  FrameContentImpl,
  (prev, next) =>
    prev.frameId === next.frameId &&
    prev.html === next.html &&
    prev.revision === next.revision &&
    prev.interactive === next.interactive,
);
