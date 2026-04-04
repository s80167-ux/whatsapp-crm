const fs = require("fs");
const { Client } = require("pg");

async function main() {
  const sql = fs.readFileSync("./sql/2026-04-04_customer_status_pipeline.sql", "utf8");
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  await client.query(sql);
  await client.end();
  console.log("Migration applied");
}

main().catch(async (error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});