import { Pool } from "pg";

declare global { var __pool: Pool | undefined; }

export function db(): Pool {
  if (!global.__pool) {
    global.__pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 3,
    });
  }
  return global.__pool;
}

export async function q<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const r = await db().query(text, params);
  return r.rows as T[];
}
