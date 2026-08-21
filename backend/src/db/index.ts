import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://secondbrain:secondbrain@localhost:5432/secondbrain",
});

export const db = drizzle(pool, { schema });
