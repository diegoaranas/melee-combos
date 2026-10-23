// Review session: plays a batch of top-ranked, unrated punishes in Slippi Dolphin and records
// a rating for whichever segment is on screen when a key is pressed.
//
//   node review.js [count=40]
//
// Keys:  x = great   g = good   b = bad   q = quit
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
const pool = unrated.slice(nTop, 3000);
while (batch.length < count && pool.length) batch.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
batch.sort(() => Math.random() - 0.5); // don't reveal which ones are exploration picks

const queue = {
  mode: "queue",
  replay: "",
  isRealTimeMode: false,
  outputOverlayFiles: false,
  queue: batch.map((r) => ({
    path: r.file,
    startFrame: Math.max(-123, Number(r.s) - LEAD_IN),
    endFrame: Number(r.e) + TAIL,
  })),
};
const queueFile = path.resolve("out/review_queue.json");
fs.writeFileSync(queueFile, JSON.stringify(queue, null, 1));

let current = -1;
let pendingPath = null;
const done = new Set();

function locate(file, startFrame) {
  return queue.queue.findIndex((q, i) => q.path.toLowerCase() === file.toLowerCase() && Math.abs(q.startFrame - startFrame) < 5 && !done.has(i)) ;
}

const dolphin = spawn(DOLPHIN, ["-i", queueFile, "-e", ISO, "--cout"], { stdio: ["ignore", "pipe", "ignore"] });
readline.createInterface({ input: dolphin.stdout }).on("line", (line) => {
  const m = line.match(/^\[(\w+)\]\s*(.*)$/);
  if (!m) return;
  const [, tag, val] = m;
  if (tag === "FILE_PATH") pendingPath = val.trim();
  if (tag === "PLAYBACK_START_FRAME" && pendingPath) {
    const i = locate(pendingPath, Number(val));
    if (i >= 0) {
      current = i;
      const r = batch[i];
      console.log(`\n[${i + 1}/${batch.length}] ${r.opponent} | ${Math.round(r.dmg)}% ${r.kill === "1" ? "kill" : "no kill"}, ${r.hits} hits`);
    }
  }
});
dolphin.on("exit", () => finish());

function rate(value) {
  if (current < 0) return console.log("(nothing playing yet)");
  const r = batch[current];
  fs.appendFileSync(RATINGS, `${r.file},${r.s},${value},${new Date().toISOString()}\n`);
  done.add(current);
  console.log(`  rated ${["bad", "good", "great"][value]}`);
}

function finish() {
  console.log(`\nRated ${done.size}/${batch.length}. Re-rank with: python rank.py --no-cv`);
  process.exit(0);
}

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
console.log(`Playing ${batch.length} segments. Keys: x=great  g=good  b=bad  q=quit`);
process.stdin.on("keypress", (_, key) => {
  if (!key) return;
  if (key.name === "x") rate(2);
  else if (key.name === "g") rate(1);
  else if (key.name === "b") rate(0);
  else if (key.name === "q" || (key.ctrl && key.name === "c")) {
    dolphin.kill();
    finish();
  }
});
