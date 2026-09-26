'use strict';

/**
 * @file server.js
 * @description Production entry point.
 *
 * Imports the configured Express app and starts the HTTP listener.
 * Separating this from src/app.js means the test suite can import
 * the app without triggering a real listen() call.
 */

const app = require('./src/app');
const { PORT } = require('./src/config');

app.listen(PORT, function() {
  console.log('server running on port ' + PORT);
});
