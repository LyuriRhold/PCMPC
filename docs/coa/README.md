# Chart of accounts (COA)

The MIS loads its chart of accounts from **`docs/coa/pcmpc-coa.csv`** when `npm run db:seed` runs.
Until PCMPC provides that file, a **provisional** chart is seeded (every account flagged
`provisional`, shown with a "Provisional" badge in Accounting › Chart of accounts). See
`PROGRESS.md › Questions` (Q-03.1).

`provisional-coa.csv` in this folder is the provisional chart in the import format. The
bookkeeper can use it as a template: edit codes and names to match the cooperative's COA
(CDA Revised Standard Chart of Accounts, MC 2016-06), save it as `pcmpc-coa.csv`, and re-seed
a fresh database.

## Format
UTF-8 CSV with this header row:

```
code,name,type,normal_balance,parent_code,postable,sca_code,mapping_keys
```

| Column | Meaning |
|---|---|
| `code` | Account code, unique (e.g. `11110`) |
| `name` | Account title. Quote it if it contains a comma |
| `type` | `ASSET`, `LIABILITY`, `EQUITY`, `REVENUE` or `EXPENSE` |
| `normal_balance` | `DR` or `CR` (contra accounts take the opposite side) |
| `parent_code` | Code of the header account above it, or blank for a top-level account |
| `postable` | `true` for accounts that take entries, `false` for headers |
| `sca_code` | The CDA standard chart code, if different from `code` (optional) |
| `mapping_keys` | The DOMAIN §6 posting keys this account receives, separated by `;` (e.g. `cash_on_hand`) |

Every key in DOMAIN §6 must be mapped to exactly one postable account. The seed stops with
a list of the missing keys if any are missing. Templated keys are expanded per loan product
(`loans_receivable_REG`, `loans_receivable_EMR`, `loans_receivable_PRD`). Depreciation keys
(`accumulated_depreciation_{class}`) are added in Phase 14.
