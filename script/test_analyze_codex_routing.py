import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('analysis', Path(__file__).with_name('analyze-codex-routing.py'))
analysis = importlib.util.module_from_spec(spec)
spec.loader.exec_module(analysis)


class CostTests(unittest.TestCase):
    def test_cache_and_reasoning_are_not_double_counted(self):
        usage = {'input_tokens': 1000, 'cached_input_tokens': 800, 'output_tokens': 100,
                 'reasoning_output_tokens': 80}
        self.assertAlmostEqual(analysis.price(usage, 'gpt-6-astra'), .0078)
        self.assertAlmostEqual(analysis.price(usage, 'gpt-6-astra', cache=False), .015)

    def test_budget_is_a_chronological_prefix_without_overshoot(self):
        calls = [{'usage': {'input_tokens': 1_000_000}} for _ in range(3)]
        selected = analysis.capped_calls(calls, 45)
        self.assertEqual(len(selected), 2)
        self.assertLessEqual(sum(analysis.price(x['usage'], 'gpt-6-astra') for x in selected), 45)

    def test_long_context_premium_applies_to_full_call(self):
        usage = {'input_tokens': 300_000, 'cached_input_tokens': 200_000, 'output_tokens': 1000}
        self.assertAlmostEqual(analysis.price(usage, 'gpt-6-astra'), 2.475)

    def test_switch_cache_and_unmatched_usage_are_conservative(self):
        data = {'source': {}, 'calls': [
            {'turn': 'one', 'thread': 'thread', 'usage': {'input_tokens': 1000, 'cached_input_tokens': 800}},
            {'turn': 'two', 'thread': 'thread', 'usage': {'input_tokens': 1000, 'cached_input_tokens': 800}},
            {'turn': 'missing', 'thread': 'other', 'usage': {'input_tokens': 1000}},
        ]}
        choices = {'one': {'choice': 'gpt-6-astra/high', 'status': 'classified'},
                   'two': {'choice': 'gpt-6-luna/low', 'status': 'classified'}}
        report = analysis.summarize(data, choices, 0)
        self.assertEqual(report['totals']['cache_reset_calls'], 1)
        self.assertEqual(report['totals']['unmatched_calls'], 1)
        self.assertGreater(report['totals']['routed_usd_switch_cache_miss'],
                           report['totals']['routed_usd_preserved_cache'])
        self.assertEqual(report['buckets']['unmatched-astra']['baseline_usd'],
                         report['buckets']['unmatched-astra']['routed_usd_preserved_cache'])


if __name__ == '__main__':
    unittest.main()
