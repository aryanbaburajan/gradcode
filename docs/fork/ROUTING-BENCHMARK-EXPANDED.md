# Expanded Auto–Laya versus GPT-6-Astra evaluation

Started: 2026-10-24T00:54:52.262677+00:00. Completed executions: **136/136**.

All **34 Python tasks** in the pinned Aider Polyglot dataset, **2 fresh attempts per condition**. This is an adapted Gradcode evaluation, not an official Aider leaderboard score. The earlier 10-task pilot is excluded from these totals.

For the newer capped history analysis, see [fixed-token cost estimates with model-switch cache misses](ROUTING-BENCHMARK-CAPPED.md): **$16.71 per $100 all-Astra (83.29% lower estimated token cost)**. That analysis does not replay requests or measure answer quality; its results are separate from the execution results below.

## Results

| Condition | Executions | Passing all original tests | Estimated model cost | Cost per passing execution | Mean inference time |
| --- | ---: | ---: | ---: | ---: | ---: |
| Astra/high | 68 | 57/68 (83.8%) | Incomplete ($18.176482 recorded; 3 unmetered steps) | N/A | 63.6s |
| Auto–Laya | 68 | 38/68 (55.9%) | Incomplete ($5.099611 recorded; 2 unmetered steps) | N/A | 58.6s |

Inference timeouts: Auto **2**, Astra **1**. All attempts, including timeouts, remain in the task-success denominator.

**A total-cost savings percentage for all attempts is unavailable because some calls have no usage record. Missing costs have not been assigned zero.**

Auto minus baseline success rate across every attempt: **-27.94 percentage points** (95% paired task-bootstrap interval: **-42.65 to -14.71 points**).

## Secondary cost comparison: complete-usage paired subset

This analysis retains a task/repetition pair only when both conditions have complete cost records, regardless of whether either solution passed. It does not replace the all-attempt quality comparison. This missing-data handling was added after the first observed transport interruption and before the full run finished.

Coverage: **65/68 paired attempts**, covering **34 unique tasks**.

Auto: **$4.920492**; Astra/high: **$17.510386**. Estimated savings within this subset: **71.90%** (95% paired task-bootstrap interval: **58.38% to 84.83%**).

Excluded cost pairs (still included in quality results):

- `transpose`, repetition 1: incomplete cost in baseline.
- `poker`, repetition 2: incomplete cost in auto.
- `phone-number`, repetition 2: incomplete cost in baseline, auto.

## Scoped landing-page wording

> Auto–Laya used 71.9% less estimated model cost than fixed GPT-6-Astra/high on 65 paired Python coding attempts with complete usage records (130 runs). Across all 136 runs, task success was 55.9% for Auto versus 83.8% for Astra.

Keep the success-rate comparison and cost-coverage footnote adjacent to the savings figure. Do not describe this subset estimate as total billed savings or claim equivalent quality. Local router compute is excluded. Link this full methodology and the raw results.

Uncertainty uses 10,000 paired task-cluster bootstrap samples (seed 20261024); both repetitions remain inside their task cluster. These intervals do not establish performance on unseen task distributions or invoice accuracy.

## Per-task outcomes

