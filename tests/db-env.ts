/** Test-DB guard shared by the Vitest DB setup files. */
export function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error("DATABASE_URL_TEST is not set");
  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!name.endsWith("_test")) {
    throw new Error(`DATABASE_URL_TEST must point at a *_test database (got "${name}"); tests truncate every table`);
  }
  return url;
}
