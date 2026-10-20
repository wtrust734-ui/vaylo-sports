import fs from 'node:fs';
import { URL } from 'node:url';

function parseEnv() {
  const out = {};
  for (const line of fs.readFileSync('.env', 'utf8').trim().split(/\r?\n/)) {
    if (!line.includes('=') || line.startsWith('#')) continue;
    const [k, ...v] = line.split('=');
    out[k.trim()] = v.join('=').trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
  return out;
}

const env = parseEnv();
const base = new URL(env.VITE_SUPABASE_URL);
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!key) { console.log('MISSING_PUBLISHABLE_KEY'); process.exit(1); }

const sessPath = '.preview-session.json';
const sess = JSON.parse(fs.readFileSync(sessPath, 'utf8'));
if (!sess.refresh_token) { console.log('MISSING_REFRESH_TOKEN'); process.exit(1); }

const tok = await fetch(new URL('/auth/v1/token?grant_type=refresh_token', base), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: key },
  body: JSON.stringify({ refresh_token: sess.refresh_token }),
});
const s = await tok.json();
if (!s.access_token) {
  console.log('REFRESH_FAILED', tok.status, JSON.stringify(s).slice(0, 500));
  process.exit(1);
}
fs.writeFileSync(sessPath, JSON.stringify({ ...sess, access_token: s.access_token, expires_at: s.expires_at, expires_in: s.expires_in, refresh_token: s.refresh_token }));
fs.writeFileSync('.surf-access-token.txt', s.access_token);
console.log('REFRESH_OK');
console.log('access_token:', s.access_token.slice(0, 40) + '...');
console.log('expires_at:', s.expires_at);
console.log('expires_in:', s.expires_in);
console.log('user_id:', sess.user_id);
console.log('token_type:', s.token_type);
