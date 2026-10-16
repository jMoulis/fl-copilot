import { asSchema, jsonSchema } from "ai";
import { z } from "zod";
/** Provider transport needs a root object. The original strict tagged union remains the authority for every argument. */
export function objectUnionToolSchema<T>(validator: z.ZodType<T>) {
  return jsonSchema<T>(
    async () => {
      const original = await asSchema(validator).jsonSchema;
      const variants = original.oneOf ?? original.anyOf;
      if (!variants?.length) {
        if (original.type !== "object")
          throw Error("TOOL_SCHEMA_OBJECT_REQUIRED");
        return original;
      }
      const branches = variants.map((v) => {
        if (typeof v !== "object" || v.type !== "object" || !v.properties)
          throw Error("TOOL_SCHEMA_OBJECT_BRANCH_REQUIRED");
        return v;
      });
      type Definition = NonNullable<typeof original.properties>[string];
      const grouped = new Map<string, Map<string, Definition>>();
      for (const branch of branches)
        for (const [key, value] of Object.entries(branch.properties!)) {
          const values = grouped.get(key) ?? new Map<string, Definition>();
          values.set(JSON.stringify(value), value);
          grouped.set(key, values);
        }
      const properties: NonNullable<typeof original.properties> = {};
      for (const [key, group] of grouped) {
        const options = [...group.values()];
        properties[key] =
          options.length === 1 ? options[0]! : { anyOf: options };
      }
      const required = (branches[0]!.required ?? []).filter((key) =>
        branches.every((b) => b.required?.includes(key)),
      );
      const { oneOf, anyOf, ...rest } = original;
      void oneOf;
      void anyOf;
      return {
        ...rest,
        type: "object",
        properties,
        required,
        additionalProperties: false,
      };
    },
    {
      validate: (value) => {
        const parsed = validator.safeParse(value);
        return parsed.success
          ? { success: true, value: parsed.data }
          : { success: false, error: parsed.error };
      },
    },
  );
}
