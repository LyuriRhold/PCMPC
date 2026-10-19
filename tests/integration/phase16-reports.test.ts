import { afterEach, describe, expect, it } from "vitest";
import "@/modules/plugins";
import { ForbiddenError, runAs } from "@/lib/auth-guard";
import { setClock } from "@/lib/dates";
import { addOfficerAction, addTrainingAction, endOfficerTermAction } from "@/modules/governance/actions";
import { listOfficers, listTrainings, officerTrainingHours } from "@/modules/governance/service";
import { makeUser } from "../helpers/phase01";
import { membersFixture } from "../helpers/phase16";

afterEach(() => setClock(null));

describe("T16.1 officers, committees and trainings", () => {
  it("the manager records officers and their terms; who serves on a date; an ended term", async () => {
    const { manager } = await membersFixture();
    const teller = (await makeUser("TELLER", "teller1")).id;
    const add = (o: Partial<Parameters<typeof addOfficerAction>[0]>, by = manager) =>
      runAs(by, () => addOfficerAction({ memberNo: "M-000001", position: "Chairperson", committee: "BOARD", termStart: "2026-03-01", termEnd: "2028-02-28", electedAtGa: "2026-02-28", ...o }));
    await expect(add({}, teller)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await add({ memberNo: "M-999999" })).toEqual({ ok: false, error: "No member with no. M-999999" });
    expect(await add({ committee: "FINANCE" })).toEqual({ ok: false, error: "Choose the board or committee" });
    expect(await add({ termEnd: "2026-01-01" })).toEqual({ ok: false, error: "The term ends on or after it starts" });
    expect(await add({ position: " " })).toEqual({ ok: false, error: "Enter the position" });
    const chair = await add({});
    if (!chair.ok) throw new Error(chair.error);
    expect((await add({ memberNo: "m-000004", position: "Chairperson", committee: "AUDIT", electedAtGa: null, termEnd: null })).ok).toBe(true);
    expect((await listOfficers("2026-06-30")).map((o) => [o.committee, o.position, o.memberNo])).toEqual([
      ["AUDIT", "Chairperson", "M-000004"],
      ["BOARD", "Chairperson", "M-000001"],
    ]);
    expect(await listOfficers("2026-02-01")).toEqual([]);
    expect(await runAs(manager, () => endOfficerTermAction({ officerId: chair.data.id, termEnd: "2026-01-01" }))).toEqual({ ok: false, error: "The term ends on or after it starts" });
    expect((await runAs(manager, () => endOfficerTermAction({ officerId: chair.data.id, termEnd: "2026-06-30" }))).ok).toBe(true);
    expect((await listOfficers("2026-07-01")).map((o) => o.memberNo)).toEqual(["M-000004"]);
  });

  it("a training with its attendees (member nos.); hours per member in a period", async () => {
    const { manager } = await membersFixture();
    const add = (o: Partial<Parameters<typeof addTrainingAction>[0]>) =>
      runAs(manager, () => addTrainingAction({ title: "Fundamentals of Cooperatives", provider: "CDA Region IV-A", heldOn: "2026-05-14", hours: "8", memberNos: "M-000001, M-000002\nM-000006", ...o }));
    expect(await add({ hours: "0" })).toEqual({ ok: false, error: "Enter the hours, more than 0 (up to 2 decimals)" });
    expect(await add({ memberNos: "" })).toEqual({ ok: false, error: "Enter at least one attendee's member no." });
    expect(await add({ memberNos: "M-000001, M-000077" })).toEqual({ ok: false, error: "No member with no. M-000077" });
    expect(await add({ heldOn: "2099-01-01" })).toEqual({ ok: false, error: "The training date can't be in the future" });
    expect((await add({})).ok).toBe(true);
    expect((await add({ title: "Credit Management", hours: "4.5", heldOn: "2026-08-20", memberNos: "M-000001" })).ok).toBe(true);
    const list = await listTrainings("2026-01-01", "2026-12-31");
    expect(list.map((t) => [t.title, t.hours, t.attendees.map((a) => a.memberNo)])).toEqual([
      ["Credit Management", "4.50", ["M-000001"]],
      ["Fundamentals of Cooperatives", "8.00", ["M-000001", "M-000002", "M-000006"]],
    ]);
    const hours = await officerTrainingHours("2026-01-01", "2026-12-31");
    expect([...hours.values()].map((h) => [h.hours, h.trainings]).sort()).toEqual([
      ["12.50", 2],
      ["8.00", 1],
      ["8.00", 1],
    ]);
  });
});
