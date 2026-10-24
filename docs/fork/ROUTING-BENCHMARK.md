# Auto–Laya versus GPT-6-Astra: measured pilot

Started: 2026-10-23T23:47:17.552897+00:00. Dataset: Aider Polyglot, revision `7e0611e77b54e2dea774cdc0aa00cf9f7ed6144f`.

**20/20 executions recorded.** Python-only exploratory pilot; these results are not an official Aider leaderboard score.

## Aggregate results

| Condition | Completed | Tasks passing all tests | Estimated model cost | Cost per passing task | Mean elapsed |
| --- | ---: | ---: | ---: | ---: | ---: |
| Astra/high | 10 | 8/10 | $2.574517 | $0.321815 | 46.3s |
| Auto–Laya | 10 | 7/10 | $0.929029 | $0.132718 | 39.8s |

Estimated total model-cost savings: **63.91%**. Success-rate difference: **-10.0 percentage points**.

Exploratory 95% paired task-bootstrap interval for estimated cost savings: **39.36%–89.82%** (10,000 resamples; seed 20261024). This interval does not account for model stochasticity or invoice-price uncertainty.
Approximate 95% Wilson success-rate interval for baseline: **49.0%–94.3%**.
Approximate 95% Wilson success-rate interval for auto: **39.7%–89.2%**.

This pilot shows lower estimated expenditure with an additional task failure. It does not demonstrate equivalent quality or meet the proposed point target of a success-rate drop no greater than 3 percentage points.

## Per-task results

| Task | Condition | Selected model / effort | All tests pass | Tests run | Cost estimate | Elapsed |
| --- | --- | --- | --- | ---: | ---: | ---: |
| sgf-parsing | auto | openai/gpt-6-luna#low | Yes | 23 | $0.003009 | 63.0s |
| sgf-parsing | baseline | openai/gpt-6-astra#high | Yes | 23 | $0.358583 | 90.4s |
| react | auto | openai/gpt-6-astra#medium | Yes | 14 | $0.228595 | 68.4s |
| react | baseline | openai/gpt-6-astra#high | Yes | 14 | $0.281949 | 54.8s |
| zebra-puzzle | auto | openai/gpt-6-luna#low | Yes | 2 | $0.001989 | 37.5s |
| zebra-puzzle | baseline | openai/gpt-6-astra#high | Yes | 2 | $0.197749 | 42.0s |
| zipper | auto | openai/gpt-6-astra#medium | Yes | 14 | $0.223124 | 47.8s |
| zipper | baseline | openai/gpt-6-astra#high | Yes | 14 | $0.274753 | 50.6s |
| list-ops | auto | openai/gpt-6-astra#medium | Yes | 24 | $0.204452 | 27.0s |
| list-ops | baseline | openai/gpt-6-astra#high | Yes | 24 | $0.228779 | 34.3s |
| paasio | auto | openai/gpt-6-astra#medium | No | 25 | $0.259324 | 40.7s |
| paasio | baseline | openai/gpt-6-astra#high | No | 25 | $0.354789 | 53.4s |
| bottle-song | auto | openai/gpt-6-luna#low | Yes | 7 | $0.001913 | 24.7s |
| bottle-song | baseline | openai/gpt-6-astra#high | Yes | 7 | $0.179542 | 24.8s |
| grade-school | auto | openai/gpt-6-luna#low | No | 20 | $0.002146 | 27.7s |
| grade-school | baseline | openai/gpt-6-astra#high | Yes | 20 | $0.189149 | 30.7s |
| go-counting | auto | openai/gpt-6-luna#low | No | 1 | $0.002207 | 29.6s |
| go-counting | baseline | openai/gpt-6-astra#high | No | 1 | $0.269361 | 49.3s |
| scale-generator | auto | openai/gpt-6-luna#low | Yes | 17 | $0.002273 | 31.9s |
| scale-generator | baseline | openai/gpt-6-astra#high | Yes | 17 | $0.239862 | 32.7s |

## Method and limits