| Task | Astra passes | Auto passes | Astra cost | Auto cost | Auto choices |
| --- | ---: | ---: | ---: | ---: | --- |
| sgf-parsing | 2/2 | 2/2 | $0.745683 | $0.004836 | gpt-6-luna#low |
| react | 2/2 | 2/2 | $0.633072 | $0.462969 | gpt-6-astra#medium |
| zebra-puzzle | 2/2 | 2/2 | $0.378079 | $0.004122 | gpt-6-luna#low |
| zipper | 2/2 | 2/2 | $0.553424 | $0.440707 | gpt-6-astra#medium |
| list-ops | 2/2 | 2/2 | $0.451454 | $0.406238 | gpt-6-astra#medium |
| paasio | 0/2 | 0/2 | $0.650860 | $0.549143 | gpt-6-astra#medium |
| bottle-song | 2/2 | 2/2 | $0.384929 | $0.003757 | gpt-6-luna#low |
| grade-school | 2/2 | 0/2 | $0.396768 | $0.003698 | gpt-6-luna#low |
| go-counting | 0/2 | 0/2 | $0.534947 | $0.003809 | gpt-6-luna#low |
| scale-generator | 2/2 | 1/2 | $0.560442 | $0.004401 | gpt-6-luna#low |
| simple-linked-list | 2/2 | 0/2 | $0.495018 | $0.003922 | gpt-6-luna#low |
| beer-song | 2/2 | 2/2 | $0.463252 | $0.005093 | gpt-6-luna#low |
| two-bucket | 2/2 | 1/2 | $0.596199 | $0.004159 | gpt-6-luna#low |
| hangman | 2/2 | 0/2 | $0.486957 | $0.004247 | gpt-6-luna#low |
| tree-building | 0/2 | 0/2 | $0.650711 | $0.492683 | gpt-6-astra#medium |
| wordy | 2/2 | 2/2 | $0.598671 | $0.466986 | gpt-6-astra#medium |
| book-store | 2/2 | 0/2 | $0.602332 | $0.004001 | gpt-6-luna#low |
| connect | 2/2 | 0/2 | $0.536964 | $0.004286 | gpt-6-luna#low |
| robot-name | 2/2 | 2/2 | $0.568935 | $0.003297 | gpt-6-luna#low |
| pov | 2/2 | 0/2 | $0.664727 | $0.004576 | gpt-6-luna#low |
| dominoes | 2/2 | 1/2 | $0.474496 | $0.003843 | gpt-6-luna#low |
| pig-latin | 2/2 | 2/2 | $0.390609 | $0.003795 | gpt-6-luna#low |
| proverb | 2/2 | 1/2 | $0.388920 | $0.003054 | gpt-6-luna#low |
| dot-dsl | 0/2 | 0/2 | $0.611972 | $0.476284 | gpt-6-astra#medium |
| bowling | 2/2 | 2/2 | $0.650746 | $0.006880 | gpt-6-luna#low |
| transpose | 2/2 | 2/2 | Incomplete | $0.349028 | gpt-6-astra#medium |
| affine-cipher | 2/2 | 2/2 | $0.465118 | $0.004673 | gpt-6-luna#low |
| grep | 2/2 | 2/2 | $0.467741 | $0.390756 | gpt-6-astra#medium |
| food-chain | 2/2 | 0/2 | $0.464624 | $0.004390 | gpt-6-luna#low |
| forth | 0/2 | 0/2 | $0.682498 | $0.005079 | gpt-6-luna#low |
| poker | 2/2 | 1/2 | $0.598077 | Incomplete | gpt-6-luna#low |
| phone-number | 1/2 | 1/2 | Incomplete | Incomplete | gpt-6-luna#low |
| variable-length-quantity | 2/2 | 2/2 | $0.505024 | $0.424905 | gpt-6-astra#medium |
| rest-api | 2/2 | 2/2 | $0.655794 | $0.542939 | gpt-6-astra#medium |

## Observed Auto selections

- `gpt-6-astra#medium`: 22 executions.
- `gpt-6-luna#low`: 46 executions.

## Fixed method

