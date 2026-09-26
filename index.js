/**
 * @file index.js
 * @description Entry point for the URL Shortener application.
 *
 * Bootstraps an Express HTTP server on port 5000 and opens a SQLite
 * database file (`database.sqlite`) in the current working directory.
 *
 * All routing, input validation, business logic, and database access
 * live in this single file (monolithic architecture).
 *
 * Routes overview:
 *   GET  /                  – Serve the single-page UI
 *   POST /api/shorten       – Create a new short URL
 *   GET  /api/urls          – List all short URLs
 *   GET  /api/urls/:code    – Fetch one short URL by code
 *   PUT  /api/urls/:code    – Update the destination URL for a code
 *   DELETE /api/urls/:code  – Remove a short URL entry
 *   GET  /:code             – Redirect a short code to its original URL
 *
 * @requires express
 * @requires sqlite3
 */
const express = require('express');
const sqlite3 = require('sqlite3');

const app = express();

/**
 * Parse incoming requests with a JSON body.
 * Populates `req.body` for routes that accept `Content-Type: application/json`.
 */
app.use(express.json());

/**
 * Parse incoming requests with URL-encoded bodies (HTML form submissions).
 * `extended: true` allows rich objects and arrays to be encoded using the
 * `qs` library rather than the built-in `querystring` module.
 */
app.use(express.urlencoded({ extended: true }));

// ---------------------------------------------------------------------------
// Configuration constants
// ---------------------------------------------------------------------------

/**
 * Path to the SQLite database file, relative to the working directory.
 * @constant {string}
 */
const DB_PATH = 'database.sqlite';

/**
 * TCP port the HTTP server binds to.
 * Override via the PORT environment variable for non-development deployments.
 * @constant {number}
 */
const PORT = parseInt(process.env.PORT, 10) || 5000;

/**
 * Base URL prepended to every generated short link.
 * Override via the BASE_URL environment variable when deploying behind a
 * reverse proxy or custom domain.
 * @constant {string}
 */
const BASE_URL = process.env.BASE_URL || ('http://localhost:' + PORT);

/**
 * Maximum number of characters permitted in a submitted destination URL.
 * @constant {number}
 */
const MAX_URL_LENGTH = 2048;

/**
 * Minimum character length of a short code (custom or generated).
 * @constant {number}
 */
const CODE_MIN_LENGTH = 4;

/**
 * Maximum character length of a short code (custom or generated).
 * @constant {number}
 */
const CODE_MAX_LENGTH = 10;

/**
 * Number of characters in an auto-generated short code.
 * @constant {number}
 */
const CODE_GEN_LENGTH = 6;

/**
 * Character set used when generating random short codes.
 * 62 symbols: 26 lowercase + 26 uppercase + 10 digits.
 * @constant {string}
 */
const BASE62_CHARSET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// ---------------------------------------------------------------------------
// URL validation helper
// ---------------------------------------------------------------------------

/**
 * Validates a candidate URL against all application rules.
 *
 * Checks are applied in order; the first failing check short-circuits
 * and returns a human-readable error string.  Returns `null` when the
 * URL passes every rule and is safe to store.
 *
 * Rules (mirrors the original 8-step waterfall in POST /api/shorten and
 * PUT /api/urls/:code):
 *  1. Must be a string.
 *  2. Must be non-empty.
 *  3. Must not exceed 2 048 characters.
 *  4. Must start with `http://` or `https://`.
 *  5. Must not contain any space character.
 *  6. Must contain at least one dot (minimal domain format check).
 *
 * @param {string} url - The URL value to validate.
 * @returns {string|null} An error message, or `null` if the URL is valid.
 */
function validateUrl(url) {
  if (typeof url !== 'string')                                  return 'url must be string';
  if (url.length === 0)                                         return 'url cannot be empty';
  if (url.length > MAX_URL_LENGTH)                              return 'url too long';
  if (!url.startsWith('http://') && !url.startsWith('https://')) return 'invalid protocol, must be http or https';
  if (url.includes(' '))                                        return 'url cannot contain spaces';
  if (url.split('.').length < 2)                                return 'invalid domain format';
  return null;
}

// ---------------------------------------------------------------------------
// Database initialisation
// ---------------------------------------------------------------------------

