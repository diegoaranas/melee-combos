# melee-combos

Finds the best punishes in your Slippi replays, learns which ones you like from your ratings,
and makes videos of them.

## Download

New to it? The [step-by-step guide](https://diegoaranasegura.com/melee-combos/) walks through
setup, rating and sending your ratings back.

1. Download [`melee-combos_windows_amd64.exe`](https://github.com/diegoaranas/melee-combos/releases/latest/download/melee-combos_windows_amd64.exe)
   from the [latest release](https://github.com/diegoaranas/melee-combos/releases/latest).
2. Put it in its own folder. It keeps its data next to itself.
3. Double-click it.

You need Windows and Slippi Launcher with your replay folder and Melee ISO set in its
settings. Your connect code and replay folder are detected automatically.

The first launch reads every replay you have, which takes a few minutes per thousand
replays. After that it only reads new ones.

Windows may warn that the app is from an unknown publisher (it isn't signed). Click
**More info → Run anyway**.

## Using it

```
You've rated 0 punishes.
  1  Rate punishes (the more you rate, the better it gets at finding ones you like)
  2  Watch my top 20 in Dolphin
  3  Make videos of the punishes I rated great
  4  Make my ratings file (to send back)
  5  Check for new replays
  q  Quit
```

- **Rate punishes**: Dolphin plays one punish at a time. Click back on the app window and press
  `x` great, `g` good, `b` bad (then why: `1` repetitive, `2` opponent was acting, `3` other),
  `s` skip, `r` replay, `q` stop. Each batch is 40 punishes: mostly the ones it currently thinks
  are best, plus some it is unsure about, so it learns faster. A few you already rated come
  back unmarked, to check how consistent the ratings are.
- **Make videos** renders every punish you rated great to `out\clips\*.mp4` (1080p). The first
  time, it downloads ffmpeg (about 200 MB). A Dolphin window opens for each clip; each takes
  about 40 seconds.
- **Make my ratings package** writes `ratings-<your code>.zip` next to the app. Send it to
  whoever gave you the app (Google Drive or similar if it's over Discord's 10 MB limit; expect
  about 0.65 MB per game you rated a punish in). Inside:
  - `ratings-<your code>.json`: your ratings and the numbers used to rank each punish
    (damage, hits, kill, movement and so on), with the replay's file name. No folder paths or
    opponent names. This part gets built into the next version of the app.
  - `replays/`: the games those punishes are from, so the ranking can be recomputed when it
    improves. These show your opponents' tags, so they are kept private and never published.

Before you have rated anything, the ranking comes from the ratings built into the app (everyone
who has sent theirs in). Everyone's ratings count the same, and it learns your taste as you rate.

## How it works

1. Reads every replay with [slippi-js](https://github.com/project-slippi/slippi-js) and lists
   your punishes (its "conversions").
2. Describes each punish with about 40 numbers: damage, hits, kill, start percent, how fast,
   how varied, how much time off-stage, how far it carried the opponent, whether the opponent
   was acting during it, and so on.
3. Trains a small gradient-boosted tree model (`gbm.js`): punishes rated good or great are
   positives, punishes rated bad are strong negatives, and unrated punishes are weak negatives.
4. Videos: plays each punish in a private copy of Slippi's playback Dolphin with frame dumping
   on, then encodes it with ffmpeg.

## Development

Needs Node 18+. `npm install`, then run any step directly; `node app.js` is the same as the exe.

| Step | Script | Output |
|---|---|---|
| First-time config (connect code, paths) | `setup.js` | `config.json` |
| All of the below, incrementally | `update.js` | |
| Read every replay (players, punishes) | `index.js` | `data/index_*.jsonl` |
| Punish features | `features.js` | `data/features.csv` |
| Per-frame features (≥20% / kills) | `framefeat.js` | `data/ff_*.jsonl` |
| Ranking (own + shared ratings) | `rank.js` | `data/ranked.csv` |
| Rate punishes | `review.js [N]` | `data/ratings.csv` |
| Export your ratings | `share.js` | `shared/<code>.json` |
| Unpack a friend's package | `receive.js <zip>` | `shared/`, `received/` |
| Render to mp4 | `render.js great \| good \| <queue.json>` | `out/clips/` |
| Build the exe | `build.js` | `dist/` |

When someone sends a ratings package, `node receive.js ratings-ABCD-123.zip` puts their ratings
into `shared/ABCD-123.json` and their replays into `received/ABCD-123/` (git-ignored). Commit
the `shared/` file as `feat: add <name>'s ratings`; the exe is built with every file in
`shared/` inside (`starter.json`), so the next release gives everyone their ratings.

Releases are automated: see [AGENTS.md](AGENTS.md).

The Python scripts (`rank.py` with held-out clip ranks and a `--logit` model, `explain.py`,
`top.py`, `ragequits.py`) are analysis tools. They need `pip install -r requirements.txt`.

In slippi-js v6 conversions, `playerIndex` is the player being hit and `lastHitBy` is the attacker
(stored as `p` / `opp` in the index).
