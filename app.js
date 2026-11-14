// melee-combos app: the entry point of the downloadable exe (double-click it), also runnable
// as `node app.js`. With no arguments it shows a menu. Subcommands are used internally to run
// the pipeline steps in separate processes.
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");
const { COMPILED, runSelf } = require("./self");

// The exe keeps its data in its own folder, like slippi-upset.
if (COMPILED) process.chdir(path.dirname(process.execPath));

const sub = process.argv[2];

if (sub === "index-worker" || sub === "ff-worker" || sub === "features" || sub === "review" || sub === "render") {
  // The scripts read their own arguments from process.argv[2...]; drop the subcommand.
  process.argv.splice(2, 1);
  if (sub === "index-worker") require("./index.js");
  else if (sub === "ff-worker") require("./framefeat.js");
  else if (sub === "features") require("./features.js");
  else if (sub === "review") require("./review.js");
  else require("./render.js");
} else {
  main().catch(async (e) => {
    console.error(`\n${e.message}`);
    await ask("\nPress Enter to close.");
    process.exit(1);
  });
}

async function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await new Promise((r) => rl.question(q, r));
  rl.close();
  return a.trim();
}

function countRatings() {
  if (!fs.existsSync("data/ratings.csv")) return 0;
  return new Set(fs.readFileSync("data/ratings.csv", "utf8").split(/\r?\n/).slice(1).filter(Boolean)
    .map((l) => l.split(",").slice(0, 2).join(","))).size;
}

// Play the current top N in Dolphin, without blocking the menu.
function watchTop(cfg, n) {
  const { readCsv } = require("./csv");
  const top = readCsv("data/ranked.csv").slice(0, n);
  fs.mkdirSync("out", { recursive: true });
  const queue = path.resolve("out/queue_top.json");
  fs.writeFileSync(queue, JSON.stringify({
    mode: "queue", replay: "", isRealTimeMode: false, outputOverlayFiles: false,
    queue: top.map((r, i) => ({ path: r.file, startFrame: Math.max(-123, Number(r.s) - 90), endFrame: Number(r.e) + 60 })),
  }));
  spawn(cfg.dolphin, ["-i", queue, "-e", cfg.iso], { detached: true, stdio: "ignore" }).unref();
}

async function main() {
  const { setup } = require("./setup");
  const { update } = require("./update");
  const { rank } = require("./rank");
  console.log("melee-combos: finds your best punishes in your Slippi replays\n");
  const cfg = await setup();
  console.log(`Connect code ${cfg.code}, replays in ${cfg.replays}\n`);
  await update();

  for (;;) {
    const n = countRatings();
    console.log(`
You've rated ${n} punish${n === 1 ? "" : "es"}.
  1  Rate punishes (the more you rate, the better it gets at finding ones you like)
  2  Watch my top 20 in Dolphin
  3  Make videos of the punishes I rated great
  4  Make my ratings package (to send back)
  5  Check for new replays
  q  Quit`);
    const choice = (await ask("> ")).toLowerCase();
    try {
      if (choice === "1") {
        console.log(`
A Dolphin window plays each punish. Click back on THIS window, then press:
  x = great   g = good   b = bad (then 1 = repetitive, 2 = opponent was acting, 3 = other)
  s = skip    r = replay   q = stop rating`);
        await ask("Press Enter to start.");
        runSelf("review", ["40"]);
        console.log("Updating your ranking with the new ratings ...");
        rank({ quiet: true });
        console.log("Saved. Use option 4 when you want to send your ratings back.");
      } else if (choice === "2") {
        watchTop(cfg, 20);
        console.log("Opening Dolphin with your top 20.");
      } else if (choice === "3") {
        await require("./ffmpeg").ensure();
        runSelf("render", ["great"]);
        console.log(`Videos are in ${path.resolve("out", "clips")}`);
        if (process.platform === "win32") spawn("explorer", [path.resolve("out", "clips")], { detached: true, stdio: "ignore" }).unref();
      } else if (choice === "4") {
        const { exportPackage } = require("./share");
        const zip = path.resolve(`ratings-${require("./config").codeSlug(cfg.code)}.zip`);
        const r = exportPackage(zip, { onProgress: (n) => console.log(`\nPacking your ratings and the ${n} replays they come from ...`) });
        const mb = (r.bytes / 1e6).toFixed(0);
        console.log(`\nWrote ${zip} (${mb} MB):
  ${r.count} rated punishes and ${r.games} replays${r.missingGames ? ` (${r.missingGames} replays no longer on this PC)` : ""}.
Send it to whoever gave you this app. ${r.bytes > 10e6
  ? "It's too big for a free Discord upload: put it on Google Drive\n(or similar) and send the link."
  : "It's small enough to send on Discord."}
The replays show your opponents' tags; they stay private and are only used to improve the ranking.`);
        if (process.platform === "win32") spawn("explorer", [`/select,${zip}`], { detached: true, stdio: "ignore" }).unref();
      } else if (choice === "5") {
        await update();
      } else if (choice === "q" || choice === "quit") {
        process.exit(0);
      }
    } catch (e) {
      console.error(`\n${e.message}`);
    }
  }
}
