// Fails when prisma/schema.prisma and prisma/migrations disagree, i.e. someone
// edited the schema without generating a migration (or the reverse).
import { spawnSync } from "node:child_process";
import path from "node:path";

try {
  process.loadEnvFile(".env");
} catch {
  /* CI sets env directly */
}

const shadow = process.env.SHADOW_DATABASE_URL;
if (!shadow) {
  console.error("SHADOW_DATABASE_URL is required for the migration check.");
  process.exit(1);
}

const prismaCli = path.resolve("node_modules/prisma/build/index.js");
const { status } = spawnSync(
  process.execPath,
  [
    prismaCli,
    "migrate",
    "diff",
    "--from-migrations",
    "prisma/migrations",
    "--to-schema-datamodel",
    "prisma/schema.prisma",
    "--shadow-database-url",
    shadow,
    "--exit-code",
  ],
  { stdio: "inherit" },
);

if (status === 0) {
  console.log("Migrations match schema.prisma.");
} else if (status === 2) {
  console.error("Drift: schema.prisma has changes that are not in a migration. Run `npm run db:migrate`.");
}
process.exit(status ?? 1);
