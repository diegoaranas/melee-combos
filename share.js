// Export your ratings (and clip labels) as anonymised feature rows: shared/<code>.json.
// rank.js trains on everyone's shared files, so each person's ratings improve everyone's
// ranking, and a new user gets a working ranker before rating anything.
//
// The file holds only the numbers the model uses, plus the replay's file name and frame so a
// later re-export overwrites rather than duplicates. No folder paths or opponent names.
//
//   node share.js        (review.js runs this automatically after a session)
const fs = require("fs");
const path = require("path");
const { load, codeSlug } = require("./config");
const { readCsv } = require("./csv");

const RATINGS = "data/ratings.csv";
const DROP = new Set(["id", "file", "opponent", "label"]);

const num = (v) => (v === "" || v == null ? null : Number(v));
const key = (file, s) => `${file}|${s}`;

// Writes the file and returns its path. Default: shared/<code>.json.
function exportRatings(out, { quiet = false } = {}) {
  const { code } = load();
  const feats = new Map(readCsv("data/features.csv").map((r) => [key(r.file, r.s), r]));
  const frames = new Map();
  for (const f of fs.readdirSync("data").filter((f) => /^ff_\d+\.jsonl$/.test(f))) {
    for (const line of fs.readFileSync(`data/${f}`, "utf8").split("\n")) {
      if (!line) continue;
      const g = JSON.parse(line);
      for (const p of g.punishes || []) frames.set(key(g.file, p.s), p);
    }
  }

  function row(f, extra) {
    const out = { replay: path.basename(f.file) };
    for (const [k, v] of Object.entries(f)) if (!DROP.has(k)) out[k] = num(v);
    const fr = frames.get(key(f.file, f.s));
    if (fr) for (const [k, v] of Object.entries(fr)) if (k !== "s") out[k] = v;
    return { ...out, ...extra };
  }

  const rows = [];
  const replays = new Set(); // full paths of the games with a rated punish
  let missing = 0;
  // Latest rating wins, as in rank.py.
  const ratings = new Map();
  if (fs.existsSync(RATINGS)) for (const r of readCsv(RATINGS)) ratings.set(key(r.file, r.s), r);
  for (const [k, r] of ratings) {
    const f = feats.get(k);
    if (!f) { missing++; continue; }
    rows.push(row(f, { rating: Number(r.rating), reason: r.reason || "", time: r.time }));
    replays.add(f.file);
  }
  // Punishes matched to hand-made clips count as "good" unless rated otherwise.
  for (const [k, f] of feats) if (f.label === "1" && !ratings.has(k)) rows.push(row(f, { rating: 1, reason: "clipped", time: null }));

  out = out || `shared/${codeSlug(code)}.json`;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ rater: code, exported: new Date().toISOString(), rows }) + "\n");
  if (!quiet) console.log(`Wrote ${out}: ${rows.length} rated punishes${missing ? ` (${missing} ratings skipped: replay no longer indexed)` : ""}.`);
  return { out, count: rows.length, replays: [...replays] };
}

// A zip to send back: the ratings file plus every replay that has a rated punish, so features
// can be recomputed later and the punishes watched. Replays name opponents, so the receiver
// keeps them out of git (receive.js puts them in received/).
function exportPackage(out, { onProgress } = {}) {
  const { code } = load();
  const tmp = `${out}.ratings.json`;
  const { count, replays } = exportRatings(tmp, { quiet: true });
  const present = replays.filter((p) => fs.existsSync(p));
  const entries = [{ name: `ratings-${codeSlug(code)}.json`, file: tmp }];
  for (const p of present) entries.push({ name: `replays/${path.basename(p)}`, file: p });
  if (onProgress) onProgress(present.length);
  const bytes = require("./zip").writeZip(out, entries);
  fs.rmSync(tmp, { force: true });
  return { out, count, games: present.length, missingGames: replays.length - present.length, bytes };
}

module.exports = { exportRatings, exportPackage };
if (require.main === module) exportRatings();
