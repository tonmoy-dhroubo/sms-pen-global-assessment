// Minimal structured logging: one JSON line per event on stderr, so request ids and errors can be grepped
// locally and picked up by Vercel's log drain when hosted.

type Fields = Record<string, unknown>;

function serialiseError(error: unknown): Fields {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}

export function logError(message: string, error: unknown, fields: Fields = {}): void {
  console.error(
    JSON.stringify({
      level: "error",
      time: new Date().toISOString(),
      message,
      ...fields,
      error: serialiseError(error),
    }),
  );
}
