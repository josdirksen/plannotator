import { storage } from '@plannotator/ui/utils/storage';

/**
 * One-time gates for the guided-review introduction. Cookie-based, mirroring
 * the review-setup gate. Two independent flags: the intro dialog (seen once,
 * never again) and the header Guide-button hint (shimmer + dot), which runs
 * until the user's first Guide click regardless of how the dialog was
 * dismissed.
 */
const INTRO_SEEN_KEY = 'plannotator-guide-intro-seen';
const HINT_ACKED_KEY = 'plannotator-guide-hint-acked';

export function needsGuideIntro(): boolean {
  return storage.getItem(INTRO_SEEN_KEY) !== 'true';
}

export function markGuideIntroSeen(): void {
  storage.setItem(INTRO_SEEN_KEY, 'true');
}

export function needsGuideHint(): boolean {
  return storage.getItem(HINT_ACKED_KEY) !== 'true';
}

export function markGuideHintSeen(): void {
  storage.setItem(HINT_ACKED_KEY, 'true');
}
