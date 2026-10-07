import { eq, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { audit } from "@/lib/audit";
import { now } from "@/lib/dates";
import { settings, settingsHistory } from "./schema";
import { isSettingKey, SETTING_KEYS, SETTINGS, type SettingKey, type SettingValue } from "./registry";

export class SettingError extends Error {
  override name = "SettingError";
}

/** Reads one setting, validated against its schema. Throws if the setting was never seeded. */
export async function getSetting<K extends SettingKey>(key: K, db: Db | Tx = getDb()): Promise<SettingValue<K>> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key));
  if (!row) throw new SettingError(`Setting "${key}" is not seeded. Run npm run db:seed.`);
  return SETTINGS[key].schema.parse(row.value) as SettingValue<K>;
}

export type SettingRow = {
  key: SettingKey;
  group: string;
  label: string;
  kind: string;
  confirm: boolean;
  note: string | null;
  value: unknown;
  updatedAt: Date | null;
};

/** Every registered setting with its stored value, in registry order. */
export async function listSettings(db: Db | Tx = getDb()): Promise<SettingRow[]> {
  const rows = await db.select().from(settings);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return SETTING_KEYS.map((key) => {
    const d = SETTINGS[key];
    const row = byKey.get(key);
    return {
      key,
      group: d.group,
      label: d.label,
      kind: d.kind,
      confirm: d.confirm,
      note: "note" in d ? (d.note ?? null) : null,
      value: row?.value ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  });
}

/** Changes one setting: validates, keeps history and writes an audit row, all in `tx`. */
export async function updateSetting(tx: Tx, key: string, value: unknown, actorId: string | null): Promise<void> {
  if (!isSettingKey(key)) throw new SettingError(`Unknown setting "${key}"`);
  const parsed = SETTINGS[key].schema.safeParse(value);
  if (!parsed.success) throw new SettingError(`Invalid value for ${key}: ${parsed.error.issues[0]?.message ?? "invalid"}`);

  const [current] = await tx
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .for("update");
  if (!current) throw new SettingError(`Setting "${key}" is not seeded`);

  const at = now();
  await tx.insert(settingsHistory).values({
    key,
    oldValue: current.value,
    newValue: parsed.data,
    changedBy: actorId,
    changedAt: at,
    createdBy: actorId,
  });
  await tx.update(settings).set({ value: parsed.data, updatedBy: actorId, updatedAt: at }).where(eq(settings.id, current.id));
  await audit(tx, {
    action: "setting.update",
    entity: "setting",
    entityId: key,
    before: { key, value: current.value },
    after: { key, value: parsed.data },
    userId: actorId,
  });
}

/** Seeds every setting with its default. Existing values are kept (idempotent). */
export async function seedSettings(tx: Tx): Promise<void> {
  const values = SETTING_KEYS.map((key) => ({ key, value: SETTINGS[key].default as unknown }));
  await tx.insert(settings).values(values).onConflictDoNothing({ target: settings.key });
}

/** History of one setting, newest first. */
export async function settingHistory(key: SettingKey, db: Db | Tx = getDb()) {
  return db
    .select()
    .from(settingsHistory)
    .where(eq(settingsHistory.key, key))
    .orderBy(sql`${settingsHistory.changedAt} DESC, ${settingsHistory.id} DESC`);
}
