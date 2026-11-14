// Render punishes to mp4 with Slippi's playback Dolphin (frame + audio dump) and ffmpeg.
//
//   node render.js great                  # every punish you rated great
//   node render.js good                   # rated good or great
//   node render.js out\queue_top.json     # any playback queue (e.g. from top.py)
//   options:  --jobs=2  (parallel Dolphins)   --out=out/clips
//
// Uses its own copy of the playback Dolphin (render/dolphin) with frame dumping switched on,
// so your normal Dolphin settings are untouched. Clips that already exist are skipped.
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { characters } = require("@slippi/slippi-js");
const { load } = require("./config");
const { readCsv } = require("./csv");

const cfg = load();
const args = process.argv.slice(2);
const opt = (name, dflt) => (args.find((a) => a.startsWith(`--${name}=`)) || "").split("=")[1] || dflt;
const what = args.find((a) => !a.startsWith("--"));
const JOBS = Number(opt("jobs", 2));
const OUT = path.resolve(opt("out", "out/clips"));
const RENDER = path.resolve("render");
const DOLPHIN_DIR = path.join(RENDER, "dolphin");
const LEAD_IN = 90;
const TAIL = 60;

if (!what) {
  console.log("Usage: node render.js great | good | <queue.json>  [--jobs=2] [--out=out/clips]");
  process.exit(1);
}
const FFMPEG = require("./ffmpeg").find();
if (!FFMPEG) {
  console.error("ffmpeg not found (Windows: winget install ffmpeg, or make videos from the app menu once).");
  process.exit(1);
}

const charName = (id) => {
  try { return characters.getCharacterShortName(Number(id)).replace(/\W/g, ""); } catch { return String(id); }
};

function clipsFromRatings(min) {
  const latest = new Map();
  for (const r of readCsv("data/ratings.csv")) latest.set(`${r.file}|${r.s}`, Number(r.rating));
  const feats = new Map(readCsv("data/features.csv").map((f) => [`${f.file}|${f.s}`, f]));
  const clips = [];
  for (const [k, rating] of latest) {
    const f = feats.get(k);
    if (rating < min || !f) continue;
    const stamp = (path.basename(f.file).match(/(\d{8}T\d{6})/) || [])[1] || path.basename(f.file, ".slp");
    clips.push({
      path: f.file, startFrame: Math.max(-123, Number(f.s) - LEAD_IN), endFrame: Number(f.e) + TAIL,
      name: `${stamp}_${charName(f.me)}-v-${charName(f.them)}_${Math.round(Number(f.dmg))}pct`,
    });
  }
  return clips;
}

function clipsFromQueue(file) {
  return JSON.parse(fs.readFileSync(file, "utf8")).queue.map((q) => ({
    ...q, name: q.name || `${path.basename(q.path, ".slp")}_${q.startFrame}`,
  }));
}

