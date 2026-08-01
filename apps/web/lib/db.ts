import postgres from 'postgres';

let client: ReturnType<typeof postgres> | undefined;

/** Lazy singleton so `next build` works without a database. */
export function db() {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    // prepare: false + small pool: compatible with Supabase's transaction
    // pooler (port 6543) and friendly to its connection limits in dev.
    client = postgres(url, { prepare: false, max: 5 });
  }
  return client;
}
