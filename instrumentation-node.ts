// Node.js-only startup work. Importing `lib/env` makes a missing or invalid variable stop the server
// at startup, with a readable list, instead of failing on the first request.
export async function checkEnvironment() {
  try {
    await import("./lib/env");
  } catch (error) {
    // Print just the list of problems (not a stack trace) and refuse to start.
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
