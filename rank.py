"""Rank punishes by how clip-worthy they look.

Fits a regularised logistic regression of "clipped" vs everything else (positive-unlabelled:
unclipped punishes are not known to be bad, so the model only orders them). Reports
leave-one-clip-out ranks, then writes data/ranked.csv for the review queue.
"""
import glob
import json
import os
import re
import sys

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

CONFIG = json.load(open("config.json", encoding="utf8")) if os.path.exists("config.json") else {}
SHARED_WEIGHT = 1.0  # other people's ratings count as much as your own
MODEL = "logit" if "--logit" in sys.argv else "gbm"
C = float(next((a.split("=")[1] for a in sys.argv if a.startswith("--C=")), 0.1))

df = pd.read_csv("data/features.csv")

# Ratings from review sessions override the clip labels: 1 = good, 0 = bad.
try:
    ratings = pd.read_csv("data/ratings.csv")
    # Keep the latest rating if a punish was rated more than once.
    ratings = ratings.drop_duplicates(["file", "s"], keep="last")
    df = df.merge(ratings[["file", "s", "rating"]], on=["file", "s"], how="left")
except FileNotFoundError:
    df["rating"] = np.nan


FRAME_COLS = ["offstageFrac", "killOffstage", "victimFreeFrac", "myAirFrac", "lcancels", "wavelands",
              "airdodges", "jumps", "ledge", "victimActs", "victimXSpan", "victimMaxY", "myTravel"]


def load_frame_features():
    rows = []
    for f in glob.glob("data/ff_*.jsonl"):
        for line in open(f, encoding="utf8"):
            g = json.loads(line)
            rows += [{"file": g["file"], **p} for p in g.get("punishes", [])]
    return pd.DataFrame(rows, columns=["file", "s", *FRAME_COLS])


def load_shared():
    """Other people's rated punishes (shared/*.json, written by share.js), as extra training rows."""
    own = re.sub(r"[^A-Za-z0-9]+", "-", CONFIG.get("code") or "")
    rows = []
    for f in sorted(glob.glob("shared/*.json")):
        if os.path.splitext(os.path.basename(f))[0] == own:
            continue  # your own ratings are already in data/ratings.csv
        rows += json.load(open(f, encoding="utf8"))["rows"]
    sh = pd.DataFrame(rows)
    if len(sh):
        sh = sh[sh.rating.notna()].copy()
        sh["label"] = 0
    return sh


ff = load_frame_features()
df = df.merge(ff, on=["file", "s"], how="left")
n_local = len(df)
shared = load_shared()
if len(shared):
    print(f"training also on {len(shared)} punishes rated by other people (shared/)")
    df = pd.concat([df, shared], ignore_index=True)
# Punishes under 20% without a kill were not frame-parsed; they get neutral zeros.
df["framed"] = df.offstageFrac.notna().astype(int)
df[FRAME_COLS] = df[FRAME_COLS].fillna(0)


def features(d):
    X = pd.DataFrame(index=d.index)
    X["logdmg"] = np.log1p(d.dmg.clip(lower=0))
    X["hits"] = np.log1p(d.hits)
    X["distinct"] = d.distinct
    X["sp"] = d.sp / 100
    X["kill"] = d.kill
    X["kill_logdmg"] = d.kill * X.logdmg
    X["zeroToDeath"] = d.zeroToDeath
    X["ragequit"] = d.ragequit
    X["gameWinner"] = d.gameWinner
    X["seconds"] = np.log1p(d.seconds)
    X["hitsPerSec"] = d.hitsPerSec.clip(upper=5)
    X["maxHitShare"] = d.maxHitShare.replace([np.inf, -np.inf], 1).clip(0, 1)
    X["neutralWin"] = d.neutralWin
    X["singles"] = d.singles
    X["maxGap"] = np.log1p(d.maxGap.clip(lower=0))
    X["meanGap"] = np.log1p(d.meanGap.clip(lower=0))
    X["maxRun"] = d.maxRun
    for k in ["aerialFrac", "smashFrac", "grabFrac", "downBFrac", "repeatFrac",
              "killAerial", "killSmash", "killDownB", "killThrow"]:
        X[k] = d[k]
    if "--no-frames" not in sys.argv:
        X["framed"] = d.framed
        for k in ["offstageFrac", "killOffstage", "victimFreeFrac", "myAirFrac"]:
            X[k] = d[k]
        X["victimActsPerSec"] = d.victimActs / d.seconds
        for k in ["lcancels", "wavelands", "airdodges", "jumps", "ledge", "victimActs"]:
            X[k] = np.log1p(d[k])
        for k in ["victimXSpan", "victimMaxY", "myTravel"]:
            X[k] = np.log1p(d[k].clip(lower=0))
    return X


X = features(df)
y = df.label.copy()
# Rated punishes count as labelled examples; a bad rating also teaches what to push down.
y[df.rating >= 1] = 1
weights = np.ones(len(df))
weights[df.rating == 0] = 20.0  # an explicit "bad" is much stronger evidence than "unclipped"
# Weight for ratings from shared/ (other people), relative to your own.
weights[n_local:] *= SHARED_WEIGHT
if y.sum() == 0:
    sys.exit("No positive examples yet: rate some punishes (node review.js) or add friends' files to shared/.")

scaler = StandardScaler().fit(X)
Xs = scaler.transform(X)


def fit(mask_out=None):
    w = weights.copy()
    yy = y.copy()
    if mask_out is not None:
        yy[mask_out] = 0
    if MODEL == "gbm":
        # Positives are rare; upweight them to balance the classes.
        w = w * np.where(yy == 1, (yy == 0).sum() / max(1, (yy == 1).sum()), 1.0)
        # early_stopping defaults to on above 10k rows, holding out a random 10% (which can
        # drop clips from training) and making every fit different; keep it off and seeded.
        m = HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=200,
                                           min_samples_leaf=50, l2_regularization=1.0,
                                           early_stopping=False, random_state=0)
    else:
        m = LogisticRegression(C=C, class_weight="balanced", max_iter=2000)
    m.fit(Xs, yy, sample_weight=w)
    return m


pos = np.flatnonzero(df.label.values == 1)
if "--no-cv" not in sys.argv:
    ranks = []
    for i in pos:
        m = fit(mask_out=i)
        score = m.decision_function(Xs)
        ranks.append(int((score[:n_local] >= score[i]).sum()))  # ties count against the clip
    ranks = np.array(ranks)
    print(f"held-out clip ranks among {n_local} punishes:")
    print("  ", sorted(ranks.tolist()))
    for k in (100, 200, 300, 500, 1000):
        print(f"   top {k:>4}: {(ranks <= k).sum()}/{len(ranks)}")

m = fit()
df["score"] = m.decision_function(Xs)
if MODEL == "logit":
    print("\nweights (standardised):")
    for name, w in sorted(zip(X.columns, m.coef_[0]), key=lambda t: -abs(t[1])):
        print(f"   {name:12s} {w:+.2f}")
# Opponent goes last because names can contain commas (review.js splits naively).
REVIEW_COLS = ["file", "s", "e", "label", "rating", "score", "dmg", "kill", "hits", "sp", "victimXSpan", "opponent"]
df.iloc[:n_local].sort_values("score", ascending=False)[REVIEW_COLS].to_csv("data/ranked.csv", index=False)
