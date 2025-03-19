import { Logger } from "@nestjs/common";

export function upsertQuery(table: string, record: Record<string, unknown>): string;
export function upsertQuery(table: string, record: Record<string, unknown>, primaryKeys: string[]): string;
export function upsertQuery(schema: string, table: string, record: Record<string, unknown>): string;
export function upsertQuery(
  schema: string,
  table: string,
  record: Record<string, unknown>,
  primaryKeys: string[],
): string;

export function upsertQuery(
  ...args:
    | [string, string, Record<string, unknown>]
    | [string, string, Record<string, unknown>, string[]]
    | [string, Record<string, unknown>]
    | [string, Record<string, unknown>, string[]]
): string {
  const schema = typeof args[1] === 'string' ? (args[0] as string) : 'public';
  const table = typeof args[1] === 'string' ? (args[1] as string) : args[0];
  const record = (typeof args[1] === 'string' ? args[2] : args[1]) as Record<string, unknown>;
  const columns = Object.keys(record);
  const primaryKeys = Array.isArray(args[args.length - 1]) ? (args[args.length - 1] as string[]) : undefined;

  let conflictClause = '';
  if (primaryKeys && primaryKeys.length > 0) {
    const secondaryKeys = columns.filter((key) => !primaryKeys.includes(key));
    if (secondaryKeys.length > 0) {
      conflictClause = ` ON CONFLICT (${primaryKeys.join(',')}) DO UPDATE SET ${secondaryKeys.map((key) => `"${key}" = EXCLUDED."${key}"`).join(',')}`;
    } else {
      conflictClause = ` ON CONFLICT (${primaryKeys.join(',')}) DO NOTHING`;
    }
  }

  const query = `INSERT INTO "${schema}"."${table}" ("${columns.join('","')}")
       VALUES (${columns.map((key, index) => `$${index + 1}`).join(',')})
       ${conflictClause}
       RETURNING *`;
  return query;
}
