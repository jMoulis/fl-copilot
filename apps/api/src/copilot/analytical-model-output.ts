import type { JSONValue } from "ai";

/** Ephemeral model transport only. Canonical evidence, hashes and APIs never change. */
export function createAnalyticalModelOutput(initialIds: readonly string[]) {
  const canonical = new Set(initialIds);
  const references = new Map<string, string>();
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
    const wire: JSONValue = {
      ...(referenceFields(value) as Record<string, JSONValue>),
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
        details,
      },
    };
    return {
      wire,
      accept() {
        // prepare/accept run synchronously around the existing byte/scope checks.
        for (const id of ids) canonical.add(id);
        for (const [ref, id] of staged) references.set(ref, id);
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
      return references.size;
    },
    prepare,
    bind,
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
