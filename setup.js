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
async function setup(codeArg) {
  const cfg = load({ requireCode: false });
  const problems = [];
  if (!cfg.replays || !fs.existsSync(cfg.replays)) problems.push(`replay folder not found (${cfg.replays || "not set in Slippi Launcher"})`);
  if (!cfg.iso || !fs.existsSync(cfg.iso)) problems.push(`Melee ISO not found (${cfg.iso || "not set in Slippi Launcher"})`);
  if (!fs.existsSync(cfg.dolphin)) problems.push(`Slippi playback Dolphin not found (${cfg.dolphin})`);
  if (problems.length) {
    throw new Error(
      "Setup problem:\n  - " + problems.join("\n  - ") +
      "\nOpen Slippi Launcher, set your replay folder and Melee ISO in its settings, and watch one replay\n" +
      `there once (that installs the playback Dolphin). Or write the paths into ${CONFIG_FILE}:\n` +
      `  { "code": "ABCD#123", "replays": "...", "iso": "...", "dolphin": "..." }`
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
