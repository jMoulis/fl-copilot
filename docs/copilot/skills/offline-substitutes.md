# Find confirmed substitutes

Future M7 read-only tool adapter for `lookupSubstitutes` in substitution-core and `SubstituteLookupRepository.read` on the device. This is a shared deterministic operation, not an active LLM call or a conversational tool registration.

The user/model request may identify the source product and an optional customer need. A trusted adapter resolves the authorized store, current timestamp, complete current directed relation/parent/event snapshots and score policy. Never accept model-authored relationship scores, confidence, stock amounts, human validation flags or field events as trusted inputs.

Return candidate IDs, supporting directed relation/need, behavioural ordering basis, confidence/evidence metadata, explicit exclusions and real field warning IDs. Pending confirmed local changes remain labeled as such. Rejected/unconfirmed/unresolved/inactive references are excluded; no reverse/transitive/name-based relationship is invented.

DECLARED ranking is distinct from a canonical learned score. Missing optional compatibilities and confidence remain unknown, and zero stays zero. Group a candidate appearing under several customer needs. Margin does not rank behavioural substitution. Commercial attractiveness and plan execution remain separate later operations.

A current USER stockout blocks the candidate even offline. No blocking stockout does not prove availability: candidate availability remains UNKNOWN until a separate trustworthy availability source exists. Source documents are not store stock observations. A copilot may explain these limits and ask a useful targeted question, but cannot validate/reactivate a relation or execute an action through this read tool.

For planned promotion overlap, use shared `detectPromotionOverlaps` with trusted current plan/graph snapshots and the versioned policy. Return overlapping sale dates, original offer mechanisms/citations, and supporting confirmed membership or directed relation IDs and versions. Group each offer pair once. This is a qualitative risk to inspect, not measured cannibalization or complementarity; sales transfer, lost sales and margin impact remain unknown. Never remove or change an offer through this read operation.
