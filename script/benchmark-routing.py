#!/usr/bin/env python3
"""Run a Gradcode coding pilot on a pinned local Aider Polyglot checkout."""

import argparse
import concurrent.futures
import datetime
import hashlib
import json
import math
from pathlib import Path
import re
import random
import shutil
import subprocess
import time


ROOT = Path(__file__).resolve().parents[1]
SEED = "gradcode-routing-pilot-v1/"
PROFILES = [
    ("gpt-6-luna", "low", "economy", "Routine, small Python implementations and straightforward algorithms."),
    ("gpt-6-luna", "high", "economy", "Moderately involved Python algorithms on a small budget."),
    ("gpt-6-sol", "medium", "balanced", "General implementation, parsing, and stateful data structures."),
    ("gpt-6-sol", "high", "balanced", "Complex parsing, callbacks, dependency tracking, and subtle edge cases."),
    ("gpt-6-astra", "medium", "quality", "Difficult implementation requiring careful multi-step reasoning."),
    ("gpt-6-astra", "high", "quality", "Most difficult algorithms, intricate state invariants, and broad edge cases."),
]


def cli(args, cwd, timeout=60):
    return subprocess.run([str(ROOT / "gradcode"), *args], cwd=cwd, capture_output=True, text=True, timeout=timeout)


def configuration():
    return {
        "agents": {"build": {"steps": 12}},
        "routing": {
            "enabled": True,
            # Any saved Jev key can only reach a closed local port, never a hosted router.
            "jev": {"endpoint": "http://127.0.0.1:1/disabled", "timeoutMs": 1,
                    "keyEnvironment": "GRADCODE_BENCHMARK_DISABLED_JEV_KEY"},
            "laya": {"endpoint": "http://127.0.0.1:8000/v1/systemone", "model": "laya", "timeoutMs": 5000},
            "profiles": [
                {"name": f"{model}/{effort}", "model": {"providerID": "openai", "id": model, "variant": effort},
                 "reasoningEffort": effort, "description": description, "capabilities": ["text", "tools"],
                 "costPreference": cost}
                for model, effort, cost, description in PROFILES
            ],
        },
    }


def run_task(task, condition, source, work, config, repetition=1):
    started = time.monotonic()
    original = source / "python/exercises/practice" / task
    name = f"{task}-{condition}" + (f"-r{repetition}" if repetition > 1 else "")
    directory = work / name
    directory.mkdir()
    meta = json.loads((original / ".meta/config.json").read_text())
    solutions = meta["files"]["solution"]
    for name in solutions:
        (directory / name).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(original / name, directory / name)
    (directory / "opencode.json").write_text(json.dumps(config, indent=2))
    (directory / "AGENTS.md").write_text(
        "Work only in this directory. Implement the requested exercise using Python's standard library. "
        "Do not use subagents, network access, or files outside this directory. "
        "Do not search for reference implementations or grading tests. Do not edit configuration or AGENTS.md.\n"
    )
    docs = [original / ".docs/instructions.md", original / ".docs/instructions.append.md"]
    instructions = "\n\n".join(p.read_text() for p in docs if p.exists())
    prompt = (
        f"Implement the Python exercise '{task}' in {', '.join(solutions)}. "
        "Read the provided stubs and preserve their public API. "
        "Use only the standard library. You may write and run your own checks in this directory. "
        "The evaluator's tests are hidden; do not look for them or reference solutions. "
        "Finish by saving your implementation.\n\n" + instructions
    )
    (directory / "prompt.txt").write_text(prompt)
    model = "auto/auto" if condition == "auto" else "openai/gpt-6-astra#high"
    record = {"task": task, "condition": condition, "repetition": repetition, "requested_model": model, "directory": str(directory),
              "prompt_sha256": hashlib.sha256(prompt.encode()).hexdigest(), "timeout": False}
    log = directory / "events.jsonl"
    with log.open("w") as out, (directory / "stderr.log").open("w") as err:
        process = subprocess.Popen(
            [str(ROOT / "gradcode"), "run", "--model", model, "--format", "json", "--auto", prompt],
            cwd=directory, stdout=out, stderr=err, stdin=subprocess.DEVNULL,
        )
        try:
            record["exit_code"] = process.wait(timeout=300)
        except subprocess.TimeoutExpired:
            record["timeout"] = True
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            record["exit_code"] = process.returncode
    record["duration_seconds"] = round(time.monotonic() - started, 3)
    return collect_task(record, source, work, directory, solutions, log)


