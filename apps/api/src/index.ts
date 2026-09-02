import { createApp } from "./app";
import { seedPreviewAccount } from "./auth/repository";
import { loadConfig } from "./config";
import { createDatabase } from "./db/database";

const config = loadConfig();
const database = createDatabase(config);
await database.migrate();
if (config.previewSeed) {
  await seedPreviewAccount(database, config.previewSeed);
  console.log(`Seeded preview account ${config.previewSeed.accountId} for CLI access.`);
}

const app = createApp({ config, database }).listen(config.port);

console.log(`pushdraft listening on ${app.server?.hostname}:${app.server?.port}`);
