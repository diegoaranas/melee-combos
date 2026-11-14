// First-time setup: finds the replay folder, Melee ISO and playback Dolphin from Slippi
// Launcher, guesses your connect code from your replays, and writes config.json.
//
//   node setup.js                 # detect everything, confirm the code
//   node setup.js ABCD#123        # set the code explicitly
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { SlippiGame } = require("@slippi/slippi-js");
const { load, CONFIG_FILE } = require("./config");

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith(".slp") ? [p] : [];
  });
}

// The code that appears in the most recent replays is almost certainly the owner's.
function guessCode(files) {
  const counts = {};
  for (const f of files.slice(-60)) {
    try {
      for (const p of new SlippiGame(f).getSettings().players) {
        if (p.connectCode) counts[p.connectCode] = (counts[p.connectCode] || 0) + 1;
      }
    } catch {}
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

async function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await new Promise((r) => rl.question(q, r));
  rl.close();
  return a.trim();
}

// Returns the config, or throws with a message saying what to fix.
// Ask for a path until it exists. Accepts paths pasted with quotes (Explorer's "Copy as path").
async function askPath(question, ok) {
  for (;;) {
    const p = (await ask(question)).replace(/^"(.*)"$/, "$1").trim();
    if (p && fs.existsSync(p) && ok(p)) return path.resolve(p);
    console.log(p ? `  Couldn't find that (${p}). Try again.` : "  Paste a path, then press Enter.");
  }
}

async function setup(codeArg) {
  const cfg = load({ requireCode: false });
  if (!cfg.replays || !fs.existsSync(cfg.replays)) {
    console.log("Couldn't find your Slippi replay folder. In Slippi Launcher it's under Settings > Replays.");
    cfg.replays = await askPath("Paste the replay folder's path (e.g. C:\\Users\\you\\Documents\\Slippi): ",
      (p) => fs.statSync(p).isDirectory());
  }
  if (!cfg.iso || !fs.existsSync(cfg.iso)) {
    console.log("Couldn't find your Melee ISO. In Slippi Launcher it's under Settings > Melee ISO File.");
    cfg.iso = await askPath("Paste the path to your Melee .iso file: ", (p) => fs.statSync(p).isFile());
  }
  if (!fs.existsSync(cfg.dolphin)) {
    throw new Error(
      "Slippi's replay player isn't installed yet.\n" +
      "Open Slippi Launcher, watch any replay once (that installs it), then start this app again."
    );
  }
  let code = codeArg || cfg.code;
  if (!code) {
    const files = walk(cfg.replays).sort();
    console.log(`Found ${files.length} replays in ${cfg.replays}.`);
    const guesses = guessCode(files);
    if (!guesses.length) {
      code = await ask("What's your Slippi connect code (e.g. ABCD#123)? ");
    } else {
      const top = guesses[0][0];
      const a = await ask(`Your connect code looks like ${top}. Press Enter if that's right, or type yours: `);
      code = a || top;
    }
  }
  code = code.toUpperCase();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...cfg, code }, null, 2) + "\n");
  return { ...cfg, code };
}

module.exports = { setup };
if (require.main === module) {
  setup(process.argv[2]).then(
    (c) => console.log(`Wrote ${CONFIG_FILE} (code ${c.code}). Next: node update.js`),
    (e) => { console.error(e.message); process.exit(1); }
  );
}
