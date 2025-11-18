import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn(
    "[db] DATABASE_URL is not defined. Database client will not be initialized."
  );
}

const pool = connectionString ? new Pool({ connectionString }) : undefined;

export const db = pool ? drizzle(pool, { schema }) : undefined;
