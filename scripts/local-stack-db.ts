/**
 * The local stack's database helper (P120): creates a database if it is
 * absent, or drops it. Node's `pg` rather than `psql`, so the runbook needs
 * nothing a workspace install does not already bring.
 *
 *   tsx scripts/local-stack-db.ts ensure <admin-url> <database>
 *   tsx scripts/local-stack-db.ts drop   <admin-url> <database>
 *
 * The admin URL is used only to connect to the server's maintenance database;
 * it is never printed.
 */

import pg from "pg";

const [command, adminUrl, database] = process.argv.slice(2);
if ((command !== "ensure" && command !== "drop") || adminUrl === undefined || database === undefined) {
  process.stderr.write("usage: local-stack-db.ts ensure|drop <admin-url> <database>\n");
  process.exit(2);
}
if (!/^[a-z][a-z0-9_]{0,62}$/.test(database)) {
  process.stderr.write("the database name must be lower-case letters, digits and underscores\n");
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: adminUrl });
try {
  if (command === "ensure") {
    const exists = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
    if (exists.rowCount === 0) await pool.query(`CREATE DATABASE ${database}`);
    process.stdout.write(`${database}: ${exists.rowCount === 0 ? "created" : "present"}\n`);
  } else {
    await pool.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    process.stdout.write(`${database}: dropped\n`);
  }
} finally {
  await pool.end();
}
