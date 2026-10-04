# analytics-core

Shared deterministic KPI, comparison and candidate logic for both the mobile and remote runtimes.

The package currently provides:

- canonical decimal and EUR arithmetic;
- a central KPI registry with explicit inputs, units, aggregation and missing-data policies;
- missing-versus-zero aware sums;
- quantity aggregation guarded by compatible product sales units;
- ratio, average realized price and known-output waste-share formulas;
- comparison availability without implicit zero references;
- deterministic `ProductDailyPerformance` building with metric availability, source lineage, formula version and input revision.

Official KPI builders must reuse these functions. They must keep known and estimated waste costs separate and must not derive an aggregate margin rate until its business formula is validated.
