// Patch any .cjs file that references localhost URLs to point at the real
// Supabase project URL. Run from the project root.
const { resolve, join } = require('path');
const fs = require('fs');

const root = process.cwd();
// Supabase project URL — real, not localhost.
const REAL_URL = 'https://vvwhausdjzdmmsyxekrcl.supabase.co';

function walk(dir) {
  let found = null;
  let entries;
  try { entries = fs.readdirSync(dir); } catch (e) { return found; }
  for (const entry of entries) {
    const full = join(dir, entry);
    try {
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        if (entry.startsWith('.') || entry === 'node_modules' || entry === '.git') continue;
        const r = walk(full);
        if (r) return r;
      } else if (entry.endsWith('.cjs')) {
        found = full;
        break;
      }
    } catch (e) { /* skip unreadable */ }
  }
  return found;
}

const file = walk(root);
if (!file) {
  console.log('No .cjs file found to patch.');
  process.exit(0);
}

console.log('Found .cjs file to patch:', file);
const content = fs.readFileSync(file, 'utf8');
const localhostPattern = /http:\/\/[a-z0-9.-]*(?::\d{2,5})?/gi;
const matches = content.match(localhostPattern) || [];
if (matches.length === 0) {
  console.log('No localhost URLs found — nothing to patch.');
  process.exit(0);
}
console.log('Found localhost URL(s):', matches.slice(0, 5));

const patched = content.replace(localhostPattern, REAL_URL);
if (patched === content) {
  console.log('No changes made.');
  process.exit(0);
}

fs.writeFileSync(file, patched, 'utf8');
console.log('Patched.', file);
