# %% [markdown]
# # Push Bracket Update
# Run this notebook (or script) whenever you update ProjectedBrackets.xlsx.
# It regenerates all TypeScript data files locally and pushes to GitHub.
# No need to run bracket_sim.

# %%
import subprocess, datetime, sys
from pathlib import Path

BASE = Path(__file__).resolve().parent if "__file__" in dir() else Path.cwd()

def _git(*args):
    return subprocess.run(["git", *args], cwd=BASE, capture_output=True, text=True)

# %%
# Step 1 — Regenerate TypeScript data files from xlsx sources
print("Regenerating TypeScript data files...")
result = subprocess.run(
    ["npx", "tsx", "scripts/convertData.ts"],
    cwd=BASE, capture_output=True, text=True
)
print(result.stdout[-2000:] if result.stdout else "")
if result.returncode != 0:
    print("ERROR:", result.stderr[-1000:])
    sys.exit(1)
print("Done regenerating.")

# %%
# Step 2 — Stage all generated files + ProjectedBrackets.xlsx
FILES = [
    "ProjectedBrackets.xlsx",
    "src/data/teams.ts",
    "src/data/bracketPreds2026.ts",
    "src/lib/matchupProbData.ts",
    "src/data/matchupPredictor.ts",
    "src/data/teamStats2026.ts",
    "src/conferences/data/confTeams.ts",
    "src/conferences/data/confMatchupProbs.ts",
    "src/rankings/data/d1Rankings.ts",
]

for f in FILES:
    _git("add", f)

diff = _git("diff", "--staged", "--quiet")
if diff.returncode == 0:
    print("No changes detected — already up to date.")
    sys.exit(0)

today = datetime.date.today().isoformat()
commit = _git("commit", "-m", f"Update bracket and regenerate data files ({today})")
print(commit.stdout.strip())

# %%
# Step 3 — Pull rebase then push
import shutil
pull = _git("pull", "--rebase", "--autostash")
if pull.returncode != 0:
    print(f"Pull failed: {pull.stderr.strip()}")
    _git("rebase", "--abort")
    rmerge = BASE / ".git" / "rebase-merge"
    if rmerge.exists():
        shutil.rmtree(str(rmerge), ignore_errors=True)
    print("Rebase aborted. Re-run push_bracket to retry.")
    sys.exit(1)

push = _git("push")
if push.returncode == 0:
    print(f"Pushed successfully. Website will update in ~30 seconds.")
else:
    print(f"Push failed: {push.stderr.strip()}")
    sys.exit(1)
