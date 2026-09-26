'use strict';

/**
 * @file src/controllers/urlController.js
 * @description Route handler functions (business logic) for the URL Shortener.
 *
 * Each exported function is a standard Express request handler. Handlers
 * depend on the shared db instance, the validator, the code generator, and
 * the BASE_URL constant — all injected via module imports rather than globals.
 *
 * No Express app or router is created here; that is the responsibility of
 * src/routes/urlRoutes.js.
 */

const { db } = require('../db');
const { validateUrl, validateCode } = require('../utils/validator');
const { generateCode } = require('../utils/shortener');
const { BASE_URL, CODE_MIN_LENGTH, CODE_MAX_LENGTH } = require('../config');

/**
 * Serve the single-page URL Shortener UI.
 * GET /
 */
function serveUI(req, res) {
  var html = '<!DOCTYPE html><html><head><title>URL Shortener</title><style>body{font-family:sans-serif;max-width:800px;margin:40px auto;padding:20px;background:#f9f9f9;}h1{color:#333;}input,button{padding:10px;margin:5px 0;font-size:14px;}input{width:70%;}button{background:#0066cc;color:white;border:none;cursor:pointer;}table{width:100%;border-collapse:collapse;margin-top:20px;background:white;}th,td{border:1px solid #ddd;padding:8px;text-align:left;}th{background:#f2f2f2;}.danger{background:#cc0000;color:white;border:none;padding:5px 10px;cursor:pointer;}.edit{background:#ff9900;color:white;border:none;padding:5px 10px;cursor:pointer;}</style></head><body><h1>URL Shortener</h1><div><input type="text" id="urlInput" placeholder="Enter long URL (e.g. https://google.com)" /><br/><input type="text" id="customCode" placeholder="Custom code (optional 4-10 chars)" /><br/><button onclick="shorten()">Shorten URL</button></div><h2>All Links</h2><table id="tbl"><thead><tr><th>ID</th><th>Code</th><th>Original URL</th><th>Short Link</th><th>Clicks</th><th>Created</th><th>Actions</th></tr></thead><tbody id="tb"></tbody></table><script>function load(){fetch("/api/urls").then(function(r){return r.json()}).then(function(data){var b=document.getElementById("tb");b.innerHTML="";data.forEach(function(i){var tr=document.createElement("tr");tr.innerHTML="<td>"+i.id+"</td><td>"+i.code+"</td><td style=\"max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;\">"+i.original_url+"</td><td><a href=\""+i.short_url+"\" target=\"_blank\">"+i.code+"</a></td><td>"+i.clicks+"</td><td>"+i.created_at+"</td><td><button class=\"edit\" onclick=\"editUrl(\'"+i.code+"\')\">Edit</button> <button class=\"danger\" onclick=\"delUrl(\'"+i.code+"\')\">Delete</button></td>";b.appendChild(tr);});});}function shorten(){var u=document.getElementById("urlInput").value;var c=document.getElementById("customCode").value;var p={url:u};if(c)p.code=c;fetch("/api/shorten",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(p)}).then(function(r){return r.json()}).then(function(d){if(d.err){alert("Error: "+d.err);}else{document.getElementById("urlInput").value="";document.getElementById("customCode").value="";load();}});}function editUrl(c){var n=prompt("Enter new URL:");if(n){fetch("/api/urls/"+c,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:n})}).then(function(r){return r.json()}).then(function(d){if(d.err){alert("Error: "+d.err);}else{load();}});}}function delUrl(c){if(confirm("Delete "+c+"?")){fetch("/api/urls/"+c,{method:"DELETE"}).then(function(r){return r.json()}).then(function(d){load();});}}load();</script></body></html>';
  res.status(200).send(html);
}

/**
 * Create a new short URL entry.
 * POST /api/shorten
 */
function createShortUrl(req, res) {
  var body = req.body;
  if (!body)     { return res.status(400).send({ err: 'missing body' }); }
  if (!body.url) { return res.status(400).send({ err: 'url required' }); }

  var targetUrl = body.url;
  var urlError = validateUrl(targetUrl);
  if (urlError) { return res.status(400).send({ err: urlError }); }

  var shortCode;
  if (body.code) {
    var codeError = validateCode(body.code);
    if (codeError) { return res.status(400).send({ err: codeError }); }
    shortCode = body.code;
  } else {
    shortCode = generateCode();
  }

  db.run(
    'INSERT INTO urls (code, original_url, clicks, created_at) VALUES (?, ?, 0, ?)',
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
        clicks: 0,
      });
    }
  );
}

