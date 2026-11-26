import { DataSource } from 'typeorm';

/**
 * TypeORM's Postgres driver returns `[rows, affectedCount]` for UPDATE/DELETE
 * (even with RETURNING) and a plain rows array for SELECT/INSERT.
 * This normalises both shapes to rows only.
 */
export async function queryRows<T>(
  dataSource: DataSource,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const raw: unknown = await dataSource.query(sql, params);

  if (
    Array.isArray(raw) &&
    raw.length === 2 &&
    Array.isArray(raw[0]) &&
    typeof raw[1] === 'number'
  ) {
    return raw[0] as T[];
  }

  return raw as T[];
}