def recover_task(task, condition, source, work, repetition=1):
    """Grade an already generated solution without executing model inference again."""
    name = f"{task}-{condition}" + (f"-r{repetition}" if repetition > 1 else "")
    directory = work / name
    original = source / "python/exercises/practice" / task
    solutions = json.loads((original / ".meta/config.json").read_text())["files"]["solution"]
    log = directory / "events.jsonl"
    events = [json.loads(line) for line in log.read_text().splitlines() if line.strip()]
    times = [e["timestamp"] for e in events if isinstance(e.get("timestamp"), (int, float))]
    record = {
        "task": task, "condition": condition, "repetition": repetition,
        "requested_model": "auto/auto" if condition == "auto" else "openai/gpt-6-astra#high",
        "directory": str(directory), "prompt_sha256": hashlib.sha256((directory / "prompt.txt").read_bytes()).hexdigest(),
        "timeout": False, "exit_code": None, "recovered_without_inference_retry": True,
        "duration_seconds": round((max(times) - min(times)) / 1000, 3) if times else 0,
        "duration_source": "event timestamp span; CLI startup and shutdown excluded",
    }
    return collect_task(record, source, work, directory, solutions, log)


def collect_task(record, source, work, directory, solutions, log):
    original = source / "python/exercises/practice" / record["task"]
    meta = json.loads((original / ".meta/config.json").read_text())
    events = []
    for line in log.read_text().splitlines():
        try:
            events.append(json.loads(line))
        except ValueError:
            continue
    session = next((event.get("sessionID") for event in events if event.get("sessionID")), None)
    record["session_id"] = session
    record["errors"] = [
        {"type": e.get("error", {}).get("type"), "message": e.get("error", {}).get("message")}
        for e in events if e.get("type") == "error"
    ]
    if session:
        if record["timeout"]:
            cli(["api", "POST", f"/api/session/{session}/interrupt"], directory)
        response = cli(["api", "GET", f"/api/session/{session}/message"], directory)
        try:
            messages = json.loads(response.stdout).get("data", [])
        except ValueError:
            messages = []
        assistants = [m for m in messages if m.get("type") == "assistant"]
        record["steps"] = len(assistants)
        record["models"] = [m.get("model") for m in assistants]
        record["usage"] = [
            {"message_id": m["id"], "cost": m.get("cost"), "tokens": m.get("tokens"), "model": m.get("model")}
            for m in assistants
        ]
        record["cost_usd"] = sum(m["cost"] for m in assistants) if assistants and all(
            isinstance(m.get("cost"), (float, int)) for m in assistants
        ) else None
        record["session_outcome"] = next((m.get("outcome") for m in messages if m.get("type") == "idle"), None)
    grade = work / "grading" / directory.name
    grade.mkdir(parents=True, exist_ok=True)
    for name in meta["files"]["test"]:
        shutil.copy2(original / name, grade / name)
    for name in solutions:
        shutil.copy2(directory / name, grade / name)
    try:
        result = subprocess.run(
            ["python3", "-m", "unittest", "discover", "-p", "*_test.py", "-v"],
            cwd=grade, capture_output=True, text=True, timeout=30,
        )
        text = result.stdout + result.stderr
        (grade / "result.txt").write_text(text)
        count = re.search(r"Ran (\d+) tests?", text)
        record["tests_run"] = int(count.group(1)) if count else 0
        record["grading_exit_code"] = result.returncode
        record["passed"] = result.returncode == 0 and record["tests_run"] > 0
        record["grading_summary"] = text[-1800:] if not record["passed"] else "OK"
    except subprocess.TimeoutExpired:
        record.update(passed=False, grading_summary="Grading exceeded 30 seconds", tests_run=None)
    return record