- Both conditions use Gradcode's production execution loop, tools, fresh sessions, identical task prompts and stubs, 12-step allowance, 300-second inference limit, and 30-second grading limit. No feedback from hidden tests or benchmark retries.
- Ten of the 34 Python tasks were selected before execution by sorting SHA-256 hashes of `gradcode-routing-pilot-v1/<task-name>` and taking the first ten. No difficulty balancing or post-result task selection.
- One execution per task per condition; two task executions can run concurrently. Condition order alternates by task.
- Original tests and reference implementations are excluded from the model's working directory. Grading copies only the saved solution into a separate directory containing the original tests. Isolation is by directory and instruction, not a security sandbox.
- Before inference, all ten upstream reference implementations passed their original tests in fresh grading directories, validating the grading environment.
- Fixed baseline is `openai/gpt-6-astra#high`. Auto uses the six frozen choices below. This isolated OpenAI pool replaces the inaccessible free endpoints only for this experiment; app configuration is unchanged.
- Jev is pointed at a closed loopback port with a 1 ms timeout; no hosted Jev endpoint is contacted. Laya is the only reachable classifier, with its production 5-second timeout. No deterministic third fallback.
- Laya checkpoint: `7b928d828b7b0e022f929d9bd2e44165aa270148`, CPU, warm startup. Classification time is included in end-to-end inference time; it is not independently measured here.
- Costs are Gradcode's persisted per-message estimates from its model catalog, not independently verified provider invoices. All recorded assistant steps, including failed executions, are included. Raw token/cache observations and the catalog snapshot are retained alongside this report. Local CPU, tools, setup, and smoke-check expenditure are excluded from table totals.
- Ten tasks with one attempt each cannot establish a 3-percentage-point quality margin. Do not extrapolate this pilot to multilingual repository work or conversational follow-ups.
- This adapts the task set with hidden tests, rather than reproducing Aider's full published evaluation protocol. Some grading requirements are not stated in the supplied prose/stubs: both Go-counting solutions omitted module-level constants required by the test imports; both Paasio solutions failed the same wrapper behavior checks. These failures are retained, but they limit interpretation as a pure capability measure.
- No fixed cheap-model condition was run. This comparison cannot establish how much value Laya adds over simply using Luna for every task.

### Auto candidates

- `openai/gpt-6-luna#low` — economy; Routine, small Python implementations and straightforward algorithms.
- `openai/gpt-6-luna#high` — economy; Moderately involved Python algorithms on a small budget.
- `openai/gpt-6-sol#medium` — balanced; General implementation, parsing, and stateful data structures.
- `openai/gpt-6-sol#high` — balanced; Complex parsing, callbacks, dependency tracking, and subtle edge cases.
- `openai/gpt-6-astra#medium` — quality; Difficult implementation requiring careful multi-step reasoning.
- `openai/gpt-6-astra#high` — quality; Most difficult algorithms, intricate state invariants, and broad edge cases.

## Failed executions

### paasio / auto

Exit: 0; timeout: False; session outcome: succeeded.

```text
===========================================================
FAIL: test_meteredsocket_context_manager (paasio_test.PaasioTest.test_meteredsocket_context_manager)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "/tmp/gradcode-routing-pilot-20261024/grading/paasio-auto/paasio_test.py", line 17, in test_meteredsocket_context_manager
    self.assertFalse(mock.__enter__.called)
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: True is not false

======================================================================
FAIL: test_meteredsocket_context_manager_exception_raise (paasio_test.PaasioTest.test_meteredsocket_context_manager_exception_raise)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "/tmp/gradcode-routing-pilot-20261024/grading/paasio-auto/paasio_test.py", line 34, in test_meteredsocket_context_manager_exception_raise
    self.assertFalse(mock.__enter__.called)
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: True is not false

======================================================================
FAIL: test_meteredsocket_context_manager_exception_suppress (paasio_test.PaasioTest.test_meteredsocket_context_manager_exception_suppress)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "/tmp/gradcode-routing-pilot-20261024/grading/paasio-auto/paasio_test.py", line 50, in test_meteredsocket_context_manager_exception_suppress
    self.assertFalse(mock.__enter__.called)
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: True is not false

----------------------------------------------------------------------
Ran 25 tests in 0.051s

FAILED (failures=15)

```

### paasio / baseline

Exit: 0; timeout: False; session outcome: succeeded.

```text
===============================================
FAIL: test_meteredsocket_context_manager (paasio_test.PaasioTest.test_meteredsocket_context_manager)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "/tmp/gradcode-routing-pilot-20261024/grading/paasio-baseline/paasio_test.py", line 17, in test_meteredsocket_context_manager
    self.assertFalse(mock.__enter__.called)
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: True is not false

======================================================================
FAIL: test_meteredsocket_context_manager_exception_raise (paasio_test.PaasioTest.test_meteredsocket_context_manager_exception_raise)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "/tmp/gradcode-routing-pilot-20261024/grading/paasio-baseline/paasio_test.py", line 34, in test_meteredsocket_context_manager_exception_raise
    self.assertFalse(mock.__enter__.called)
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: True is not false

======================================================================
FAIL: test_meteredsocket_context_manager_exception_suppress (paasio_test.PaasioTest.test_meteredsocket_context_manager_exception_suppress)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "/tmp/gradcode-routing-pilot-20261024/grading/paasio-baseline/paasio_test.py", line 50, in test_meteredsocket_context_manager_exception_suppress
    self.assertFalse(mock.__enter__.called)
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: True is not false

----------------------------------------------------------------------
Ran 25 tests in 0.052s

FAILED (failures=15)

```

