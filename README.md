# TRex's Tournament Trainer (TTT)

A tournament poker study tool: ICM-aware pre-flop ranges, final table prep, pre-flop and post-flop drills, a math sprint and a leak tracker.

**Study between sessions, not during them.** Online poker sites ban real-time assistance - this is a training tool only.

## Use it
Open `index.html` in any browser, or visit the GitHub Pages site for this repo. Everything runs in the browser; drills, logs and saved tables are stored locally on each device.

## Tabs
- **Review** - set up the table by seat number (chips or big blinds), tag opponents (Nit, Fish, TAG Reg, LAG Reg), and get fold/call/raise/all-in frequencies for any hand.
- **Table Prep** - plan a known table (e.g. a final table): your ranges vs every seat, ICM risk, next orbit, ICM equity and pay jumps.
- **Pre-Flop Drills** - random spots on an 8-handed table.
- **Post-Flop Drills** - fold/call/raise vs bets by player type, plus a 10-question Math Sprint.
- **Leaks** - are you too loose or too tight, and where.
- **Tools** - bet math and a player-type guide.

## How it works
- Pre-flop all-ins: exact Malmuth-Harville ICM and a 169x169 equity table, with ranges solved to an equilibrium and shifted by player type.
- Deeper raise/call/3-bet: chart model adjusted for ICM and reads (guidance).
- Post-flop: 7-card evaluator + Monte Carlo equity vs modeled betting ranges per player type (guidance, not solver output).

## Edit and rebuild
Source lives in `src/`. After editing, run:
```
python3 src/build.py
```
This regenerates `index.html`. (`src/eq.py` regenerates the equity table and needs `pip install eval7`.)
