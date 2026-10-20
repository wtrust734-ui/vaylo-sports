// Audit patch-*.cjs files in .freebuff for localhost URLs.
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const dir = path.join(root, '.freebuff');

const patchFiles = fs.readdirSync(dir)
  .filter(f => f.startsWith('patch-') && f.endsWith('.cjs'))
  .sort();

let totalHits = 0;

console.log('Auditing .freebuff/patch-*.cjs for localhost URLs...\n');

for (const f of patchFiles) {
  const full = path.join(dir, f);
  try {
    const content = fs.readFileSync(full, 'utf8');
    // match http://... and https://... tokens that look like URLs
    const hits = content.match(/https?:\/\/[^\s"'`<>()]+/gi) || [];
    // filter to localhost-ish
    const localhostHits = hits.filter(h => /localhost/i.test(h));
    if (localhostHits.length) {
      console.log(`📄 ${f}`);
      localhostHits.forEach(h => console.log(`   ${h}`));
      totalHits++;
    }
  } catch (e) {
    console.log(`⚠️  could not read ${f}: ${e.message}`);
  }
}

console.log('\n---');
console.log(`Total patch-*.cjs files with localhost URLs: ${totalHits}`);
