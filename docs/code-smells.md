# Code Smells & Anti-Patterns — `index.js`

> **Scope:** Static analysis of [`../index.js`](../index.js) (641 lines).  
> **Purpose:** Catalogue the five most critical issues blocking production readiness,
> each with exact line references, a risk assessment, and a concrete refactoring recipe.

---

## Table of Contents

1. [Smell 1 — Unparameterised SQL Queries (Injection Risk)](#smell-1--unparameterised-sql-queries-injection-risk)
2. [Smell 2 — Duplicated Validation Logic (DRY Violation)](#smell-2--duplicated-validation-logic-dry-violation)
3. [Smell 3 — Arrow-of-Doom Nesting (Deeply Nested Conditionals)](#smell-3--arrow-of-doom-nesting-deeply-nested-conditionals)
4. [Smell 4 — Silently Swallowed Errors (Missing Error Handling)](#smell-4--silently-swallowed-errors-missing-error-handling)
5. [Smell 5 — Magic Values Scattered Throughout the Codebase](#smell-5--magic-values-scattered-throughout-the-codebase)

---

## Smell 1 — Unparameterised SQL Queries (Injection Risk)

### Severity: 🔴 Critical

### Affected lines

Every database interaction in the file builds its SQL by concatenating user-supplied
strings directly into the query:

| Line | Query | User input interpolated |
|------|-------|------------------------|
| 218 | `INSERT INTO urls … VALUES ('` + `code` + `', '` + `temp` + `', …` | `code` (custom or generated), `temp` (full URL) |
| 306 | `SELECT * FROM urls WHERE code = '` + `temp` + `'` | `temp` = `x.params.code` |
| 311 | `UPDATE urls SET clicks = clicks + 1 WHERE code = '` + `temp` + `'` | `temp` = `x.params.code` |
| 372 | `SELECT * FROM urls ORDER BY id DESC` | *(none — but same pattern throughout)* |
| 440 | `SELECT * FROM urls WHERE code = '` + `temp` + `'` | `temp` = `x.params.code` |
| 524 | `UPDATE urls SET original_url = '` + `temp` + `' WHERE code = '` + `tempCode` + `'` | `temp` (URL body), `tempCode` (route param) |
| 603 | `DELETE FROM urls WHERE code = '` + `temp` + `'` | `temp` = `x.params.code` |

The most direct attack surface is `GET /:code` at line 306. Any value that passes the
4–10 character length guard (lines 304–305) is concatenated verbatim. A code value of:

```
a'; DROP TABLE urls; --
```

would only be rejected because it is 23 characters long. The length guard is the *only*
defence. For the `PUT` body at line 524, `temp` (the full URL) can be up to 2 048
characters — more than enough room for a multi-statement injection payload.

### Why it is harmful

- **Data destruction:** An attacker can drop tables, delete all rows, or corrupt data.
- **Data exfiltration:** `UNION SELECT`-based attacks can read any table in the database.
- **Application bypass:** Queries can be shaped to return arbitrary rows, bypassing
  intended access control.
- SQLite's default driver in Node.js silently executes multiple statements when separated
  by `;`, making stacked queries viable.

### Recommended fix

Replace every concatenated query with **parameterised placeholders** (`?`). The
`sqlite3` driver supports this natively and handles all escaping internally:

```js
// BEFORE (line 306) — dangerous
var q = "SELECT * FROM urls WHERE code = '" + temp + "'";
db.get(q, function(err, row) { … });

// AFTER — safe
db.get(
  "SELECT * FROM urls WHERE code = ?",
  [temp],
  function(err, row) { … }
);
```

```js
// BEFORE (line 218) — dangerous
var q = "INSERT INTO urls (code, original_url, clicks, created_at) VALUES ('"
  + code + "', '" + temp + "', 0, '" + new Date().toISOString() + "')";
db.run(q, function(err) { … });

// AFTER — safe
db.run(
  "INSERT INTO urls (code, original_url, clicks, created_at) VALUES (?, ?, 0, ?)",
  [code, temp, new Date().toISOString()],
  function(err) { … }
);
```

Apply the same pattern to all seven query sites. No changes to route logic are required —
this is a pure mechanical substitution at each `db.run` / `db.get` / `db.all` call site.

---

## Smell 2 — Duplicated Validation Logic (DRY Violation)

### Severity: 🔴 Critical

### Affected lines

The identical 8-step URL validation waterfall is copy-pasted into two separate route
handlers with no shared abstraction:

**First copy — `POST /api/shorten` (lines 173–258):**

```
line 174  if (data.url)              → 'url required'
line 176  if (typeof temp === 'string') → 'url must be string'
line 177  if (temp.length > 0)       → 'url cannot be empty'
line 178  if (temp.length <= 2048)   → 'url too long'
line 179  if (temp.startsWith(…))    → 'invalid protocol'
line 182  for (space scan)           → 'url cannot contain spaces'
line 188  if (arr.length >= 2)       → 'invalid domain format'
```

**Second copy — `PUT /api/urls/:code` (lines 505–563):**

```
line 507  if (data.url)              → 'url required'
line 509  if (typeof temp === 'string') → 'url must be string'
line 510  if (temp.length > 0)       → 'url cannot be empty'
line 511  if (temp.length <= 2048)   → 'url too long'
line 512  if (temp.startsWith(…))    → 'invalid protocol'
line 515  for (space scan)           → 'url cannot contain spaces'
line 521  if (arr.length >= 2)       → 'invalid domain format'
```

Both copies are **structurally identical** — same order, same error strings, same
conditions — separated only by their surrounding route context.

### Why it is harmful

- **Silent divergence:** Any future rule change (e.g. adding a blocked-domain list or
  raising the max-length limit) must be applied in both places. One missed change means
  `POST` and `PUT` silently apply different rules to the same input.
- **Multiplicative maintenance cost:** Every new route that accepts a URL (e.g. a bulk
  import endpoint) must copy the block a third time, compounding the problem.
- **Untestable in isolation:** Because the logic is embedded inside route callbacks,
  there is no way to unit-test the validation rules without firing up an HTTP server and
  making real requests.

### Recommended fix

Extract a single pure `validateUrl(url)` function that returns either `null` (valid) or
an error string (invalid). Both routes call it and respond to its output:

```js
/**
 * Validates a candidate URL against all application rules.
 * @param {string} url
 * @returns {string|null} An error message string, or null if the URL is valid.
 */
function validateUrl(url) {
  if (typeof url !== 'string')             return 'url must be string';
  if (url.length === 0)                    return 'url cannot be empty';
  if (url.length > 2048)                   return 'url too long';
  if (!url.startsWith('http://') && !url.startsWith('https://'))
                                           return 'invalid protocol, must be http or https';
  if (url.includes(' '))                   return 'url cannot contain spaces';
  if (url.split('.').length < 2)           return 'invalid domain format';
  return null;
}
```

Each route becomes a flat two-liner instead of a 40-line pyramid:

```js
app.post('/api/shorten', function(req, res) {
  if (!req.body)       return res.status(400).json({ err: 'missing body' });
  if (!req.body.url)   return res.status(400).json({ err: 'url required' });

  const urlError = validateUrl(req.body.url);
  if (urlError)        return res.status(400).json({ err: urlError });

  // … code generation and INSERT …
});
```

The function can now be `require`d in a test file and exercised with zero HTTP overhead.

---

## Smell 3 — Arrow-of-Doom Nesting (Deeply Nested Conditionals)

### Severity: 🟠 High

### Affected lines

The `POST /api/shorten` handler (lines 171–258) and the `PUT /api/urls/:code` handler
(lines 502–563) both reach **8 levels of indentation** inside a single function. The
`POST` handler's deepest path, the successful `db.run` INSERT callback, sits at 10
levels of nesting (indentation columns ≈ 36 spaces):

```
app.post(…, function(x, res2) {          // level 1
  if (data) {                            // level 2
    if (data.url) {                      // level 3
      if (typeof temp === 'string') {    // level 4
        if (temp.length > 0) {           // level 5
          if (temp.length <= 2048) {     // level 6
            if (temp.startsWith(…)) {   // level 7
              if (flag) {               // level 8
                if (arr.length >= 2) {  // level 9
                  db.run(q, function(err) {  // level 10
```

Lines 171–258 contain **88 lines** with a cyclomatic complexity of at least 10 distinct
decision paths in a single function — far above the industry guideline of ≤ 5–7.

The closing `}` staircase at lines 234–257 contains **nine consecutive closing braces**,
each associated with an error response at a different nesting level — making it
effectively impossible to trace which `if` each `else` belongs to without counting
braces manually.

### Why it is harmful

- **Cognitive load:** A developer reading or modifying this code must hold 9 simultaneous
  conditional states in working memory to understand a single execution path.
- **Error-prone maintenance:** It is easy to accidentally add logic inside the wrong `if`
  block when the correct level is not visually obvious. The current code already has one
  misaligned inline comment (`/* Custom code path … */` at line 193 is indented to the
  wrong column relative to the `if (data.code)` it describes).
- **Untestability:** High cyclomatic complexity exponentially increases the number of
  test cases needed to achieve branch coverage.

### Recommended fix

Apply the **early-return (guard clause) pattern**: invert each failing condition and
return immediately, eliminating all nesting except the happy path.

```js
// BEFORE: 8 levels of nesting, 88 lines, closing-brace staircase
app.post('/api/shorten', function(x, res2) {
  var data = x.body;
  if (data) {
    if (data.url) {
      if (typeof temp === 'string') {
        // … and so on for 80 more lines
      }
    }
  }
});

// AFTER: flat, ≤ 2 levels of nesting in the happy path
app.post('/api/shorten', function(req, res) {
  if (!req.body)                    return res.status(400).json({ err: 'missing body' });
  if (!req.body.url)                return res.status(400).json({ err: 'url required' });

  const urlErr = validateUrl(req.body.url);  // extracted function from Smell 2
  if (urlErr)                       return res.status(400).json({ err: urlErr });

  let code = req.body.code || null;
  if (code !== null) {
    if (code.length < 4)            return res.status(400).json({ err: 'code too short' });
    if (code.length > 10)           return res.status(400).json({ err: 'code too long' });
  } else {
    code = generateCode();          // extracted 6-char random function
  }

  db.run(
    "INSERT INTO urls (code, original_url, clicks, created_at) VALUES (?, ?, 0, ?)",
    [code, req.body.url, new Date().toISOString()],
    function(err) {
      if (err) return res.status(500).json({ err: 'could not save url' });
      res.status(201).json({ id: this.lastID, code, url: req.body.url,
                             short_url: BASE_URL + '/' + code, clicks: 0 });
    }
  );
});
```

Maximum indentation: 3 levels. Cyclomatic complexity: ≤ 4.

---

## Smell 4 — Silently Swallowed Errors (Missing Error Handling)

### Severity: 🟠 High

### Affected lines

Every `db.run`, `db.get`, and `db.all` callback receives an `err` argument. In six of
the seven database call sites, `err` is **never read**:

| Line | Callback signature | `err` inspected? |
|------|--------------------|-----------------|
| 224 | `db.run(q, function(err) {` | ❌ Never read |
| 308 | `db.get(q, function(err, row) {` | ❌ Never read |
| 313 | `db.run(q2, function(err2) {` | ❌ Never read |
| 373 | `db.all(q, function(err, arr) {` | ❌ Never read |
| 441 | `db.get(q, function(err, row) {` | ❌ Never read |
| 529 | `db.run(q, function(err) {` | ❌ Never read — only `this.changes` is checked |
| 604 | `db.run(q, function(err) {` | ❌ Never read — only `this.changes` is checked |

The most dangerous case is line 224, the `INSERT` callback in `POST /api/shorten`.
When a randomly generated code collides with an existing one, SQLite fires a
`SQLITE_CONSTRAINT: UNIQUE constraint failed: urls.code` error and passes it as `err`.
Because `err` is never read, the callback proceeds to build and send a `201` response
with `this.lastID === 0` and an incorrect `code` value — giving the client false
confirmation that the URL was saved when it was not.

In the redirect route (line 308–313), if `db.get` fails due to a disk I/O error, `row`
will be `undefined`, which falls into the `'not found'` 404 branch — misrepresenting
a server-side infrastructure failure as a missing record to the client.

There is also no top-level uncaught-exception or unhandled-rejection handler, meaning
any unexpected error anywhere will silently terminate the Node.js process.

### Why it is harmful

- **Data integrity:** Clients receive false `201 Created` responses for records that were
  never actually saved to the database.
- **Silent failures:** Database I/O errors, disk-full conditions, and constraint
  violations are all invisible — no log entry, no error response, no alert.
- **Misleading responses:** A storage failure gets surfaced as a `404 Not Found` rather
  than a `500 Internal Server Error`, making debugging extremely difficult.
- **Process crashes:** Unhandled exceptions in async callbacks can crash the server
  without any diagnostic output.

### Recommended fix

Read `err` at every callback site and respond with a `500` before continuing:

```js
// BEFORE (line 224) — err ignored, false 201 sent on constraint violation
db.run(q, function(err) {
  var obj = { id: this.lastID, code: code, … };
  res2.status(201).send(obj);
});

// AFTER — err checked first; UNIQUE collisions get a meaningful 409
db.run(
  "INSERT INTO urls (code, original_url, clicks, created_at) VALUES (?, ?, 0, ?)",
  [code, temp, new Date().toISOString()],
  function(err) {
    if (err) {
      if (err.code === 'SQLITE_CONSTRAINT') {
        return res.status(409).json({ err: 'code already exists' });
      }
      console.error('db INSERT error:', err);
      return res.status(500).json({ err: 'internal server error' });
    }
    res.status(201).json({ id: this.lastID, code, url: temp,
                           short_url: BASE_URL + '/' + code, clicks: 0 });
  }
);
```

Additionally, add a global safety net at the bottom of `index.js`:

```js
process.on('uncaughtException',  (err) => { console.error('uncaughtException:', err); });
process.on('unhandledRejection', (err) => { console.error('unhandledRejection:', err); });
```

---

## Smell 5 — Magic Values Scattered Throughout the Codebase

### Severity: 🟡 Medium

### Affected lines

Seven distinct magic values are hardcoded inline across the file, with no symbolic
names or centralised configuration:

| Line(s) | Value | Used for |
|---------|-------|----------|
| 178, 511 | `2048` | Maximum permitted URL length |
| 194, 601 | `4` | Minimum short code length |
| 195, 602 | `10` | Maximum short code length |
| 206, 213 | `62`, `'abcdefghijklmnopqrstuvwxyz…'` | Alphabet size and character set for code generation |
| 212 | `6` | Length of auto-generated code |
| 229, 384, 448, 531 | `'http://localhost:5000/'` | Base URL prepended to every `short_url` |
| 638 | `5000` | HTTP listen port |

The base URL string `'http://localhost:5000/'` appears on **four separate lines** (229,
384, 448, 531). Deploying the application to any real host requires four manual
find-and-replace operations — one missed occurrence silently returns broken links.

The value `4` appears in the minimum-code-length guard in both `POST /api/shorten`
(line 194) and `DELETE /api/urls/:code` (line 601). If the minimum were changed to `3`
and line 601 were missed, the delete route would reject valid 3-character codes that
were successfully created by the shortened route.

### Why it is harmful

- **Deployment friction:** The application cannot be configured for different environments
  (development, staging, production) without editing source files.
- **Consistency drift:** The same logical constant (e.g. minimum code length) enforced in
  multiple places will diverge over time as some occurrences are updated and others are
  missed.
- **Readability:** A reader encountering `<= 2048` or `* 62` in isolation has no
  immediate context for what the number represents or why that value was chosen.
- **Testability:** Tests that need to exercise edge cases (e.g. a URL of exactly 2 048
  characters) must hardcode the same number, meaning both the test and the production
  code must be updated in lockstep.

### Recommended fix

Define all constants in a single block at the top of the file (or in a dedicated
`config.js` module), and source environment-sensitive values from `process.env`:

```js
// config.js  (or top of index.js)
const BASE_URL      = process.env.BASE_URL   || 'http://localhost:5000';
const PORT          = parseInt(process.env.PORT, 10) || 5000;
const DB_PATH       = process.env.DB_PATH    || 'database.sqlite';

const URL_MAX_LEN   = 2048;
const CODE_MIN_LEN  = 4;
const CODE_MAX_LEN  = 10;
const CODE_GEN_LEN  = 6;
const CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
```

Every occurrence of the raw number or string is then replaced with the named constant:

```js
// BEFORE (lines 194–195)
if (data.code.length >= 4) {
  if (data.code.length <= 10) {

// AFTER — intent is explicit, single source of truth
if (data.code.length >= CODE_MIN_LEN) {
  if (data.code.length <= CODE_MAX_LEN) {
```

```js
// BEFORE (line 229) — four copies across the file
short_url: 'http://localhost:5000/' + code,

// AFTER — one definition, used everywhere
short_url: BASE_URL + '/' + code,
```

The application can then be deployed with different port or domain settings via
environment variables alone, with zero source-code changes.

---

## Summary

| # | Smell | Severity | Lines affected | Effort to fix |
|---|-------|----------|----------------|---------------|
| 1 | Unparameterised SQL / injection risk | 🔴 Critical | 218, 306, 311, 440, 524, 603 | Low — mechanical `?` substitution at 6 sites |
| 2 | Duplicated URL validation (DRY violation) | 🔴 Critical | 173–258, 505–563 | Medium — extract `validateUrl()` function |
| 3 | Arrow-of-doom nesting (8–10 levels deep) | 🟠 High | 171–258, 502–563 | Medium — apply guard-clause pattern |
| 4 | Silently swallowed `err` in DB callbacks | 🟠 High | 224, 308, 313, 373, 441, 529, 604 | Low — add `if (err) return res.status(500)…` |
| 5 | Magic values with no symbolic names | 🟡 Medium | 178, 194, 195, 206, 212, 213, 229, 384, 448, 531, 638 | Low — declare constants at file top |

Addressing smells 1 and 4 are purely mechanical and carry negligible regression risk.
Smells 2 and 3 are best tackled together as part of the MVC refactor described in
[`../README.md#current-limitations--technical-debt`](../README.md#current-limitations--technical-debt),
since extracting `validateUrl()` naturally eliminates the nesting at the same time.
Smell 5 should be done as a standalone preparatory commit before any other refactoring
so that all subsequent diffs reference named constants rather than raw literals.