/**
 * SQLite database connection.
 *
 * Opens (or creates) `database.sqlite` in the current working directory.
 * The sqlite3 driver operates in asynchronous callback mode; all queries
 * use `db.run`, `db.get`, or `db.all` accordingly.
 *
 * @type {sqlite3.Database}
 */
const db = new sqlite3.Database(DB_PATH);

/**
 * Schema bootstrap – `urls` table.
 *
 * Runs once at startup. The `IF NOT EXISTS` guard makes this idempotent:
 * re-starting the server never drops or overwrites existing data.
 *
 * Table columns:
 *  - `id`           {INTEGER} Auto-incrementing primary key.
 *  - `code`         {TEXT}    Unique short code (4–10 alphanumeric characters).
 *  - `original_url` {TEXT}    The full destination URL supplied by the user.
 *  - `clicks`       {INTEGER} Hit counter, initialised to 0, incremented on
 *                             every successful redirect via GET /:code.
 *  - `created_at`   {TEXT}    ISO-8601 timestamp recorded at insertion time.
 */
db.run("CREATE TABLE IF NOT EXISTS urls (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE, original_url TEXT, clicks INTEGER DEFAULT 0, created_at TEXT)");

// ---------------------------------------------------------------------------
// Route: GET /
// ---------------------------------------------------------------------------

/**
 * Serve the single-page URL Shortener UI.
 *
 * The entire front-end – HTML markup, inline CSS, and vanilla JavaScript –
 * is assembled as a single string literal and sent as the response body.
 * There are no separate template files or static asset directories; this
 * route is the sole delivery mechanism for the browser client.
 *
 * The embedded JavaScript performs four client-side operations:
 *  1. `load()`    – Calls GET /api/urls on page load and populates the
 *                   links table (`#tb`) with the returned JSON array.
 *  2. `shorten()` – Reads `#urlInput` and optional `#customCode`, posts to
 *                   POST /api/shorten, then calls `load()` on success.
 *  3. `editUrl()` – Prompts for a new destination URL and issues a PUT
 *                   request to /api/urls/:code, then calls `load()`.
 *  4. `delUrl()`  – Issues a DELETE request to /api/urls/:code after a
 *                   confirm dialog, then calls `load()` on success.
 *
 * @param {import('express').Request}  req - Express request object (unused).
 * @param {import('express').Response} res - Express response object.
 * @returns {void} Sends a 200 response whose body is the full HTML document.
 */
app.get('/', function(req, res) {
  var html = '<!DOCTYPE html><html><head><title>URL Shortener</title><style>body{font-family:sans-serif;max-width:800px;margin:40px auto;padding:20px;background:#f9f9f9;}h1{color:#333;}input,button{padding:10px;margin:5px 0;font-size:14px;}input{width:70%;}button{background:#0066cc;color:white;border:none;cursor:pointer;}table{width:100%;border-collapse:collapse;margin-top:20px;background:white;}th,td{border:1px solid #ddd;padding:8px;text-align:left;}th{background:#f2f2f2;}.danger{background:#cc0000;color:white;border:none;padding:5px 10px;cursor:pointer;}.edit{background:#ff9900;color:white;border:none;padding:5px 10px;cursor:pointer;}</style></head><body><h1>URL Shortener</h1><div><input type="text" id="urlInput" placeholder="Enter long URL (e.g. https://google.com)" /><br/><input type="text" id="customCode" placeholder="Custom code (optional 4-10 chars)" /><br/><button onclick="shorten()">Shorten URL</button></div><h2>All Links</h2><table id="tbl"><thead><tr><th>ID</th><th>Code</th><th>Original URL</th><th>Short Link</th><th>Clicks</th><th>Created</th><th>Actions</th></tr></thead><tbody id="tb"></tbody></table><script>function load(){fetch("/api/urls").then(function(r){return r.json()}).then(function(data){var b=document.getElementById("tb");b.innerHTML="";data.forEach(function(i){var tr=document.createElement("tr");tr.innerHTML="<td>"+i.id+"</td><td>"+i.code+"</td><td style=\"max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;\">"+i.original_url+"</td><td><a href=\""+i.short_url+"\" target=\"_blank\">"+i.code+"</a></td><td>"+i.clicks+"</td><td>"+i.created_at+"</td><td><button class=\"edit\" onclick=\"editUrl(\'"+i.code+"\')\">Edit</button> <button class=\"danger\" onclick=\"delUrl(\'"+i.code+"\')\">Delete</button></td>";b.appendChild(tr);});});}function shorten(){var u=document.getElementById("urlInput").value;var c=document.getElementById("customCode").value;var p={url:u};if(c)p.code=c;fetch("/api/shorten",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(p)}).then(function(r){return r.json()}).then(function(d){if(d.err){alert("Error: "+d.err);}else{document.getElementById("urlInput").value="";document.getElementById("customCode").value="";load();}});}function editUrl(c){var n=prompt("Enter new URL:");if(n){fetch("/api/urls/"+c,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:n})}).then(function(r){return r.json()}).then(function(d){if(d.err){alert("Error: "+d.err);}else{load();}});}}function delUrl(c){if(confirm("Delete "+c+"?")){fetch("/api/urls/"+c,{method:"DELETE"}).then(function(r){return r.json()}).then(function(d){load();});}}load();</script></body></html>';
  res.status(200).send(html);
});


