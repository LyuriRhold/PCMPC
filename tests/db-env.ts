/** Test-DB guard shared by the Vitest DB setup files. */

/** Vitest workers for DB tests; each worker gets its own copy of the test database. */
export const DB_WORKERS = 4;

export function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error("DATABASE_URL_TEST is not set");
  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!name.endsWith("_test")) {
    throw new Error(`DATABASE_URL_TEST must point at a *_test database (got "${name}"); tests truncate every table`);
  }
  return url;
}

/** Name of worker `id`'s database: pcmpc_test → pcmpc_w3_test (still a *_test database). */
export function workerDatabaseName(id: number): string {
  const name = decodeURIComponent(new URL(testDatabaseUrl()).pathname.slice(1));
  return name.replace(/_test$/, `_w${id}_test`);
}

export function workerDatabaseUrl(id: number): string {
  const url = new URL(testDatabaseUrl());
  url.pathname = `/${encodeURIComponent(workerDatabaseName(id))}`;
  return url.toString();
}
