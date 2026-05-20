import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL ?? "postgresql://postgres:dev@localhost:5432/contritas";

const client = postgres(connectionString);

export const db = drizzle(client, { schema });

export { schema };

export async function closeDb(): Promise<void> {
  await client.end();
}