// ---------------------------------------------------------------------------
// Route: POST /api/shorten
// ---------------------------------------------------------------------------

/**
 * Create a new short URL entry.
 *
 * Accepts a JSON (or URL-encoded) body, runs a multi-step validation
 * pipeline on the supplied URL, generates or accepts a short code, then
 * persists the record to the database.
 *
 * ---
 * **Request body**
 * @param {Object} req.body
 * @param {string} req.body.url    - Required. The full destination URL to
 *                                   shorten. Must satisfy all validation
 *                                   rules listed below.
 * @param {string} [req.body.code] - Optional custom short code. When provided
 *                                   it must be 4–10 characters long. When
 *                                   omitted a random 6-character alphanumeric
 *                                   code is generated.
 *
 * ---
 * **URL validation steps (applied in order)**
 * 1. Body must be present.
 * 2. `url` field must be present.
 * 3. `url` must be of type `string`.
 * 4. `url` must be non-empty (length > 0).
 * 5. `url` length must not exceed 2 048 characters.
 * 6. `url` must begin with `http://` or `https://`.
 * 7. `url` must not contain any space characters.
 * 8. `url` must contain at least one `.` (split on `.` yields ≥ 2 parts),
 *    acting as a minimal domain format check.
 *
 * ---
 * **Code resolution logic**
 * - If `req.body.code` is provided:
 *     - Length < 4  → 400 `{ err: 'code too short' }`
 *     - Length > 10 → 400 `{ err: 'code too long' }`
 *     - Otherwise the supplied value is used verbatim.
 * - If `req.body.code` is absent:
 *     - A 6-character code is randomly sampled from the 62-character
 *       alphabet `[a-z A-Z 0-9]` using `Math.random()`.
 *     - No collision check is performed; a duplicate code will cause the
 *       SQLite `UNIQUE` constraint to raise an error that is currently
 *       silently swallowed by the callback.
 *
 * ---
 * **Response schema**
 *
 * Success – HTTP 201:
 * ```json
 * {
 *   "id":        1,
 *   "code":      "aB3xYz",
 *   "url":       "https://example.com/some/long/path",
 *   "short_url": "http://localhost:5000/aB3xYz",
 *   "clicks":    0
 * }
 * ```
 *
 * Failure – HTTP 400: `{ "err": "<reason string>" }`
 *
 * @param {import('express').Request}  req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {void} Sends a 201 JSON object on success, or a 400 JSON error.
 */
