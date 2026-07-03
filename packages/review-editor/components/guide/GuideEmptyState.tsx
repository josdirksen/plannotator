import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { AgentCapabilities } from '@plannotator/ui/types';
import type { AgentLaunchParams } from '@plannotator/ui/hooks/useAgentJobs';
import { useAgentSettings } from '@plannotator/ui/hooks/useAgentSettings';
import type { ReviewEngine } from '@plannotator/ui/hooks/useAgentSettings';
// Same catalogs AgentsTab's launch panel uses — one source of truth for both
// guide launch surfaces (this page and the sidebar's Guided Review mode).
import { TOUR_CLAUDE_MODELS, CLAUDE_EFFORT, CODEX_MODELS, CODEX_REASONING, PI_THINKING } from '@plannotator/ui/components/AgentsTab';
import { groupModelOptions, labelWithinGroup } from '@plannotator/ui/components/AgentControls';

const ENGINE_LABEL: Record<ReviewEngine, string> = {
  claude: 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  opencode: 'OpenCode',
  pi: 'Pi',
};
const GUIDE_ENGINES = Object.keys(ENGINE_LABEL) as ReviewEngine[];

// Marker-engine fallbacks until the server delivers the live catalogs on the
// capability entries (mirrors AgentsTab's fallbacks).
const CURSOR_FALLBACK = [{ value: 'auto', label: 'Auto' }];
const OPENCODE_FALLBACK = [{ value: '', label: 'Default' }];
const PI_FALLBACK = [{ value: '', label: 'Default' }];

type Option = { value: string; label: string };

/** Inline "Label: Value ▾" picker — the wireframe's compact select pill.
 *  Long catalogs (marker-engine model lists can run to hundreds) automatically
 *  gain a type-to-filter input, a wider popover, and provider group headers. */