/**
 * Redirect a short code to its stored destination URL.
 * GET /:code
 */
function redirectToUrl(req, res) {
  var shortCode = req.params.code;
  if (!shortCode) { return res.status(400).send({ err: 'no code' }); }
  if (shortCode.length < CODE_MIN_LENGTH ||
      shortCode.length > CODE_MAX_LENGTH) {
    return res.status(400).send({ err: 'code length invalid' });
  }

  db.get(
    'SELECT * FROM urls WHERE code = ?',
    [shortCode],
    function(err, urlRecord) {
      if (err) {
        console.error('db SELECT error (redirect):', err);
        return res.status(500).send({ err: 'internal server error' });
      }
      if (!urlRecord)              { return res.status(404).send({ err: 'not found' }); }
      if (!urlRecord.original_url) { return res.status(404).send({ err: 'url empty' }); }

      /* Increment clicks; a counter failure must not abort the redirect. */
      db.run(
        'UPDATE urls SET clicks = clicks + 1 WHERE code = ?',
        [shortCode],
        function(err2) {
          if (err2) { console.error('db UPDATE clicks error:', err2); }
          res.redirect(302, urlRecord.original_url);
        }
      );
    }
  );
}

/**
 * Return all short URL records ordered by most recently created.
 * GET /api/urls
 */
function listUrls(req, res) {
  db.all(
    'SELECT * FROM urls ORDER BY id DESC',
    [],
    function(err, rows) {
      if (err) {
        console.error('db SELECT ALL error:', err);
        return res.status(500).send({ err: 'internal server error' });
      }
      if (!rows) { return res.status(200).send([]); }

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
          created_at: row.created_at,
        });
      }
      res.status(200).send(records);
    }
  );
}

/**
 * Fetch a single short URL record by its short code.
 * GET /api/urls/:code
 */
function getUrl(req, res) {
  var shortCode = req.params.code;
  if (!shortCode) { return res.status(400).send({ err: 'code required' }); }

  db.get(
    'SELECT * FROM urls WHERE code = ?',
    [shortCode],
    function(err, urlRecord) {
      if (err) {
        console.error('db SELECT error (fetch one):', err);
        return res.status(500).send({ err: 'internal server error' });
      }
      if (!urlRecord) { return res.status(404).send({ err: 'not found' }); }

      res.status(200).send({
        id: urlRecord.id,
        code: urlRecord.code,
        original_url: urlRecord.original_url,
        short_url: BASE_URL + '/' + urlRecord.code,
        clicks: urlRecord.clicks,
        created_at: urlRecord.created_at,
      });
    }
  );
}

/**
 * Update the destination URL for an existing short code.
 * PUT /api/urls/:code
 */
function updateUrl(req, res) {
  var shortCode = req.params.code;
  var body = req.body;
  if (!shortCode) { return res.status(400).send({ err: 'code required' }); }
  if (!body)      { return res.status(400).send({ err: 'missing body' }); }
  if (!body.url)  { return res.status(400).send({ err: 'url required' }); }

  var targetUrl = body.url;
  var urlError = validateUrl(targetUrl);
  if (urlError) { return res.status(400).send({ err: urlError }); }

  db.run(
    'UPDATE urls SET original_url = ? WHERE code = ?',
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
}

/**
 * Permanently remove a short URL entry by its short code.
 * DELETE /api/urls/:code
 */
function deleteUrl(req, res) {
  var shortCode = req.params.code;
  if (!shortCode) { return res.status(400).send({ err: 'code required' }); }
  if (shortCode.length < CODE_MIN_LENGTH ||
      shortCode.length > CODE_MAX_LENGTH) {
    return res.status(400).send({ err: 'invalid code length' });
  }

  db.run(
    'DELETE FROM urls WHERE code = ?',
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
}

module.exports = {
  serveUI,
  createShortUrl,
  redirectToUrl,
  listUrls,
  getUrl,
  updateUrl,
  deleteUrl,
};
