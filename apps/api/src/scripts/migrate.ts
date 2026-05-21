import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { createLogger } from "../lib/logger.js";

const log = createLogger("migrate");

const url = process.env.DATABASE_URL;
if (!url) {
  log.error("DATABASE_URL is required");
  process.exit(1);
}

// Resolve the migrations folder relative to this file so the script works
// regardless of the current working directory (entrypoint runs from /app/apps/api).
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, "../drizzle/migrations");

const client = postgres(url, { max: 1 });

try {
  log.info({ migrationsFolder }, "applying migrations");
  await migrate(drizzle(client), { migrationsFolder });
  log.info("migrations applied");
} catch (err) {
  log.error({ err }, "migration failed");
  process.exitCode = 1;
} finally {
  await client.end();
}
