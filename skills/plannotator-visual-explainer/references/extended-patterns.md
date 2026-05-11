# Extended Patterns

Components that complement visual-explainer's toolkit. These use the same Plannotator theme tokens from `theme-override.md` and can be mixed freely with Nico's `.ve-card`, `.kpi-card`, `.pipeline` patterns.

## Timeline

Vertical timeline showing phases or sequence — without time estimates. Shows ordering and dependencies, not duration.

```html
<div class="timeline">
  <div class="timeline-item">
    <div class="timeline-label">Phase 1</div>
    <div class="timeline-dot-col">
      <div class="timeline-dot active"></div>
      <div class="timeline-line"></div>
    </div>
    <div class="timeline-content">
      <h4>Foundation</h4>
      <p>Set up the core infrastructure and initial integrations.</p>
    </div>
  </div>
  <!-- more items -->
</div>
```

```css
.timeline { display: flex; flex-direction: column; gap: 0; }

.timeline-item {
  display: grid;
  grid-template-columns: 100px 28px 1fr;
  gap: 16px;
  min-height: 80px;
}

.timeline-label {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--muted-foreground);
  text-align: right;
  padding-top: 4px;
}

.timeline-dot-col {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.timeline-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--card);
  border: 3px solid var(--primary);
  flex-shrink: 0;
}

.timeline-dot.active { background: var(--primary); }

.timeline-line {
  width: 2px;
  flex: 1;
  background: var(--border);
}

.timeline-content { padding-bottom: 24px; }

.timeline-content h4 {
  font-family: var(--font-display);
  font-size: 1rem;
  font-weight: 500;
  margin-bottom: 4px;
}

.timeline-content p {
  font-size: 0.88rem;
  color: var(--muted-foreground);
}
```

The last timeline item should hide the line: `style="background: transparent"` on the `.timeline-line`.

## Code Blocks with Syntax Highlighting

Dark-themed code panels showing key interfaces, schemas, or API signatures. Use sparingly — show the 5-10 lines that matter, not full files.

```html
<div class="code-panel">
  <span class="code-file">src/api/handler.ts</span>
  <pre><code><span class="kw">interface</span> <span class="fn">Config</span> {
  <span class="fn">port</span>: <span class="kw">number</span>;
  <span class="fn">host</span>: <span class="kw">string</span>;
}</code></pre>
</div>
```

```css
.code-panel {
  background: var(--code-bg);
  border: 1.5px solid var(--border);
  border-radius: var(--radius);
  padding: 20px 24px;
  overflow-x: auto;
  margin: 16px 0;
}

.code-file {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--muted-foreground);
  display: block;
  margin-bottom: 8px;
}

.code-panel pre {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.85rem;
  line-height: 1.55;
  color: var(--foreground);
  white-space: pre-wrap;
  word-break: break-word;
}

.code-panel .kw  { color: var(--primary); }
.code-panel .fn  { color: var(--accent); }
.code-panel .str { color: var(--success); }
.code-panel .cm  { color: var(--muted-foreground); font-style: italic; }
.code-panel .num { color: var(--warning); }
```

## Risk Table

Severity-graded risk assessment with colored badges.

```html
<div class="risk-grid">
  <div class="risk-row">
    <div class="risk-name">Database migration on live table</div>
    <div><span class="risk-badge risk-high">HIGH</span></div>
    <div class="risk-mitigation">Run during off-peak with online DDL</div>
  </div>
</div>
```

```css
.risk-grid {
  border: 1.5px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.risk-row {
  display: grid;
  grid-template-columns: 1fr auto 1.5fr;
  gap: 24px;
  padding: 16px 24px;
  align-items: center;
  border-bottom: 1px solid var(--border);
}

.risk-row:last-child { border-bottom: none; }
.risk-name { font-weight: 500; }
.risk-mitigation { font-size: 0.9rem; color: var(--muted-foreground); }

.risk-badge {
  font-family: var(--font-mono);
  font-size: 0.65rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.risk-high {
  background: color-mix(in oklab, var(--destructive) 15%, transparent);
  color: var(--destructive);
}
.risk-med {
  background: color-mix(in oklab, var(--warning) 15%, transparent);
  color: var(--warning);
}
.risk-low {
  background: color-mix(in oklab, var(--success) 15%, transparent);
  color: var(--success);
}
```

## Open Questions

Callout cards for unresolved decisions. Each names who can answer.

```html
<div class="question">
  <h3>Should we use WebSockets or SSE?</h3>
  <p>SSE is simpler but unidirectional. WebSockets add infrastructure complexity.</p>
  <span class="question-owner">Decide with: infrastructure team</span>
</div>
```

```css
.question {
  border-left: 3px solid var(--primary);
  padding: 16px 24px;
  margin: 16px 0;
  background: var(--card);
  border-radius: 0 var(--radius) var(--radius) 0;
}

.question h3 {
  font-family: var(--font-display);
  font-size: 1.05rem;
  font-weight: 500;
  margin-bottom: 4px;
}

.question p {
  font-size: 0.9rem;
  color: var(--muted-foreground);
  line-height: 1.55;
}

.question-owner {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--primary);
  font-weight: 500;
  display: block;
  margin-top: 8px;
}
```

## Inline SVG Diagrams

For simple architecture or data flow diagrams where Mermaid is overkill (under 8 nodes, simple topology). Use Mermaid for anything with complex edge routing.

Wrap in a bordered panel:

```html
<div class="svg-panel">
  <svg viewBox="0 0 720 280" xmlns="http://www.w3.org/2000/svg" style="width:100%">
    <!-- diagram content -->
  </svg>
  <span class="svg-caption">Request flow through the API gateway</span>
</div>
```

```css
.svg-panel {
  border: 1.5px solid var(--border);
  border-radius: var(--radius);
  padding: 24px;
  margin: 24px 0;
  background: var(--card);
}

.svg-caption {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--muted-foreground);
  display: block;
  margin-top: 8px;
  text-align: center;
}
```

SVG elements use theme tokens via CSS classes:

```css
/* Define inside the <svg> <style> block */
.box   { fill: var(--card); stroke: var(--border); stroke-width: 1.5; }
.box-new { fill: color-mix(in oklab, var(--primary) 8%, transparent);
           stroke: var(--primary); stroke-width: 1.5; }
.label { font-family: var(--font-sans); font-size: 13px;
         font-weight: 600; fill: var(--foreground); }
.sub   { font-family: var(--font-mono); font-size: 10.5px;
         fill: var(--muted-foreground); }
.conn  { stroke: var(--muted-foreground); stroke-width: 1.5; }
```

Arrow markers:
```svg
<defs>
  <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5"
          markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M0,0 L10,5 L0,10 z" fill="var(--muted-foreground)"/>
  </marker>
</defs>
```

## Section Headers

Numbered sections with display font headings:

```css
.section-header {
  display: flex;
  align-items: baseline;
  gap: 14px;
  margin-bottom: 24px;
  padding-bottom: 8px;
  border-bottom: 1.5px solid var(--border);
}

.section-num {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--primary);
}

.section-header h2 {
  font-family: var(--font-display);
  font-size: 1.35rem;
  font-weight: 500;
}
```

## Tag Chips

Small inline labels for categorizing items:

```css
.tag {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--muted);
  color: var(--muted-foreground);
}

.tag-highlight {
  background: color-mix(in oklab, var(--primary) 12%, transparent);
  color: var(--primary);
}
```
