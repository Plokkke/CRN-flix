import { RejectionNotice } from '@crn-flix/contracts';

import { EVERYONE, RuleOutcome } from './assess';

/** A shared shelf and the profiles that see it. Order matters: a title goes on the first one whose rules it passes. */
export type Shelf = {
  key: string;
  profiles: string[];
};

/** A granted exemption on one title: `userId` null = for everyone, `ruleId` null = from every rule. */
export type Exemption = {
  userId: string | null;
  ruleId: string | null;
};

/** The admin's choice for a title, which prevails: a shelf, or `none` (kept off the shared shelves). */
export type ShelfOverride = string | 'none' | null;

export type Placement =
  | { kind: 'shelf'; shelf: string; forced: boolean }
  /** Kept off the shared shelves by the admin (a personal download). */
  | { kind: 'held' }
  | { kind: 'restricted'; refusals: Refusal[] };

/** One reason a title is refused; `ruleId` null when the admin's choice is the reason. */
export type Refusal = {
  ruleId: string | null;
  ruleName: string;
  summary: string;
  notices: RejectionNotice[];
};

export type Admission = { admitted: true; via: 'shelf' | 'exemption' } | { admitted: false; refusals: Refusal[] };

const exempts = (exemptions: Exemption[], ruleId: string): boolean =>
  exemptions.some((exemption) => exemption.ruleId === null || exemption.ruleId === ruleId);

function refusalOf(outcome: RuleOutcome): Refusal {
  if (outcome.status === 'refused') {
    return {
      ruleId: outcome.ruleId,
      ruleName: outcome.ruleName,
      summary: outcome.matches.map((match) => match.summary).join(' ; '),
      notices: outcome.matches.map((match) => match.notice),
    };
  }
  const why = outcome.status === 'invalid' ? `règle invalide (${outcome.problem})` : 'informations manquantes';
  return {
    ruleId: outcome.ruleId,
    ruleName: outcome.ruleName,
    summary: `Impossible de vérifier : ${why}`,
    notices: [
      {
        headline: 'Impossible de vérifier ce titre',
        blocks: [
          { type: 'paragraph', text: `La règle « ${outcome.ruleName} » n’a pas pu être vérifiée pour ce titre.` },
        ],
      },
    ],
  };
}

/** Rules for everyone fail open (only a sure refusal counts): a title the source ignores stays available. */
function everyoneBlocking(outcomes: RuleOutcome[], exemptions: Exemption[]): RuleOutcome[] {
  return outcomes.filter(
    (outcome) => outcome.audience === EVERYONE && outcome.status === 'refused' && !exempts(exemptions, outcome.ruleId),
  );
}

/** Shelf rules fail closed: a shelf only takes what its rules surely admit. */
function shelfFailing(outcomes: RuleOutcome[], shelf: Shelf, exemptions: Exemption[]): RuleOutcome[] {
  return outcomes.filter(
    (outcome) => outcome.audience === shelf.key && outcome.status !== 'passed' && !exempts(exemptions, outcome.ruleId),
  );
}

/**
 * Where a title goes, from its rule outcomes and the exemptions granted for everyone.
 * The admin's choice prevails; otherwise a title refused for everyone is restricted, and
 * goes on the first shelf whose rules it passes.
 */
export function classify(
  outcomes: RuleOutcome[],
  shelves: Shelf[],
  globalExemptions: Exemption[],
  override: ShelfOverride,
): Placement {
  if (override === 'none') {
    return { kind: 'held' };
  }
  if (override !== null) {
    return { kind: 'shelf', shelf: override, forced: true };
  }
  const blocking = everyoneBlocking(outcomes, globalExemptions);
  if (blocking.length > 0) {
    return { kind: 'restricted', refusals: blocking.map(refusalOf) };
  }
  const shelf = shelves.find((candidate) => shelfFailing(outcomes, candidate, globalExemptions).length === 0);
  if (shelf) {
    return { kind: 'shelf', shelf: shelf.key, forced: false };
  }
  const last = shelves[shelves.length - 1];
  return { kind: 'restricted', refusals: last ? shelfFailing(outcomes, last, globalExemptions).map(refusalOf) : [] };
}

const ADMIN_CHOICE: Refusal = {
  ruleId: null,
  ruleName: 'Choix de l’administrateur',
  summary: 'Placé par l’administrateur sur une étagère que ce profil ne voit pas',
  notices: [
    {
      headline: 'Ce titre n’est pas proposé à votre profil',
      blocks: [{ type: 'paragraph', text: 'L’administrateur l’a placé sur une étagère que votre profil ne voit pas.' }],
    },
  ],
};

/**
 * Whether a requester gets the title: it must pass the rules for everyone and land on a shelf
 * their profile sees, each failing rule possibly lifted by one of their exemptions (granted to
 * them or to everyone). A `none` override does not hold a request back: an admitted request lifts it.
 */
export function admit(
  outcomes: RuleOutcome[],
  shelves: Shelf[],
  profile: string,
  exemptions: Exemption[],
  override: ShelfOverride,
): Admission {
  const visible = shelves.filter((shelf) => shelf.profiles.includes(profile));
  if (override !== null && override !== 'none' && visible.some((shelf) => shelf.key === override)) {
    return { admitted: true, via: 'shelf' };
  }
  const globals = exemptions.filter((exemption) => exemption.userId === null);
  const failing = [
    ...everyoneBlocking(outcomes, exemptions),
    ...(visible.some((shelf) => shelfFailing(outcomes, shelf, exemptions).length === 0)
      ? []
      : visible.slice(0, 1).flatMap((shelf) => shelfFailing(outcomes, shelf, exemptions))),
  ];
  if (failing.length > 0) {
    return { admitted: false, refusals: failing.map(refusalOf) };
  }
  if (override !== null && override !== 'none') {
    const personal = exemptions.some((exemption) => exemption.userId !== null);
    return personal ? { admitted: true, via: 'exemption' } : { admitted: false, refusals: [ADMIN_CHOICE] };
  }
  const withoutPersonal = classify(outcomes, shelves, globals, null);
  const onVisibleShelf =
    withoutPersonal.kind === 'shelf' && visible.some((shelf) => shelf.key === withoutPersonal.shelf);
  return { admitted: true, via: onVisibleShelf ? 'shelf' : 'exemption' };
}
