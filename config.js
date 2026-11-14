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

// Slippi Launcher only saves rootSlpPath once it's changed; until then it uses Documents\Slippi.
// Documents can be redirected (often into OneDrive), so ask Windows where it is if the usual
// places don't have it.
let defaultReplays;
function defaultReplayDir() {
  if (defaultReplays !== undefined) return defaultReplays;
  const home = require("os").homedir();
  const docs = [path.join(home, "Documents")];
  if (process.env.OneDrive) docs.push(path.join(process.env.OneDrive, "Documents"));
  docs.push(path.join(home, "OneDrive", "Documents"));
  if (process.platform === "win32") {
    try {
      const r = require("child_process").spawnSync("powershell",
        ["-NoProfile", "-Command", "[Environment]::GetFolderPath('MyDocuments')"], { encoding: "utf8", timeout: 10000 });
      const p = (r.stdout || "").trim();
      if (p) docs.unshift(p);
    } catch {}
  }
  defaultReplays = docs.map((d) => path.join(d, "Slippi")).find((p) => fs.existsSync(p)) || null;
  return defaultReplays;
}

// `saved` is config.json: a folder it already names skips the (slower) default lookup.
function defaults(saved = {}) {
  const s = launcherSettings();
  return {
    code: null,
    replays: saved.replays || s.rootSlpPath || defaultReplayDir(),
    iso: s.isoPath || null,
    dolphin: path.join(LAUNCHER, "playback", process.platform === "win32" ? "Slippi Dolphin.exe" : "Slippi_Playback"),
  };
}

function load({ requireCode = true } = {}) {
  const saved = fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) : {};
  const cfg = { ...defaults(saved), ...saved };
  if (requireCode && !cfg.code) {
    console.error("No connect code configured. Run: node setup.js");
    process.exit(1);
  }
  return cfg;
}

// File-name-safe form of a connect code: "1SHINE#0" -> "1SHINE-0".
const codeSlug = (code) => code.replace(/[^A-Za-z0-9]+/g, "-");

module.exports = { load, defaults, codeSlug, CONFIG_FILE, LAUNCHER };
