import pg from 'pg';

// bigint (int8) come number: gli importi in centesimi restano ben sotto 2^53.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export type Db = pg.Pool;
export type Tx = pg.PoolClient;
export type Queryable = Db | Tx;

export function createPool(connectionString: string): Db {
  return new pg.Pool({ connectionString, max: 20, statement_timeout: 10_000 });
}

export async function tx<T>(db: Db, fn: (client: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function one<T>(db: Queryable, sql: string, params: unknown[] = []): Promise<T | undefined> {
  const { rows } = await db.query(sql, params);
  return rows[0] as T | undefined;
}

export async function many<T>(db: Queryable, sql: string, params: unknown[] = []): Promise<T[]> {
  const { rows } = await db.query(sql, params);
  return rows as T[];
}