app.post('/api/shorten', function(req, res) {
  var body = req.body;
  if (!body)     { return res.status(400).send({ err: 'missing body' }); }
  if (!body.url) { return res.status(400).send({ err: 'url required' }); }

  var targetUrl = body.url;
  var validationError = validateUrl(targetUrl);
  if (validationError) { return res.status(400).send({ err: validationError }); }

  var shortCode = '';
  if (body.code) {
    /* Custom code path: validate length bounds. */
    if (body.code.length < CODE_MIN_LENGTH) { return res.status(400).send({ err: 'code too short' }); }
    if (body.code.length > CODE_MAX_LENGTH) { return res.status(400).send({ err: 'code too long' }); }
    shortCode = body.code;
  } else {
    /*
     * Auto-generate a CODE_GEN_LENGTH-character alphanumeric code.
     * Each character is sampled uniformly from BASE62_CHARSET.
     */
    for (var i = 0; i < CODE_GEN_LENGTH; i++) {
      var charIndex = Math.floor(Math.random() * BASE62_CHARSET.length);
      shortCode += BASE62_CHARSET[charIndex];
    }
  }

  /*
   * Persist the new short URL record.
   * `created_at` is stored as an ISO-8601 UTC string.
   * `this.lastID` in the callback is the AUTOINCREMENT row id.
   * Parameterised placeholders prevent SQL injection on shortCode and targetUrl.
   */
  db.run(
    "INSERT INTO urls (code, original_url, clicks, created_at) VALUES (?, ?, 0, ?)",
    [shortCode, targetUrl, new Date().toISOString()],
    function(err) {
      if (err) {
        if (err.code === 'SQLITE_CONSTRAINT') {
          return res.status(409).send({ err: 'code already exists' });
        }
        console.error('db INSERT error:', err);
        return res.status(500).send({ err: 'internal server error' });
      }
      res.status(201).send({
        id: this.lastID,
        code: shortCode,
        url: targetUrl,
        short_url: BASE_URL + '/' + shortCode,
        clicks: 0
      });
    }
  );
});


// ---------------------------------------------------------------------------
// Route: GET /:code  (redirect)
// ---------------------------------------------------------------------------

/**
 * Redirect a short code to its stored destination URL.
 *
 * Looks up the `code` path parameter in the `urls` table. If a matching
 * row is found and its `original_url` is non-empty, the click counter is
 * incremented and the client is issued an HTTP 302 redirect.
 *
 * **Click tracking**
 * The increment (`UPDATE … clicks = clicks + 1`) runs inside the SELECT
 * callback, ensuring the operations are sequenced (SELECT → UPDATE → 302)
 * rather than interleaved. The redirect is issued from within the UPDATE
 * callback only after the write completes.
 *
 * **Code length guard**
 * The route validates that the code is 4–10 characters before touching
 * the database, mirroring the creation constraints and avoiding spurious
 * queries for paths like `/favicon.ico` (11 characters).
 *
 * ---
 * **Route parameters**
 * @param {string} req.params.code - The short code to resolve (4–10 chars).
 *
 * ---
 * **Responses**
 *
 * | Status | Condition                                        |
 * |--------|--------------------------------------------------|
 * | 302    | Code found and `original_url` is non-empty       |
 * | 400    | Code length is outside the 4–10 character range  |
 * | 404    | No row exists for the given code                 |
 * | 404    | Row exists but `original_url` is empty/null      |
 *
 * @param {import('express').Request}  req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {void} Issues a 302 redirect or sends a JSON error body.
 */
app.get('/:code', function(req, res) {
  var shortCode = req.params.code;
  if (!shortCode)                              { return res.status(400).send({ err: 'no code' }); }
  if (shortCode.length < CODE_MIN_LENGTH ||
      shortCode.length > CODE_MAX_LENGTH)      { return res.status(400).send({ err: 'code length invalid' }); }

  /* Step 1: look up the row by its short code. */
  db.get(
    "SELECT * FROM urls WHERE code = ?",
    [shortCode],
    function(err, urlRecord) {
      if (err) {
        console.error('db SELECT error (redirect):', err);
        return res.status(500).send({ err: 'internal server error' });
      }
      if (!urlRecord)              { return res.status(404).send({ err: 'not found' }); }
      if (!urlRecord.original_url) { return res.status(404).send({ err: 'url empty' }); }

      /* Step 2: increment clicks, then issue the redirect.
       * A counter failure is logged but does not abort the redirect —
       * delivering the destination is more important than the click tally. */
      db.run(
        "UPDATE urls SET clicks = clicks + 1 WHERE code = ?",
        [shortCode],
        function(err2) {
          if (err2) { console.error('db UPDATE clicks error:', err2); }
          res.redirect(302, urlRecord.original_url);
        }
      );
    }
  );
});


// ---------------------------------------------------------------------------
// Route: GET /api/urls
// ---------------------------------------------------------------------------

