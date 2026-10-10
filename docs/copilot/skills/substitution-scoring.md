# Conservative substitution scoring

Future M7 tool adapter: `calculateConservativeSubstitutionScore` in substitution-core. This is a deterministic shared operation, not an active chat tool or an AI provider call.

The trusted adapter supplies a scoped, human-confirmed directed relationship and the complete canonical set of current evidence revisions, including invalidations. Never let model-authored requests choose evidence subsets, final scores, historical values or policy weights. M6-T08 publishes results and immutable evidence-linked audit atomically through the canonical evidence processor.

The result separates business compatibility, observed signal, limited confidence and per-evidence eligibility decisions. It supports reproduction, correction and inspection without repeated accumulation. No result silently validates/reactivates a relationship or claims causality. Missing inputs yield no learned metrics. An AI may explain the traced result and propose a human action; it cannot write an arbitrary score.

Read audit through the scoped substitutionScoreHistory synchronization contract. Preserve before/after metrics and proof versions when explaining a correction; a current evidence page may differ from the historical snapshot. Rejected relations retain their explicit human state and cannot be reactivated by scoring.