def report(records, manifest, output):
    lines = ["# Auto–Laya versus GPT-6-Astra: measured pilot", "",
             f"Started: {manifest['started_utc']}. Dataset: Aider Polyglot, revision `{manifest['dataset_revision']}`.", "",
             f"**{len(records)}/{len(manifest['tasks']) * 2} executions recorded.** Python-only exploratory pilot; "
             "these results are not an official Aider leaderboard score.", "",
             "## Aggregate results", "",
             "| Condition | Completed | Tasks passing all tests | Estimated model cost | Cost per passing task | Mean elapsed |",
             "| --- | ---: | ---: | ---: | ---: | ---: |"]
    totals = {}
    for condition in ["baseline", "auto"]:
        rows = [r for r in records if r["condition"] == condition]
        known = bool(rows) and all(r.get("cost_usd") is not None for r in rows)
        cost = sum(r.get("cost_usd") or 0 for r in rows)
        passed = sum(r["passed"] for r in rows)
        totals[condition] = (cost, passed, known)
        price = f"${cost:.6f}" if known else "Unknown/incomplete"
        per = f"${cost / passed:.6f}" if known and passed else "N/A"
        elapsed = f"{sum(r['duration_seconds'] for r in rows) / len(rows):.1f}s" if rows else "N/A"
        lines.append(f"| {'Astra/high' if condition == 'baseline' else 'Auto–Laya'} | {len(rows)} | {passed}/{len(rows)} | {price} | {per} | {elapsed} |")
    if len(records) == len(manifest["tasks"]) * 2 and all(t[2] for t in totals.values()) and totals["baseline"][0]:
        savings = 100 * (1 - totals["auto"][0] / totals["baseline"][0])
        lines += ["", f"Estimated total model-cost savings: **{savings:.2f}%**. "
                  f"Success-rate difference: **{100 * (totals['auto'][1] - totals['baseline'][1]) / len(manifest['tasks']):+.1f} percentage points**."]
        pairs = [(next(r for r in records if r["task"] == task and r["condition"] == "baseline")["cost_usd"],
                  next(r for r in records if r["task"] == task and r["condition"] == "auto")["cost_usd"])
                 for task in manifest["tasks"]]
        rng = random.Random(20261024)
        samples = []
        for _ in range(10_000):
            sample = rng.choices(pairs, k=len(pairs))
            baseline_cost = sum(p[0] for p in sample)
            if baseline_cost:
                samples.append(100 * (1 - sum(p[1] for p in sample) / baseline_cost))
        samples.sort()
        lines += ["", f"Exploratory 95% paired task-bootstrap interval for estimated cost savings: "
                  f"**{samples[int(len(samples) * .025)]:.2f}%–{samples[int(len(samples) * .975)]:.2f}%** "
                  "(10,000 resamples; seed 20261024). This interval does not account for model stochasticity or invoice-price uncertainty."]
        for condition, (_, passed, _) in totals.items():
            n = len(manifest["tasks"])
            p = passed / n
            denominator = 1 + 1.96 ** 2 / n
            center = (p + 1.96 ** 2 / (2 * n)) / denominator
            radius = 1.96 * math.sqrt(p * (1 - p) / n + 1.96 ** 2 / (4 * n ** 2)) / denominator
            lines.append(f"Approximate 95% Wilson success-rate interval for {condition}: "
                         f"**{100 * (center - radius):.1f}%–{100 * (center + radius):.1f}%**.")
        lines += ["", "This pilot shows lower estimated expenditure with an additional task failure. "
                  "It does not demonstrate equivalent quality or meet the proposed point target of a success-rate drop no greater than 3 percentage points."]
    lines += ["", "## Per-task results", "",
              "| Task | Condition | Selected model / effort | All tests pass | Tests run | Cost estimate | Elapsed |",
              "| --- | --- | --- | --- | ---: | ---: | ---: |"]
    for r in records:
        selected = sorted({f"{m['providerID']}/{m['id']}#{m.get('variant', 'default')}" for m in r.get("models", []) if m})
        cost = f"${r['cost_usd']:.6f}" if r.get("cost_usd") is not None else "Unknown"
        lines.append(f"| {r['task']} | {r['condition']} | {', '.join(selected) or 'Unavailable'} | "
                     f"{'Yes' if r['passed'] else 'No'} | {r.get('tests_run')} | {cost} | {r['duration_seconds']:.1f}s |")
    lines += ["", "## Method and limits", "",
              "- Both conditions use Gradcode's production execution loop, tools, fresh sessions, identical task prompts and stubs, "
              "12-step allowance, 300-second inference limit, and 30-second grading limit. No feedback from hidden tests or benchmark retries.",
              "- Ten of the 34 Python tasks were selected before execution by sorting SHA-256 hashes of "
              "`gradcode-routing-pilot-v1/<task-name>` and taking the first ten. No difficulty balancing or post-result task selection.",
              "- One execution per task per condition; two task executions can run concurrently. Condition order alternates by task.",
              "- Original tests and reference implementations are excluded from the model's working directory. "
              "Grading copies only the saved solution into a separate directory containing the original tests. "
              "Isolation is by directory and instruction, not a security sandbox.",
              "- Before inference, all ten upstream reference implementations passed their original tests in fresh grading directories, validating the grading environment.",
              "- Fixed baseline is `openai/gpt-6-astra#high`. Auto uses the six frozen choices below. "
              "This isolated OpenAI pool replaces the inaccessible free endpoints only for this experiment; app configuration is unchanged.",
              "- Jev is pointed at a closed loopback port with a 1 ms timeout; no hosted Jev endpoint is contacted. "
              "Laya is the only reachable classifier, with its production 5-second timeout. No deterministic third fallback.",
              f"- Laya checkpoint: `{manifest['laya_revision']}`, CPU, warm startup. "
              "Classification time is included in end-to-end inference time; it is not independently measured here.",
              "- Costs are Gradcode's persisted per-message estimates from its model catalog, not independently verified provider invoices. "
              "All recorded assistant steps, including failed executions, are included. Raw token/cache observations and the catalog "
              "snapshot are retained alongside this report. Local CPU, tools, setup, and smoke-check expenditure are excluded from table totals.",
              "- Ten tasks with one attempt each cannot establish a 3-percentage-point quality margin. "
              "Do not extrapolate this pilot to multilingual repository work or conversational follow-ups.",
              "- This adapts the task set with hidden tests, rather than reproducing Aider's full published evaluation protocol. "
              "Some grading requirements are not stated in the supplied prose/stubs: both Go-counting solutions omitted "
              "module-level constants required by the test imports; both Paasio solutions failed the same wrapper behavior checks. "
              "These failures are retained, but they limit interpretation as a pure capability measure.",
              "- No fixed cheap-model condition was run. This comparison cannot establish how much value Laya adds over simply using Luna for every task.",
              "", "### Auto candidates", ""]
    lines += [f"- `openai/{m}#{e}` — {cost}; {desc}" for m, e, cost, desc in PROFILES]
    failures = [r for r in records if not r["passed"]]
    if failures:
        lines += ["", "## Failed executions", ""]
        for r in failures:
            lines += [f"### {r['task']} / {r['condition']}", "",
                      f"Exit: {r['exit_code']}; timeout: {r['timeout']}; session outcome: {r.get('session_outcome', 'unknown')}.",
                      "", "```text", r.get("grading_summary", "No grading result"), "```", ""]
    lines += ["", "## Reproduction and artifacts", "",
              "- Dataset: https://github.com/Aider-AI/polyglot-benchmark (exercise content attributed to Exercism).",
              f"- Gradcode base commit: `{manifest['gradcode_revision']}` with uncommitted fork changes.",
              "- Harness: `script/benchmark-routing.py`.",
              "- Recorded task IDs and configuration: `benchmark-results/manifest.json`.",
              "- Per-execution model selections, token usage, cost estimates, grading results: `benchmark-results/results.json`.",
              "- Catalog snapshot: `benchmark-results/models.json`.",
              f"- Local working directories, event streams, saved solutions, and full grading logs: `{manifest['work_directory']}`.",
              "", "The earlier blocked preflight has been superseded by this run. Astra access was verified with an actual `OK` response before execution.", ""]
    output.write_text("\n".join(lines))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "docs/fork/ROUTING-BENCHMARK.md")
    args = parser.parse_args()
    args.work.mkdir(parents=True, exist_ok=False)
    candidates = [p.name for p in (args.source / "python/exercises/practice").iterdir() if p.is_dir()]
    tasks = sorted(candidates, key=lambda name: hashlib.sha256((SEED + name).encode()).hexdigest())[:10]
    artifact = args.output.parent / "benchmark-results"
    artifact.mkdir(exist_ok=True)
    config = configuration()
    models = cli(["api", "GET", "/api/model"], ROOT)
    (artifact / "models.json").write_text(models.stdout)
    manifest = {
        "started_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "tasks": tasks, "seed": SEED, "config": config,
        "dataset_revision": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=args.source, text=True).strip(),
        "gradcode_revision": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "laya_revision": "7b928d828b7b0e022f929d9bd2e44165aa270148",
        "work_directory": str(args.work),
    }
    (artifact / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    records = []
    report(records, manifest, args.output)
    jobs = [(task, condition) for i, task in enumerate(tasks)
            for condition in (["auto", "baseline"] if i % 2 else ["baseline", "auto"])]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        futures = {pool.submit(run_task, task, condition, args.source, args.work, config): (task, condition)
                   for task, condition in jobs}
        for future in concurrent.futures.as_completed(futures):
            record = future.result()
            records.append(record)
            records.sort(key=lambda r: (tasks.index(r["task"]), r["condition"]))
            (artifact / "results.json").write_text(json.dumps(records, indent=2) + "\n")
            report(records, manifest, args.output)
            print(json.dumps({k: record.get(k) for k in ["task", "condition", "passed", "cost_usd", "duration_seconds", "models"]}), flush=True)
    print(f"Completed. Report: {args.output}", flush=True)


if __name__ == "__main__":
    main()