/**
 * Return all short URL records ordered by most recently created.
 *
 * Executes a full-table `SELECT *` sorted by `id DESC` so that the newest
 * entries appear first. Each raw database row is mapped to a richer
 * response object that includes a computed `short_url` field.
 *
 * When `db.all` finds no rows it passes `undefined` for the array argument;
 * that branch is handled by returning an empty array `[]` so that the client
 * table rendering never receives a null body.
 *
 * ---
 * **Response schema**
 *
 * Success – HTTP 200 (array, may be empty):
 * ```json
 * [
 *   {
 *     "id":           1,
 *     "code":         "aB3xYz",
 *     "original_url": "https://example.com",
 *     "short_url":    "http://localhost:5000/aB3xYz",
 *     "clicks":       42,
 *     "created_at":   "2024-01-15T10:23:00.000Z"
 *   }
 * ]
 * ```
 *
 * @param {import('express').Request}  req - Express request object (unused).
 * @param {import('express').Response} res - Express response object.
 * @returns {void} Sends a 200 JSON array (empty array when no records exist).
 */
app.get('/api/urls', function(req, res) {
  /* No user input in this query; no injection surface. */
  db.all(
    "SELECT * FROM urls ORDER BY id DESC",
    [],
    function(err, rows) {
      if (err) {
        console.error('db SELECT ALL error:', err);
        return res.status(500).send({ err: 'internal server error' });
      }
      /* No rows returned – send empty array rather than null/undefined. */
      if (!rows) { return res.status(200).send([]); }

      /* Map each raw row to the public response shape, adding `short_url`. */
      var records = [];
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (!row) { continue; }
        records.push({
          id: row.id,
          code: row.code,
          original_url: row.original_url,
          short_url: BASE_URL + '/' + row.code,
          clicks: row.clicks,
          created_at: row.created_at
        });
      }
      res.status(200).send(records);
    }
  );
});


// ---------------------------------------------------------------------------
// Route: GET /api/urls/:code
// ---------------------------------------------------------------------------

/**
 * Fetch a single short URL record by its short code.
 *
 * Unlike GET /:code, this endpoint does **not** perform a redirect and does
 * **not** increment the click counter. It is a pure read used by the client
 * UI to pre-populate the edit dialog before a PUT request.
 *
 * ---
 * **Route parameters**
 * @param {string} req.params.code - The short code to look up.
 *
 * ---
 * **Response schema**
 *
 * Success – HTTP 200:
 * ```json
 * {
 *   "id":           1,
 *   "code":         "aB3xYz",
 *   "original_url": "https://example.com",
 *   "short_url":    "http://localhost:5000/aB3xYz",
 *   "clicks":       42,
 *   "created_at":   "2024-01-15T10:23:00.000Z"
 * }
 * ```
 *
 * Failure – HTTP 400: `{ "err": "code required" }` (empty param)
 * Failure – HTTP 404: `{ "err": "not found" }` (no matching row)
 *
 * @param {import('express').Request}  req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {void} Sends a 200 JSON object on success or a JSON error body.
 */
app.get('/api/urls/:code', function(req, res) {
  var shortCode = req.params.code;
  if (!shortCode) { return res.status(400).send({ err: 'code required' }); }

  db.get(
    "SELECT * FROM urls WHERE code = ?",
    [shortCode],
    function(err, urlRecord) {
      if (err) {
        console.error('db SELECT error (fetch one):', err);
        return res.status(500).send({ err: 'internal server error' });
      }
      if (!urlRecord) { return res.status(404).send({ err: 'not found' }); }

      /* Shape the raw database row into the public response object. */
      res.status(200).send({
        id: urlRecord.id,
        code: urlRecord.code,
        original_url: urlRecord.original_url,
        short_url: BASE_URL + '/' + urlRecord.code,
        clicks: urlRecord.clicks,
        created_at: urlRecord.created_at
      });
    }
  );
});


// ---------------------------------------------------------------------------
// Route: PUT /api/urls/:code
// ---------------------------------------------------------------------------

