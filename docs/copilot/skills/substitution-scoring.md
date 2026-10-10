# Conservative substitution scoring

Future M7 tool adapter: `calculateConservativeSubstitutionScore` in substitution-core. This is a deterministic shared operation, not an active chat tool or an AI provider call.

The trusted adapter supplies a scoped, human-confirmed directed relationship and the complete canonical set of current evidence revisions, including invalidations. Never let model-authored requests choose evidence subsets, final scores, historical values or policy weights. M6-T08 must persist results and evidence-linked audit atomically before publication.

The result separates business compatibility, observed signal, limited confidence and per-evidence eligibility decisions. It supports reproduction, correction and inspection without repeated accumulation. No result silently validates/reactivates a relationship or claims causality. Missing inputs yield no learned metrics. An AI may explain the traced result and propose a human action; it cannot write an arbitrary score.
