#!/usr/bin/env python3
"""Run and report every Python Polyglot task with repeated paired trials."""

import argparse
import collections
import concurrent.futures
import datetime
import hashlib
import importlib.util
import json
from pathlib import Path
import random
import subprocess


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("routing_pilot", ROOT / "script/benchmark-routing.py")
PILOT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PILOT)


def redact(value):
    if isinstance(value, dict):
        return {
            key: "[REDACTED]" if any(part in key.lower().replace("_", "") for part in (
                "apikey", "authorization", "accesstoken", "refreshtoken", "password", "clientsecret",
            )) else redact(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact(item) for item in value]
    return value


def summarize(records, manifest):
    summary = {}
    for condition in ("baseline", "auto"):
        rows = [r for r in records if r["condition"] == condition]
        complete_cost = bool(rows) and all(isinstance(r.get("cost_usd"), (int, float)) for r in rows)
        cost = sum(r.get("cost_usd") or 0 for r in rows)
        passed = sum(r["passed"] for r in rows)
        summary[condition] = {
            "executions": len(rows), "passed": passed,
            "success_rate": passed / len(rows) if rows else None,
            "estimated_cost_usd": cost if complete_cost else None,
            "cost_per_passing_execution_usd": cost / passed if complete_cost and passed else None,
            "mean_duration_seconds": sum(r["duration_seconds"] for r in rows) / len(rows) if rows else None,
            "unknown_cost_executions": sum(r.get("cost_usd") is None for r in rows),
            "timeouts": sum(r["timeout"] for r in rows),
            "recorded_step_cost_usd": sum(u["cost"] for r in rows for u in r.get("usage", [])
                                           if isinstance(u.get("cost"), (int, float))),
            "unmetered_steps": sum(u.get("cost") is None for r in rows for u in r.get("usage", [])),
        }
    expected = len(manifest["tasks"]) * manifest["repetitions"] * 2
    summary["complete"] = len(records) == expected
    if summary["complete"]:
        summary["success_rate_difference_pp"] = 100 * (summary["auto"]["success_rate"] - summary["baseline"]["success_rate"])
        quality_clusters, cost_clusters, excluded = [], [], []
        usable_pairs = 0
        for task in manifest["tasks"]:
            pair = [[r for r in records if r["task"] == task and r["condition"] == condition]
                    for condition in ("baseline", "auto")]
            quality_clusters.append((sum(r["passed"] for r in pair[0]), sum(r["passed"] for r in pair[1])))
            usable = []
            for repetition in range(1, manifest["repetitions"] + 1):
                a, b = [next(r for r in rows if r["repetition"] == repetition) for rows in pair]
                if a.get("cost_usd") is not None and b.get("cost_usd") is not None:
                    usable.append((a["cost_usd"], b["cost_usd"]))
                    usable_pairs += 1
                else:
                    excluded.append({"task": task, "repetition": repetition,
                                     "missing_cost_conditions": [r["condition"] for r in (a, b) if r.get("cost_usd") is None]})
            if usable:
                cost_clusters.append((sum(x[0] for x in usable), sum(x[1] for x in usable)))
        rng = random.Random(20261024)
        cost_samples, success_samples = [], []
        for _ in range(10_000):
            quality_sample = rng.choices(quality_clusters, k=len(quality_clusters))
            success_samples.append(100 * sum(x[1] - x[0] for x in quality_sample) /
                                   (len(quality_clusters) * manifest["repetitions"]))
            if cost_clusters:
                sample = rng.choices(cost_clusters, k=len(cost_clusters))
                baseline = sum(x[0] for x in sample)
                cost_samples.append(100 * (1 - sum(x[1] for x in sample) / baseline))
        summary["success_difference_95pct_task_bootstrap_interval_pp"] = [sorted(success_samples)[250], sorted(success_samples)[9750]]
        if cost_clusters:
            baseline = sum(x[0] for x in cost_clusters)
            auto = sum(x[1] for x in cost_clusters)
            summary["complete_usage_paired_subset"] = {
                "paired_attempts": usable_pairs, "total_paired_attempts": expected // 2,
                "unique_tasks": len(cost_clusters), "excluded_pairs": excluded,
                "baseline_estimated_cost_usd": baseline, "auto_estimated_cost_usd": auto,
                "cost_savings_percent": 100 * (1 - auto / baseline),
                "cost_savings_95pct_task_bootstrap_interval": [sorted(cost_samples)[250], sorted(cost_samples)[9750]],
            }
            if not excluded:
                summary["cost_savings_percent"] = summary["complete_usage_paired_subset"]["cost_savings_percent"]
                summary["cost_savings_95pct_task_bootstrap_interval"] = summary["complete_usage_paired_subset"]["cost_savings_95pct_task_bootstrap_interval"]
    return summary


def write_report(records, manifest, output):
    summary = summarize(records, manifest)
    n = len(manifest["tasks"])
    repetitions = manifest["repetitions"]
    lines = ["# Expanded Auto–Laya versus GPT-6-Astra evaluation", "",
             f"Started: {manifest['started_utc']}. Completed executions: **{len(records)}/{n * repetitions * 2}**.", "",
             f"All **{n} Python tasks** in the pinned Aider Polyglot dataset, **{repetitions} fresh attempts per condition**. "
             "This is an adapted Gradcode evaluation, not an official Aider leaderboard score. "
             "The earlier 10-task pilot is excluded from these totals.", "", "## Results", "",
             "| Condition | Executions | Passing all original tests | Estimated model cost | Cost per passing execution | Mean inference time |",
             "| --- | ---: | ---: | ---: | ---: | ---: |"]
    for condition, label in (("baseline", "Astra/high"), ("auto", "Auto–Laya")):
        s = summary[condition]
        cost = f"${s['estimated_cost_usd']:.6f}" if s["estimated_cost_usd"] is not None else "Incomplete"
        if s["estimated_cost_usd"] is None and s["executions"]:
            cost += f" (${s['recorded_step_cost_usd']:.6f} recorded; {s['unmetered_steps']} unmetered steps)"
        unit = f"${s['cost_per_passing_execution_usd']:.6f}" if s["cost_per_passing_execution_usd"] is not None else "N/A"
        elapsed = f"{s['mean_duration_seconds']:.1f}s" if s["mean_duration_seconds"] is not None else "N/A"
        rate = f" ({100 * s['success_rate']:.1f}%)" if s["success_rate"] is not None else ""
        lines.append(f"| {label} | {s['executions']} | {s['passed']}/{s['executions']}{rate} | {cost} | {unit} | {elapsed} |")
    if "cost_savings_percent" in summary:
        lo, hi = summary["cost_savings_95pct_task_bootstrap_interval"]
        qlo, qhi = summary["success_difference_95pct_task_bootstrap_interval_pp"]
        lines += ["", f"Estimated total model-cost savings: **{summary['cost_savings_percent']:.2f}%** "
                  f"(exploratory 95% paired task-bootstrap interval: **{lo:.2f}% to {hi:.2f}%**).", "",
                  f"Auto minus baseline success rate: **{summary['success_rate_difference_pp']:+.2f} percentage points** "
                  f"(95% paired task-bootstrap interval: **{qlo:+.2f} to {qhi:+.2f} points**).", "",
                  "Intervals resample whole tasks, keeping both repetitions and conditions together, with 10,000 samples and seed 20261024. "
                  "They do not include uncertainty in provider pricing, unseen task distributions, or model version drift.", "",
                  "## Landing-page wording supported by this run", "",
                  f"> Auto–Laya used {summary['cost_savings_percent']:.1f}% less estimated model cost than fixed GPT-6-Astra/high "
                  f"across {n} Python coding exercises ({n * repetitions * 2} runs). "
                  f"Task success: {100 * summary['auto']['success_rate']:.1f}% for Auto versus "
                  f"{100 * summary['baseline']['success_rate']:.1f}% for Astra.", "",
                  "Keep the quality comparison adjacent to the savings figure and link this methodology. "
                  "Label costs as estimates and the test as Python-only. This run does not support a general "
                  "\"same quality\" or multilingual/repository-work savings claim. Local router compute is excluded."]
    elif summary["complete"]:
        qlo, qhi = summary["success_difference_95pct_task_bootstrap_interval_pp"]
        lines += ["", "**A total-cost savings percentage for all attempts is unavailable because some calls have no usage record. "
                  "Missing costs have not been assigned zero.**", "",
                  f"Auto minus baseline success rate across every attempt: **{summary['success_rate_difference_pp']:+.2f} percentage points** "
                  f"(95% paired task-bootstrap interval: **{qlo:+.2f} to {qhi:+.2f} points**).", "",
                  "## Secondary cost comparison: complete-usage paired subset", "",
                  "This analysis retains a task/repetition pair only when both conditions have complete cost records, "
                  "regardless of whether either solution passed. It does not replace the all-attempt quality comparison. "
                  "This missing-data handling was added after the first observed transport interruption and before the full run finished."]
        subset = summary.get("complete_usage_paired_subset")
        if subset:
            lo, hi = subset["cost_savings_95pct_task_bootstrap_interval"]
            lines += ["", f"Coverage: **{subset['paired_attempts']}/{subset['total_paired_attempts']} paired attempts**, "
                      f"covering **{subset['unique_tasks']} unique tasks**.", "",
                      f"Auto: **${subset['auto_estimated_cost_usd']:.6f}**; Astra/high: **${subset['baseline_estimated_cost_usd']:.6f}**. "
                      f"Estimated savings within this subset: **{subset['cost_savings_percent']:.2f}%** "
                      f"(95% paired task-bootstrap interval: **{lo:.2f}% to {hi:.2f}%**).", "",
                      "Excluded cost pairs (still included in quality results):", ""]
            lines += [f"- `{p['task']}`, repetition {p['repetition']}: incomplete cost in {', '.join(p['missing_cost_conditions'])}."
                      for p in subset["excluded_pairs"]]
            lines += ["", "## Scoped landing-page wording", "",
                      f"> Auto–Laya used {subset['cost_savings_percent']:.1f}% less estimated model cost than fixed GPT-6-Astra/high "
                      f"on {subset['paired_attempts']} paired Python coding attempts with complete usage records "
                      f"({subset['paired_attempts'] * 2} runs). Across all {n * repetitions * 2} runs, "
                      f"task success was {100 * summary['auto']['success_rate']:.1f}% for Auto versus "
                      f"{100 * summary['baseline']['success_rate']:.1f}% for Astra.", "",
                      "Keep the success-rate comparison and cost-coverage footnote adjacent to the savings figure. "
                      "Do not describe this subset estimate as total billed savings or claim equivalent quality. "
                      "Local router compute is excluded. Link this full methodology and the raw results."]
        lines += ["", "Uncertainty uses 10,000 paired task-cluster bootstrap samples (seed 20261024); both repetitions remain "
                  "inside their task cluster. These intervals do not establish performance on unseen task distributions or invoice accuracy."]
    lines += ["", "## Per-task outcomes", "",
              "| Task | Astra passes | Auto passes | Astra cost | Auto cost | Auto choices |",
              "| --- | ---: | ---: | ---: | ---: | --- |"]
    for task in manifest["tasks"]:
        base = [r for r in records if r["task"] == task and r["condition"] == "baseline"]
        auto = [r for r in records if r["task"] == task and r["condition"] == "auto"]
        choices = sorted({f"{m['id']}#{m.get('variant', 'default')}" for r in auto for m in r.get("models", []) if m})
        def price(rows):
            return f"${sum(r['cost_usd'] for r in rows):.6f}" if rows and all(r.get("cost_usd") is not None for r in rows) else "Incomplete"
        lines.append(f"| {task} | {sum(r['passed'] for r in base)}/{len(base)} | {sum(r['passed'] for r in auto)}/{len(auto)} | "
                     f"{price(base)} | {price(auto)} | {', '.join(choices)} |")
    counts = collections.Counter(
        f"{r['models'][0]['id']}#{r['models'][0].get('variant', 'default')}"
        for r in records if r["condition"] == "auto" and r.get("models")
    )
    lines += ["", "## Observed Auto selections", ""]
    lines += [f"- `{choice}`: {count} executions." for choice, count in sorted(counts.items())]
    lines += ["", "## Fixed method", "",
              "- Full Python split; no tasks excluded because of outcomes. Two fresh attempts per task and condition. "
              "The earlier exploratory pilot is retained separately and is not pooled into these statistics.",
              "- Same six Auto choices and descriptions as the pilot: Luna/low, Luna/high, Sol/medium, Sol/high, "
              "Astra/medium, Astra/high. Fixed baseline: Astra/high. No outcome-based profile tuning. "
              "This is a benchmark-specific OpenAI pool, not the default automatically generated pool. App settings are unchanged.",
              "- Identical paired task prompts, stubs, tools, and agent instructions; fresh sessions and working directories. "
              "12 execution steps and 300 seconds per attempt; original tests get 30 seconds. No grading feedback or benchmark retries.",
              f"- Up to {manifest['workers']} concurrent executions. Task order is SHA-256-sorted using the original pilot seed. "
              "Condition submission order alternates by task and repetition. Repetitions share a provider account and may benefit from ordinary provider caching.",
              "- Local Laya is warm on CPU with a 5-second classification deadline; its latency is included in end-to-end time. "
              "The Jev endpoint is disabled using a closed loopback port. There is no deterministic fallback or hosted router call.",
              "- The 34 upstream reference solutions were checked against the original tests before this expanded run; all passed. "
              "Agent workspaces contain only solution stubs, prompt, agent instructions, and routing config. "
              "Original tests and examples are withheld; final solutions are copied to separate grading directories. "
              "This is directory/instruction isolation, not a security sandbox.",
              "- Dataset revision and frozen config are in `expanded-results/manifest.json`; all per-execution "
              "model selections, token/cache usage, costs, terminal status, and grading results are in `expanded-results/results.json`. "
              "The model catalog snapshot is `expanded-results/models.json`.",
              "- Monetary figures use persisted Gradcode catalog-based cost estimates for every recorded assistant step, "
              "including failed attempts. They are not provider-invoice measurements. Local CPU, tools, setup, and "
              "preflight/pilot spending are excluded. Unknown cost stays unknown and prevents a complete savings statistic.",
              "- The complete-usage cost subset is conditional on metering availability. Missingness may depend on task or condition, "
              "so that subset statistic should not be extrapolated to full-run billed expenditure.",
              "- A grading-directory collision was corrected during the first repetition. Already generated solutions were "
              "recovered and graded without re-running inference. Recovered records identify their elapsed time as an "
              "event-timestamp span, excluding CLI startup/shutdown; latency is therefore descriptive, not a landing-page claim.",
              "- Repeated attempts are not independent tasks: uncertainty is clustered by task. "
              "The benchmark is public and potential training exposure is uncontrolled. It does not measure repository tasks or follow-up conversations.",
              "- Hidden tests make this an adaptation of the task set, not a reproduction of Aider's agent protocol. "
              "Some APIs are underspecified in the provided instructions/stubs. In the pilot, both conditions omitted "
              "Go-counting constants required by test imports and failed Paasio wrapper checks. All such failures remain counted here.",
              "- This evaluation compares the configured Auto pool to Astra/high. Without a fixed Luna arm it cannot "
              "attribute savings uniquely to the classifier rather than cheaper model selection.", "",
              "## Failed executions", ""]
    failures = [r for r in records if not r["passed"]]
    if not failures:
        lines += ["None recorded so far."]
    for r in failures:
        lines += [f"- `{r['task']}` / {r['condition']} / repetition {r.get('repetition', 1)}: "
                  f"exit {r['exit_code']}; timeout {r['timeout']}; {r.get('tests_run')} tests; "
                  f"session outcome `{r.get('session_outcome', 'unknown')}`. Details retained in the raw results."]
    lines += ["", "## Reproduction", "",
              f"Dataset: [Aider Polyglot](https://github.com/Aider-AI/polyglot-benchmark/tree/{manifest['dataset_revision']}/python). "
              "Exercise content is attributed to Exercism under the upstream licenses.", "",
              f"Gradcode base: `{manifest['gradcode_revision']}` plus the uncommitted fork changes. "
              f"Laya revision: `{manifest['laya_revision']}`.", "",
              "```bash", "python3 -u script/benchmark-routing-expanded.py \\",
              "  --source /path/to/pinned/polyglot-benchmark \\",
              "  --work /path/to/new/isolated/work-directory \\",
              "  --repetitions 2 --workers 4", "```", "",
              f"This run's local solutions, event streams, and grading logs: `{manifest['work_directory']}`.", ""]
    output.write_text("\n".join(lines))
    (output.parent / "expanded-results/summary.json").write_text(json.dumps(summary, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--repetitions", type=int, default=2)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--output", type=Path, default=ROOT / "docs/fork/ROUTING-BENCHMARK-EXPANDED.md")
    args = parser.parse_args()
    if args.repetitions < 1 or args.workers < 1:
        parser.error("repetitions and workers must be positive")
    args.work.mkdir(parents=True, exist_ok=args.resume)
    tasks = sorted(
        [p.name for p in (args.source / "python/exercises/practice").iterdir() if p.is_dir()],
        key=lambda name: hashlib.sha256((PILOT.SEED + name).encode()).hexdigest(),
    )
    artifact = args.output.parent / "expanded-results"
    artifact.mkdir(exist_ok=args.resume)
    response = PILOT.cli(["api", "GET", "/api/model"], ROOT)
    if response.returncode:
        raise RuntimeError("Cannot obtain model catalog")
    if not args.resume:
        (artifact / "models.json").write_text(json.dumps(redact(json.loads(response.stdout)), indent=2) + "\n")
    manifest = {
        "started_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "tasks": tasks, "repetitions": args.repetitions, "workers": args.workers,
        "config": PILOT.configuration(), "seed": PILOT.SEED,
        "dataset_revision": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=args.source, text=True).strip(),
        "gradcode_revision": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "laya_revision": "7b928d828b7b0e022f929d9bd2e44165aa270148",
        "work_directory": str(args.work),
        "reference_validation": "All 34 upstream reference solutions passed original tests before inference.",
        "harness_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "pilot_harness_sha256": hashlib.sha256((ROOT / "script/benchmark-routing.py").read_bytes()).hexdigest(),
    }
    if args.resume:
        previous = json.loads((artifact / "manifest.json").read_text())
        for key in ("tasks", "repetitions", "workers", "config", "dataset_revision", "work_directory"):
            if previous[key] != manifest[key]:
                raise ValueError(f"Cannot resume with changed {key}")
        previous["resumed_utc"] = manifest["started_utc"]
        previous["harness_sha256"] = manifest["harness_sha256"]
        previous["pilot_harness_sha256"] = manifest["pilot_harness_sha256"]
        manifest = previous
    (artifact / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    records = json.loads((artifact / "results.json").read_text()) if args.resume and (artifact / "results.json").exists() else []
    write_report(records, manifest, args.output)
    jobs = [(task, condition, repetition) for repetition in range(1, args.repetitions + 1)
            for index, task in enumerate(tasks)
            for condition in (["auto", "baseline"] if (index + repetition) % 2 else ["baseline", "auto"])]
    completed = {(r["task"], r["condition"], r.get("repetition", 1)) for r in records}
    jobs = [job for job in jobs if job not in completed]
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {}
        for task, condition, repetition in jobs:
            name = f"{task}-{condition}" + (f"-r{repetition}" if repetition > 1 else "")
            if (args.work / name).exists():
                if not args.resume:
                    raise ValueError("Existing execution requires --resume")
                future = pool.submit(PILOT.recover_task, task, condition, args.source, args.work, repetition)
            else:
                future = pool.submit(PILOT.run_task, task, condition, args.source, args.work, manifest["config"], repetition)
            futures[future] = (task, condition, repetition)
        for future in concurrent.futures.as_completed(futures):
            try:
                record = future.result()
            except Exception:
                for pending in futures:
                    pending.cancel()
                raise
            records.append(record)
            records.sort(key=lambda r: (tasks.index(r["task"]), r["repetition"], r["condition"]))
            (artifact / "results.json").write_text(json.dumps(records, indent=2) + "\n")
            write_report(records, manifest, args.output)
            print(json.dumps({"completed": len(records), **{key: record.get(key) for key in
                  ("task", "condition", "repetition", "passed", "cost_usd", "duration_seconds", "timeout")}}), flush=True)
    manifest["completed_utc"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    (artifact / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Completed. Report: {args.output}", flush=True)


if __name__ == "__main__":
    main()
