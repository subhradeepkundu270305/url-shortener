'use strict';

/**
 * @file src/routes/urlRoutes.js
 * @description Express router — binds HTTP methods and paths to controller
 * handler functions.
 *
 * Route order matters: specific paths (/api/urls, /api/urls/:code) are
 * registered before the catch-all redirect route (/:code) so that Express
 * does not interpret "api" as a short code.
 */

const express = require('express');
const controller = require('../controllers/urlController');

const router = express.Router();

/* UI */
router.get('/', controller.serveUI);

/* API — specific paths before the wildcard redirect */
router.get('/api/urls',       controller.listUrls);
router.get('/api/urls/:code', controller.getUrl);
router.post('/api/shorten',   controller.createShortUrl);
router.put('/api/urls/:code', controller.updateUrl);
router.delete('/api/urls/:code', controller.deleteUrl);

/* Redirect — must be last; matches any single-segment path */
router.get('/:code', controller.redirectToUrl);

module.exports = router;