// A private copy of the playback Dolphin with frame and audio dumping on. Texture packs
// (User/Load) are left out to keep it small.
function prepareDolphin() {
  const src = path.dirname(cfg.dolphin);
  const exe = path.join(DOLPHIN_DIR, path.basename(cfg.dolphin));
  if (!fs.existsSync(exe)) {
    console.log(`Copying playback Dolphin to ${DOLPHIN_DIR} ...`);
    fs.mkdirSync(path.join(DOLPHIN_DIR, "User"), { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      if (e.isFile()) fs.copyFileSync(path.join(src, e.name), path.join(DOLPHIN_DIR, e.name));
    }
    fs.cpSync(path.join(src, "Sys"), path.join(DOLPHIN_DIR, "Sys"), { recursive: true });
    for (const d of ["Config", "GameSettings", "Slippi", "GC", "Wii"]) {
      const p = path.join(src, "User", d);
      if (fs.existsSync(p)) fs.cpSync(p, path.join(DOLPHIN_DIR, "User", d), { recursive: true });
    }
  }
  const set = (file, section, pairs) => {
    const p = path.join(DOLPHIN_DIR, "User", "Config", file);
    let text = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
    for (const [k, v] of Object.entries(pairs)) {
      const re = new RegExp(`^${k} = .*$`, "m");
      if (re.test(text)) text = text.replace(re, `${k} = ${v}`);
      else if (text.includes(`[${section}]`)) text = text.replace(`[${section}]`, `[${section}]\n${k} = ${v}`);
      else text += `\n[${section}]\n${k} = ${v}\n`;
    }
    fs.writeFileSync(p, text);
  };
  set("Dolphin.ini", "Movie", { DumpFrames: "True", DumpFramesSilent: "True" });
  set("Dolphin.ini", "DSP", { DumpAudio: "True", DumpAudioSilent: "True" });
  set("GFX.ini", "Settings", { InternalResolutionFrameDumps: "True", BitrateKbps: "25000" });
  return exe;
}

// Play one segment in Dolphin and stop it once the last frame has been dumped.
function dump(exe, clip, i, tmp) {
  const comm = path.join(tmp, `${i}.json`);
  fs.writeFileSync(comm, JSON.stringify({
    mode: "normal", replay: clip.path, startFrame: clip.startFrame, endFrame: clip.endFrame,
    isRealTimeMode: false, commandId: `render-${Date.now()}-${i}`,
  }));
  return new Promise((resolve) => {
    const p = spawn(exe, ["-i", comm, "-o", String(i), `--output-directory=${tmp}`, "-b", "-e", cfg.iso, "--cout"]);
    let end = clip.endFrame;
    let reached = false;
    // Generous limit: boot plus the segment at well under real time.
    const timer = setTimeout(() => p.kill(), 60000 + ((clip.endFrame - clip.startFrame) / 60) * 4000);
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", (d) => {
      for (const line of d.split(/\r?\n/)) {
        const m = line.match(/\[(PLAYBACK_END_FRAME|GAME_END_FRAME|CURRENT_FRAME)\] (-?\d+)/);
        if (!m) continue;
        const f = Number(m[2]);
        if (m[1] !== "CURRENT_FRAME") end = Math.min(end, f);
        else if (f >= end && !reached) { reached = true; p.kill(); }
      }
    });
    p.on("exit", () => { clearTimeout(timer); resolve(reached); });
  });
}

function encode(i, tmp, out) {
  const r = spawnSync(FFMPEG, [
    "-v", "error", "-y", "-i", path.join(tmp, `${i}.avi`), "-i", path.join(tmp, `${i}.wav`),
    "-vf", "scale=-2:1080", "-c:v", "libx264", "-crf", "18", "-preset", "fast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-shortest", out,
  ], { stdio: "inherit" });
  return r.status === 0;
}

(async () => {
  const clips = what === "great" ? clipsFromRatings(2) : what === "good" ? clipsFromRatings(1) : clipsFromQueue(what);
  fs.mkdirSync(OUT, { recursive: true });
  const todo = clips.map((c, i) => ({ ...c, i, out: path.join(OUT, `${c.name}.mp4`) })).filter((c) => !fs.existsSync(c.out));
  console.log(`${clips.length} clips, ${clips.length - todo.length} already rendered, ${todo.length} to go -> ${OUT}`);
  if (!todo.length) return;
  const exe = prepareDolphin();
  const tmp = path.join(RENDER, "tmp");
  fs.mkdirSync(tmp, { recursive: true });

  let done = 0, failed = 0;
  const worker = async () => {
    for (let c; (c = todo.shift()); ) {
      const ok = (await dump(exe, c, c.i, tmp)) && encode(c.i, tmp, c.out);
      for (const ext of ["json", "avi", "wav"]) fs.rmSync(path.join(tmp, `${c.i}.${ext}`), { force: true });
      ok ? done++ : failed++;
      console.log(`${ok ? "ok    " : "FAILED"} ${path.basename(c.out)}`);
    }
  };
  await Promise.all(Array.from({ length: JOBS }, worker));
  console.log(`\nRendered ${done}${failed ? `, ${failed} failed` : ""}. Videos in ${OUT}`);
})();
