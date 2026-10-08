# Open questions

Claude Code: when you hit one of these, build behind a setting or a placeholder and say so in the PR.

## Need Aarisa (Aaron)

| # | Question | Blocks |
|---|---|---|
| 1 | Confirm Hovership rates derived from the file: T1–3 $3.00 / $2.50, T4 $2.00 / $1.75, Stat $10.00 / $5.00. Pharma pickup driver rate? | Phase 1 payroll |
| 2 | Confirm STEM stays out of per-driver margin and is counted at operation level (changes per-driver margins, not the weekly total). | Phase 1 Hovership screen |
| 3 | Are bonuses that equal STEM a pass-through to the driver? Should the portal tag them as such? | Phase 1 margin view |
| 4 | T-Force e-commerce rates: client per piece, driver per piece, any per-route minimums? | Phase 2 |
| 5 | How is Puma paid: per piece, per route-day, fixed? Same for other contractors? | Phase 2 |
| 6 | Payroll file format the bank or payroll provider needs (CSV columns, NACHA, other). | Phase 1 export |
| 7 | Which mailbox receives the client reports, and from which senders? | Phase 2 ingest |
| 8 | WhatsApp: number to use, who verifies the Meta Business account, morning time per weekday. | Phase 2 |
| 9 | Who will be dispatcher and finance users; their phones and preferred language. | Phase 1 roles |
| 10 | Hovership historical vs current data: many stations and codes Jan–May, one station Jun–Jul. Contraction, restructuring or incomplete capture? | Data migration |
| 11 | Do they want historical data loaded (Jan–Jul 2026) or start clean? | Seed / migration |
| 12 | "Low pieces" threshold for T-Force exceptions (default: under 10% of the route median; 20% would also flag 9000J on Jun 17 with 15 pieces). | Phase 2 |
| 13 | Is a guaranteed daily minimum paid to Hovership drivers? (Some bonuses look like floor top-ups.) | Phase 1 bonus rules |

## Need Dimetrics / Leanova

| # | Question |
|---|---|
| 14 | Host on the Dimetrics VPS (`alexyah` or `dimetrics` host) or on infrastructure Aarisa owns? Data is US payroll data. |
| 15 | Domain: `aarisa.dimetrics.com.co` or a domain of Aarisa's. |
| 16 | Speech-to-text provider for WhatsApp voice notes (self-hosted Whisper vs hosted API). |
| 17 | File storage: local volume or S3-compatible bucket. |
| 18 | Teams integration later (phase 4) or not at all. |
