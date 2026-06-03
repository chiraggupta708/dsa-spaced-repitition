#!/usr/bin/env node
/**
 * Coding Journal API Server
 * Zero-dependency REST API using only Node.js built-in modules.
 */

const http = require('http');
const fs = require('fs');
const pathModule = require('path');
const urlModule = require('url');

const PORT = process.env.PORT || 3000;
const DATA_DIR = pathModule.join(__dirname, 'data');
const DATA_FILE = pathModule.join(DATA_DIR, 'journal.json');

/* ------------------------------------------------------------------ */
/*  SM-2 Algorithm                                                     */
/* ------------------------------------------------------------------ */

function sm2Calc(quality, card) {
  var EF = card.easinessFactor || 2.5;
  var interval = card.interval || 0;
  var reps = card.repetitions || 0;
  var today = new Date().toISOString().slice(0, 10);

  if (quality < 3) {
    reps = 0;
    interval = 0;
  } else {
    if (reps === 0) {
      interval = 1;
    } else if (reps === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * EF);
    }
    reps += 1;
  }

  var q = quality;
  EF = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (EF < 1.3) EF = 1.3;

  var nextReview = new Date();
  nextReview.setDate(nextReview.getDate() + interval);
  var nextReviewStr = nextReview.toISOString().slice(0, 10);

  return {
    easinessFactor: Math.round(EF * 100) / 100,
    interval: interval,
    repetitions: reps,
    nextReview: nextReviewStr,
    lastReview: today,
    lastQuality: q
  };
}

/* ------------------------------------------------------------------ */
/*  Data Store                                                         */
/* ------------------------------------------------------------------ */

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ cards: [] }), 'utf-8');
  }
}

