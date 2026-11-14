// Per-user settings: connect code and paths. `node setup.js` writes config.json; any value
// missing there falls back to what Slippi Launcher has stored.
const fs = require("fs");
const path = require("path");

const APPDATA = process.env.APPDATA || path.join(require("os").homedir(), "AppData", "Roaming");
const LAUNCHER = path.join(APPDATA, "Slippi Launcher");
// Relative to the working directory: the project folder, or the exe's folder (app.js changes
// into it), where all data lives.
const CONFIG_FILE = path.resolve("config.json");

function launcherSettings() {
  try {
    return JSON.parse(fs.readFileSync(path.join(LAUNCHER, "Settings"), "utf8")).settings || {};
  } catch {
    return {};
  }
}

function defaults() {
  const s = launcherSettings();
  return {
    code: null,
    replays: s.rootSlpPath || null,
    iso: s.isoPath || null,
    dolphin: path.join(LAUNCHER, "playback", process.platform === "win32" ? "Slippi Dolphin.exe" : "Slippi_Playback"),
  };
}

function load({ requireCode = true } = {}) {
  const saved = fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) : {};
  const cfg = { ...defaults(), ...saved };
  if (requireCode && !cfg.code) {
    console.error("No connect code configured. Run: node setup.js");
    process.exit(1);
  }
  return cfg;
}

// File-name-safe form of a connect code: "1SHINE#0" -> "1SHINE-0".
const codeSlug = (code) => code.replace(/[^A-Za-z0-9]+/g, "-");

module.exports = { load, defaults, codeSlug, CONFIG_FILE, LAUNCHER };
