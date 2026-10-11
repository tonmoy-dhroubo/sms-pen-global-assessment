import "server-only";
import { parseEnv } from "./env-schema";

// Validated, typed environment. Parsed once on first import and throws an `EnvError` listing every
// missing or invalid variable. Server code only: never import this from a client component.
export const env = parseEnv(process.env);
export type { Env } from "./env-schema";
