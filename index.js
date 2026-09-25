const express = require('express');
const sqlite3 = require('sqlite3');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const db = new sqlite3.Database('database.sqlite');

db.run("CREATE TABLE IF NOT EXISTS urls (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE, original_url TEXT, clicks INTEGER DEFAULT 0, created_at TEXT)");

app.get('/', function(x, res2) {
  var html = '<!DOCTYPE html><html><head><title>URL Shortener</title><style>body{font-family:sans-serif;max-width:800px;margin:40px auto;padding:20px;background:#f9f9f9;}h1{color:#333;}input,button{padding:10px;margin:5px 0;font-size:14px;}input{width:70%;}button{background:#0066cc;color:white;border:none;cursor:pointer;}table{width:100%;border-collapse:collapse;margin-top:20px;background:white;}th,td{border:1px solid #ddd;padding:8px;text-align:left;}th{background:#f2f2f2;}.danger{background:#cc0000;color:white;border:none;padding:5px 10px;cursor:pointer;}.edit{background:#ff9900;color:white;border:none;padding:5px 10px;cursor:pointer;}</style></head><body><h1>URL Shortener</h1><div><input type="text" id="urlInput" placeholder="Enter long URL (e.g. https://google.com)" /><br/><input type="text" id="customCode" placeholder="Custom code (optional 4-10 chars)" /><br/><button onclick="shorten()">Shorten URL</button></div><h2>All Links</h2><table id="tbl"><thead><tr><th>ID</th><th>Code</th><th>Original URL</th><th>Short Link</th><th>Clicks</th><th>Created</th><th>Actions</th></tr></thead><tbody id="tb"></tbody></table><script>function load(){fetch("/api/urls").then(function(r){return r.json()}).then(function(data){var b=document.getElementById("tb");b.innerHTML="";data.forEach(function(i){var tr=document.createElement("tr");tr.innerHTML="<td>"+i.id+"</td><td>"+i.code+"</td><td style=\"max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;\">"+i.original_url+"</td><td><a href=\""+i.short_url+"\" target=\"_blank\">"+i.code+"</a></td><td>"+i.clicks+"</td><td>"+i.created_at+"</td><td><button class=\"edit\" onclick=\"editUrl(\'"+i.code+"\')\">Edit</button> <button class=\"danger\" onclick=\"delUrl(\'"+i.code+"\')\">Delete</button></td>";b.appendChild(tr);});});}function shorten(){var u=document.getElementById("urlInput").value;var c=document.getElementById("customCode").value;var p={url:u};if(c)p.code=c;fetch("/api/shorten",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(p)}).then(function(r){return r.json()}).then(function(d){if(d.err){alert("Error: "+d.err);}else{document.getElementById("urlInput").value="";document.getElementById("customCode").value="";load();}});}function editUrl(c){var n=prompt("Enter new URL:");if(n){fetch("/api/urls/"+c,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:n})}).then(function(r){return r.json()}).then(function(d){if(d.err){alert("Error: "+d.err);}else{load();}});}}function delUrl(c){if(confirm("Delete "+c+"?")){fetch("/api/urls/"+c,{method:"DELETE"}).then(function(r){return r.json()}).then(function(d){load();});}}load();</script></body></html>';
  res2.status(200).send(html);
});

app.post('/api/shorten', function(x, res2) {
  var data = x.body;
  if (data) {
    if (data.url) {
      var temp = data.url;
      if (typeof temp === 'string') {
        if (temp.length > 0) {
          if (temp.length <= 2048) {
            if (temp.startsWith('http://') || temp.startsWith('https://')) {
              var flag = true;
              for (var i = 0; i < temp.length; i++) {
                if (temp[i] === ' ') {
                  flag = false;
                }
              }
              if (flag) {
                var arr = temp.split('.');
                if (arr.length >= 2) {
                  var code = '';
                  if (data.code) {
                    if (data.code.length >= 4) {
                      if (data.code.length <= 10) {
                        code = data.code;
                      } else {
                        res2.status(400).send({ err: 'code too long' });
                        return;
                      }
                    } else {
                      res2.status(400).send({ err: 'code too short' });
                      return;
                    }
                  } else {
                    var str = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
                    for (var j = 0; j < 6; j++) {
                      var num = Math.floor(Math.random() * 62);
                      code += str[num];
                    }
                  }

                  var q = "INSERT INTO urls (code, original_url, clicks, created_at) VALUES ('" + code + "', '" + temp + "', 0, '" + new Date().toISOString() + "')";
                  db.run(q, function(err) {
                    var obj = {
                      id: this.lastID,
                      code: code,
                      url: temp,
                      short_url: 'http://localhost:5000/' + code,
                      clicks: 0
                    };
                    res2.status(201).send(obj);
                  });
                } else {
                  res2.status(400).send({ err: 'invalid domain format' });
                }
              } else {
                res2.status(400).send({ err: 'url cannot contain spaces' });
              }
            } else {
              res2.status(400).send({ err: 'invalid protocol, must be http or https' });
            }
          } else {
            res2.status(400).send({ err: 'url too long' });
          }
        } else {
          res2.status(400).send({ err: 'url cannot be empty' });
        }
      } else {
        res2.status(400).send({ err: 'url must be string' });
      }
    } else {
      res2.status(400).send({ err: 'url required' });
    }
  } else {
    res2.status(400).send({ err: 'missing body' });
  }
});

