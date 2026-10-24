# Capped history analysis: fixed-token routing cost estimate

## Result

Normalizing the all-Astra baseline to **$100**, Laya routing costs an estimated **$16.71**, or **83.29% lower token cost**, when modelling cache misses after model switches.

| Scenario | Estimated token cost | Normalized to $100 baseline |
| --- | ---: | ---: |
| All Astra, observed caching | $99.9174 | $100.00 |
| Laya routing, cache misses after model switches | $16.6957 | $16.71 |

This completed, capped analysis covers **898 unique calls** and **177 classified turns** from a local Codex history snapshot dated 2026-10-24. Figures use the unrounded analysis totals; displayed dollar values are rounded.

## Method and limitations

This is **fixed-token counterfactual repricing**, not measured savings from replaying the requests. Recorded input, output, and reasoning token counts are held fixed across models and effort levels. Different models could produce different token counts, answers, tool calls, and retries in actual use. No answer quality or task success was evaluated in this analysis.

The baseline prices all included calls as Astra with observed caching. The routed scenario removes cache-read discounts on the first call after each model change within a thread; subsequent calls retain observed cache usage. This models a switching penalty, rather than measuring actual cache behavior after replay. It does not assume every call is uncached.

Laya classifies prompt text and preceding conversation, without future answers or attachment contents. Unmatched usage and classification failures remain on Astra. Subagent calls are included; copied response IDs are counted once. Costs use standard API list prices with long-context premiums, rather than subscription spending. Tool fees, local compute/electricity, and unrecorded inference are excluded. This capped sample does not establish savings across the full history or other workloads.

## Suggested wording

> Estimated token cost: **$16.71 per $100 all-Astra — 83.29% lower**, modelling cache misses after model switches. Fixed-token estimates from 898 historical calls, not measured request-replay savings; answer quality was not evaluated.

See the [machine-readable statistic](expanded-results/capped-stat.json). The separate [Python coding-task evaluation](ROUTING-BENCHMARK-EXPANDED.md) measures execution outcomes and must not be pooled with this analysis. Private prompts and conversation logs are not published.