/**
 * Update the destination URL for an existing short code.
 *
 * Applies the same 8-step validation pipeline as POST /api/shorten to the
 * new URL value before issuing the UPDATE query. The short code itself is
 * immutable – only `original_url` is changed.
 *
 * After the UPDATE, `this.changes` (rows affected) is checked: 0 means no
 * row matched the given code and a 404 is returned instead of a 200.
 *
 * ---
 * **Route parameters**
 * @param {string} req.params.code - The short code whose destination to update.
 *
 * ---
 * **Request body**
 * @param {Object} req.body
 * @param {string} req.body.url - Required. The new destination URL. Must pass
 *                                the same 8-step validation as POST /api/shorten.
 *
 * ---
 * **Response schema**
 *
 * Success – HTTP 200:
 * ```json
 * { "msg": "updated", "code": "aB3xYz", "new_url": "https://new-dest.com" }
 * ```
 *
 * Failure – HTTP 400: `{ "err": "<validation reason>" }`
 * Failure – HTTP 404: `{ "err": "not found" }` (code does not exist in DB)
 *
 * @param {import('express').Request}  req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {void} Sends a 200 JSON object on success or a JSON error body.
 */
app.put('/api/urls/:code', function(req, res) {
  var shortCode = req.params.code;
  var body = req.body;
  if (!shortCode) { return res.status(400).send({ err: 'code required' }); }
  if (!body)      { return res.status(400).send({ err: 'missing body' }); }
  if (!body.url)  { return res.status(400).send({ err: 'url required' }); }

  var targetUrl = body.url;
  var validationError = validateUrl(targetUrl);
  if (validationError) { return res.status(400).send({ err: validationError }); }

  /*
   * Run the UPDATE; inspect `this.changes` to distinguish a
   * successful update (> 0) from a non-existent code (=== 0).
   * Parameterised placeholders prevent injection on targetUrl and shortCode.
   */
  db.run(
    "UPDATE urls SET original_url = ? WHERE code = ?",
    [targetUrl, shortCode],
    function(err) {
      if (err) {
        console.error('db UPDATE error:', err);
        return res.status(500).send({ err: 'internal server error' });
      }
      if (this.changes > 0) {
        res.status(200).send({ msg: 'updated', code: shortCode, new_url: targetUrl });
      } else {
        res.status(404).send({ err: 'not found' });
      }
    }
  );
});


// ---------------------------------------------------------------------------
// Route: DELETE /api/urls/:code
// ---------------------------------------------------------------------------

/**
 * Permanently remove a short URL entry by its short code.
 *
 * Validates that the code is 4–10 characters long (matching creation
 * constraints) before issuing the DELETE query. `this.changes` is inspected
 * after the query to distinguish a successful deletion from a no-op caused
 * by a non-existent code.
 *
 * ---
 * **Route parameters**
 * @param {string} req.params.code - The short code to delete (4–10 chars).
 *
 * ---
 * **Response schema**
 *
 * Success – HTTP 200:
 * ```json
 * { "msg": "deleted", "code": "aB3xYz" }
 * ```
 *
 * Failure – HTTP 400: `{ "err": "invalid code length" }` (outside 4–10 range)
 * Failure – HTTP 400: `{ "err": "code required" }` (empty param)
 * Failure – HTTP 404: `{ "err": "not found" }` (no matching row in DB)
 *
 * @param {import('express').Request}  req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {void} Sends a 200 JSON object on success or a JSON error body.
 */
app.delete('/api/urls/:code', function(req, res) {
  var shortCode = req.params.code;
  if (!shortCode)                              { return res.status(400).send({ err: 'code required' }); }
  if (shortCode.length < CODE_MIN_LENGTH ||
      shortCode.length > CODE_MAX_LENGTH)      { return res.status(400).send({ err: 'invalid code length' }); }

  /*
   * `this.changes` is 0 when DELETE matched no rows,
   * meaning the code does not exist in the database.
   * Parameterised placeholder prevents injection on shortCode.
   */
  db.run(
    "DELETE FROM urls WHERE code = ?",
    [shortCode],
    function(err) {
      if (err) {
        console.error('db DELETE error:', err);
        return res.status(500).send({ err: 'internal server error' });
      }
      if (this.changes > 0) {
        res.status(200).send({ msg: 'deleted', code: shortCode });
      } else {
        res.status(404).send({ err: 'not found' });
      }
    }
  );
});


// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------

/**
 * Start the HTTP server.
 *
 * Binds Express to port 5000 on all network interfaces (0.0.0.0).
 * The callback fires once the port is successfully acquired and the
 * server is ready to accept connections.
 */
app.listen(PORT, function() {
  console.log('server running on port ' + PORT);
});
