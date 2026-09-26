'use strict';

/**
 * @file src/config.js
 * @description Centralised configuration constants for the URL Shortener.
 *
 * All magic values live here. Environment variables are read once at startup;
 * every other module imports from this file rather than reading process.env
 * directly or repeating raw literals.
 */

/** Path to the SQLite database file, relative to the working directory. */
const DB_PATH = process.env.DB_PATH || 'database.sqlite';

/**
 * TCP port the HTTP server binds to.
 * Override via the PORT environment variable for non-development deployments.
 */
const PORT = parseInt(process.env.PORT, 10) || 5000;

/**
 * Base URL prepended to every generated short link.
 * Override via BASE_URL when deploying behind a reverse proxy or custom domain.
 */
const BASE_URL = process.env.BASE_URL || ('http://localhost:' + PORT);

/** Maximum number of characters permitted in a submitted destination URL. */
const MAX_URL_LENGTH = 2048;

/** Minimum character length of a short code (custom or auto-generated). */
const CODE_MIN_LENGTH = 4;

/** Maximum character length of a short code (custom or auto-generated). */
const CODE_MAX_LENGTH = 10;

/** Number of characters in an auto-generated short code. */
const CODE_GEN_LENGTH = 6;

/**
 * Character set used when generating random short codes.
 * 62 symbols: 26 lowercase + 26 uppercase + 10 digits.
 */
const BASE62_CHARSET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

module.exports = {
  DB_PATH,
  PORT,
  BASE_URL,
  MAX_URL_LENGTH,
  CODE_MIN_LENGTH,
  CODE_MAX_LENGTH,
  CODE_GEN_LENGTH,
  BASE62_CHARSET,
};
