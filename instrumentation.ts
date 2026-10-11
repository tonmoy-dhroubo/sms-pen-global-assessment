// Runs once when the Next.js server starts (see instrumentation-node.ts for what it does).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // `next build` has no runtime configuration; the variables are checked when the server starts.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { checkEnvironment } = await import("./instrumentation-node");
  await checkEnvironment();
}
