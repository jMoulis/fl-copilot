# analytics-core

Shared deterministic KPI, comparison and candidate logic for both the mobile and remote runtimes.

The package currently provides:

- canonical decimal and EUR arithmetic;
- a central KPI registry with explicit inputs, units, aggregation and missing-data policies;
- missing-versus-zero aware sums;
- quantity aggregation guarded by compatible product sales units;
- ratio, average realized price and known-output waste-share formulas;
- comparison availability without implicit zero references;
- deterministic `ProductDailyPerformance` building with metric availability, source lineage, formula version and input revision;
- deterministic `DepartmentDailyPerformance` aggregation that propagates partial coverage, excludes incompatible global quantities and withholds unvalidated aggregate margin rates.
- deterministic comparison modes for J-7, comparable weeks, same-weekday averages, year-over-year, pre-operation and custom reference periods, with explicit sample sizes and reference methods.
- deterministic data-quality components for source completeness, product matching, waste cost coverage, reference quality, opening-calendar period completeness, unit compatibility, execution data and context.

Comparison results preserve missing references, zero references and partial source coverage instead of converting them into misleading percentages. Quality results preserve missing, partial and complete states, average only applicable dimensions and keep known, estimated and unknown waste cost shares separate. Official KPI builders must reuse these functions. They must not derive an aggregate margin rate until its business formula is validated.
