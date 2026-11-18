const fs = require("node:fs");
const path = require("node:path");

const databasePath = path.resolve(process.env.DATABASE_PATH || path.join(__dirname, "..", "data", "crm.db"));
if (!process.argv.includes("--yes")) {
  console.error("This removes the database and its SQLite journal files. Re-run with -- --yes to confirm.");
  process.exitCode = 1;
} else {
  for (const file of [databasePath, `${databasePath}-shm`, `${databasePath}-wal`]) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  console.log(`Removed database files at ${databasePath}. The next server start will create fresh demo data.`);
}
