import postgres from 'postgres';

let client: ReturnType<typeof postgres> | undefined;

/** Lazy singleton so `next build` works without a database. */
export function db() {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    client = postgres(url, { prepare: false });
  }
  return client;
}
