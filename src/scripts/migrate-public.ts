import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { publicDb } from "../db/index.js";

async function main() {
  await migrate(publicDb, { migrationsFolder: "./drizzle/public" });
  console.log("Public migrations complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
