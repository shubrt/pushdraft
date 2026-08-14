import { createApp } from "./app";
import { loadConfig } from "./config";
import { createDatabase } from "./db/database";

const config = loadConfig();
const database = createDatabase(config);
await database.migrate();

const app = createApp({ config, database }).listen(config.port);

console.log(`pushover listening on ${app.server?.hostname}:${app.server?.port}`);
