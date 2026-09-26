'use strict';

/**
 * @file tests/urls.test.js
 * @description Integration tests for the URL Shortener API.
 *
 * Uses Node's built-in test runner (node:test) and assertion library
 * (node:assert). No external test framework is required.
 *
 * Strategy
 * --------
 * Each top-level describe block boots the Express app against a fresh
 * in-memory SQLite database (DB_PATH=:memory:) on an OS-assigned ephemeral
 * port (listen(0)), runs its assertions, then closes the server. This keeps
 * tests hermetic and avoids port conflicts.
 *
 * HTTP requests are made with the built-in `node:http` module via a small
 * `request()` helper, so no additional dependencies are needed.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

/* -------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------- */

/**
 * Make an HTTP request and resolve with { status, body }.
 * body is JSON-parsed when the response Content-Type is application/json,
 * otherwise returned as a raw string.
 *
 * @param {object} opts  - node:http.request options
 * @param {string} [payload] - optional JSON-stringified request body
 * @returns {Promise<{status: number, body: any}>}
 */
function request(opts, payload) {
  return new Promise(function(resolve, reject) {
    var req = http.request(opts, function(res) {
      var chunks = [];
      res.on('data', function(chunk) { chunks.push(chunk); });
      res.on('end', function() {
        var raw = Buffer.concat(chunks).toString();
        var body;
        try { body = JSON.parse(raw); } catch (_) { body = raw; }
        resolve({ status: res.statusCode, body: body, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) { req.write(payload); }
    req.end();
  });
}

/**
 * Build a base options object for requests against the test server.
 *
 * @param {number} port
 * @param {string} method
 * @param {string} path
 * @param {boolean} [withBody=false]
 * @returns {object}
 */
function opts(port, method, path, withBody) {
  var o = { hostname: '127.0.0.1', port: port, method: method, path: path };
  if (withBody) { o.headers = { 'Content-Type': 'application/json' }; }
  return o;
}

/**
 * Start a fresh server backed by an in-memory SQLite database.
 * Returns a Promise that resolves to { server, port }.
 */
function startServer() {
  return new Promise(function(resolve) {
    /* Point the db module at an in-memory database for this test run */
    process.env.DB_PATH = ':memory:';

    /* Clear the require cache so each suite gets a fresh db connection
     * and a freshly bootstrapped schema. */
    Object.keys(require.cache).forEach(function(key) {
      if (key.includes('/src/')) { delete require.cache[key]; }
    });

    /* Load modules fresh after cache clear */
    var db      = require('../src/db');
    var app     = require('../src/app');
    var server  = http.createServer(app);

    /* Only start listening once the CREATE TABLE DDL has committed.
     * This eliminates the race between schema creation and the first INSERT. */
    db.initSchema(function() {
      server.listen(0, '127.0.0.1', function() {
        resolve({ server: server, port: server.address().port });
      });
    });
  });
}

/** Stop the server and clear module cache for the next suite. */
function stopServer(server) {
  return new Promise(function(resolve) {
    server.close(resolve);
  });
}

/* =========================================================================
 * Suite 1 — POST /api/shorten  (create)
 * ====================================================================== */
describe('POST /api/shorten', function() {
  var port;
  var server;

  before(async function() {
    var s = await startServer();
    server = s.server;
    port = s.port;
  });

  after(async function() {
    await stopServer(server);
  });

  it('creates a short URL with an auto-generated code', async function() {
    var payload = JSON.stringify({ url: 'https://example.com' });
    var res = await request(opts(port, 'POST', '/api/shorten', true), payload);

    assert.equal(res.status, 201);
    assert.ok(res.body.id > 0, 'id should be a positive integer');
    assert.match(res.body.code, /^[a-zA-Z0-9]{6}$/, 'code should be 6 alphanumeric chars');
    assert.equal(res.body.url, 'https://example.com');
    assert.ok(res.body.short_url.endsWith('/' + res.body.code));
    assert.equal(res.body.clicks, 0);
  });

  it('creates a short URL with a custom code', async function() {
    var payload = JSON.stringify({ url: 'https://example.com/custom', code: 'myCode' });
    var res = await request(opts(port, 'POST', '/api/shorten', true), payload);

    assert.equal(res.status, 201);
    assert.equal(res.body.code, 'myCode');
  });

  it('returns 409 when a duplicate custom code is submitted', async function() {
    var payload = JSON.stringify({ url: 'https://example.com/first', code: 'dupeMe' });
    await request(opts(port, 'POST', '/api/shorten', true), payload);

    var res = await request(opts(port, 'POST', '/api/shorten', true), payload);
    assert.equal(res.status, 409);
    assert.equal(res.body.err, 'code already exists');
  });

  it('returns 400 when url is missing', async function() {
    var payload = JSON.stringify({});
    var res = await request(opts(port, 'POST', '/api/shorten', true), payload);
    assert.equal(res.status, 400);
    assert.equal(res.body.err, 'url required');
  });

  it('returns 400 for an invalid protocol', async function() {
    var payload = JSON.stringify({ url: 'ftp://example.com' });
    var res = await request(opts(port, 'POST', '/api/shorten', true), payload);
    assert.equal(res.status, 400);
    assert.equal(res.body.err, 'invalid protocol, must be http or https');
  });

  it('returns 400 for a custom code that is too short', async function() {
    var payload = JSON.stringify({ url: 'https://example.com', code: 'ab' });
    var res = await request(opts(port, 'POST', '/api/shorten', true), payload);
    assert.equal(res.status, 400);
    assert.equal(res.body.err, 'code too short');
  });

  it('returns 400 for a custom code that is too long', async function() {
    var payload = JSON.stringify({ url: 'https://example.com', code: 'thisistoolong' });
    var res = await request(opts(port, 'POST', '/api/shorten', true), payload);
    assert.equal(res.status, 400);
    assert.equal(res.body.err, 'code too long');
  });
});

/* =========================================================================
 * Suite 2 — GET /:code  (redirect)
 * ====================================================================== */
describe('GET /:code (redirect)', function() {
  var port;
  var server;
  var createdCode;

  before(async function() {
    var s = await startServer();
    server = s.server;
    port = s.port;

    /* Seed one record */
    var payload = JSON.stringify({ url: 'https://redirect-target.com', code: 'redir' });
    await request(opts(port, 'POST', '/api/shorten', true), payload);
    createdCode = 'redir';
  });

  after(async function() {
    await stopServer(server);
  });

  it('redirects to the original URL with 302', async function() {
    var res = await request(opts(port, 'GET', '/' + createdCode));
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, 'https://redirect-target.com');
  });

  it('returns 404 for an unknown code', async function() {
    var res = await request(opts(port, 'GET', '/zzzzz'));
    assert.equal(res.status, 404);
    assert.equal(res.body.err, 'not found');
  });

  it('returns 400 for a code that is too short', async function() {
    var res = await request(opts(port, 'GET', '/ab'));
    assert.equal(res.status, 400);
  });
});

/* =========================================================================
 * Suite 3 — PUT /api/urls/:code  (update)
 * ====================================================================== */
describe('PUT /api/urls/:code', function() {
  var port;
  var server;

  before(async function() {
    var s = await startServer();
    server = s.server;
    port = s.port;

    /* Seed one record */
    var payload = JSON.stringify({ url: 'https://original.com', code: 'updMe' });
    await request(opts(port, 'POST', '/api/shorten', true), payload);
  });

  after(async function() {
    await stopServer(server);
  });

  it('updates the destination URL and returns 200', async function() {
    var payload = JSON.stringify({ url: 'https://updated.com' });
    var res = await request(opts(port, 'PUT', '/api/urls/updMe', true), payload);

    assert.equal(res.status, 200);
    assert.equal(res.body.msg, 'updated');
    assert.equal(res.body.code, 'updMe');
    assert.equal(res.body.new_url, 'https://updated.com');
  });

  it('the redirect now goes to the updated URL', async function() {
    var res = await request(opts(port, 'GET', '/updMe'));
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, 'https://updated.com');
  });

  it('returns 404 when updating a non-existent code', async function() {
    var payload = JSON.stringify({ url: 'https://example.com' });
    var res = await request(opts(port, 'PUT', '/api/urls/noSuch', true), payload);
    assert.equal(res.status, 404);
    assert.equal(res.body.err, 'not found');
  });

  it('returns 400 when the new URL is invalid', async function() {
    var payload = JSON.stringify({ url: 'not-a-url' });
    var res = await request(opts(port, 'PUT', '/api/urls/updMe', true), payload);
    assert.equal(res.status, 400);
  });
});

/* =========================================================================
 * Suite 4 — DELETE /api/urls/:code  (delete)
 * ====================================================================== */
describe('DELETE /api/urls/:code', function() {
  var port;
  var server;

  before(async function() {
    var s = await startServer();
    server = s.server;
    port = s.port;

    /* Seed one record */
    var payload = JSON.stringify({ url: 'https://delete-me.com', code: 'delMe' });
    await request(opts(port, 'POST', '/api/shorten', true), payload);
  });

  after(async function() {
    await stopServer(server);
  });

  it('deletes an existing code and returns 200', async function() {
    var res = await request(opts(port, 'DELETE', '/api/urls/delMe'));
    assert.equal(res.status, 200);
    assert.equal(res.body.msg, 'deleted');
    assert.equal(res.body.code, 'delMe');
  });

  it('the deleted code no longer redirects (404)', async function() {
    var res = await request(opts(port, 'GET', '/delMe'));
    assert.equal(res.status, 404);
  });

  it('returns 404 when deleting a non-existent code', async function() {
    var res = await request(opts(port, 'DELETE', '/api/urls/noSuch'));
    assert.equal(res.status, 404);
    assert.equal(res.body.err, 'not found');
  });
});

/* =========================================================================
 * Suite 5 — GET /api/urls  (list) and GET /api/urls/:code  (fetch one)
 * ====================================================================== */
describe('GET /api/urls', function() {
  var port;
  var server;

  before(async function() {
    var s = await startServer();
    server = s.server;
    port = s.port;

    await request(
      opts(port, 'POST', '/api/shorten', true),
      JSON.stringify({ url: 'https://first.com', code: 'first' })
    );
    await request(
      opts(port, 'POST', '/api/shorten', true),
      JSON.stringify({ url: 'https://second.com', code: 'secnd' })
    );
  });

  after(async function() {
    await stopServer(server);
  });

  it('returns all records as an array, newest first', async function() {
    var res = await request(opts(port, 'GET', '/api/urls'));
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.equal(res.body.length, 2);
    /* Newest first (ORDER BY id DESC) */
    assert.equal(res.body[0].code, 'secnd');
    assert.equal(res.body[1].code, 'first');
  });

  it('each record includes a short_url field', async function() {
    var res = await request(opts(port, 'GET', '/api/urls'));
    res.body.forEach(function(record) {
      assert.ok(record.short_url, 'short_url should be present');
      assert.ok(record.short_url.endsWith('/' + record.code));
    });
  });

  it('GET /api/urls/:code returns a single record', async function() {
    var res = await request(opts(port, 'GET', '/api/urls/first'));
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 'first');
    assert.equal(res.body.original_url, 'https://first.com');
  });

  it('GET /api/urls/:code returns 404 for unknown code', async function() {
    var res = await request(opts(port, 'GET', '/api/urls/nope1'));
    assert.equal(res.status, 404);
    assert.equal(res.body.err, 'not found');
  });
});
