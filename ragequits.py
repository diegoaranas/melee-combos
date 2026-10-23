"""List punishes that ended because the opponent quit (LRAS) mid-punish, as their own queue."""
import json

import pandas as pd

df = pd.read_csv("data/features.csv")
rq = df[(df.ragequit == 1) & (df.hits >= 2)].sort_values("dmg", ascending=False)
print(f"{len(rq)} rage-quits during a punish of 2+ hits ({int(rq.label.sum())} of them clipped)")
print(rq[["file", "dmg", "hits", "sp", "opponent"]].head(10).to_string(index=False))
queue = {
    "mode": "queue", "replay": "", "isRealTimeMode": False, "outputOverlayFiles": False,
    "queue": [{"path": r.file, "startFrame": max(-123, int(r.s) - 90), "endFrame": int(r.e) + 30}
              for r in rq.itertuples()],
}
json.dump(queue, open("out/queue_ragequits.json", "w"), indent=1)