- Full Python split; no tasks excluded because of outcomes. Two fresh attempts per task and condition. The earlier exploratory pilot is retained separately and is not pooled into these statistics.
- Same six Auto choices and descriptions as the pilot: Luna/low, Luna/high, Sol/medium, Sol/high, Astra/medium, Astra/high. Fixed baseline: Astra/high. No outcome-based profile tuning. This is a benchmark-specific OpenAI pool, not the default automatically generated pool. App settings are unchanged.
- Identical paired task prompts, stubs, tools, and agent instructions; fresh sessions and working directories. 12 execution steps and 300 seconds per attempt; original tests get 30 seconds. No grading feedback or benchmark retries.
- Up to 4 concurrent executions. Task order is SHA-256-sorted using the original pilot seed. Condition submission order alternates by task and repetition. Repetitions share a provider account and may benefit from ordinary provider caching.
- Local Laya is warm on CPU with a 5-second classification deadline; its latency is included in end-to-end time. The Jev endpoint is disabled using a closed loopback port. There is no deterministic fallback or hosted router call.
- The 34 upstream reference solutions were checked against the original tests before this expanded run; all passed. Agent workspaces contain only solution stubs, prompt, agent instructions, and routing config. Original tests and examples are withheld; final solutions are copied to separate grading directories. This is directory/instruction isolation, not a security sandbox.
- Dataset revision and frozen config are in `expanded-results/manifest.json`; all per-execution model selections, token/cache usage, costs, terminal status, and grading results are in `expanded-results/results.json`. The model catalog snapshot is `expanded-results/models.json`.
- Monetary figures use persisted Gradcode catalog-based cost estimates for every recorded assistant step, including failed attempts. They are not provider-invoice measurements. Local CPU, tools, setup, and preflight/pilot spending are excluded. Unknown cost stays unknown and prevents a complete savings statistic.
- The complete-usage cost subset is conditional on metering availability. Missingness may depend on task or condition, so that subset statistic should not be extrapolated to full-run billed expenditure.
- A grading-directory collision was corrected during the first repetition. Already generated solutions were recovered and graded without re-running inference. Recovered records identify their elapsed time as an event-timestamp span, excluding CLI startup/shutdown; latency is therefore descriptive, not a landing-page claim.
- Repeated attempts are not independent tasks: uncertainty is clustered by task. The benchmark is public and potential training exposure is uncontrolled. It does not measure repository tasks or follow-up conversations.
- Hidden tests make this an adaptation of the task set, not a reproduction of Aider's agent protocol. Some APIs are underspecified in the provided instructions/stubs. In the pilot, both conditions omitted Go-counting constants required by test imports and failed Paasio wrapper checks. All such failures remain counted here.
- This evaluation compares the configured Auto pool to Astra/high. Without a fixed Luna arm it cannot attribute savings uniquely to the classifier rather than cheaper model selection.

## Failed executions

