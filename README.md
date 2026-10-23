# melee-combos

Find clip-worthy punishes in my Slippi replays (`C:\Games\Slippi Replays`, connect code `1SHINE#0`).

## Review loop

```
node review.js 40          # plays 40 unrated top candidates in Dolphin; x=great g=good b=bad q=quit
python rank.py --no-cv     # re-rank using the new ratings
```

Each batch is 80% top-ranked and 20% random picks from ranks ~30–3000, so the model also
learns from things it is unsure about. Ratings go to `data/ratings.csv`. A "bad" rating counts
much more than an unclipped punish, and "good"/"great" count as positives.

`python rank.py` (without `--no-cv`) also reports where each hand-made clip ranks when it is
held out of training. That is a loose check: most cool punishes were never clipped.

## Pipeline

| Step | Script | Output |
|---|---|---|
| Index every replay (players, punishes) | `index.js` (20 workers) | `data/index_*.jsonl` |
| Match captured videos to replay + frames | `match.js` (HUD readings in `data/clips.json`) | `data/matches.json` |
| Clippi default profile, for comparison | `clippi.js` | `data/clippi_combos.json` |
| Clipped punish per video | `compare.js`, `export.js` | `out/clipped_combos.csv`, `out/queue_clipped.json` |
| Punish features | `features.js` | `data/features.csv` |
| Per-frame features (≥20% / kills) | `framefeat.js` (20 workers) | `data/ff_*.jsonl` |
| Ranking | `rank.py` (gradient boosting; `--logit` for linear) | `data/ranked.csv` |
| Opponent quit mid-punish | `ragequits.py` | `out/queue_ragequits.json` |

Play any queue with `play.bat out\<queue>.json`.

In slippi-js v6 conversions, `playerIndex` is the player being hit and `lastHitBy` is the attacker
(stored as `p` / `opp` in the index).