function readData() {
  var raw = fs.readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(raw);
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function defaultSm2() {
  return {
    easinessFactor: 2.5,
    interval: 0,
    repetitions: 0,
    nextReview: null,
    lastReview: null,
    lastQuality: null
  };
}

function countStreak(cards) {
  var streaks = {};
  cards.forEach(function (c) {
    if (c.sm2 && c.sm2.lastReview) {
      streaks[c.sm2.lastReview] = true;
    }
  });
  var streakDays = Object.keys(streaks).sort().reverse();
  var count = 0;
  var check = new Date();
  for (var i = 0; i < streakDays.length; i++) {
    var expected = new Date(check);
    expected.setDate(expected.getDate() - count);
    var expectedStr = expected.toISOString().slice(0, 10);
    if (streakDays[i] === expectedStr) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

var MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain'
};

function getContentType(ext) {
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function sendJSON(res, statusCode, data) {
  var headers = {
    'Content-Type': 'application/json'
  };
  var ch = corsHeaders();
  for (var key in ch) {
    headers[key] = ch[key];
  }
  res.writeHead(statusCode, headers);
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    req.on('data', function (chunk) {
      chunks.push(chunk);
    });
    req.on('end', function () {
      var body = Buffer.concat(chunks).toString('utf-8');
      if (!body) {
        return reject(new Error('Empty body'));
      }
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/* ------------------------------------------------------------------ */
/*  API Router                                                         */
/* ------------------------------------------------------------------ */

function handleAPI(req, res, pathParts) {
  var method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    return res.end();
  }

  // ------------------------ GET /api/health ------------------------
  if (method === 'GET' && pathParts.length === 2 && pathParts[1] === 'health') {
    try {
      var data = readData();
      sendJSON(res, 200, { status: 'ok', cards: data.cards.length });
    } catch (e) {
      sendJSON(res, 500, { ok: false, error: 'Internal error' });
    }
    return;
  }

  // ------------------------ GET /api/export ------------------------
  if (method === 'GET' && pathParts.length === 2 && pathParts[1] === 'export') {
    try {
      var exportData = readData();
      var jsonStr = JSON.stringify(exportData, null, 2);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="coding-journal-backup.json"',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(jsonStr);
    } catch (e) {
      sendJSON(res, 500, { ok: false, error: 'Internal error' });
    }
    return;
  }

  // ------------------------ POST /api/import -----------------------
  if (method === 'POST' && pathParts.length === 2 && pathParts[1] === 'import') {
    parseBody(req).then(function (body) {
      if (!body || !Array.isArray(body.cards)) {
        sendJSON(res, 400, { ok: false, error: 'Body must have a cards array' });
        return;
      }
      writeData({ cards: body.cards });
      sendJSON(res, 200, { ok: true, count: body.cards.length });
    }).catch(function (err) {
      sendJSON(res, 400, { ok: false, error: err.message === 'Empty body' ? 'Empty body' : 'Invalid JSON' });
    });
    return;
  }

  // ------------------------ GET /api/stats -------------------------
  if (method === 'GET' && pathParts.length === 2 && pathParts[1] === 'stats') {
    try {
      var dataStats = readData();
      var allCards = dataStats.cards;
      var total = allCards.length;
      var mastered = 0;
      var due = 0;
      var todayStr = todayISO();
      allCards.forEach(function (c) {
        if (c.sm2 && c.sm2.repetitions >= 5) mastered++;
        if (!c.sm2 || !c.sm2.nextReview || c.sm2.nextReview <= todayStr) due++;
      });
      sendJSON(res, 200, {
        ok: true,
        stats: {
          total: total,
          due: due,
          mastered: mastered,
          streak: countStreak(allCards)
        }
      });
    } catch (e) {
      sendJSON(res, 500, { ok: false, error: 'Internal error' });
    }
    return;
  }

  // ------------------------ GET /api/cards/due ---------------------
  if (method === 'GET' && pathParts.length === 3 && pathParts[1] === 'cards' && pathParts[2] === 'due') {
    try {
      var dueData = readData();
      var todayDue = todayISO();
      var dueCards = dueData.cards.filter(function (c) {
        return !c.sm2 || !c.sm2.nextReview || c.sm2.nextReview <= todayDue;
      });
      dueCards.sort(function (a, b) {
        var aNext = a.sm2 && a.sm2.nextReview ? a.sm2.nextReview : '';
        var bNext = b.sm2 && b.sm2.nextReview ? b.sm2.nextReview : '';
        if (aNext !== bNext) {
          if (!aNext) return -1;
          if (!bNext) return 1;
          return aNext < bNext ? -1 : 1;
        }
        var aEF = a.sm2 && a.sm2.easinessFactor != null ? a.sm2.easinessFactor : 2.5;
        var bEF = b.sm2 && b.sm2.easinessFactor != null ? b.sm2.easinessFactor : 2.5;
        return aEF - bEF;
      });
      sendJSON(res, 200, { ok: true, cards: dueCards });
    } catch (e) {
      sendJSON(res, 500, { ok: false, error: 'Internal error' });
    }
    return;
  }

  // ------------------------ GET /api/cards/mastered ----------------
  if (method === 'GET' && pathParts.length === 3 && pathParts[1] === 'cards' && pathParts[2] === 'mastered') {
    try {
      var masteredData = readData();
      var masteredCards = masteredData.cards.filter(function (c) {
        return c.sm2 && c.sm2.repetitions >= 5;
      });
      sendJSON(res, 200, { ok: true, cards: masteredCards });
    } catch (e) {
      sendJSON(res, 500, { ok: false, error: 'Internal error' });
    }
    return;
  }

  // ------------------------ GET /api/cards -------------------------
  if (method === 'GET' && pathParts.length === 2 && pathParts[1] === 'cards') {
    try {
      var cardsData = readData();
      var sorted = cardsData.cards.slice().sort(function (a, b) {
        return a.created > b.created ? -1 : a.created < b.created ? 1 : 0;
      });
      sendJSON(res, 200, { ok: true, cards: sorted });
    } catch (e) {
      sendJSON(res, 500, { ok: false, error: 'Internal error' });
    }
    return;
  }

  // ------------------------ POST /api/cards ------------------------
  if (method === 'POST' && pathParts.length === 2 && pathParts[1] === 'cards') {
    parseBody(req).then(function (body) {
      var card = {
        id: generateId(),
        created: todayISO(),
        updated: todayISO(),
        question: body.question || '',
        link: body.link || '',
        tags: Array.isArray(body.tags) ? body.tags : [],
        difficulty: body.difficulty || 'medium',
        actual_code: body.actual_code || '',
        my_thinking: body.my_thinking || '',
        right_thinking: body.right_thinking || '',
        notes: body.notes || '',
        sm2: defaultSm2()
      };
      var cData = readData();
      cData.cards.push(card);
      writeData(cData);
      sendJSON(res, 201, { ok: true, card: card });
    }).catch(function (err) {
      sendJSON(res, 400, { ok: false, error: err.message === 'Empty body' ? 'Empty body' : 'Invalid JSON' });
    });
    return;
  }

  // -------------------- Single card: GET/PUT/DELETE /api/cards/:id -
  if (pathParts.length >= 3 && pathParts[1] === 'cards' && pathParts[2]) {
    var cardId = pathParts[2];

    // POST /api/cards/:id/review
    if (method === 'POST' && pathParts.length === 4 && pathParts[3] === 'review') {
      parseBody(req).then(function (body) {
        var quality = body.quality;
        if (quality === undefined || quality === null || !Number.isInteger(Number(quality)) || quality < 0 || quality > 5) {
          sendJSON(res, 400, { ok: false, error: 'quality must be an integer 0-5' });
          return;
        }
        quality = Number(quality);
        var rData = readData();
        var rIdx = -1;
        for (var ri = 0; ri < rData.cards.length; ri++) {
          if (rData.cards[ri].id === cardId) {
            rIdx = ri;
            break;
          }
        }
        if (rIdx === -1) {
          sendJSON(res, 404, { ok: false, error: 'Card not found' });
          return;
        }
        var card = rData.cards[rIdx];
        var newSm2 = sm2Calc(quality, card.sm2 || {});
        card.sm2 = newSm2;
        card.updated = todayISO();
        rData.cards[rIdx] = card;
        writeData(rData);
        sendJSON(res, 200, { ok: true, card: card });
      }).catch(function (err) {
        sendJSON(res, 400, { ok: false, error: err.message === 'Empty body' ? 'Empty body' : 'Invalid JSON' });
      });
      return;
    }

    // GET /api/cards/:id
    if (method === 'GET') {
      try {
        var gData = readData();
        var found = null;
        for (var gi = 0; gi < gData.cards.length; gi++) {
          if (gData.cards[gi].id === cardId) {
            found = gData.cards[gi];
            break;
          }
        }
        if (!found) {
          sendJSON(res, 404, { ok: false, error: 'Card not found' });
          return;
        }
        sendJSON(res, 200, { ok: true, card: found });
      } catch (e) {
        sendJSON(res, 500, { ok: false, error: 'Internal error' });
      }
      return;
    }

    // PUT /api/cards/:id
    if (method === 'PUT') {
      parseBody(req).then(function (body) {
        var uData = readData();
        var idx = -1;
        for (var ui = 0; ui < uData.cards.length; ui++) {
          if (uData.cards[ui].id === cardId) {
            idx = ui;
            break;
          }
        }
        if (idx === -1) {
          sendJSON(res, 404, { ok: false, error: 'Card not found' });
          return;
        }
        var existing = uData.cards[idx];
        if (body.question !== undefined) existing.question = body.question;
        if (body.link !== undefined) existing.link = body.link;
        if (body.tags !== undefined) existing.tags = body.tags;
        if (body.difficulty !== undefined) existing.difficulty = body.difficulty;
        if (body.actual_code !== undefined) existing.actual_code = body.actual_code;
        if (body.my_thinking !== undefined) existing.my_thinking = body.my_thinking;
        if (body.right_thinking !== undefined) existing.right_thinking = body.right_thinking;
        if (body.notes !== undefined) existing.notes = body.notes;
        existing.updated = todayISO();
        uData.cards[idx] = existing;
        writeData(uData);
        sendJSON(res, 200, { ok: true, card: existing });
      }).catch(function (err) {
        sendJSON(res, 400, { ok: false, error: err.message === 'Empty body' ? 'Empty body' : 'Invalid JSON' });
      });
      return;
    }

    // DELETE /api/cards/:id
    if (method === 'DELETE') {
      try {
        var dData = readData();
        var dIdx = -1;
        for (var di = 0; di < dData.cards.length; di++) {
          if (dData.cards[di].id === cardId) {
            dIdx = di;
            break;
          }
        }
        if (dIdx === -1) {
          sendJSON(res, 404, { ok: false, error: 'Card not found' });
          return;
        }
        dData.cards.splice(dIdx, 1);
        writeData(dData);
        sendJSON(res, 200, { ok: true });
      } catch (e) {
        sendJSON(res, 500, { ok: false, error: 'Internal error' });
      }
      return;
    }

    // Unsupported method on /api/cards/:id
    sendJSON(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }

  // Fallback 404 for unmatched API routes
  sendJSON(res, 404, { ok: false, error: 'Not found' });
}

/* ------------------------------------------------------------------ */
/*  Static File Server                                                 */
/* ------------------------------------------------------------------ */

function serveStatic(req, res, pathname) {
  var filePath = pathname === '/' ? pathModule.join(__dirname, 'index.html') : pathModule.join(__dirname, pathname);

  fs.readFile(filePath, function (err, content) {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, {
          'Content-Type': 'text/plain',
          'Access-Control-Allow-Origin': '*'
        });
        res.end('Not found');
        return;
      }
      res.writeHead(500, {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*'
      });
      res.end('Internal server error');
      return;
    }
    var ext = pathModule.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': getContentType(ext),
      'Access-Control-Allow-Origin': '*'
    });
    res.end(content);
  });
}

/* ------------------------------------------------------------------ */
/*  Main Server                                                        */
/* ------------------------------------------------------------------ */

function handleRequest(req, res) {
  var parsedUrl = urlModule.parse(req.url, true);
  var pathname = parsedUrl.pathname;

  // API routes
  if (pathname.startsWith('/api')) {
    var pathParts = pathname.split('/').filter(Boolean);
    handleAPI(req, res, pathParts);
    return;
  }

  // Static files
  serveStatic(req, res, pathname);
}

var server = http.createServer(handleRequest);

ensureDataFile();

server.listen(PORT, function () {
  console.log('Coding Journal API running on http://localhost:' + PORT);
  console.log('Data file: ' + DATA_FILE);
});
