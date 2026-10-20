#!/usr/bin/env node
/* Refresh the embedded Supabase access token for the 0.7 preview.
   Writes only the bare access_token to:
     <workspace>/vaylo ad web app/0.7.html.token
   and prints OK len=<n> on success, or FAIL ... on error.
   Do not print the token value to stdout. */
const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const WEB_APP = path.resolve(ROOT, '..', 'vaylo ad web app');
const OUT = path.resolve(WEB_APP, '0.7.html.token');
if (!fs.existsSync(OUT.replace(/\/[^\/]+$/, ''))) { fs.mkdirSync(OUT.replace(/\/[^\/]+$/, ''), { recursive: true }); }

const SB_URL = 'vvwhausdjzdmsyxekrcl.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ2d2hhdXNkanpkbXN5eGVrcmNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk4NzUzMjcsImV4cCI6MjEwNTQ1MTMyN30.qZHdYwyP9WsQPclJmqMTAUb2gYlz2OUdBCWagWILS9M';
const REFRESH_TOKEN = 'b6o4cznepvpk';

function post(urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(body, 'utf-8');
    const req = https.request({
      hostname: SB_URL,
      path: urlPath,
      method: 'POST',
      headers: {
        'apikey': ANON_KEY,
        'Content-Type': 'application/json',
        'Content-Length': String(payload.length),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('Invalid JSON response: ' + raw.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

(async () => {
  try {
    const body = JSON.stringify({ refresh_token: REFRESH_TOKEN });
    const j = await post('/auth/v1/token?grant_type=refresh_token', body);
    const token = j.access_token;
    if (!token || typeof token !== 'string') {
      console.error('FAIL no access_token in response');
      process.exit(1);
    }
    fs.writeFileSync(OUT, token, 'utf-8');
    console.log(`OK len=${token.length}`);
  } catch (e) {
    console.error('FAIL', e.message);
    process.exit(1);
  }
})();
