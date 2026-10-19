import { sql } from "drizzle-orm";
import { check, date, index, numeric, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdColumns } from "@/db/columns";
import { members } from "@/modules/members/schema";

/**
 * Governance records for the CDA reports (PHASE-16 T16.1): the officers (directors, officers and
 * committee members with their terms) and the trainings they and other members attended.
 */

const inList = (col: string, values: readonly string[]) => sql.raw(`${col} IN (${values.map((v) => `'${v}'`).join(", ")})`);

/** The board and the committees RA 9520 asks for, plus management (CONFIRM Q-16.2). */
export const COMMITTEES = ["BOARD", "AUDIT", "ELECTION", "MEDIATION_CONCILIATION", "ETHICS", "CREDIT", "EDUCATION_TRAINING", "GENDER_DEVELOPMENT", "MANAGEMENT"] as const;
export type Committee = (typeof COMMITTEES)[number];

export const officers = pgTable(
  "officers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    /** E.g. Chairperson, Vice-Chairperson, Director, Secretary, Treasurer, Member, General Manager. */
    position: text("position").notNull(),
    committee: text("committee").$type<Committee>().notNull(),
    termStart: date("term_start", { mode: "string" }).notNull(),
    termEnd: date("term_end", { mode: "string" }),
    /** The General Assembly that elected them (none for appointed officers). */
    electedAtGa: date("elected_at_ga", { mode: "string" }),
    ...createdColumns(),
  },
  (t) => [
    check("officers_committee_chk", inList("committee", COMMITTEES)),
    check("officers_term_chk", sql`${t.termEnd} IS NULL OR ${t.termEnd} >= ${t.termStart}`),
    index("officers_member_idx").on(t.memberId),
  ],
);

export const trainings = pgTable(
  "trainings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    provider: text("provider").notNull(),
    heldOn: date("held_on", { mode: "string" }).notNull(),
    hours: numeric("hours", { precision: 6, scale: 2 }).notNull(),
    ...createdColumns(),
  },
  (t) => [check("trainings_hours_chk", sql`${t.hours} > 0`), index("trainings_held_idx").on(t.heldOn)],
);

/** Who attended a training (officers are members too). */
export const trainingAttendees = pgTable(
  "training_attendees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trainingId: uuid("training_id")
      .notNull()
      .references(() => trainings.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    ...createdColumns(),
  },
  (t) => [unique("training_attendees_uq").on(t.trainingId, t.memberId)],
);

export type Officer = typeof officers.$inferSelect;
export type Training = typeof trainings.$inferSelect;
