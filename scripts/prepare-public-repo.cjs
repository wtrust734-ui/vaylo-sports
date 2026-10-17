const fs = require('fs');
const { execSync } = require('child_process');

const root = process.env.GITHUB_WORKSPACE || process.cwd();

let gitignore = fs.readFileSync('.gitignore', 'utf8');
if (!gitignore.endsWith('\n')) gitignore += '\n';
const lines = gitignore.split(/\r?\n/);
const block = [
  '*.apk',
  '*.aab',
  '*.tgz',
  '*.zip',
  '*.gz',
  '*.xz',
  '*.7z',
  'tmp_*.py',
  'tmp_*.sh',
  'tmp_*.js',
  'tmp_*.json',
  'tmp_*.ts',
  'tmp_*.mjs',
  'tmp_*.cjs',
  'temp/',
  'tmp_build_profile.py',
  'tmp_diagnose_profile.py',
  'tmp_fix_profile.py',
  'tmp_inspect_profile_render.py',
  'tmp_inventory_profile.py',
  'tmp_tsconfig_app_no_upload.json',
  'Vaylo-Sports-*-release.apk',
  'vaylo-sports-*-release.apk',
  'node_modules/',
  'dist/',
  'dist-web/',
  '.vercel/',
  '.env',
  '.env.local',
  '.env.*.local',
  '*.pem',
  '*.key',
  '*.p12',
  '*.jks',
  '*.keystore',
];
const added = [];
for (const line of block) {
  if (!lines.includes(line)) {
    lines.push(line);
    added.push(line);
  }
}
fs.writeFileSync('.gitignore', lines.join('\n') + '\n');
console.log('added .gitignore entries:', added.join(', '));

const readme = [
  '# Vaylo Sports',
  '',
  'Public source for the Vaylo sports app / ad platform checkout.',
  '',
  'This repo is the working tree behind the current local build. It is not an official',
  'release artifact — APKs, bundles, and dist outputs are intentionally excluded via',
  '.gitignore and should be published through the project release pipeline instead.',
  '',
  '## Local setup',
  '',
  '```bash',
  'npm install',
  '```',
  '',
  'Requires Node >= 22.',
  '',
  '## Scripts',
  '',
  '- `npm run build` — app build',
  '- `npm run typecheck` — app + functions typecheck',
  '- `npm run test` — Vitest suite',
  '- `npm run lint` — ESLint',
  '',
  '## Supabase functions',
  '',
  'Supabase Edge functions live under `supabase/functions/`. Migrations live under',
  '`supabase/migrations/`. Do not commit secrets; use environment injection at deploy time.',
  '',
].join('\n') + '\n';

fs.writeFileSync('README.md', readme);
console.log('README.md updated for public repo');
