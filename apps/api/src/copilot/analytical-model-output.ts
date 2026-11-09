import type { JSONValue } from "ai";

/** Ephemeral model transport only. Canonical evidence, hashes and APIs never change. */
export function createAnalyticalModelOutput(initialIds: readonly string[]) {
  const canonical = new Set(initialIds);
  const references = new Map<string, string>();
  const analyticalIds = new Set<string>();
  // Verbatim labels/filenames are source text, not model-authored measurements.
  // Keep their canonical identity even when the model echoes them without a marker.
  const verbatim = new Map<string, { id: string; kind: "label" | "value" }>();
  const rememberText = (entries: Array<Record<string, JSONValue>>) => {
    for (const entry of entries) {
      const candidates = [
        { text: entry.label, kind: "label" as const },
        ...(entry.sourceType === "SOURCE_DOCUMENT" &&
        entry.factKind === "QUALITY"
          ? [{ text: entry.value, kind: "value" as const }]
          : []),
      ];
      for (const { text, kind } of candidates) {
        if (
          typeof text !== "string" ||
          !/\p{L}/u.test(text) ||
          !/\p{N}/u.test(text) ||
          /[{}\r\n]|https?:|copilot-source:/i.test(text)
        )
          continue;
        const old = verbatim.get(text);
        // Identical labels may name different records: never choose one implicitly.
        verbatim.set(text, {
          id: old && old.id !== entry.id ? "" : String(entry.id),
          kind,
        });
      }
    }
  };
  let initialIndex = 0;
  for (const id of canonical) {
    let ref: string;
    do {
      ref = `i${initialIndex++}`;
    } while (canonical.has(ref));
    references.set(ref, id);
  }
  let next = 0;
  const outputs = new WeakMap<object, JSONValue>();
  const prepare = (family: string, raw: unknown, remainingReads: number) => {
    const value = raw as Record<string, JSONValue>;
    if (!value || !Array.isArray(value.evidence)) return;
    const entries = value.evidence as Array<Record<string, JSONValue>>;
    const ids = new Set([...canonical, ...entries.map((e) => String(e.id))]);
    // A future canonical ID cannot silently take the meaning of an exposed ref.
    if (
      entries.some(
        (e) =>
          references.has(String(e.id)) && references.get(String(e.id)) !== e.id,
      )
    )
      throw Error("ANALYTICAL_REFERENCE_COLLISION");
    if (!["analytics-query", "period", "mongo"].includes(family))
      return {
        wire: value as JSONValue,
        accept() {
          for (const id of ids) canonical.add(id);
          rememberText(entries);
        },
      };
    const staged = new Map(references);
    const byId = new Map([...staged].map(([ref, id]) => [id, ref]));
    let counter = next;
    const details: JSONValue[] = [];
    const detailIndex = new Map<string, number>();
    const intern = (
      item: JSONValue,
      items: JSONValue[],
      indexes: Map<string, number>,
    ) => {
      const key = JSON.stringify(item);
      let index = indexes.get(key);
      if (index === undefined) {
        index = items.length;
        indexes.set(key, index);
        items.push(item);
      }
      return index;
    };
    const rows = entries.map((entry) => {
      const {
        id,
        label,
        value: amount,
        sourceType,
        factKind,
        detail,
        ...extra
      } = entry;
      delete extra.sourceId;
      delete extra.sourceVersion;
      let ref = byId.get(String(id));
      if (!ref) {
        do {
          ref = `r${counter++}`;
        } while (ids.has(ref) || staged.has(ref));
        staged.set(ref, String(id));
        byId.set(String(id), ref);
      }
      return [
        ref,
        label!,
        amount!,
        sourceType!,
        factKind!,
        detail === undefined ? null : intern(detail, details, detailIndex),
        Object.keys(extra).length ? extra : null,
      ];
    });
    // Only evidence references change; product/document/candidate IDs remain canonical.
    const referenceFields = (
      item: JSONValue,
      inReference = false,
    ): JSONValue => {
      if (inReference && typeof item === "string")
        return byId.get(item) ?? item;
      if (Array.isArray(item))
        return item.map((v) => referenceFields(v, inReference));
      if (item && typeof item === "object")
        return Object.fromEntries(
          Object.entries(item).map(([key, v]) => [
            key,
            referenceFields(
              v!,
              inReference ||
                key === "evidenceId" ||
                key === "evidenceIds" ||
                key === "chartEvidenceId",
            ),
          ]),
        );
      return item;
    };
    const projected = referenceFields(value) as Record<string, JSONValue>;
    // Preserve every character, including decimal points and whitespace. Only
    // repeated prose is shared; the model still cites the same direct refs.
    const detailParts: JSONValue[] = [];
    const partIndex = new Map<string, number>();
    const sharedDetails = details.map((detail) =>
      typeof detail === "string"
        ? detail
            .split(/(?<=\. )/u)
            .map((part) => intern(part, detailParts, partIndex))
        : detail,
    );
    const shareDetails =
      JSON.stringify({ details: sharedDetails, detailParts }).length <
      JSON.stringify({ details }).length;
    // Query metrics repeat identical coverage objects for each product/metric.
    // Share those exact objects and name the metric columns once; no sampling.
    if (family === "analytics-query" && Array.isArray(projected.rows)) {
      const coverages: JSONValue[] = [];
      const coverageIndex = new Map<string, number>();
      projected.rows = projected.rows.map((rawRow) => {
        if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow))
          return rawRow;
        if (!Array.isArray(rawRow.metrics) || !rawRow.metrics.length)
          return rawRow;
        const metrics = rawRow.metrics as Record<string, JSONValue>[];
        const keys = [
          ...new Set(metrics.flatMap((metric) => Object.keys(metric))),
        ];
        // Future heterogeneous rows keep their original shape: absence must
        // never silently become a null cell.
        if (
          metrics.some((metric) =>
            keys.some((key) => !Object.hasOwn(metric, key)),
          )
        )
          return rawRow;
        const coverageKeys = new Set(["currentCoverage", "referenceCoverage"]);
        return {
          ...rawRow,
          metrics: {
            columns: keys.map((key) =>
              coverageKeys.has(key) ? `${key}Index` : key,
            ),
            rows: metrics.map((metric) =>
              keys.map((key) => {
                const item = metric[key];
                return coverageKeys.has(key) && item != null
                  ? intern(item, coverages, coverageIndex)
                  : (item ?? null);
              }),
            ),
          },
        };
      });
      if (coverages.length) projected.coverages = coverages;
      // A query uses the same metric columns for each product. Name them once
      // when all rows agree, retaining heterogeneous/future shapes verbatim.
      const tables = projected.rows.map((row) => {
        const metrics =
          row && typeof row === "object" && !Array.isArray(row)
            ? (row as Record<string, JSONValue>).metrics
            : null;
        return metrics && typeof metrics === "object" && !Array.isArray(metrics)
          ? (metrics as Record<string, JSONValue>)
          : null;
      });
      const first = tables[0];
      if (
        first &&
        Array.isArray(first.columns) &&
        tables.every(
          (table) =>
            table &&
            Object.keys(table).length === 2 &&
            Array.isArray(table.rows) &&
            JSON.stringify(table.columns) === JSON.stringify(first.columns),
        )
      ) {
        projected.metricColumns = first.columns;
        projected.rows = projected.rows.map((row) => {
          const record = row as Record<string, JSONValue>;
          return {
            ...record,
            metrics: (record.metrics as Record<string, JSONValue>).rows!,
          };
        });
      }
    }
    const wire: JSONValue = {
      ...projected,
      remainingReads,
      evidence: {
        columns: [
          "ref",
          "label",
          "value",
          "sourceType",
          "factKind",
          "detail",
          "extra",
        ],
        rows,
        details: shareDetails ? sharedDetails : details,
        ...(shareDetails ? { detailParts } : {}),
      },
    };
    return {
      wire,
      accept() {
        // prepare/accept run synchronously around the existing byte/scope checks.
        for (const id of ids) canonical.add(id);
        rememberText(entries);
        for (const [ref, id] of staged) references.set(ref, id);
        for (const entry of entries) analyticalIds.add(String(entry.id));
        next = counter;
        outputs.set(raw as object, wire);
      },
    };
  };
  const bind = (value: unknown, evidenceField = false): unknown => {
    if (evidenceField && typeof value === "string")
      return references.get(value) ?? value;
    if (Array.isArray(value)) return value.map((v) => bind(v, evidenceField));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, v]) => [
          key,
          bind(
            v,
            evidenceField || key === "evidenceId" || key === "evidenceIds",
          ),
        ]),
      );
    return value;
  };
  return {
    get factCount() {
      return analyticalIds.size;
    },
    projectInitial(value: unknown): unknown {
      const byId = new Map([...references].map(([ref, id]) => [id, ref]));
      const walk = (item: unknown, evidence = false): unknown => {
        if (Array.isArray(item))
          return item.map((entry) => walk(entry, evidence));
        if (!item || typeof item !== "object") return item;
        return Object.fromEntries(
          Object.entries(item).map(([key, child]) => [
            key,
            evidence && key === "id" && typeof child === "string"
              ? (byId.get(child) ?? child)
              : walk(child, key.toLowerCase() === "evidence"),
          ]),
        );
      };
      return walk(value);
    },
    prepare,
    bind,
    /** The model names a fact directly; only the server constructs array indexes. */
    bindAnswer(value: unknown, partial = false) {
      const output = bind(value) as Record<string, unknown>;
      if (
        !output ||
        typeof output !== "object" ||
        typeof output.narrative !== "string"
      )
        return { output, omittedBlocks: 0 };
      const facts: Array<{ evidenceId: string }> = [];
      const blocks: string[] = [];
      let omittedBlocks = 0;
      // Markdown ordinals describe layout, not measured business quantities.
      const prose = output.narrative.replace(
        /^([ \t]*)\d{1,9}[.)][ \t]+(?=\S)/gm,
        "$1- ",
      );
      for (const block of prose.split(/\n\s*\n/)) {
        const selected = [...facts];
        let invalid = false;
        const names = [...verbatim]
          .filter(([, entry]) => entry.id && canonical.has(entry.id))
          .map(([text]) => text)
          .sort((a, b) => b.length - a.length);
        const pattern = names.length
          ? new RegExp(
              `(?<![\\p{L}\\p{N}_])(?:${names.map((text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\p{L}\\p{N}_])`,
              "gu",
            )
          : null;
        const protectedBlock = pattern
          ? block
              .split(/(\{\{[^{}]*\}\})/g)
              .map((part) =>
                part.startsWith("{{")
                  ? part
                  : part.replace(pattern, (text) => {
                      const { kind, id } = verbatim.get(text)!;
                      const ref =
                        [...references].find(
                          ([, canonicalId]) => canonicalId === id,
                        )?.[0] ?? id;
                      return `{{${kind}:${ref}}}`;
                    }),
              )
              .join("")
          : block;
        const narrative = protectedBlock.replace(
          /\{\{(value|label|source|chart):([^{}\r\n]+)\}\}/g,
          (_token, kind: string, ref: string) => {
            const key = ref.trim();
            const id = references.get(key) ?? key;
            if (!canonical.has(id)) {
              invalid = true;
              return "";
            }
            let index = selected.findIndex((fact) => fact.evidenceId === id);
            if (index < 0) {
              index = selected.length;
              selected.push({ evidenceId: id });
            }
            return `{{${kind}:${index}}}`;
          },
        );
        if (invalid) {
          omittedBlocks++;
          continue;
        }
        facts.splice(0, facts.length, ...selected);
        blocks.push(narrative);
      }
      if (omittedBlocks && !partial)
        blocks.push("Un passage n’a pas pu être vérifié et n’est pas affiché.");
      return {
        output: {
          ...output,
          language: "fr-FR",
          summary: "Voici les éléments disponibles.",
          interpretation: [],
          questions: [],
          facts,
          narrative: blocks.join("\n\n"),
        },
        omittedBlocks,
      };
    },
    /** SDK toModelOutput: execution/replay still receives the original object. */
    toModelOutput: ({ output }: { output: unknown }) => ({
      type: "json" as const,
      value:
        (output && typeof output === "object"
          ? outputs.get(output)
          : undefined) ?? (output as JSONValue),
    }),
  };
}
