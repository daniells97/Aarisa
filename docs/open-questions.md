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
| 19 | The Hovership report has a Bonus column, but spec §5.2 says Finance/Owner types the bonus. Phase 1 imports the report value as the starting bonus (source `hovership_report`) and lets Finance/Owner change it, with each change audited. Is that right, or should bonuses always start at zero? | Phase 1 bonus entry |
| 20 | Driver code `DUB088` appears once with a blank name and elsewhere as "Naira Rivera". Seed uses the non-blank name. Should a blank name in a report be an exception? | Phase 1 import |
| 21 | STEM reasons are typed by hand ("Diablo", "DIABLO", "DIablo", "Pittsburg", "Pitsburg", "Pittrsburg Martinez"…). Kept as free text for now; does Aarisa want a closed list of stations? | Reporting |

## Need Dimetrics / Leanova

| # | Question |
|---|---|
| 14 | Host on the Dimetrics VPS (`alexyah` or `dimetrics` host) or on infrastructure Aarisa owns? Data is US payroll data. |
| 15 | ~~Domain~~ Decided Oct 9, 2026: `aarisa.dimetrics.com.co` for now (A record to the Dimetrics VPS, 2.25.229.44). A domain of Aarisa's can be added later. |
| 16 | Speech-to-text provider for WhatsApp voice notes (self-hosted Whisper vs hosted API). |
| 17 | File storage: local volume or S3-compatible bucket. |
| 18 | Teams integration later (phase 4) or not at all. |
| 22 | The client process documents ("Document 1 -TFORCE Process", "Document 2 Tforce", "TFORCE Process", "Propuesta_Nomina_Aarisa") were not on the server during Phase 1, so they haven't been checked against the spec yet. |
| 25 | Hovership reports arrive as CSV in Phase 1. If the client sends Excel (.xlsx), reading it needs a parser library over 50 kB (SheetJS or similar), so it waits for approval. | Phase 1 import |
| 26 | A corrected Hovership report for days already imported is refused today ("these days were already imported"). Should a corrected file replace the earlier one while its pay period is still open? | Phase 1 import |
| 27 | Who may resolve an unknown driver code? Built as anyone who can clear exceptions (owner, dispatcher, finance); a driver created this way is marked "Finish setup" for the owner. | Phase 1 import |
| 28 | With STEM at operation level, 19 of 51 driver-days in the June 15 to 21 week lose money (the "lost money" panel lists the worst five). Confirms the note in spec §9 and open questions 2, 3 and 13. | Phase 1 margin view |
| 29 | Who may download the payroll file? Built as owner, finance and viewer (read-only); dispatchers can't. A run that isn't approved yet downloads as a "draft" file. | Phase 1 export |
| 30 | "Paid" status: the portal doesn't pay drivers (out of scope), so the owner taps "Mark as paid" after paying. Confirm, or should finance do it? | Phase 1 payroll |
| 31 | T-Force e-commerce rate is not loaded (#4), so the T-Force run shows pieces and payees but "–" for money and stays blocked. Add the rate in Drivers and rates (driver and contractor overrides supported) once Aarisa confirms it. | Phase 2 payroll |
| 32 | A T-Force route letter that isn't in the portal yet is created automatically on import, with no usual driver. Confirm, or should an unknown route be an exception? | Phase 2 import |
| 33 | "Not our route" leaves the route-day unpaid and unbilled. Should it also create a note for the client? | Phase 2 weekly check |
| 34 | Spec conflict: dispatchers log extra jobs, which need "client amount", but must never see client money (§2). Built as: dispatchers don't see or enter what T-Force pays; the job is saved and flagged until finance or the owner adds it (as in the Mobile-Synced design). Confirm. | Phase 2 extra jobs |
| 35 | Extra job photo is optional in §6.6 but not built yet; it needs the file storage decision (#17). | Phase 2 extra jobs |
| 36 | Claims "as PDF and email" (§5.6): built without new dependencies. The PDF is a printable claim page (browser "Save as PDF"); email opens a pre-written message in the user's mail app, and "Mark claim as sent" records it. A generated PDF file or sending from the portal needs a PDF library (over 50 kB) and a mail service or an n8n flow. Which do you want? | Phase 3 settlements |
| 37 | Hovership's expected weekly invoice is computed as package and stat revenue plus STEM for Monday to Sunday, due 21 days after the week ends ("about three weeks"). Confirm the invoice week and terms; T-Force is net 30 from the end of the week. | Phase 3 settlements |
| 31 | Decided Oct 9, 2026: services are no longer a closed list. The owner adds extra-job services and edits names (EN/ES) and rules; report services can't be turned off. Extra-job services may have default amounts. The WhatsApp AI still only recognises the original four extra-job services; a new one arrives as "other" and the person picks the right one in the form. | Phase 2 |
| 24 | Design gap: `Login.dc.html` shows email, password, "keep me signed in" and "email me a code" on the portal's own page. The spec uses Zitadel OIDC + PKCE, so the portal shows one "Sign in" button and Zitadel's hosted login asks for the credentials (passwordless and OTP are configured in Zitadel). Branding the Zitadel login with the Aarisa colors is a Zitadel setting. |
| 23 | Zitadel on the shared VPS has no admin service account that Claude Code can use. Creating the "Aarisa" project, roles and PKCE app needs a PAT from an IAM or org owner, or a person doing it in the console. |
