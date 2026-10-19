/**
 * The CDA templates the CAPR workbook fills (PHASE-16 T16.2): each template is an Excel file PCMPC
 * saves in `docs/cda-templates/`, and its fields map a cell to a key of the CAPR data
 * (`caprData`, e.g. "members.regular.male"). A field with no source in the MIS has `source: null`
 * and is listed on the workbook's "Unmapped fields" sheet. Fields are never invented: they are
 * added here from the actual template once PCMPC sends it (Q-16.1).
 */

export type TemplateField = { sheet: string; cell: string; label: string; source: string | null };
export type CdaTemplate = { key: string; title: string; file: string; fields: TemplateField[] };

export const CDA_TEMPLATES: CdaTemplate[] = [
  { key: "CAPR", title: "Cooperative Annual Progress Report (CAPR)", file: "capr.xlsx", fields: [] },
];
