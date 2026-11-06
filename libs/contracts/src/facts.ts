import type { MediaKind } from './metadata';

/** A person as the metadata source identifies them: `ref` is opaque and stable (e.g. `tmdb:person:287`), never a name. */
export type PersonRef = {
  ref: string;
  name: string;
};

/**
 * One credit of a person on a title. Departments and jobs use the source's English vocabulary
 * (`Acting` / `Actor`, `Directing` / `Director`, `Production` / `Executive Producer`, `Creator`…).
 * For a show, credits aggregate every episode and `episodeCount` says how many the person is in.
 */
export type MediaCredit = {
  person: PersonRef;
  department: string;
  job: string;
  character: string | null;
  /** Cast billing order, 0 first; null for crew. */
  billingOrder: number | null;
  /** Null for a movie. */
  episodeCount: number | null;
};

/** An age rating as one country's board gives it (`FR` / `12`, `US` / `PG-13`, `US` / `TV-MA`). */
export type Certification = {
  country: string;
  rating: string;
};

/**
 * What policies look at beyond the titles: who made the title and what it is. Genres and
 * keywords are English names; countries are ISO 3166-1 codes, languages ISO 639-1.
 */
export type MediaFacts = {
  kind: MediaKind;
  adult: boolean;
  year: number | null;
  /** A movie's runtime, a show's typical episode runtime. */
  runtimeMinutes: number | null;
  originalLanguage: string | null;
  originCountries: string[];
  genres: string[];
  keywords: string[];
  certifications: Certification[];
  credits: MediaCredit[];
};

/** A person found by name, to pick the right one among namesakes. */
export type PersonCandidate = PersonRef & {
  knownForDepartment: string | null;
  /** A few titles the person is known for, to tell namesakes apart. */
  knownFor: string[];
  pageUrl: string;
};
