// Match captured clips (HUD readings in data/clips.json) to replay files and frames.
// Usage: node match.js [--all]   (--all skips the name prefilter and checks every game)
const fs = require("fs");
const { execSync } = require("child_process");
const { SlippiGame } = require("@slippi/slippi-js");

const CAPTURES = "G:\\My Drive\\Videos\\Captures";
const BRUTE = process.argv.includes("--all");

const games = fs
  .readdirSync("data")
  .filter((f) => /^index_\d+\.jsonl$/.test(f))
  .flatMap((f) => fs.readFileSync(`data/${f}`, "utf8").split("\n").filter(Boolean).map(JSON.parse))
  .filter((g) => !g.error && g.players);

const ONLY = (process.env.IDS || "").split(",").filter(Boolean).map(Number);
const clips = JSON.parse(fs.readFileSync("data/clips.json", "utf8")).filter((c) => !ONLY.length || ONLY.includes(c.id));

// The first reading of each clip is at 10% of its duration, except where noted (50%).
const FIRST_OBS_POS = { 3: 0.5, 48: 0.5 };

const norm = (s) => (s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

function nameSim(a, b) {
  // Punctuation-only names such as "..." or "???" normalize to nothing; compare them raw.
  if (a && b && a.trim().toLowerCase() === b.trim().toLowerCase()) return 1;
  a = norm(a);
  b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.9;
  return 1 - lev(a, b) / Math.max(a.length, b.length);
}

const timerToFrame = (t, start) => {
  const [m, s, c] = t.split(":").map(Number);
  return Math.round((start - (m * 60 + s + c / 100)) * 60);
};

const frameCache = new Map();
function percentsAt(file, frame) {
  if (!frameCache.has(file)) {
    if (frameCache.size > 50) frameCache.clear();
    frameCache.set(file, new SlippiGame(file).getFrames());
  }
  const fr = frameCache.get(file)[frame];
  if (!fr) return null;
  return Object.values(fr.players)
    .filter(Boolean)
    .map((p) => Math.floor(p.post.percent));
}

// Eliminated players have no HUD percent, so the readings may cover only some players.
const sameMultiset = (got, want) => {
  const rest = [...got];
  return want.every((p) => { const i = rest.indexOf(p); return i >= 0 && rest.splice(i, 1); });
};

function duration(file) {
  const out = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${CAPTURES}\\${file}"`);
  return parseFloat(out.toString());
}

const results = [];
for (const clip of clips) {
  const nPlayers = clip.nPlayers || clip.obs[0][1].length;
  const names = clip.obs[0][1].map(([n]) => n);
  let cands = games.filter((g) => g.players.length === nPlayers && g.timerStart);
  if (!BRUTE) {
    cands = cands
      .map((g) => {
        const score = Math.max(
          ...names.flatMap((n) =>
            ["oferton", "esimmelee", "retired30yo", "retired30vo"].includes(norm(n)) ? [0] : g.players.flatMap((p) => [nameSim(n, p.name), nameSim(n, p.tag)])
          )
        );
        return { g, score };
      })
      .filter((x) => x.score >= 0.6)
      .map((x) => x.g);
  }
  let best = null;
  for (const g of cands) {
    const frames = clip.obs.map(([t]) => timerToFrame(t, g.timerStart));
    if (Math.max(...frames) > g.lastFrame) continue;
    let hits = 0;
    let offsets = [];
    for (let i = 0; i < clip.obs.length; i++) {
      const want = clip.obs[i][1].map(([, p]) => p);
      for (const d of [0, -1, 1, -2, 2]) {
        const got = percentsAt(g.file, frames[i] + d);
        if (got && sameMultiset(got, want)) {
          hits++;
          offsets.push(d);
          break;
        }
      }
    }
    if (hits > 0 && (!best || hits > best.hits)) best = { g, hits, frames };
    if (best && best.hits === clip.obs.length) break;
  }
  const rec = { id: clip.id, clip: clip.file, candidates: cands.length };
  if (best) {
    const dur = duration(clip.file);
    const pos = FIRST_OBS_POS[clip.id] || 0.1;
    const startFrame = Math.round(best.frames[0] - pos * dur * 60);
    Object.assign(rec, {
      replay: best.g.file,
      startAt: best.g.startAt,
      hits: `${best.hits}/${clip.obs.length}`,
      startFrame,
      endFrame: startFrame + Math.round(dur * 60),
      players: best.g.players.map((p) => `${p.name || p.tag || "?"} (${p.code || "local"}, char ${p.char})`).join(" vs "),
    });
  }
  results.push(rec);
  console.log(JSON.stringify(rec));
}
fs.writeFileSync(BRUTE ? "data/matches_all.json" : "data/matches.json", JSON.stringify(results, null, 1));
