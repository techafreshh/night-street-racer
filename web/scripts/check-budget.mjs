// Budget gate (mirrors scripts/smoke.mjs non-zero-exit convention):
// weighs every file under dist/assets gzipped in-process, prints
// `budget: <sum> / 15728640 bytes gz`, and exits non-zero with the five
// largest offenders on stderr when the total exceeds 15 MB. Any I/O
// failure (missing dist, unreadable chunk) also exits non-zero with the
// reason on stderr.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const BUDGET_BYTES = 15 * 1024 * 1024;
const OFFENDERS_SHOWN = 5;

function fail(reason) {
  console.error(`budget: ${reason}`);
  process.exit(1);
}

function collectFiles(dir) {
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    fail(`cannot read ${dir}: ${err.message}`);
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out = out.concat(collectFiles(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const assetsDir = join(here, "..", "dist", "assets");
  let isDir = false;
  try {
    isDir = statSync(assetsDir).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) {
    fail(`missing assets dir ${assetsDir} (run vite build first)`);
  }
  const files = collectFiles(assetsDir);
  if (files.length === 0) {
    fail(`no files under ${assetsDir}`);
  }
  const weighed = files.map((file) => {
    let bytes;
    try {
      bytes = readFileSync(file);
    } catch (err) {
      fail(`cannot read ${file}: ${err.message}`);
    }
    let gz = 0;
    try {
      gz = gzipSync(bytes).length;
    } catch (err) {
      fail(`cannot gzip ${file}: ${err.message}`);
    }
    return { file, gz };
  });
  const total = weighed.reduce((sum, entry) => sum + entry.gz, 0);
  console.log(`budget: ${total} / ${BUDGET_BYTES} bytes gz`);
  if (total > BUDGET_BYTES) {
    weighed.sort((a, b) => b.gz - a.gz);
    for (const entry of weighed.slice(0, OFFENDERS_SHOWN)) {
      console.error(`budget: offender ${entry.gz} bytes gz ${entry.file}`);
    }
    process.exit(1);
  }
}

main();
