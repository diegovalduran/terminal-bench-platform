import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

export type DatabaseClient = ReturnType<typeof drizzle> | undefined;

export const db: DatabaseClient = connectionString
  ? drizzle(new Pool({ connectionString }))
  : undefined;
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn(
    "[db] DATABASE_URL is not defined. Database client will not be initialized."
  );
}

const pool = connectionString ? new Pool({ connectionString }) : undefined;

export const db = pool ? drizzle(pool) : undefined;

