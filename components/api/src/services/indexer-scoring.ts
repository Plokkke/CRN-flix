import { IndexerCandidate } from '@/modules/indexer/contract';
import { EnginePreferences } from '@/modules/indexer/preferences';

const QUALITY_WEIGHT = 10_000;
const AUTO_TRIGGERABLE_WEIGHT = 500;
const LANGUAGE_WEIGHT = 100;
const SIZE_PENALTY_PER_GB = 5;
const SIZE_PENALTY_CAP = 50;

export function scoreOf(candidate: IndexerCandidate, prefs: EnginePreferences, autoTriggerable: boolean): number {
  let score = 0;

  if (prefs.allowedQualities.length > 0) {
    const idx = prefs.allowedQualities.indexOf(candidate.quality);
    if (idx >= 0) {
      score += QUALITY_WEIGHT * (prefs.allowedQualities.length - idx);
    }
  }

  if (prefs.allowedLanguages.length > 0) {
    const idx = prefs.allowedLanguages.indexOf(candidate.language);
    if (idx >= 0) {
      score += LANGUAGE_WEIGHT * (prefs.allowedLanguages.length - idx);
    }
  }

  if (autoTriggerable) {
    score += AUTO_TRIGGERABLE_WEIGHT;
  }

  if (candidate.sizeBytes !== null) {
    const gb = candidate.sizeBytes / 1024 ** 3;
    score -= Math.min(SIZE_PENALTY_CAP, gb * SIZE_PENALTY_PER_GB);
  }

  return score;
}
