import { FieldSpec } from '@crn-flix/contracts';

/** A urlencoded form body as Express parses it. */
export type FormBody = Record<string, unknown>;

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const lines = (value: unknown): string[] =>
  text(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

function linkOf(line: string): { label: string; url: string } {
  const separator = line.lastIndexOf('|');
  if (separator < 0) {
    return { label: line, url: line };
  }
  return { label: line.slice(0, separator).trim(), url: line.slice(separator + 1).trim() };
}

function valueOf(field: FieldSpec, raw: unknown): unknown {
  switch (field.type) {
    case 'number':
      return text(raw) === '' ? undefined : Number(text(raw));
    case 'list':
      return lines(raw);
    case 'links':
      return lines(raw).map(linkOf);
    default:
      return text(raw) === '' && field.optional ? undefined : text(raw);
  }
}

/** The JSON a kind's schema validates, from the form its fields describe; empty optional fields are left out. */
export function valuesFromForm(fields: FieldSpec[], body: FormBody): Record<string, unknown> {
  return Object.fromEntries(
    fields.flatMap((field) => {
      const value = valueOf(field, body[field.name]);
      return value === undefined ? [] : [[field.name, value]];
    }),
  );
}

function textOf(field: FieldSpec, value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (field.type === 'links' && Array.isArray(value)) {
    return value.map((link: { label?: unknown; url?: unknown }) => `${link.label} | ${link.url}`).join('\n');
  }
  return Array.isArray(value) ? value.join('\n') : String(value);
}

/** What each input shows, from stored JSON. */
export function formFromValues(fields: FieldSpec[], values: unknown): Record<string, string> {
  const record = (values ?? {}) as Record<string, unknown>;
  return Object.fromEntries(fields.map((field) => [field.name, textOf(field, record[field.name])]));
}

/** The first problem of a validation error, readable in a flash message. */
export function describeValidationError(error: unknown): string {
  const issues = (error as { issues?: { path: PropertyKey[]; message: string }[] }).issues;
  if (issues?.[0]) {
    const [issue] = issues;
    return issue.path.length > 0 ? `${issue.path.join('.')} : ${issue.message}` : issue.message;
  }
  return error instanceof Error ? error.message : String(error);
}
