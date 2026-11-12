// Review session: plays a batch of top-ranked, unrated punishes in Slippi Dolphin one at a time
// and records a rating for each; the next segment loads only after a key is pressed. A few
// already-rated punishes are mixed in unmarked, to measure how consistent the ratings are.
//
//   node review.js [count=40]
//
// Keys:  x = great   g = good   b = bad   s = skip   r = replay   q = quit
// After b:  1 = repetitive   2 = opponent acting mid-punish   3 = other   (Esc = cancel)
// Ratings are appended to data/ratings.csv; rerun `python rank.py --no-cv` afterwards to re-rank.
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");

const DOLPHIN = path.join(process.env.APPDATA, "Slippi Launcher", "playback", "Slippi Dolphin.exe");
const ISO = "C:\\Games\\GC and Wii\\Melee v1.02\\GALE01\\game.iso";
const RATINGS = "data/ratings.csv";
const LEAD_IN = 90; // frames shown before the punish starts
const TAIL = 60;
const EXPLORE = 0.2; // share of the batch drawn from further down the ranking
const WIDE_SHARE = 0.05; // widest share of big punishes (by victim travel) counted as "wide"
const REPEATS = 4; // already-rated punishes added to the batch
const HEADER = "file,s,rating,time,reason,repeat";
const REASONS = { 1: "repetitive", 2: "opponent", 3: "other" };

const count = Number(process.argv[2] || 40);

function readCsv(file) {
  const [head, ...lines] = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
  const cols = head.split(",");
  // The last column (opponent name) may contain commas, so it takes the rest of the line.
  return lines.map((l) => {
    const cells = l.replace(/\r$/, "").split(",");
    const row = Object.fromEntries(cols.map((c, i) => [c, cells[i]]));
    row[cols[cols.length - 1]] = cells.slice(cols.length - 1).join(",").replace(/^"|"$/g, "");
    return row;
  });
}

const ranked = readCsv("data/ranked.csv");
if (!fs.existsSync(RATINGS)) fs.writeFileSync(RATINGS, HEADER + "\n");
// Older files lack the reason/repeat columns; their rows simply leave them empty.
const ratingsText = fs.readFileSync(RATINGS, "utf8");
if (!ratingsText.startsWith(HEADER)) fs.writeFileSync(RATINGS, ratingsText.replace(/^.*/, HEADER));
const rated = new Set(readCsv(RATINGS).map((r) => `${r.file}|${r.s}`));

const unrated = ranked.filter((r) => !rated.has(`${r.file}|${r.s}`) && r.label !== "1");
const nTop = Math.round(count * (1 - EXPLORE));
const batch = unrated.slice(0, nTop);
// The top of the ranking is almost all kills, so a third of the exploration picks are the
// best-ranked non-kills; otherwise the ratings never tell the model whether those are worth it.
const nExplore = Math.ceil((count - nTop) / 3);
const nonKills = unrated.slice(nTop).filter((r) => r.kill !== "1").slice(0, nExplore);
batch.push(...nonKills);
// Another third are big punishes that carry the victim furthest across the stage: few of them
// were ever clipped or rated, so the model has almost no data on them.
const big = ranked.filter((r) => Number(r.dmg) >= 50 && Number(r.victimXSpan) > 0);
const spans = big.map((r) => Number(r.victimXSpan)).sort((a, b) => a - b);
const wideMin = spans[Math.floor(spans.length * (1 - WIDE_SHARE))] ?? Infinity;
const wide = unrated.slice(nTop)
  .filter((r) => Number(r.dmg) >= 50 && Number(r.victimXSpan) >= wideMin && !nonKills.includes(r))
  .slice(0, nExplore);
batch.push(...wide);
const pool = unrated.slice(nTop, 3000).filter((r) => !nonKills.includes(r) && !wide.includes(r));
while (batch.length < count && pool.length) batch.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
const ratedPool = ranked.filter((r) => rated.has(`${r.file}|${r.s}`));
for (let k = 0; k < REPEATS && ratedPool.length; k++) {
  batch.push({ ...ratedPool.splice(Math.floor(Math.random() * ratedPool.length), 1)[0], repeat: true });
}
batch.sort(() => Math.random() - 0.5); // don't reveal which ones are exploration picks or repeats

const segments = batch.map((r) => ({
  path: r.file,
  startFrame: Math.max(-123, Number(r.s) - LEAD_IN),
  endFrame: Number(r.e) + TAIL,
}));

// Dolphin gets one segment at a time. It reloads the comm file whenever commandId changes,
// so the next segment only starts once the current one has been rated (or skipped).
const commFile = path.resolve("out/review_queue.json");
let current = -1;
let nRated = 0;
let askingReason = false;

function show(i) {
  current = i;
  const r = batch[i];
  fs.writeFileSync(
    commFile,
    JSON.stringify({ mode: "queue", replay: "", isRealTimeMode: false, outputOverlayFiles: false, commandId: `${Date.now()}-${i}`, queue: [segments[i]] }, null, 1)
  );
  console.log(`\n[${i + 1}/${batch.length}] ${r.opponent} | ${Math.round(r.dmg)}% ${r.kill === "1" ? "kill" : "no kill"}, ${r.hits} hits`);
}

function next() {
  if (current + 1 >= batch.length) {
    dolphin.kill();
    return finish();
  }
  show(current + 1);
}

show(0);
const dolphin = spawn(DOLPHIN, ["-i", commFile, "-e", ISO], { stdio: "ignore" });
dolphin.on("exit", () => finish());

function rate(value, reason = "") {
  const r = batch[current];
  fs.appendFileSync(RATINGS, `${r.file},${r.s},${value},${new Date().toISOString()},${reason},${r.repeat ? 1 : 0}\n`);
  nRated++;
  console.log(`  rated ${["bad", "good", "great"][value]}${reason ? ` (${reason})` : ""}`);
  next();
}

function finish() {
  console.log(`\nRated ${nRated}/${batch.length}. Re-rank with: python rank.py --no-cv`);
  process.exit(0);
}

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
console.log(`Playing ${batch.length} segments. Keys: x=great  g=good  b=bad  s=skip  r=replay  q=quit`);
process.stdin.on("keypress", (_, key) => {
  if (!key) return;
  if (askingReason) {
    if (REASONS[key.name]) {
      askingReason = false;
      rate(0, REASONS[key.name]);
    } else if (key.name === "escape") {
      askingReason = false;
      console.log("  cancelled");
    }
    return;
  }
  if (key.name === "x") rate(2);
  else if (key.name === "g") rate(1);
  else if (key.name === "b") {
    askingReason = true;
    console.log("  bad because? 1=repetitive  2=opponent acting  3=other  (Esc=cancel)");
  }
  else if (key.name === "s") {
    console.log("  skipped");
    next();
  } else if (key.name === "r") show(current);
  else if (key.name === "q" || (key.ctrl && key.name === "c")) {
    dolphin.kill();
    finish();
  }
});
