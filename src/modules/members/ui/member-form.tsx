"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createApplicantAction, updateMemberAction } from "../actions";
import { CIVIL_STATUSES, ID_TYPES, memberInputSchema, SEXES, type MemberInput } from "../validation";

export const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

export type MemberFormValues = Partial<Record<keyof MemberInput, string | boolean | null>>;

function Field({
  id,
  label,
  children,
  hint,
  className,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * Membership application / edit form. Validation is the same zod schema the server uses.
 * When `sensitiveLocked` is set (editor without members.read_sensitive), birthdate, ID no.,
 * TIN and mobile show their masked values read-only and the server keeps the stored ones.
 */
export function MemberForm({
  mode,
  memberId,
  initial = {},
  isApplicant = true,
  sensitiveLocked = false,
}: {
  mode: "create" | "edit";
  memberId?: string;
  initial?: MemberFormValues;
  isApplicant?: boolean;
  sensitiveLocked?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(fd: FormData) {
    setError(null);
    const get = (k: string) => String(fd.get(k) ?? "");
    const raw: MemberInput = {
      type: get("type") as MemberInput["type"],
      lastName: get("lastName"),
      firstName: get("firstName"),
      middleName: get("middleName"),
      suffix: get("suffix"),
      birthdate: sensitiveLocked ? "1900-01-01" : get("birthdate"),
      sex: get("sex") as MemberInput["sex"],
      civilStatus: get("civilStatus") as MemberInput["civilStatus"],
      addrStreet: get("addrStreet"),
      addrPurok: get("addrPurok"),
      addrBarangay: get("addrBarangay"),
      addrMunicipality: get("addrMunicipality"),
      addrProvince: get("addrProvince"),
      mobile: sensitiveLocked ? null : get("mobile"),
      email: get("email"),
      occupation: get("occupation"),
      employer: get("employer"),
      tin: sensitiveLocked ? null : get("tin"),
      validIdType: get("validIdType"),
      validIdNo: sensitiveLocked ? null : get("validIdNo"),
      pmesDate: isApplicant ? get("pmesDate") : null,
      bodResolutionNo: isApplicant ? get("bodResolutionNo") : null,
      privacyConsent: fd.get("privacyConsent") === "on",
      remarks: get("remarks"),
    };
    const parsed = memberInputSchema.safeParse(raw);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the form");
      return;
    }
    startTransition(async () => {
      try {
        if (mode === "create") {
          const r = await createApplicantAction(raw);
          if (!r.ok) return setError(r.error);
          router.push(`/members/${r.data.id}`);
        } else if (memberId) {
          const r = await updateMemberAction({ memberId, data: raw });
          if (!r.ok) return setError(r.error);
          router.push(`/members/${memberId}`);
          router.refresh();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  return (
    <form action={submit} className="flex max-w-4xl flex-col gap-6">
      <fieldset className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="px-1 text-sm font-semibold">Name &amp; membership type</legend>
        <Field id="lastName" label="Last name">
          <Input id="lastName" name="lastName" defaultValue={str(initial.lastName)} required maxLength={80} />
        </Field>
        <Field id="firstName" label="First name">
          <Input id="firstName" name="firstName" defaultValue={str(initial.firstName)} required maxLength={80} />
        </Field>
        <Field id="middleName" label="Middle name">
          <Input id="middleName" name="middleName" defaultValue={str(initial.middleName)} maxLength={80} />
        </Field>
        <Field id="suffix" label="Suffix">
          <Input id="suffix" name="suffix" defaultValue={str(initial.suffix)} maxLength={10} placeholder="Jr., III" />
        </Field>
        <Field id="type" label="Membership type">
          <select id="type" name="type" defaultValue={str(initial.type) || "REGULAR"} className={selectClass}>
            <option value="REGULAR">Regular</option>
            <option value="ASSOCIATE">Associate</option>
          </select>
        </Field>
      </fieldset>

      <fieldset className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="px-1 text-sm font-semibold">Personal details</legend>
        <Field id="birthdate" label="Birthdate" hint={sensitiveLocked ? "Hidden: needs members.read_sensitive" : undefined}>
          {sensitiveLocked ? (
            <Input id="birthdate" value={str(initial.birthdate)} disabled readOnly />
          ) : (
            <Input id="birthdate" name="birthdate" type="date" defaultValue={str(initial.birthdate)} required />
          )}
        </Field>
        <Field id="sex" label="Sex">
          <select id="sex" name="sex" defaultValue={str(initial.sex)} required className={selectClass}>
            <option value="" disabled>
              Choose
            </option>
            {SEXES.map((s) => (
              <option key={s} value={s}>
                {s === "MALE" ? "Male" : "Female"}
              </option>
            ))}
          </select>
        </Field>
        <Field id="civilStatus" label="Civil status">
          <select id="civilStatus" name="civilStatus" defaultValue={str(initial.civilStatus)} required className={selectClass}>
            <option value="" disabled>
              Choose
            </option>
            {CIVIL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </Field>
        <Field id="occupation" label="Occupation">
          <Input id="occupation" name="occupation" defaultValue={str(initial.occupation)} maxLength={120} />
        </Field>
        <Field id="employer" label="Employer / business">
          <Input id="employer" name="employer" defaultValue={str(initial.employer)} maxLength={120} />
        </Field>
        <Field id="tin" label="TIN (optional)">
          <Input id="tin" name="tin" defaultValue={str(initial.tin)} maxLength={20} disabled={sensitiveLocked} />
        </Field>
        <Field id="validIdType" label="Valid ID type">
          <Input id="validIdType" name="validIdType" defaultValue={str(initial.validIdType)} list="id-types" maxLength={60} />
          <datalist id="id-types">
            {ID_TYPES.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </Field>
        <Field id="validIdNo" label="Valid ID no.">
          <Input id="validIdNo" name="validIdNo" defaultValue={str(initial.validIdNo)} maxLength={40} disabled={sensitiveLocked} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="px-1 text-sm font-semibold">Address &amp; contact</legend>
        <Field id="addrStreet" label="House no. / street" className="sm:col-span-2">
          <Input id="addrStreet" name="addrStreet" defaultValue={str(initial.addrStreet)} maxLength={200} />
        </Field>
        <Field id="addrPurok" label="Purok / sitio">
          <Input id="addrPurok" name="addrPurok" defaultValue={str(initial.addrPurok)} maxLength={80} />
        </Field>
        <Field id="addrBarangay" label="Barangay">
          <Input id="addrBarangay" name="addrBarangay" defaultValue={str(initial.addrBarangay) || "Pipindan"} required maxLength={80} />
        </Field>
        <Field id="addrMunicipality" label="Municipality">
          <Input id="addrMunicipality" name="addrMunicipality" defaultValue={str(initial.addrMunicipality) || "Binangonan"} required maxLength={80} />
        </Field>
        <Field id="addrProvince" label="Province">
          <Input id="addrProvince" name="addrProvince" defaultValue={str(initial.addrProvince) || "Rizal"} required maxLength={80} />
        </Field>
        <Field id="mobile" label="Mobile">
          <Input id="mobile" name="mobile" defaultValue={str(initial.mobile)} maxLength={20} inputMode="tel" disabled={sensitiveLocked} />
        </Field>
        <Field id="email" label="E-mail">
          <Input id="email" name="email" type="email" defaultValue={str(initial.email)} maxLength={200} />
        </Field>
      </fieldset>

      {isApplicant ? (
        <fieldset className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4">
          <legend className="px-1 text-sm font-semibold">Membership requirements (can be completed later)</legend>
          <Field id="pmesDate" label="PMES attended on">
            <Input id="pmesDate" name="pmesDate" type="date" defaultValue={str(initial.pmesDate)} />
          </Field>
          <Field id="bodResolutionNo" label="BOD resolution no. (if already approved)">
            <Input id="bodResolutionNo" name="bodResolutionNo" defaultValue={str(initial.bodResolutionNo)} maxLength={40} />
          </Field>
        </fieldset>
      ) : null}

      <div className="flex flex-col gap-3 rounded-lg border p-4">
        <Field id="remarks" label="Remarks">
          <Textarea id="remarks" name="remarks" defaultValue={str(initial.remarks)} maxLength={500} rows={2} />
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="privacyConsent" defaultChecked={initial.privacyConsent === true} className="mt-1" />
          <span>
            I consent to PCMPC collecting and processing my personal data for membership, records and services, as
            described in the cooperative&apos;s privacy notice (Data Privacy Act, RA 10173).
          </span>
        </label>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : mode === "create" ? "Save application" : "Save changes"}
        </Button>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
