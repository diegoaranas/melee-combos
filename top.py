"""Print the current top-ranked punishes and write them as a playback queue."""
import json
import sys

import pandas as pd

N = int(sys.argv[1]) if len(sys.argv) > 1 else 20
CHARS = {0: "Falcon", 1: "DK", 2: "Fox", 7: "Luigi", 9: "Marth", 12: "Peach", 13: "Pikachu", 15: "Puff",
         16: "Samus", 18: "Zelda", 19: "Sheik", 20: "Falco", 22: "Doc", 25: "Ganon", 23: "Roy", 21: "YLink"}
STAGES = {2: "FoD", 3: "Stadium", 8: "Yoshi's", 28: "Dream Land", 31: "Battlefield", 32: "FD"}

ranked = pd.read_csv("data/ranked.csv").head(N)
feats = pd.read_csv("data/features.csv", usecols=["file", "s", "me", "them", "stage", "seconds"])
top = ranked.merge(feats, on=["file", "s"], how="left")
top["date"] = top.file.str.extract(r"Game_(\d{8})")[0].str.replace(r"(\d{4})(\d{2})(\d{2})", r"\1-\2-\3", regex=True)
top["matchup"] = top.me.map(CHARS).fillna(top.me.astype(str)) + " v " + top.them.map(CHARS).fillna(top.them.astype(str))
top["stage"] = top.stage.map(STAGES).fillna(top.stage.astype(str))
top["clipped"] = top.label.map({1: "yes", 0: ""})
print(top[["date", "matchup", "stage", "opponent", "dmg", "sp", "hits", "seconds", "kill", "clipped"]]
      .rename(columns={"sp": "from%", "seconds": "secs"}).round(1).to_string(index=True))
queue = {"mode": "queue", "replay": "", "isRealTimeMode": False, "outputOverlayFiles": False,
         "queue": [{"path": r.file, "startFrame": max(-123, int(r.s) - 90), "endFrame": int(r.e) + 60}
                   for r in top.itertuples()]}
json.dump(queue, open("out/queue_top.json", "w"), indent=1)
