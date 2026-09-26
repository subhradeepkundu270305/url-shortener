'use strict';

/**
 * @file src/db.js
 * @description SQLite database connection and schema bootstrap.
 *
 * Exports the shared `db` instance used by all controllers.
 * `initSchema` is called once at application startup; it is idempotent
 * thanks to the `IF NOT EXISTS` guard, so restarting the server never
 * drops or overwrites existing data.
 */

const sqlite3 = require('sqlite3');
const { DB_PATH } = require('./config');

/**
 * Shared SQLite database connection.
 * The sqlite3 driver operates in asynchronous callback mode; all queries
 * use db.run, db.get, or db.all accordingly.
 *
 * @type {sqlite3.Database}
 */
const db = new sqlite3.Database(DB_PATH);

/**
 * Create the `urls` table if it does not already exist.
 *
 * Columns:
 *  - id           INTEGER  Auto-incrementing primary key.
 *  - code         TEXT     Unique short code (4–10 alphanumeric characters).
 *  - original_url TEXT     The full destination URL supplied by the user.
 *  - clicks       INTEGER  Hit counter, initialised to 0.
 *  - created_at   TEXT     ISO-8601 timestamp recorded at insertion time.
 */
/**
 * @param {function} [done] - Optional callback invoked when the DDL finishes.
 */
function initSchema(done) {
  db.run(
    'CREATE TABLE IF NOT EXISTS urls (' +
    '  id           INTEGER PRIMARY KEY AUTOINCREMENT,' +
    '  code         TEXT UNIQUE,' +
    '  original_url TEXT,' +
    '  clicks       INTEGER DEFAULT 0,' +
    '  created_at   TEXT' +
    ')',
    done || function() {}
  );
}

module.exports = { db, initSchema };
