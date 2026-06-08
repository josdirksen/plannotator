export type PlanWidth = 'compact' | 'default' | 'wide' | 'ultrawide';

const PLAN_WIDTHS: readonly PlanWidth[] = ['compact', 'default', 'wide', 'ultrawide'];
export function isPlanWidth(v: unknown): v is PlanWidth {
  return typeof v === 'string' && (PLAN_WIDTHS as readonly string[]).includes(v);
}

/** `px: null` means full width — no max-width cap (ultrawide). */
export const PLAN_WIDTH_OPTIONS: { id: PlanWidth; label: string; px: number | null; hint: string }[] = [
  { id: 'compact', label: 'Compact', px: 832, hint: 'Best for reading. Ideal line length for laptops and focused review.' },
  { id: 'default', label: 'Default', px: 1040, hint: 'Balanced. More room for code blocks without sacrificing readability.' },
  { id: 'wide', label: 'Wide', px: 1280, hint: 'For large monitors. Best with diagrams and wide code.' },
  { id: 'ultrawide', label: 'Ultrawide', px: null, hint: 'Full width — fills the entire content area. For ultrawide monitors.' },
];
