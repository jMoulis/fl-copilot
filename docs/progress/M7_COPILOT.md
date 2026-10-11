# M7 — Copilot, decisions, execution and review

## Entry gate

M6-T01 through T11 are deployed. The grouped iOS acceptance build 32093897-8457-496c-a670-8046815f02f2 is based on merge 6cd9d453f4e832848f0b94fabc75e8275cef9a61. Julien confirmed the mobile acceptance on 11 October 2026. The targeted exit checks passed: 16 actual SQLite tests and 15 Atlas transaction tests (isolated test database). They cover offline capture/restart/lookup, canonical evidence and score audit, idempotency/rejection, capable bootstrap/pull and offline restoration. A real observation does not guarantee immediate learning: sufficient published daily sales and an eligible confirmed directed relation are required.

## M7-T01 — Candidate aggregation

Runtime-neutral `aggregateCopilotCandidates` in analytics-core combines existing analytical candidates and trusted structured weekly producer output into a versioned common domain contract. It maps the four existing analytical trigger types without recalculating KPI thresholds. IDs include store and origin to avoid collisions across producers. Exact retries are deduplicated; divergent candidate/evidence identities fail explicitly. Ordering is deterministic, not a recommendation ranking. No semantic merge, priority cutoff, eligibility decision or generation occurs here; every normalized candidate remains TO_REVIEW for subsequent M7 stages.

Sources, entity IDs (including leading zeroes), dated context, evidence, data-quality warnings, optional declared missing data and nullable scores remain distinct. Source instruction, planned offer and derived interpretation have explicit evidence kinds. Zero is not missing. No stock, purchase cost, financial impact or causal effect is fabricated. The promotion-overlap weekly adapter calls the existing M6 detector, preserving exact mechanisms, dates, source references and support versions. Its default economic/urgency/quality scores remain unknown; declared compatibility is not a learned relationship score. No rejected edge reactivates.

This ticket creates the deterministic input seam for later filtering, scoring and remote generation. It is not an active chat, an AI call, a new mobile screen or a persistence/sync migration. Existing operational data remains authoritative. Weekly deadlines and other producers can supply the explicit weekly contract without changing the aggregator. M7-T02/T03/T04 own eligibility, priority components and conflicting proposed actions; M7-T05/T06 own configured remote AI and bounded French output. The full conversational copilot remains the M7 objective.

Validation: 610 local tests, structure, lint and strict TypeScript. No paid EAS build is needed for this pure shared increment.
