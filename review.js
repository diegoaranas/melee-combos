// Review session: plays a batch of top-ranked, unrated punishes in Slippi Dolphin one at a time
// and records a rating for each; the next segment loads only after a key is pressed.
//
//   node review.js [count=40]
//
// Keys:  x = great   g = good   b = bad   s = skip   r = replay   q = quit
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
const rated = new Set(fs.existsSync(RATINGS) ? readCsv(RATINGS).map((r) => `${r.file}|${r.s}`) : []);
if (!fs.existsSync(RATINGS)) fs.writeFileSync(RATINGS, "file,s,rating,time\n");

const unrated = ranked.filter((r) => !rated.has(`${r.file}|${r.s}`) && r.label !== "1");
const nTop = Math.round(count * (1 - EXPLORE));
const batch = unrated.slice(0, nTop);
// The top of the ranking is almost all kills, so half the exploration picks are the
// best-ranked non-kills; otherwise the ratings never tell the model whether those are worth it.
const nonKills = unrated.slice(nTop).filter((r) => r.kill !== "1").slice(0, Math.ceil((count - nTop) / 2));
batch.push(...nonKills);
const pool = unrated.slice(nTop, 3000).filter((r) => !nonKills.includes(r));
while (batch.length < count && pool.length) batch.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
batch.sort(() => Math.random() - 0.5); // don't reveal which ones are exploration picks

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

function rate(value) {
  const r = batch[current];
  fs.appendFileSync(RATINGS, `${r.file},${r.s},${value},${new Date().toISOString()}\n`);
  nRated++;
  console.log(`  rated ${["bad", "good", "great"][value]}`);
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
  if (key.name === "x") rate(2);
  else if (key.name === "g") rate(1);
  else if (key.name === "b") rate(0);
  else if (key.name === "s") {
    console.log("  skipped");
    next();
  } else if (key.name === "r") show(current);
  else if (key.name === "q" || (key.ctrl && key.name === "c")) {
    dolphin.kill();
    finish();
  }
});
