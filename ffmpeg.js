// Locate ffmpeg (on PATH, or tools/ffmpeg.exe next to the app), downloading it on Windows the
// first time videos are made.
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const LOCAL = path.resolve("tools", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const URL = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";

const works = (cmd) => spawnSync(cmd, ["-version"], { stdio: "ignore" }).status === 0;

function find() {
  if (fs.existsSync(LOCAL) && works(LOCAL)) return LOCAL;
  if (works("ffmpeg")) return "ffmpeg";
  return null;
}

async function ensure() {
  const found = find();
  if (found) return found;
  if (process.platform !== "win32") throw new Error("Install ffmpeg first (e.g. brew install ffmpeg / apt install ffmpeg).");
  console.log("Downloading ffmpeg (needed once to make videos, about 200 MB) ...");
  const dir = path.dirname(LOCAL);
  const tmp = path.join(dir, "ffmpeg-download");
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const zip = path.join(tmp, "ffmpeg.zip");
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`ffmpeg download failed: HTTP ${res.status}`);
  fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  // Windows 10+ ships bsdtar, which extracts zip files.
  const r = spawnSync("tar", ["-xf", zip, "-C", tmp], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("Couldn't extract ffmpeg.zip");
  const exe = (function search(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { const hit = search(p); if (hit) return hit; }
      else if (e.name.toLowerCase() === "ffmpeg.exe") return p;
    }
    return null;
  })(tmp);
  if (!exe) throw new Error("ffmpeg.exe not found in the download");
  fs.renameSync(exe, LOCAL);
  fs.rmSync(tmp, { recursive: true, force: true });
  return LOCAL;
}

module.exports = { find, ensure };