### grade-school / auto

Exit: 0; timeout: False; session outcome: succeeded.

```text

    self.assertEqual(school.added(), expected)
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: Lists differ: ['Aimee'] != [True]

First differing element 0:
'Aimee'
True

- ['Aimee']
+ [True]

======================================================================
FAIL: test_adding_multiple_students_in_the_same_grade_in_the_roster (grade_school_test.GradeSchoolTest.test_adding_multiple_students_in_the_same_grade_in_the_roster)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "/tmp/gradcode-routing-pilot-20261024/grading/grade-school-auto/grade_school_test.py", line 38, in test_adding_multiple_students_in_the_same_grade_in_the_roster
    self.assertEqual(school.added(), expected)
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: Lists differ: ['Blair', 'James', 'Paul'] != [True, True, True]

First differing element 0:
'Blair'
True

- ['Blair', 'James', 'Paul']
+ [True, True, True]

======================================================================
FAIL: test_adding_students_in_multiple_grades (grade_school_test.GradeSchoolTest.test_adding_students_in_multiple_grades)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "/tmp/gradcode-routing-pilot-20261024/grading/grade-school-auto/grade_school_test.py", line 73, in test_adding_students_in_multiple_grades
    self.assertEqual(school.added(), expected)
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: Lists differ: ['Chelsea', 'Logan'] != [True, True]

First differing element 0:
'Chelsea'
True

- ['Chelsea', 'Logan']
+ [True, True]

----------------------------------------------------------------------
Ran 20 tests in 0.003s

FAILED (failures=3, errors=7)

```

### go-counting / auto

Exit: 0; timeout: False; session outcome: succeeded.

```text
go_counting_test (unittest.loader._FailedTest.go_counting_test) ... ERROR

======================================================================
ERROR: go_counting_test (unittest.loader._FailedTest.go_counting_test)
----------------------------------------------------------------------
ImportError: Failed to import test module: go_counting_test
Traceback (most recent call last):
  File "/usr/lib/python3.13/unittest/loader.py", line 396, in _find_test_path
    module = self._get_module_from_name(name)
  File "/usr/lib/python3.13/unittest/loader.py", line 339, in _get_module_from_name
    __import__(name)
    ~~~~~~~~~~^^^^^^
  File "/tmp/gradcode-routing-pilot-20261024/grading/go-counting-auto/go_counting_test.py", line 7, in <module>
    from go_counting import (
    ...<4 lines>...
    )
ImportError: cannot import name 'WHITE' from 'go_counting' (/tmp/gradcode-routing-pilot-20261024/grading/go-counting-auto/go_counting.py)


----------------------------------------------------------------------
Ran 1 test in 0.000s

FAILED (errors=1)

```

### go-counting / baseline

Exit: 0; timeout: False; session outcome: succeeded.

```text
go_counting_test (unittest.loader._FailedTest.go_counting_test) ... ERROR

======================================================================
ERROR: go_counting_test (unittest.loader._FailedTest.go_counting_test)
----------------------------------------------------------------------
ImportError: Failed to import test module: go_counting_test
Traceback (most recent call last):
  File "/usr/lib/python3.13/unittest/loader.py", line 396, in _find_test_path
    module = self._get_module_from_name(name)
  File "/usr/lib/python3.13/unittest/loader.py", line 339, in _get_module_from_name
    __import__(name)
    ~~~~~~~~~~^^^^^^
  File "/tmp/gradcode-routing-pilot-20261024/grading/go-counting-baseline/go_counting_test.py", line 7, in <module>
    from go_counting import (
    ...<4 lines>...
    )
ImportError: cannot import name 'WHITE' from 'go_counting' (/tmp/gradcode-routing-pilot-20261024/grading/go-counting-baseline/go_counting.py)


----------------------------------------------------------------------
Ran 1 test in 0.000s

FAILED (errors=1)

```


## Reproduction and artifacts

- Dataset: https://github.com/Aider-AI/polyglot-benchmark (exercise content attributed to Exercism).
- Gradcode base commit: `68bc26b7da1990ce10ffecfbc1e09eb13aa5d824` with uncommitted fork changes.
- Harness: `script/benchmark-routing.py`.
- Recorded task IDs and configuration: `benchmark-results/manifest.json`.
- Per-execution model selections, token usage, cost estimates, grading results: `benchmark-results/results.json`.
- Catalog snapshot: `benchmark-results/models.json`.
- Local working directories, event streams, saved solutions, and full grading logs: `/tmp/gradcode-routing-pilot-20261024`.

The earlier blocked preflight has been superseded by this run. Astra access was verified with an actual `OK` response before execution.
