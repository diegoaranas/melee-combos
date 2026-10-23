"""Explain the ranking model: effect curves (partial dependence) and per-combo SHAP breakdowns.

Refits the model exactly as rank.py does, then writes data/explain.json.
"""
import json
import runpy
import sys

import numpy as np
import shap

sys.argv = ["rank.py", "--no-cv"]
R = runpy.run_path("rank.py")
m, X, Xs, df, scaler = R["m"], R["X"], R["Xs"], R["df"], R["scaler"]
cols = list(X.columns)

# Background for effect curves: kill punishes of 40%+, the population where "how good" is a real question.
rng = np.random.default_rng(0)
bg_idx = np.flatnonzero(((df.kill == 1) & (df.dmg >= 40)).values)
bg_idx = rng.choice(bg_idx, size=min(2000, len(bg_idx)), replace=False)
bg = Xs[bg_idx]
base_score = float(m.decision_function(bg).mean())

# Each curve varies one model input over its observed range; `raw` converts it back to display units.
CURVES = {
    "sp": ("Starting percent", lambda v: v * 100, "%"),
    "logdmg": ("Damage", np.expm1, "%"),
    "hits": ("Hits", np.expm1, ""),
    "meanGap": ("Average gap between hits", np.expm1, "frames"),
    "maxGap": ("Longest gap between hits", np.expm1, "frames"),
    "seconds": ("Length", np.expm1, "s"),
    "distinct": ("Different moves", lambda v: v, ""),
    "maxHitShare": ("Biggest hit's share of damage", lambda v: v * 100, "%"),
    "repeatFrac": ("Most-repeated move's share", lambda v: v * 100, "%"),
    "offstageFrac": ("Time opponent is off-stage", lambda v: v * 100, "%"),
    "lcancels": ("L-cancels", np.expm1, ""),
    "myTravel": ("Distance you travel", np.expm1, "units"),
}
BINARY = {
    "kill": "Kills", "zeroToDeath": "Zero-to-death", "killOffstage": "Kill off-stage",
    "killDownB": "Finishes with down-B", "killAerial": "Finishes with an aerial",
    "killThrow": "Finishes with a throw", "gameWinner": "Wins the game", "ragequit": "Opponent quits",
}

j = {}
mean, scale = scaler.mean_, scaler.scale_


def effect(col, values):
    c = cols.index(col)
    out = []
    for v in values:
        B = bg.copy()
        B[:, c] = (v - mean[c]) / scale[c]
        if col == "kill":
            # kill_logdmg carries the same information; toggle it consistently.
            k, d = cols.index("kill_logdmg"), cols.index("logdmg")
            B[:, k] = (v * (B[:, d] * scale[d] + mean[d]) - mean[k]) / scale[k]
        out.append(float(m.decision_function(B).mean()) - base_score)
    return out


curves = []
for col, (label, raw, unit) in CURVES.items():
    vals = X[col].values[bg_idx]
    grid = np.unique(np.quantile(vals, np.linspace(0.02, 0.98, 25)))
    curves.append({"col": col, "label": label, "unit": unit,
                   "x": [round(float(raw(v)), 2) for v in grid], "y": [round(v, 3) for v in effect(col, grid)]})
binaries = []
for col, label in BINARY.items():
    no, yes = effect(col, [0.0, 1.0])
    binaries.append({"col": col, "label": label, "delta": round(yes - no, 3)})

# SHAP breakdowns: current top 10 plus a few clips, in model-score (log-odds) units.
explainer = shap.TreeExplainer(m)
order = np.argsort(-df.score.values)
picks = list(order[:10]) + list(rng.choice(np.flatnonzero(df.label.values == 1), 4, replace=False))
sv = explainer.shap_values(Xs[picks])
GROUPS = {
    "Payoff": ["logdmg", "kill", "kill_logdmg", "sp", "zeroToDeath", "gameWinner", "ragequit"],
    "Tightness": ["hits", "seconds", "hitsPerSec", "meanGap", "maxGap", "victimFreeFrac"],
    "Variety": ["distinct", "repeatFrac", "aerialFrac", "smashFrac", "grabFrac", "downBFrac", "maxHitShare"],
    "Kill style": ["killAerial", "killSmash", "killDownB", "killThrow", "killOffstage"],
    "Execution": ["lcancels", "wavelands", "airdodges", "jumps", "ledge", "myAirFrac", "myTravel"],
    "Spectacle": ["offstageFrac", "victimXSpan", "victimMaxY"],
}
group_of = {c: g for g, cs in GROUPS.items() for c in cs}
rank_of = {int(i): r + 1 for r, i in enumerate(order[:200000])}
combos = []
for k, i in enumerate(picks):
    row = df.iloc[i]
    contrib = sorted(zip(cols, sv[k]), key=lambda t: -abs(t[1]))
    groups = {}
    for c, v in zip(cols, sv[k]):
        g = group_of.get(c, "Other")
        groups[g] = groups.get(g, 0) + float(v)
    combos.append({
        "rank": rank_of[int(i)], "clipped": int(row.label), "opponent": str(row.opponent),
        "date": str(row.file).split("Game_")[1][:8], "dmg": round(float(row.dmg)), "sp": round(float(row.sp)),
        "hits": int(row.hits), "kill": int(row.kill), "seconds": round(float(row.seconds), 1),
        "score": round(float(row.score), 2),
        "groups": {g: round(v, 2) for g, v in groups.items()},
        "top": [{"feature": c, "value": round(float(X.iloc[i][c]), 2), "shap": round(float(v), 2)} for c, v in contrib[:6]],
    })

j = {"base_score": round(float(explainer.expected_value if np.ndim(explainer.expected_value) == 0 else explainer.expected_value[0]), 2),
     "bg_n": len(bg_idx), "curves": curves, "binaries": binaries, "combos": combos}
json.dump(j, open("data/explain.json", "w"), indent=1)

print("binary effects (score change, kill-40%+ background):")
for b in sorted(binaries, key=lambda b: -abs(b["delta"])):
    print(f"   {b['label']:28s} {b['delta']:+.2f}")
print("\ncurve ranges (max - min):")
for c in sorted(curves, key=lambda c: -(max(c["y"]) - min(c["y"]))):
    print(f"   {c['label']:32s} {max(c['y']) - min(c['y']):.2f}   x {c['x'][0]}..{c['x'][-1]} {c['unit']}")
for c in combos[:3] + combos[-2:]:
    print(f"\n#{c['rank']} {'(clip) ' if c['clipped'] else ''}{c['dmg']}% from {c['sp']}%, {c['hits']} hits -> {c['groups']}")
