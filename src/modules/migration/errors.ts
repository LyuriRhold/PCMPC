/** A data-migration rule was broken; the message is safe to show. */
export class MigrationError extends Error {
  override name = "MigrationError";
}
