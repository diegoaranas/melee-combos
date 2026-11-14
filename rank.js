// Rank punishes by how clip-worthy they look, and write data/ranked.csv for review and playback.
//
// Positives are punishes rated good/great (by you or by anyone in shared/) and punishes matched
// to hand-made clips. Everything unrated counts as a weak negative (positive-unlabelled: unrated
// punishes are not known to be bad, so the model only orders them); a "bad" rating counts 20x.
// Everyone's ratings count the same.
//
//   node rank.js
const fs = require("fs");
const path = require("path");
const { readCsv } = require("./csv");
const { train, score } = require("./gbm");
const { load, codeSlug } = require("./config");

const BAD_WEIGHT = 20;
const FRAME_COLS = ["offstageFrac", "killOffstage", "victimFreeFrac", "myAirFrac", "lcancels", "wavelands",
  "airdodges", "jumps", "ledge", "victimActs", "victimXSpan", "victimMaxY", "myTravel"];

function rank({ quiet = false } = {}) {
  const log = quiet ? () => {} : console.log;
  const { code } = load();
  const key = (file, s) => `${file}|${s}`;

  const local = readCsv("data/features.csv");
  const ratings = new Map();
  if (fs.existsSync("data/ratings.csv")) for (const r of readCsv("data/ratings.csv")) ratings.set(key(r.file, r.s), r.rating);
  const frames = new Map();
  for (const f of fs.readdirSync("data").filter((f) => /^ff_\d+\.jsonl$/.test(f))) {
    for (const line of fs.readFileSync(`data/${f}`, "utf8").split("\n")) {
      if (!line) continue;
      const g = JSON.parse(line);
      for (const p of g.punishes || []) frames.set(key(g.file, p.s), p);
    }
  }
  for (const r of local) {
    const fr = frames.get(key(r.file, r.s));
    r.framed = fr ? 1 : 0;
    for (const c of FRAME_COLS) r[c] = fr ? fr[c] : 0;
    r.rating = ratings.get(key(r.file, r.s)) ?? "";
  }

  // Other people's rated punishes: files in shared/ (written by share.js), plus the ones built
  // into the exe (starter.json, made by build.js). A file in shared/ replaces a built-in one of
  // the same name. Your own file is skipped: your ratings come from data/ratings.csv.
  const files = {};
  try { Object.assign(files, require("./starter.json")); } catch {}
  if (fs.existsSync("shared")) {
    for (const f of fs.readdirSync("shared").filter((f) => f.endsWith(".json"))) {
      files[f] = JSON.parse(fs.readFileSync(path.join("shared", f), "utf8"));
    }
  }
  const shared = [];
  const own = codeSlug(code);
  const seen = new Set();
  for (const [f, data] of Object.entries(files)) {
    if (path.basename(f, ".json").replace(/^ratings-/, "") === own) continue;
    seen.add(f);
    for (const r of data.rows) {
      if (r.rating == null) continue;
      r.framed = r.offstageFrac == null ? 0 : 1;
      for (const c of FRAME_COLS) r[c] = r[c] ?? 0;
      r.label = 0;
      shared.push(r);
    }
  }
  if (shared.length) log(`training also on ${shared.length} punishes rated by other people (${seen.size} files)`);

  const rows = local.concat(shared);
  const X = rows.map(features);
  const y = new Float64Array(rows.length);
  const w = new Float64Array(rows.length).fill(1);
  rows.forEach((r, i) => {
    const rating = r.rating === "" || r.rating == null ? null : Number(r.rating);
    y[i] = Number(r.label) === 1 || rating >= 1 ? 1 : 0;
    if (rating === 0) w[i] = BAD_WEIGHT;
  });
  const nPos = y.reduce((a, b) => a + b, 0);
  if (!nPos) throw new Error("No positive examples yet: rate some punishes, or add friends' rating files.");
  // Positives are rare; upweight them to balance the classes.
  const balance = (rows.length - nPos) / nPos;
  for (let i = 0; i < rows.length; i++) if (y[i] === 1) w[i] *= balance;

  const model = train(X, y, w);
  const scored = local.map((r, i) => ({ r, score: score(model, X[i]) })).sort((a, b) => b.score - a.score);

  const cols = ["file", "s", "e", "label", "rating", "score", "dmg", "kill", "hits", "sp", "victimXSpan", "opponent"];
  const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = [cols.join(",")];
  for (const { r, score: s } of scored) lines.push(cols.map((c) => cell(c === "score" ? s.toFixed(6) : r[c])).join(","));
  fs.writeFileSync("data/ranked.csv", lines.join("\n") + "\n");
  log(`ranked ${local.length} punishes`);
}

// The same feature transforms rank.py uses.
function features(d) {
  const n = (k) => Number(d[k]) || 0;
  const log1p0 = (v) => Math.log1p(Math.max(0, v));
  const logdmg = log1p0(n("dmg"));
  const seconds = n("seconds");
  return [
    logdmg, Math.log1p(n("hits")), n("distinct"), n("sp") / 100, n("kill"), n("kill") * logdmg,
    n("zeroToDeath"), n("ragequit"), n("gameWinner"), Math.log1p(seconds), Math.min(5, n("hitsPerSec")),
    Math.min(1, Math.max(0, Number.isFinite(Number(d.maxHitShare)) ? n("maxHitShare") : 1)),
    n("neutralWin"), n("singles"), log1p0(n("maxGap")), log1p0(n("meanGap")), n("maxRun"),
    n("aerialFrac"), n("smashFrac"), n("grabFrac"), n("downBFrac"), n("repeatFrac"),
    n("killAerial"), n("killSmash"), n("killDownB"), n("killThrow"),
    n("framed"), n("offstageFrac"), n("killOffstage"), n("victimFreeFrac"), n("myAirFrac"),
    seconds > 0 ? n("victimActs") / seconds : 0,
    ...["lcancels", "wavelands", "airdodges", "jumps", "ledge", "victimActs"].map((k) => Math.log1p(n(k))),
    ...["victimXSpan", "victimMaxY", "myTravel"].map((k) => log1p0(n(k))),
  ];
}

module.exports = { rank };
if (require.main === module) rank();
