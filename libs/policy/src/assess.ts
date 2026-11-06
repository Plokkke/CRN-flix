import { PolicyKind, PolicyMatch, PolicySubject } from '@crn-flix/contracts';

/** A rule for everyone: what it refuses is refused on every shelf. Any other audience is a shelf key. */
export const EVERYONE = 'everyone';

/** A concrete rule as the engine stores it: params and entries are validated by the kind's schemas. */
export type PolicyRuleRecord = {
  id: string;
  name: string;
  kind: string;
  audience: string;
  params: unknown;
  entries: unknown[];
};

/** `invalid`: the kind is unknown or the stored params / entries no longer pass its schemas. */
export type RuleStatus = 'passed' | 'refused' | 'undetermined' | 'invalid';

export type RuleOutcome = {
  ruleId: string;
  ruleName: string;
  audience: string;
  status: RuleStatus;
  matches: PolicyMatch[];
  /** Why the rule is invalid. */
  problem: string | null;
};

export type PolicyKinds = ReadonlyMap<string, PolicyKind>;

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function outcome(
  rule: PolicyRuleRecord,
  status: RuleStatus,
  matches: PolicyMatch[],
  problem: string | null,
): RuleOutcome {
  return { ruleId: rule.id, ruleName: rule.name, audience: rule.audience, status, matches, problem };
}

export function assessRule(kinds: PolicyKinds, rule: PolicyRuleRecord, subject: PolicySubject): RuleOutcome {
  const kind = kinds.get(rule.kind);
  if (!kind) {
    return outcome(rule, 'invalid', [], `Type de règle inconnu : ${rule.kind}`);
  }
  if (kind.scope !== 'content') {
    return outcome(rule, 'invalid', [], `Portée « ${kind.scope} » pas encore prise en charge`);
  }
  let parsed: { params: unknown; entries: unknown[] };
  try {
    parsed = {
      params: kind.params.schema.parse(rule.params),
      entries: kind.entries ? rule.entries.map((entry) => kind.entries!.schema.parse(entry)) : [],
    };
  } catch (error) {
    return outcome(rule, 'invalid', [], `Paramètres invalides : ${describeError(error)}`);
  }
  const matches = kind.evaluate(subject, parsed);
  if (matches === null) {
    return outcome(rule, 'undetermined', [], null);
  }
  return outcome(rule, matches.length > 0 ? 'refused' : 'passed', matches, null);
}

/** Every enabled rule against one title, judged on its content alone. */
export function assess(kinds: PolicyKinds, rules: PolicyRuleRecord[], subject: PolicySubject): RuleOutcome[] {
  return rules.map((rule) => assessRule(kinds, rule, subject));
}
