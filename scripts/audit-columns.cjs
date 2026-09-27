// Cross-checks every "<table>.<column>" or select("col1,col2") reference in src/
// against the live schema dump (temp/schema_columns.txt from the management API).
// Reports columns the code reads/writes that DO NOT exist in the live DB.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const schemaPath = process.argv[2];
if (!schemaPath) { console.error("usage: node audit-columns.cjs <schema-dump>"); process.exit(1); }

// schema dump lines look like: table.column  (plus BOM/blank/extra whitespace)
const live = new Set(
  fs.readFileSync(schemaPath, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
);
// tables mentioned anywhere in the dump
const liveTables = new Set([...live].map((s) => s.split(".")[0]));

// collect src files
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(p);
  }
  return out;
}
const files = walk(path.join(ROOT, "src"));

const findings = new Map(); // "table.column" -> [file:line]
for (const file of files) {
  const rel = path.relative(ROOT, file);
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // from("table") / .from('table')
    const fromMatch = line.match(/\.from\(\s*["'`]([a-z_0-9]+)["'`]\s*\)/);
    if (fromMatch) {
      const table = fromMatch[1];
      if (!liveTables.has(table)) {
        add(`${table}.<TABLE>`, `${rel}:${i + 1}`);
      }
    }
    // quoted dotted refs inside .from/.upsert/.update/.select/.eq/.insert arguments:
    // match "table.column" patterns with word boundaries
    for (const m of line.matchAll(/["'`]([a-z_][a-z_0-9]*)\.([a-z_][a-z_0-9]*)["'`]/g)) {
      const table = m[1];
      const column = m[2];
      // skip TS namespaces/types (e.g. "error.message"), imports, file paths, urls
      if (/^(import|export|from|node|fs|path|http|https|console|window|document|process|env|import\.meta)$/.test(table)) continue;
      if (m[0].includes("/") || m[0].includes(":")) continue;
      if (!liveTables.has(table)) continue; // not a DB table reference at all
      if (!live.has(`${table}.${column}`)) {
        add(`${table}.${column}`, `${rel}:${i + 1}`);
      }
    }
    // .select("col_a,col_b") and .select("table.col") column lists
    for (const m of line.matchAll(/\.select\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) {
      const list = m[1];
      if (list.includes("*")) continue;
      for (const col of list.split(",")) {
        const c = col.trim().replace(/\s+as\s+.+$/, "");
        if (!c || c.startsWith("!") || c.startsWith("-")) continue;
        const dotted = c.match(/^([a-z_][a-z_0-9]*)\.([a-z_][a-z_0-9*]*)$/);
        if (dotted) {
          // relation reference: relation.column (only flag if relation table known & column missing)
          if (liveTables.has(dotted[1]) && !live.has(`${dotted[1]}.${dotted[2]}`) && dotted[2] !== "*") {
            add(`${dotted[1]}.${dotted[2]}`, `${rel}:${i + 1}`);
          }
        } else if (c.includes(".")) continue; // json path or nested
      }
    }
  }
}
function add(key, loc) {
  if (!findings.has(key)) findings.set(key, []);
  findings.get(key).push(loc);
}

if (findings.size === 0) {
  console.log("NO PHANTOM COLUMNS FOUND");
} else {
  console.log(`PHANTOM COLUMNS: ${findings.size}`);
  for (const [key, locs] of [...findings].sort()) {
    console.log(`  ${key}  (${locs.length}x)`);
    for (const l of locs.slice(0, 5)) console.log(`      ${l}`);
  }
}
