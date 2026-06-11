import React, { useMemo } from 'react';
import {
  AtomicCodeMirrorEditor,
  type AtomicCodeMirrorEditorHandle,
} from '@atomic-editor/editor';
import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language';
import '@atomic-editor/editor/styles.css';
import './markdown-editor.css';
import { useTheme } from './ThemeProvider';

export type { AtomicCodeMirrorEditorHandle as MarkdownEditorHandle };

/* Trimmed grammar set for fenced code blocks. The singlefile build inlines every
   dynamic import (inlineDynamicImports: true), so each entry here is shipped in
   the HTML — keep this list to what plans actually contain. Unknown fence
   languages fall back to plain monospace. */
const CODE_LANGUAGES: readonly LanguageDescription[] = [
  LanguageDescription.of({
    name: 'JavaScript',
    alias: ['js', 'jsx', 'javascript'],
    extensions: ['js', 'jsx', 'mjs', 'cjs'],
    load: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true })),
  }),
  LanguageDescription.of({
    name: 'TypeScript',
    alias: ['ts', 'tsx', 'typescript'],
    extensions: ['ts', 'tsx'],
    load: () =>
      import('@codemirror/lang-javascript').then((m) =>
        m.javascript({ jsx: true, typescript: true }),
      ),
  }),
  LanguageDescription.of({
    name: 'Python',
    alias: ['py', 'python'],
    extensions: ['py'],
    load: () => import('@codemirror/lang-python').then((m) => m.python()),
  }),
  LanguageDescription.of({
    name: 'JSON',
    alias: ['json', 'jsonc'],
    extensions: ['json'],
    load: () => import('@codemirror/lang-json').then((m) => m.json()),
  }),
  LanguageDescription.of({
    name: 'YAML',
    alias: ['yml', 'yaml'],
    extensions: ['yml', 'yaml'],
    load: () => import('@codemirror/lang-yaml').then((m) => m.yaml()),
  }),
  LanguageDescription.of({
    name: 'Shell',
    alias: ['sh', 'bash', 'zsh', 'shell', 'console'],
    extensions: ['sh'],
    load: () =>
      import('@codemirror/legacy-modes/mode/shell').then(
        (m) => new LanguageSupport(StreamLanguage.define(m.shell)),
      ),
  }),
];

interface MarkdownEditorProps {
  /** Initial markdown. Read at mount only — the editor owns the text after that.
      Read the current text via editorHandleRef.current.getMarkdown(). */
  markdown: string;
  /** Identity key; change to remount with new content. */
  documentId: string;
  editorHandleRef: React.MutableRefObject<AtomicCodeMirrorEditorHandle | null>;
  onMarkdownChange?: (markdown: string) => void;
  onLinkClick?: (url: string) => void;
  /** Mirrors the Viewer card's outer maxWidth so toggling view<->edit doesn't jump. */
  maxWidth?: number | null;
  gridEnabled?: boolean;
}

export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
  markdown,
  documentId,
  editorHandleRef,
  onMarkdownChange,
  onLinkClick,
  maxWidth,
  gridEnabled,
}) => {
  const { resolvedMode } = useTheme();

  /* atomic-editor switches to its light palette via [data-theme="light"] on an
     ancestor; Plannotator themes via classes on <html>. Bridge here. */
  const dataTheme = resolvedMode === 'light' ? 'light' : undefined;

  const containerStyle = useMemo<React.CSSProperties>(
    () => ({
      ...(maxWidth === null ? {} : { maxWidth: maxWidth ?? 832 }),
      /* .atomic-cm-editor fills its parent; CM6 needs a bounded height to
         scroll. The host (App.tsx) stretches the plan-view row to the full
         remaining viewport while editing — we just fill it. */
      height: '100%',
      minHeight: '24rem',
    }),
    [maxWidth],
  );

  return (
    <div className="pn-markdown-editor relative z-50 w-full" data-theme={dataTheme} style={containerStyle}>
      <div
        className={`w-full h-full bg-card rounded-xl py-3 md:py-4 overflow-hidden ${
          gridEnabled ? 'px-5 md:px-8 lg:px-10 xl:px-12 shadow-xl border border-border/50' : ''
        }`}
      >
        <AtomicCodeMirrorEditor
          documentId={documentId}
          markdownSource={markdown}
          editorHandleRef={editorHandleRef}
          onMarkdownChange={onMarkdownChange}
          onLinkClick={onLinkClick}
          codeLanguages={CODE_LANGUAGES}
        />
      </div>
    </div>
  );
};
