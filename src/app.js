'use strict';

/**
 * @file src/app.js
 * @description Express application factory.
 *
 * Creates and configures the Express app — middleware, schema bootstrap, and
 * routes — but does NOT call app.listen(). Keeping listen out of this module
 * makes the app importable by the test suite, which can bind to port 0
 * (OS-assigned ephemeral port) and close cleanly after each test run.
 */

const express = require('express');
const { initSchema } = require('./db');
const router = require('./routes/urlRoutes');

const app = express();

/* Body parsers */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* Ensure the urls table exists before any request is handled */
initSchema();

/* Mount all routes */
app.use('/', router);

module.exports = app;
