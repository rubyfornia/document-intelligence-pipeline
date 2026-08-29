import dotenv from "dotenv"; dotenv.config({ path: ".env.local" }); dotenv.config();
import pg from "pg"; import fs from "node:fs";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query(fs.readFileSync("db/schema.sql", "utf8"));
console.log("schema applied");
await c.end();
