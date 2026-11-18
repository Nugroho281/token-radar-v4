# token-radar-v4

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Nugroho281/token-radar-v4/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Nugroho281/token-radar-v4/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Apogee — a token launch radar. Twenty-nine model variants run on one walk-forward protocol over the snapshot's 128 traded comps (the previous entries' thirteen kept as controls, sixteen challengers: recency-weighted comps, a two-knot size curve, a growth-by-segment interaction, category offsets, robust and ridge fits, and other hinge placements on the winning base); the winner is unchanged — a two-segment size curve with a growth term, walk-forward median |log10 error| 0.4399, blind holdout 0.5615 — because no challenger beat it by the pre-registered 0.005 on walk-forward while holding blind, and the numbers are printed in full rather than hidden. It prices all 197 genuine pre-token protocols with bootstrap bands and rank ranges; the no-token clock is shown on every row and — on the walk-forward evidence — priced into none. Every row is decomposed into its model parts, shown against its nearest traded tokens, and carries a dated farm plan netted to the dollar with per-chain gas and a mechanism-specific action on every step: farm, thin or skip.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=scz7tdtw&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
