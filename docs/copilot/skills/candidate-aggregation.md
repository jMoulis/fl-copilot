# Assemble trusted Copilot candidates

Future M7 deterministic read tool seam: `aggregateCopilotCandidates` in analytics-core. A trusted store-scoped adapter supplies analytical engine output and structured weekly producer output, plus optional canonical context. Model text is never accepted as trusted scores, evidence, stock, human validation or execution.

The aggregate preserves independent origin, source candidate IDs, entity IDs, evidence/source versions, lineages, quality warnings and missing data. All entries are TO_REVIEW until subsequent eligibility/scoring/conflict stages. Exact duplicates are idempotent; conflicting identities are errors. No semantic merging, three-priority truncation, advice, write or provider call is performed here.

Weekly promotion overlaps come from `weeklyPromotionOverlapCandidates`, which reuses the confirmed graph detector. Planned/source facts are not observed execution; financial impact and availability stay unknown. A copilot may explain these facts after eligibility and priority processing, but cannot invent missing economic scores or reactivate rejected relations.
