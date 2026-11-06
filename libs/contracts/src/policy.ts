import { RequestReason } from './catalog';
import { MediaFacts } from './facts';
import { MediaTitles } from './media';

/**
 * Anything that validates unknown input into a `T` and throws otherwise — a zod schema
 * fits as is, without the contracts depending on zod.
 */
export type Schema<T> = { parse(input: unknown): T };

/** Who asks for the title, when the rule is evaluated for a request. */
export type PolicyRequester = {
  userRef: string;
  /** The account's profile (`adult`, `kids`…). */
  profile: string;
  reasons: RequestReason[];
};

/** Everything a rule may look at; `facts` is null when the metadata source does not know the title. */
export type PolicySubject = {
  imdbId: string;
  titles: MediaTitles;
  facts: MediaFacts | null;
  /** Null when the engine classifies the title itself (which shelf it belongs on). */
  requester: PolicyRequester | null;
};

/** What the user is told, structured so every channel renders it its own way. */
export type NoticeBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'facts'; items: { label: string; value: string }[] }
  | { type: 'links'; title: string | null; links: { label: string; url: string }[] };

export type RejectionNotice = {
  headline: string;
  blocks: NoticeBlock[];
};

/** One reason a rule refuses the title: a one-line summary for the admin, the notice for the user. */
export type PolicyMatch = {
  summary: string;
  notice: RejectionNotice;
};

/**
 * Describes one input of a rule's admin form; the engine renders it and turns the submitted
 * text into JSON before the kind's schema validates it.
 * - `list`: one value per line → string[]
 * - `links`: one `label | url` per line → { label, url }[]
 * - `number`: empty → absent
 */
export type FieldSpec = {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'list' | 'links' | 'choice';
  options?: { value: string; label: string }[];
  help?: string;
  optional?: boolean;
};

/** What a rule's list holds: people (picked through the metadata source), titles, or free text. */
export type PolicyEntryKey = 'person' | 'media' | 'text';

/** `content` rules judge the title itself; `requester` rules judge who asks (a quota…). */
export type PolicyScope = 'content' | 'requester';

/**
 * A kind of rule (credits, adult content…): the code. A concrete rule is data the engine
 * stores — a kind, its params, its entries — so admins add rules and entries without a
 * deployment. Pure and synchronous: the engine supplies everything in the subject.
 */
export interface PolicyKind<Params = unknown, Entry = unknown> {
  readonly name: string;
  /** For the admin: what the kind checks. */
  readonly description: string;
  readonly scope: PolicyScope;
  readonly params: { schema: Schema<Params>; fields: FieldSpec[] };
  readonly entries: { key: PolicyEntryKey; schema: Schema<Entry>; fields: FieldSpec[] } | null;
  /** Every reason to refuse (empty: the title passes); null when the subject lacks what the rule needs. */
  evaluate(subject: PolicySubject, rule: { params: Params; entries: Entry[] }): PolicyMatch[] | null;
}

/** The optional text every kind lets the admin add to its notice, shown first. */
export const MESSAGE_FIELD: FieldSpec = {
  name: 'message',
  label: 'Message à l’utilisateur',
  type: 'textarea',
  optional: true,
  help: 'Affiché en tête du refus, avant le détail produit par la règle.',
};

export function noticeOf(headline: string, message: string | undefined, blocks: NoticeBlock[]): RejectionNotice {
  const intro: NoticeBlock[] = message?.trim() ? [{ type: 'paragraph', text: message.trim() }] : [];
  return { headline, blocks: [...intro, ...blocks] };
}
