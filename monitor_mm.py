"""
monitor_mm.py
Polls the model_mm.py background task output and writes milestone updates
to model_mm_milestones.log at trials 5, 15, 30, 45, 60, 75, 90, 100
and whenever early-stop or completion is detected.
"""
import time, re, sys, io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

OUTPUT_FILE   = r"C:\Users\franc\AppData\Local\Temp\claude\c--Users-franc-OneDrive-Jupyter-Business\tasks\b5185cf.output"
MILESTONE_LOG = r"c:/Users/franc/OneDrive/Jupyter/Business/MM/model_mm_milestones.log"
MILESTONES    = [5, 15, 30, 45, 60, 75, 90, 100]
POLL_SECS     = 20

reported      = set()
early_stopped = False

def write(msg):
    print(msg, flush=True)
    with open(MILESTONE_LOG, "a", encoding="utf-8") as f:
        f.write(msg + "\n")

write("=== Monitor started ===")

while True:
    try:
        with open(OUTPUT_FILE, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except FileNotFoundError:
        time.sleep(POLL_SECS)
        continue

    # Parse current trial number  (e.g. "| 47/100")
    trial_matches = re.findall(r"\|\s*(\d+)/100", content)
    current_trial = int(trial_matches[-1]) if trial_matches else 0

    # Parse best CV log loss
    best_matches  = re.findall(r"Best value:\s*([\d.]+)", content)
    best_value    = best_matches[-1] if best_matches else "N/A"

    # Milestone checks
    for m in MILESTONES:
        if current_trial >= m and m not in reported:
            write(f"[MILESTONE {m:3d}] trial={current_trial}/100 | best_cv_logloss={best_value}")
            reported.add(m)

    # Early-stop detection
    if "[Early stop]" in content and "early_stop" not in reported:
        es = re.search(r"\[Early stop\][^\n]+", content)
        msg = es.group() if es else "[Early stop] detected"
        write(f"[EARLY STOP] {msg}")
        reported.add("early_stop")

    # Phase 4 onward (post-Optuna)
    if "PHASE 4:" in content and "optuna_done" not in reported:
        # Extract best params block
        params_block = ""
        m = re.search(r"Best CV log loss: ([\d.]+)\nBest hyperparameters:(.*?)(?=\n# %%|\nPhase|\n={10}|\Z)",
                      content, re.DOTALL)
        if m:
            params_block = f"Best CV log loss: {m.group(1)}\n{m.group(2).strip()}"
        write(f"[OPTUNA DONE] Moving to Phase 4+.\n{params_block}")
        reported.add("optuna_done")

    # Completion
    if "All done!" in content and "done" not in reported:
        # Grab everything from PHASE 6 onward
        tail = content[content.rfind("PHASE 6:"):]  if "PHASE 6:" in content else content[-4000:]
        write(f"[COMPLETE] Script finished!\n{'='*60}\n{tail.strip()}")
        reported.add("done")
        write("=== Monitor finished ===")
        break

    time.sleep(POLL_SECS)
