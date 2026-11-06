import { classify, Exemption, Refusal, RuleStatus, Shelf } from '@crn-flix/policy';

import { TitledAssessment } from '@/services/database/policy';

export type RuleCounts = Record<Exclude<RuleStatus, 'passed'>, number>;

export type PolicyOverview = {
  restricted: { imdbId: string; title: string; refusals: Refusal[] }[];
  shelved: Record<string, { imdbId: string; title: string }[]>;
  /** Per rule id, how many titles it does not let through, by reason. */
  counts: Map<string, RuleCounts>;
  /** Assessed with other rules: the next passes will redo them. */
  outdated: number;
};

const byTitle = (a: { title: string }, b: { title: string }): number =>
  a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' });

function countOutcomes(assessments: TitledAssessment[]): Map<string, RuleCounts> {
  const counts = new Map<string, RuleCounts>();
  assessments.forEach((assessment) =>
    assessment.outcomes
      .filter((outcome) => outcome.status !== 'passed')
      .forEach((outcome) => {
        const current = counts.get(outcome.ruleId) ?? { refused: 0, undetermined: 0, invalid: 0 };
        counts.set(outcome.ruleId, { ...current, [outcome.status]: current[outcome.status as keyof RuleCounts] + 1 });
      }),
  );
  return counts;
}

/** Where every assessed title goes under the current rules, for the admin page (overrides come with the shelves). */
export function buildPolicyOverview(
  assessments: TitledAssessment[],
  fingerprint: string,
  shelves: Shelf[],
  globalExemptions: Map<string, Exemption[]>,
): PolicyOverview {
  const current = assessments.filter((assessment) => assessment.fingerprint === fingerprint);
  const shelved: PolicyOverview['shelved'] = Object.fromEntries(shelves.map((shelf) => [shelf.key, []]));
  const restricted: PolicyOverview['restricted'] = [];
  current.forEach(({ imdbId, title, outcomes }) => {
    const placement = classify(outcomes, shelves, globalExemptions.get(imdbId) ?? [], null);
    if (placement.kind === 'restricted') {
      restricted.push({ imdbId, title, refusals: placement.refusals });
    } else if (placement.kind === 'shelf') {
      shelved[placement.shelf]?.push({ imdbId, title });
    }
  });
  Object.values(shelved).forEach((titles) => titles.sort(byTitle));
  return {
    restricted: restricted.sort(byTitle),
    shelved,
    counts: countOutcomes(current),
    outdated: assessments.length - current.length,
  };
}