- `paasio` / auto / repetition 1: exit None; timeout False; 25 tests; session outcome `succeeded`. Details retained in the raw results.
- `paasio` / baseline / repetition 1: exit None; timeout False; 25 tests; session outcome `succeeded`. Details retained in the raw results.
- `paasio` / auto / repetition 2: exit 0; timeout False; 25 tests; session outcome `succeeded`. Details retained in the raw results.
- `paasio` / baseline / repetition 2: exit 0; timeout False; 25 tests; session outcome `succeeded`. Details retained in the raw results.
- `grade-school` / auto / repetition 1: exit None; timeout False; 20 tests; session outcome `succeeded`. Details retained in the raw results.
- `grade-school` / auto / repetition 2: exit 0; timeout False; 20 tests; session outcome `succeeded`. Details retained in the raw results.
- `go-counting` / auto / repetition 1: exit None; timeout False; 1 tests; session outcome `succeeded`. Details retained in the raw results.
- `go-counting` / baseline / repetition 1: exit None; timeout False; 1 tests; session outcome `succeeded`. Details retained in the raw results.
- `go-counting` / auto / repetition 2: exit 0; timeout False; 1 tests; session outcome `succeeded`. Details retained in the raw results.
- `go-counting` / baseline / repetition 2: exit 0; timeout False; 1 tests; session outcome `succeeded`. Details retained in the raw results.
- `scale-generator` / auto / repetition 2: exit 0; timeout False; 17 tests; session outcome `succeeded`. Details retained in the raw results.
- `simple-linked-list` / auto / repetition 1: exit 0; timeout False; 20 tests; session outcome `succeeded`. Details retained in the raw results.
- `simple-linked-list` / auto / repetition 2: exit 0; timeout False; 20 tests; session outcome `succeeded`. Details retained in the raw results.
- `two-bucket` / auto / repetition 2: exit 0; timeout False; 9 tests; session outcome `succeeded`. Details retained in the raw results.
- `hangman` / auto / repetition 1: exit 0; timeout False; 7 tests; session outcome `succeeded`. Details retained in the raw results.
- `hangman` / auto / repetition 2: exit 0; timeout False; 7 tests; session outcome `succeeded`. Details retained in the raw results.
- `tree-building` / auto / repetition 1: exit 0; timeout False; 13 tests; session outcome `succeeded`. Details retained in the raw results.
- `tree-building` / baseline / repetition 1: exit 0; timeout False; 13 tests; session outcome `succeeded`. Details retained in the raw results.
- `tree-building` / auto / repetition 2: exit 0; timeout False; 13 tests; session outcome `succeeded`. Details retained in the raw results.
- `tree-building` / baseline / repetition 2: exit 0; timeout False; 13 tests; session outcome `succeeded`. Details retained in the raw results.
- `book-store` / auto / repetition 1: exit 0; timeout False; 20 tests; session outcome `succeeded`. Details retained in the raw results.
- `book-store` / auto / repetition 2: exit 0; timeout False; 20 tests; session outcome `succeeded`. Details retained in the raw results.
- `connect` / auto / repetition 1: exit 0; timeout False; 10 tests; session outcome `succeeded`. Details retained in the raw results.
- `connect` / auto / repetition 2: exit 0; timeout False; 10 tests; session outcome `succeeded`. Details retained in the raw results.
- `pov` / auto / repetition 1: exit 0; timeout False; 15 tests; session outcome `succeeded`. Details retained in the raw results.
- `pov` / auto / repetition 2: exit 0; timeout False; 15 tests; session outcome `succeeded`. Details retained in the raw results.
- `dominoes` / auto / repetition 1: exit 0; timeout False; 13 tests; session outcome `succeeded`. Details retained in the raw results.
- `proverb` / auto / repetition 2: exit 0; timeout False; 8 tests; session outcome `succeeded`. Details retained in the raw results.
- `dot-dsl` / auto / repetition 1: exit 0; timeout False; 12 tests; session outcome `succeeded`. Details retained in the raw results.
- `dot-dsl` / baseline / repetition 1: exit 0; timeout False; 12 tests; session outcome `succeeded`. Details retained in the raw results.
- `dot-dsl` / auto / repetition 2: exit 0; timeout False; 12 tests; session outcome `succeeded`. Details retained in the raw results.
- `dot-dsl` / baseline / repetition 2: exit 0; timeout False; 12 tests; session outcome `succeeded`. Details retained in the raw results.
- `food-chain` / auto / repetition 1: exit 0; timeout False; 10 tests; session outcome `succeeded`. Details retained in the raw results.
- `food-chain` / auto / repetition 2: exit 0; timeout False; 10 tests; session outcome `succeeded`. Details retained in the raw results.
- `forth` / auto / repetition 1: exit 0; timeout False; 54 tests; session outcome `succeeded`. Details retained in the raw results.
- `forth` / baseline / repetition 1: exit 0; timeout False; 54 tests; session outcome `succeeded`. Details retained in the raw results.
- `forth` / auto / repetition 2: exit 0; timeout False; 54 tests; session outcome `succeeded`. Details retained in the raw results.
- `forth` / baseline / repetition 2: exit 0; timeout False; 54 tests; session outcome `succeeded`. Details retained in the raw results.
- `poker` / auto / repetition 2: exit 130; timeout True; 37 tests; session outcome `interrupted`. Details retained in the raw results.
- `phone-number` / auto / repetition 2: exit 130; timeout True; 21 tests; session outcome `interrupted`. Details retained in the raw results.
- `phone-number` / baseline / repetition 2: exit 130; timeout True; 21 tests; session outcome `interrupted`. Details retained in the raw results.

## Reproduction

Dataset: [Aider Polyglot](https://github.com/Aider-AI/polyglot-benchmark/tree/7e0611e77b54e2dea774cdc0aa00cf9f7ed6144f/python). Exercise content is attributed to Exercism under the upstream licenses.

Gradcode base: `68bc26b7da1990ce10ffecfbc1e09eb13aa5d824` plus the uncommitted fork changes. Laya revision: `7b928d828b7b0e022f929d9bd2e44165aa270148`.

```bash
python3 -u script/benchmark-routing-expanded.py \
  --source /path/to/pinned/polyglot-benchmark \
  --work /path/to/new/isolated/work-directory \
  --repetitions 2 --workers 4
```

This run's local solutions, event streams, and grading logs: `/tmp/gradcode-routing-expanded-20261024`.
