// One-off driver: run a .sql file through run-sql.cjs without any shell
// quoting hazards (the migration contains $$ bodies, quotes and semicolons).
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/run-sql-file.cjs <path-to.sql>");
  process.exit(1);
}

const sql = fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
try {
  const out = execFileSync(
    "node",
    [path.join(__dirname, "run-sql.cjs"), sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  console.log(out);
} catch (e) {
  console.log((e.stdout || "") + (e.stderr || ""));
  process.exit(1);
}
