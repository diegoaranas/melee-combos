// Run the whole pipeline: index new replays, rebuild features, frame-parse new games and re-rank.
// Every step skips work it has already done, so it is cheap to rerun after playing more games
// or rating more clips.
//
//   node update.js
const os = require("os");
const fs = require("fs");
const path = require("path");
const { load } = require("./config");
const { runSelf, spawnSelf } = require("./self");
const { rank } = require("./rank");

// Each worker holds a replay's frames in memory (up to ~600 MB on long games), and running more
// workers than fit in free RAM makes the first run crawl, so cap by free memory too.
const N = Math.max(1, Math.min(16, os.cpus().length - 1, Math.floor(os.freemem() / 700e6)));

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith(".slp") ? [p] : [];
  });
}

const countLines = (prefix) => fs.readdirSync("data").filter((f) => new RegExp(`^${prefix}_\\d+\\.jsonl$`).test(f))
  .reduce((n, f) => n + fs.readFileSync(`data/${f}`, "utf8").split("\n").filter(Boolean).length, 0);

// Run N copies of a worker subcommand, printing progress against `total` games.
function workers(sub, prefix, total, label) {
  const before = countLines(prefix);
  let last = "";
  const tick = setInterval(() => {
    const msg = `  ${label}: ${countLines(prefix)}/${total}`;
    if (msg !== last && process.stdout.isTTY) process.stdout.write(`\r${msg}`);
    last = msg;
  }, 2000);
  return Promise.all(
    Array.from({ length: N }, (_, i) => new Promise((resolve, reject) => {
      const p = spawnSelf(sub, [i, N, `data/${prefix}_${i}.jsonl`], { stdio: ["ignore", "ignore", "inherit"] });
      p.on("exit", (c) => (c ? reject(new Error(`${sub} ${i} exited with code ${c}`)) : resolve()));
    }))
  ).finally(() => {
    clearInterval(tick);
    const after = countLines(prefix);
    if (process.stdout.isTTY && last) process.stdout.write("\r" + " ".repeat(last.length) + "\r");
    if (after > before) console.log(`  ${label}: ${after - before} new`);
  });
}

async function update() {
  const cfg = load();
  fs.mkdirSync("data", { recursive: true });
  const t = Date.now();
  const step = (msg) => console.log(`[${Math.round((Date.now() - t) / 1000)}s] ${msg}`);
  const total = walk(cfg.replays).length;
  step(`reading ${total} replays, ${N} at a time (the first time takes a while)`);
  await workers("index-worker", "index", total, "replays read");
  step("finding your punishes");
  runSelf("features");
  step("looking closely at the big ones");
  const mine = fs.readdirSync("data").filter((f) => /^index_\d+\.jsonl$/.test(f))
    .flatMap((f) => fs.readFileSync(`data/${f}`, "utf8").split("\n").filter(Boolean))
    .filter((l) => l.includes(`"code":"${cfg.code}"`)).length;
  await workers("ff-worker", "ff", mine, "games checked");
  step("ranking");
  rank();
  step("done");
}

module.exports = { update };
if (require.main === module) update().then(() => require("./share").exportRatings()).catch((e) => { console.error(e.message); process.exit(1); });