function InlinePicker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const current = options.find((o) => o.value === value);
  const searchable = options.length > 12;

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
    : options;
  const grouped = groupModelOptions(filtered);

  const close = () => {
    setOpen(false);
    setQuery('');
  };
  const select = (v: string) => {
    onChange(v);
    close();
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        className="flex items-center gap-2 rounded-md border border-border/50 bg-background px-2.5 py-1.5 text-xs transition-colors hover:border-border"
      >
        <span className="text-muted-foreground">{label}:</span>
        <span className="max-w-[260px] truncate text-foreground">{current?.label ?? value}</span>
        <ChevronDown className={`text-muted-foreground/40 transition-transform ${open ? 'rotate-180' : ''}`} size={11} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={close} />
          <div
            className={`absolute left-0 top-full z-20 mt-1 rounded-lg border border-border/50 bg-popover shadow-xl ${
              searchable ? 'w-[340px]' : 'min-w-[140px]'
            }`}
          >
            {searchable && (
              <div className="p-1 pb-0">
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Escape') close();
                    if (e.key === 'Enter' && filtered.length > 0) select(filtered[0].value);
                  }}
                  placeholder="Type to filter…"
                  className="w-full rounded-md border border-border/40 bg-background px-2.5 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-border"
                />
              </div>
            )}
            <div className={`overflow-y-auto p-1 ${searchable ? 'max-h-80' : 'max-h-56'}`}>
              {filtered.length === 0 && (
                <div className="px-2.5 py-2 text-xs text-muted-foreground/50">No matches</div>
              )}
              {grouped.map((group) => (
                <React.Fragment key={group.label ?? '__flat'}>
                  {group.label && (
                    <div className="px-2.5 pb-0.5 pt-1.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/40">
                      {group.label}
                    </div>
                  )}
                  {group.options.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => select(o.value)}
                      className={`flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
                        value === o.value ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">{labelWithinGroup(o.label, group.label)}</span>
                    </button>
                  ))}
                </React.Fragment>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

interface GuideEmptyStateProps {
  capabilities: AgentCapabilities | null;
  launchJob: (params: AgentLaunchParams) => Promise<unknown>;
  /** Return to the normal diff workspace (closes the takeover). */
  onBack: () => void;
  /** Set when the most recent guide job failed (or was killed) rather than
   *  never having been launched — rendered as a banner above the launch
   *  controls so the failure isn't invisible and the user can adjust settings
   *  and relaunch. */
  errorNotice?: string;
}

/**
 * Guided Review's landing page — shown when there is no completed or running
 * guide job yet. A clean, roomy, Notion-like page: heading, one paragraph, a
 * quiet "Model defaults" card with inline Engine / Model / Effort pickers
 * (the same persisted guide settings AgentsTab's launch panel edits), and a
 * primary Generate button.
 */
export const GuideEmptyState: React.FC<GuideEmptyStateProps> = ({ capabilities, launchJob, onBack, errorNotice }) => {
  const {
    guideEngine,
    guideClaudeModel,
    guideClaudeEffort,
    guideCodexModel,
    guideCodexReasoning,
    cursorModel,
    opencodeModel,
    piModel,
    piThinking,
    setGuideEngine,
    setGuideClaudeModel,
    setGuideClaudeEffort,
    setGuideCodexModel,
    setGuideCodexReasoning,
    setCursorModel,
    setOpencodeModel,
    setPiModel,
    setPiThinking,
  } = useAgentSettings();

  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const providerAvailable = (id: string) =>
    capabilities?.providers.some((p) => p.id === id && p.available) ?? false;
  const guideAvailable = providerAvailable('guide');
  const availableEngines = GUIDE_ENGINES.filter(providerAvailable);
  // A persisted engine can be unavailable on this machine — fall back to the
  // first available one rather than a dead selection.
  const engine: ReviewEngine = providerAvailable(guideEngine) ? guideEngine : (availableEngines[0] ?? guideEngine);

  // Marker model catalogs are discovered server-side and delivered on the
  // capability entry; fall back to the engine-default option until then.
  const markerModels = (id: 'cursor' | 'opencode' | 'pi', fallback: Option[]): Option[] => {
    const models = capabilities?.providers.find((p) => p.id === id)?.models;
    return models && models.length > 0 ? models.map((m) => ({ value: m.id, label: m.label })) : fallback;
  };

  const modelPicker: { value: string; options: Option[]; onChange: (v: string) => void } =
    engine === 'claude'
      ? { value: guideClaudeModel, options: TOUR_CLAUDE_MODELS, onChange: setGuideClaudeModel }
      : engine === 'codex'
        ? { value: guideCodexModel, options: CODEX_MODELS, onChange: setGuideCodexModel }
        : engine === 'cursor'
          ? { value: cursorModel, options: markerModels('cursor', CURSOR_FALLBACK), onChange: setCursorModel }
          : engine === 'opencode'
            ? { value: opencodeModel, options: markerModels('opencode', OPENCODE_FALLBACK), onChange: setOpencodeModel }
            : { value: piModel, options: markerModels('pi', PI_FALLBACK), onChange: setPiModel };

  const canLaunch = guideAvailable && availableEngines.length > 0 && !launching;

  const handleGenerate = async () => {
    if (!canLaunch) return;
    setLaunching(true);
    setLaunchError(null);
    // Config shapes mirror AgentsTab's buildGuideLaunch exactly — one shape
    // per engine, so the server sees identical launches from both surfaces.
    const params: AgentLaunchParams =
      engine === 'cursor'
        ? {
            provider: 'guide',
            label: 'Guided Review',
            engine: 'cursor',
            ...(cursorModel && cursorModel.toLowerCase() !== 'auto' ? { model: cursorModel } : {}),
          }
        : engine === 'opencode'
          ? {
              provider: 'guide',
              label: 'Guided Review',
              engine: 'opencode',
              ...(opencodeModel ? { model: opencodeModel } : {}),
            }
          : engine === 'pi'
            ? {
                provider: 'guide',
                label: 'Guided Review',
                engine: 'pi',
                ...(piModel ? { model: piModel } : {}),
                thinking: piThinking,
              }
            : {
                provider: 'guide',
                label: 'Guided Review',
                engine,
                model: engine === 'claude' ? guideClaudeModel : guideCodexModel,
                ...(engine === 'claude'
                  ? { effort: guideClaudeEffort }
                  : { reasoningEffort: guideCodexReasoning }),
              };
    try {
      await launchJob(params);
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : 'Could not start the guide.');
    } finally {
      setLaunching(false);
    }
  };

  return (
    // Full-width page: this content sits in the header zone (where the guide
    // title lands once generated) rather than a centered island.
    <div className="w-full px-10 py-8">
      <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Start a guided review?</h1>
      <p className="mt-2 max-w-[72ch] text-[13px] leading-relaxed text-muted-foreground">
        An agent reads this changeset and organizes it into sections — the core of the
        implementation first, supporting changes and glue code separate — each with an
        explanation of what changed and why, next to the diffs it covers.
      </p>

      {errorNotice && (
        <div className="mt-6 w-fit max-w-[72ch] rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs leading-snug text-destructive">
          {errorNotice}
        </div>
      )}

      {!guideAvailable || availableEngines.length === 0 ? (
        <p className="mt-8 text-xs text-muted-foreground/70">
          Guided review needs an agent CLI (Claude, Codex, Cursor, OpenCode, or Pi) available on this machine.
        </p>
      ) : (
        <>
          <div className="mt-6 w-fit max-w-full rounded-lg border border-border/50 bg-card/50 px-4 py-3.5">
            <div className="mb-2.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">
              Model defaults
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <InlinePicker
                label="Engine"
                value={engine}
                options={availableEngines.map((e) => ({ value: e, label: ENGINE_LABEL[e] }))}
                onChange={(v) => setGuideEngine(v as ReviewEngine)}
              />
              <InlinePicker label="Model" {...modelPicker} />
              {engine === 'claude' && (
                <InlinePicker label="Effort" value={guideClaudeEffort} options={CLAUDE_EFFORT} onChange={setGuideClaudeEffort} />
              )}
              {engine === 'codex' && (
                <InlinePicker label="Reasoning" value={guideCodexReasoning} options={CODEX_REASONING} onChange={setGuideCodexReasoning} />
              )}
              {engine === 'pi' && (
                <InlinePicker label="Thinking" value={piThinking} options={PI_THINKING} onChange={setPiThinking} />
              )}
            </div>
            <p className="mt-2.5 text-[11px] leading-snug text-muted-foreground/60">
              Newer models with lower effort are recommended — guides generate quicker.
            </p>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!canLaunch}
              className="rounded-md bg-primary px-4 py-2 text-[12.5px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {launching ? 'Starting…' : 'Generate guide'}
            </button>
            <button
              type="button"
              onClick={onBack}
              className="rounded-md border border-border/50 px-3 py-2 text-[12.5px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
            >
              Back to diff
            </button>
          </div>
          {launchError && <p className="mt-2 text-xs leading-snug text-destructive/80">{launchError}</p>}
        </>
      )}
    </div>
  );
};
