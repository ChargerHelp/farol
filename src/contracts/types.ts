import { z } from 'zod'

/**
 * The shape of a value an endpoint receives or returns, as the language helpers read it (FastAPI/Pydantic, Go structs
 * with json tags, gRPC messages). Compact keys keep helper outputs small:
 * - `scalar`: a primitive or a type compared by name (`str`, `int`, `time.Time`);
 * - `enum`: allowed values; `list`: items of one shape; `object`: fields (name → field);
 * - `union`: one of several shapes; `ref`: a type already being described (recursion);
 * - `unknown`: something the helper cannot describe (compared by its text only).
 */
export type Shape =
  | { k: 'scalar'; n: string }
  | { k: 'enum'; n: string; v: string[] }
  | { k: 'list'; of: Shape }
  | { k: 'object'; n: string; f: Record<string, Field> }
  | { k: 'union'; of: Shape[] }
  | { k: 'ref'; n: string }
  | { k: 'unknown'; n: string }

/** A field or parameter: its shape, whether it must be present, whether it may be null. */
export interface Field {
  s: Shape
  req: boolean
  null: boolean
}

export const ShapeSchema: z.ZodType<Shape> = z.lazy(() =>
  z.union([
    z.object({ k: z.literal('scalar'), n: z.string() }).strict(),
    z.object({ k: z.literal('enum'), n: z.string(), v: z.array(z.string()) }).strict(),
    z.object({ k: z.literal('list'), of: ShapeSchema }).strict(),
    z.object({ k: z.literal('object'), n: z.string(), f: z.record(z.string(), FieldSchema) }).strict(),
    z.object({ k: z.literal('union'), of: z.array(ShapeSchema) }).strict(),
    z.object({ k: z.literal('ref'), n: z.string() }).strict(),
    z.object({ k: z.literal('unknown'), n: z.string() }).strict(),
  ]),
)

export const FieldSchema: z.ZodType<Field> = z.lazy(() => z.object({ s: ShapeSchema, req: z.boolean(), null: z.boolean() }).strict())

/**
 * What an endpoint receives and returns. `params`: path, query, header and form parameters keyed `path:id`,
 * `query:limit`…; `body`: the request body; `response`: the success response. null: not readable (never compared as
 * safe).
 */
export const ContractSchema = z
  .object({
    params: z.record(z.string(), FieldSchema),
    body: FieldSchema.nullable(),
    response: ShapeSchema.nullable(),
  })
  .strict()

export type Contract = z.infer<typeof ContractSchema>

export const CONTRACT_LEVELS = ['breaking', 'dangerous', 'safe'] as const
export type ContractLevel = (typeof CONTRACT_LEVELS)[number]

/** One change of an endpoint's contract: `where` is a path into it (`response.items[].price`, `query:limit`). */
export interface ContractChange {
  level: ContractLevel
  where: string
  detail: string
}
