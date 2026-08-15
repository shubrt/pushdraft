import { loadConfig } from "../config";
import { createDatabase } from "./database";

const database = createDatabase(loadConfig());

try {
  await database.migrate();
  console.log("pushdraft database schema is current.");
} finally {
  await database.close();
}