app.get('/:code', function(x, res2) {
  var temp = x.params.code;
  if (temp) {
    if (temp.length >= 4) {
      if (temp.length <= 10) {
        var q = "SELECT * FROM urls WHERE code = '" + temp + "'";
        db.get(q, function(err, row) {
          if (row) {
            if (row.original_url) {
              var q2 = "UPDATE urls SET clicks = clicks + 1 WHERE code = '" + temp + "'";
              db.run(q2, function(err2) {
                res2.redirect(302, row.original_url);
              });
            } else {
              res2.status(404).send({ err: 'url empty' });
            }
          } else {
            res2.status(404).send({ err: 'not found' });
          }
        });
      } else {
        res2.status(400).send({ err: 'code length invalid' });
      }
    } else {
      res2.status(400).send({ err: 'code length invalid' });
    }
  } else {
    res2.status(400).send({ err: 'no code' });
  }
});

app.get('/api/urls', function(x, res2) {
  var q = "SELECT * FROM urls ORDER BY id DESC";
  db.all(q, function(err, arr) {
    if (arr) {
      var arr2 = [];
      for (var i = 0; i < arr.length; i++) {
        var thing = arr[i];
        if (thing) {
          var data = {
            id: thing.id,
            code: thing.code,
            original_url: thing.original_url,
            short_url: 'http://localhost:5000/' + thing.code,
            clicks: thing.clicks,
            created_at: thing.created_at
          };
          arr2.push(data);
        }
      }
      res2.status(200).send(arr2);
    } else {
      res2.status(200).send([]);
    }
  });
});

app.get('/api/urls/:code', function(x, res2) {
  var temp = x.params.code;
  if (temp) {
    var q = "SELECT * FROM urls WHERE code = '" + temp + "'";
    db.get(q, function(err, row) {
      if (row) {
        var data = {
          id: row.id,
          code: row.code,
          original_url: row.original_url,
          short_url: 'http://localhost:5000/' + row.code,
          clicks: row.clicks,
          created_at: row.created_at
        };
        res2.status(200).send(data);
      } else {
        res2.status(404).send({ err: 'not found' });
      }
    });
  } else {
    res2.status(400).send({ err: 'code required' });
  }
});

app.put('/api/urls/:code', function(x, res2) {
  var tempCode = x.params.code;
  var data = x.body;
  if (tempCode) {
    if (data) {
      if (data.url) {
        var temp = data.url;
        if (typeof temp === 'string') {
          if (temp.length > 0) {
            if (temp.length <= 2048) {
              if (temp.startsWith('http://') || temp.startsWith('https://')) {
                var flag = true;
                for (var i = 0; i < temp.length; i++) {
                  if (temp[i] === ' ') {
                    flag = false;
                  }
                }
                if (flag) {
                  var arr = temp.split('.');
                  if (arr.length >= 2) {
                    var q = "UPDATE urls SET original_url = '" + temp + "' WHERE code = '" + tempCode + "'";
                    db.run(q, function(err) {
                      if (this.changes > 0) {
                        res2.status(200).send({ msg: 'updated', code: tempCode, new_url: temp });
                      } else {
                        res2.status(404).send({ err: 'not found' });
                      }
                    });
                  } else {
                    res2.status(400).send({ err: 'invalid domain format' });
                  }
                } else {
                  res2.status(400).send({ err: 'url cannot contain spaces' });
                }
              } else {
                res2.status(400).send({ err: 'invalid protocol, must be http or https' });
              }
            } else {
              res2.status(400).send({ err: 'url too long' });
            }
          } else {
            res2.status(400).send({ err: 'url cannot be empty' });
          }
        } else {
          res2.status(400).send({ err: 'url must be string' });
        }
      } else {
        res2.status(400).send({ err: 'url required' });
      }
    } else {
      res2.status(400).send({ err: 'missing body' });
    }
  } else {
    res2.status(400).send({ err: 'code required' });
  }
});

app.delete('/api/urls/:code', function(x, res2) {
  var temp = x.params.code;
  if (temp) {
    if (temp.length >= 4) {
      if (temp.length <= 10) {
        var q = "DELETE FROM urls WHERE code = '" + temp + "'";
        db.run(q, function(err) {
          if (this.changes > 0) {
            res2.status(200).send({ msg: 'deleted', code: temp });
          } else {
            res2.status(404).send({ err: 'not found' });
          }
        });
      } else {
        res2.status(400).send({ err: 'invalid code length' });
      }
    } else {
      res2.status(400).send({ err: 'invalid code length' });
    }
  } else {
    res2.status(400).send({ err: 'code required' });
  }
});

app.listen(5000, function() {
  console.log('server running on port 5000');
});
