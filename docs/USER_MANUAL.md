# Safetec Core — User Manual

A working guide to what the system does, the vocabulary it uses, and the rules it
deliberately follows. Written so that someone reporting an issue can describe it in
terms the system (and whoever fixes it) will recognise.

> **If you are feeding this to an AI assistant to help write tickets:** the two most
> valuable sections are [Business rules that look like bugs](#8-business-rules-that-look-like-bugs)
> — so you don't report deliberate behaviour as broken — and
> [Writing a useful ticket](#10-writing-a-useful-ticket).

---

## 1. What the system is

Safetec Core is a bespoke business management system for a South African
transport/logistics group. One application serves several separate trading companies,
covering the full operational and financial cycle:

- Customer invoicing (invoices, quotes, purchase orders) and customer statements
- Supplier invoices and monthly supplier statements
- Fleet and driver registers
- Load capture (trucks hauling for mines)
- Diesel consumption, rates and reconciliation
- Driver payroll — permanent and casual
- Subcontractor costing
- Cash-flow budgets
- Financial reporting, including SARS VAT detail and per-truck profit sheets

It is a web application: a browser front-end talking to an API, with the data in one
shared database.

---

## 2. The business entities

Nearly every record in the system belongs to **one entity**. The entity switcher in the
header changes which company you are looking at, and re-brands the whole interface to
that company's colour and logo. Admins additionally get an "All Entities" view.

| Code | Company | Notes |
|------|---------|-------|
| BTP | Border Tradepost | No trucks — Fleet, Drivers, Truck Loads and Diesel are hidden |
| OBHI | Obhi | Trucking. Personal Vehicles tab hidden |
| SFT | Safetec | Trucking. Has extras others don't: budget profit cards, Additional Load Rates, per-truck Profit Sheet |
| TP | Thembis People | No trucks, like BTP |
| BKMO | Bokamosho | Trucking. Has the "rate-pending" diesel slip workflow |
| SP | Summerpalace | Trucking |
| REAMA | Re Ama | A subcontractor given a restricted Loads + Diesel view of their own |

**Why this matters for tickets:** always say which entity. The same screen behaves
differently per entity, and "the invoice number is wrong" has a different answer for BTP
than for Safetec.

---

## 3. Who can see and do what

Access is granted in three layers:

1. **Role** — `admin` sees and does everything. `standard` is the base role.
2. **Entity access** — a non-admin only sees the entities they've been granted.
3. **Module permissions** — per entity, a user is granted specific modules
   (suppliers, invoices, fleet, drivers, truck loads, diesel, budgets) plus
   create / edit / delete flags.

Two things that surprise people:

- **Budgets is never granted by default.** A new user will not see it even if they can
  see everything else. This is deliberate.
- New users default to **suppliers + invoices only**.

If someone reports "I can't see X", the first question is which entity and which modules
they've been granted (Admin → Users → Permissions tab).

---

## 4. Two concepts that explain most confusion

### 4.1 Statement period vs. calendar date

A transaction has a **date** (when it happened) and a **statement period** (the supplier
statement month it is settled in). These are often different, and **which one a screen
uses is deliberate, not arbitrary**.

| Uses the **statement period** | Uses the **raw date** |
|---|---|
| Subcontractor costing | Payroll and trip-log views |
| Diesel period totals | SARS VAT detail |
| Split-load driver credit | Income vs Expenses report |
| Subcontractor Loads report | |

So a fill-up dated 28 July can legitimately appear in August's costing while showing a
July date on the Diesel Log. That is not a bug. A statement period can also be
deliberately moved (see *Manage → Move* under Supplier Profile).

### 4.2 Locking — five separate mechanisms

Financial records get locked, and a locked record is read-only **on the server**, not
just hidden in the interface. There are five independent locks:

| Lock | Covers | Who unlocks |
|---|---|---|
| **3-step verification** | Individual values and records, across supplier invoices, diesel, loads, driver pay items, budget values | Admin, on the record. Bulk unlock only clears locks that same admin placed |
| **Costing "Sent"** | One subcontractor's costing sheet for one truck for one month | Admin, un-send on the costing sheet |
| **Diesel invoice lock** | All fill-ups on one supplier invoice | Per invoice (or bulk) on the Diesel page |
| **Profit Sheet final lock** | An entity + month, across every truck in it | Admin, Reports → Profit Sheet |
| **Budget lock** | One budget (entity + month) | Admin, Budgets page |

**The 3-step verification flow:** step 1, any user ticks a value as verified. Step 2, a
second user approves it. Step 3, an admin applies the *final lock* — the record becomes
read-only. Locked values render **amber**. Note that ticks alone do not lock anything;
only the admin's final lock does.

**If a save is refused**, the usual cause is one of these five locks — worth checking
before reporting it as an error. The Profit Sheet lock in particular shows a full-screen
blocking message and can be triggered by capture work that seems unrelated (a load, a
food payment, a diesel entry) because it covers every truck in that entity-month.

---

## 5. Module guide

### 5.1 Dashboard

Landing page with a month/year selector. Stat cards summarise invoicing, supplier
payables, diesel warnings and profit/loss. **Each card opens a drill-down** listing the
exact rows behind the total — use this when a figure looks wrong, since it shows you
what the total is actually made of.

Admins also see a "pending invoices" badge: supplier invoices recently created but not
yet final-locked.

The payables view encodes the **30-day payment terms rule** — a July statement is
payable 7 September.

### 5.2 Suppliers and the Supplier Profile

**Suppliers** is a searchable, entity-filtered register — create, bulk create, edit,
archive (soft), permanently delete (requires typing DELETE), export.

**Supplier Profile** is the largest working screen in the system: a per-supplier ledger
grouped by statement month, containing:

- Supplier invoices, with **inline line-item editing** — click the invoice number to
  open edit mode, then Save
- Document attachments per invoice
- 3-step verification on amounts
- A per-month statement header: statement note, statement document upload, "mark
  statement paid"
- **Manage → Move**: reassigns an invoice's costing / SARS-report / listing period.
  A "Moved" badge appears when a period has been pinned away from its natural one
- Excel import of supplier invoices, diesel-rate aware for diesel suppliers

### 5.3 Customers

The parties you invoice — name, trading name, contacts, VAT and registration numbers,
address. CRUD with archive and permanent delete.

A useful distinction: **customers are who you invoice; suppliers are who you buy from.**

### 5.4 Invoices, Quotes and Purchase Orders

These are three renderings of one underlying implementation, so they behave identically.

**List page:** month / entity / status filters, bulk PDF download (as a ZIP or one
merged PDF), status changes, export. Also Tradekor PO import (from Excel) and Split PO
(upload one combined PO PDF, get back a ZIP of one PDF per order).

**Form:** typed line rows (item / header / note / spacer), VAT-exempt per line,
loading and offloading numbers, automatic next document number, inline customer
creation.

**Detail:** status override (draft, ready, sent, accepted, paid, overdue, cancelled),
mark-paid modal (date + reference), themed PDF download, email send.

**Numbering is per-entity**, and the format differs:

- BTP and BKMO are **unpadded** — e.g. `BTP739`
- Other entities are **5-digit padded** — e.g. `OBHI03667`

Typing a custom number does **not** advance the counter, so a manually typed number must
match the real format or the next suggested number will collide.

**Status notes:** there is no "unpaid" status. Reverting from paid goes to sent or
overdue and clears the paid date and reference. Content edits stay locked while an
invoice is marked paid.

### 5.5 Invoice Templates and Statements

**Templates** are reusable line-item documents per entity and document type, with
clone-to-new-invoice.

**Statements** are customer statements built by picking invoices, adding payments and
credits, with a date-range helper and live totals, exported as a branded PDF or Excel
file on the company letterhead.

### 5.6 Fleet

The vehicle register, in two tabs: **Fleet Trucks** and **Personal Vehicles** (hidden
for OBHI). Status badges (active / inactive / maintenance; sold / written-off for
personal vehicles), make and finance-institution pick lists, and **licence-expiry alerts**
with a 365-day look-ahead that can be acknowledged. Trailers are managed here too.

### 5.7 Subcontractors and Costing

A register of subcontractors, and on each profile a monthly **Costing sheet per truck**:
expenses (invoiced or general), income rows, notes, a net override, per-value
verification, the **Sent** flag (which locks it), and PDF/Excel export. "Include supplier
invoices" exports a ZIP bundling the costing with the supplier-invoice attachments shown
in it.

Rules worth knowing:

- General expenses can be marked **fixed** (recurring) — they carry forward monthly.
  To stop the series, archive the latest month's copy; a modal offers "stop from this
  month" versus "remove everywhere".
- Once a costing is marked Sent, expenses captured afterwards **roll forward into the
  next open month** rather than being lost, and the sent month does not change.
- Costing uses the **statement period**, which is what makes it reconcile with the
  Subcontractor Loads report.

### 5.8 Drivers and Payroll

**Drivers** is a register with permanent and casual badges. A driver's detail page shows
one monthly **pay cycle**: trip logs, additional loads, food payments (each individually
verifiable), mine grouping, and a payslip PDF download.

Pay is calculated from Bargaining Council (NBCRFLI) rules for permanent drivers and
per-load rates for casuals. Salary, incentive and subsistence rates come from payroll
mine groups; per-driver overrides are versioned.

Things that regularly cause questions:

- **Statutory deductions are fixed rand amounts** per pay cycle, and are only applied
  when there is a basic salary.
- **Casual CTC includes the food allowance, but wages exclude it** — `CTC = gross + food`
  and `wages = gross − food`. Food must never appear as an earnings line; that would
  change net pay.
- **Mine Bonus** (historically "Assmang bonus") is R150 per load, for Group-A mines only
  — Assmang, Mokala, Tawana, Sebilo. The interface says "Mine Bonus"; older database
  columns still say `assmang`.
- **Split loads count as 0.5 per driver.** Driver-facing load counts fold splits in, so
  a driver may correctly show 6.5 loads.
- Casual drivers can be assigned to several trucks, and food payments are attributed to
  one specific truck so they don't duplicate across every linked truck.

### 5.9 Truck Loads and the Truck Profile

**Truck Loads** is a fleet-wide monthly summary per entity, with diesel invoice
reconciliation and a "Truck Totals" PDF export. Clicking a row opens the **Truck
Profile** — one truck, one month — with tabs:

- **Loads** — capture (mine, date, tonnes, rates), bulk create, split a load across two
  drivers, archive/delete. There are two rates: the **invoiced** rate and the
  **paid-out** rate.
- **Diesel** — that truck's fill-ups, plus an import modal
- **Food Allowance** — food payments
- **Profit Sheet** — Safetec only, a per-truck P&L

Plus truck washes, monthly expenses and additional-load rates.

**Mine rates are date-aware.** The rate applied to a load is resolved by the load's date
against that mine's rate history. Posting a new rate **re-rates unpaid slips** dated on
or after its effective date — so a new rate can change figures you already looked at.

### 5.10 Diesel

The Diesel Log is a capture grid of fill-ups by month, entity and supplier, with import,
verification, per-invoice locking, and archive/delete.

Key concepts:

- **Fill-up vs top-up** — this is fixed *per supplier*, not chosen per transaction.
  Merino and Oukop are top-up; everyone else is fill-up. There is deliberately no toggle.
- **Rates** are versioned per supplier and entity with effective date ranges. The current
  open rate has no end date.
- **Admin fee** — 1% per entity, configured in diesel settings.
- **Two different slip fields**: `Slip #` (the depot slip, authoritative) and `Trans ID`
  (the supplier's transaction id). Both are shown because one supplier historically
  conflated them.
- **Rate-pending slips (BKMO)** — a slip can be logged before the rate per litre is
  known. The supplier-invoice import later fills in the rate by matching truck + slip,
  falling back to litres + date.
- **Diesel supplier invoices automatically create fill-ups**, and sync diesel figures
  onto the matching truck load.
- Fill-ups created from an invoice line that had no slip number typed in are flagged
  **"No slip"** on the log.

### 5.11 Budgets

A per-entity monthly cash-flow budget. Requires the budgets module permission, which is
not granted by default.

Structure: budget → sections → lines → values, with a rolling 3-month "TO PAY / PAID"
column window.

- **Pull from system** per section auto-fills lines from supplier invoices,
  subcontractor nets and payroll. **Hand-typed figures are protected** from being
  overwritten.
- **Income is chosen, not pulled** — a modal lists candidates (one per PO, plus invoices
  without a PO) and you assign each to one of two income lines: "Tradekor income only"
  or "Other income".
- **CASH FLOW TOTAL** auto-sums; typing a value pins it, blanking it recalculates.
- **Replicate** carries a budget into the next month, with an optional "match exactly"
  prune shown behind a preview first. Section deletes can be restored.
- Locking and branded PDF/Excel export.

### 5.12 Reports and the Profit Sheet

Seven tabs:

| Tab | What it shows |
|---|---|
| **Income vs Expenses** | Income from customer invoices; expenses from supplier invoices grouped by invoice date |
| **Profit Sheet** | Per-truck monthly P&L. Every cell is editable as an override (blank = calculated). "Average P/L" is per load. Saveable, with an admin final lock |
| **Subcontractor Loads** | Subcontractor → truck → loads, invoiced versus payout |
| **Invoiced PO vs Loads** | Reconciliation joined on **slip number** |
| **Diesel — by Truck / by Supplier / Annual** | Diesel consumption views |

Also here: SARS VAT detail (monthly and annual), report row exclusions, and export.

**Profit Sheet carry-forward:** opening a fresh month duplicates the previous month's
entire expense list, with diesel, wages and income left blank. This is deliberate.

### 5.13 Settings and Administration

- **Settings** — VAT rate, user roles, per-entity billing numbering (with a live "next
  number" preview), fleet licence warning days, diesel maintenance tools
- **Mines** — the mine register plus per-mine rate history with effective dates
- **Payroll Rates** — mine groups (base salary, incentive and subsistence per load) and
  the fixed statutory deduction amounts
- **Diesel Rates** — per-supplier rates, per-entity admin fee, and (Safetec only)
  Additional Load Rates
- **Entities** (admin) — general details, banking, branding (colour, logo, letterhead —
  these appear on PDFs), invoice numbering
- **Users** (admin) — details, password, and the per-entity module permissions
- **Audit Log** (admin) — a paginated trail with month, entity and search filters, plus
  CSV export

---

## 6. Where documents and figures come from

Useful when something "looks wrong on the PDF":

- **Invoices, statements, costing sheets, budgets, payslips and the fleet summary** are
  generated **on the server**, using the entity's letterhead and branding. What you see
  in the browser and what lands in the PDF come from the same figures, but the layout is
  built server-side.
- **Table exports** (the Export button on list screens) are generated **in the browser**
  from what is currently on screen, so they follow your current filters.

If a PDF disagrees with the screen, say which of the two you mean — they are different
code paths.

---

## 7. Money, dates and rounding

- Currency displays as `R` followed by the amount, with a non-breaking space so the R
  never wraps away from the number in narrow columns.
- Dates display as `dd MMM yyyy`; date inputs show `dd/mm/yyyy`.
- **The Diesel Log and line-item views round litres to one decimal for display.** A
  transaction captured as `278.46 L` shows as `278.5L`. The stored value is the precise
  one — so a small discrepancy between what you see and what you were told is usually
  display rounding, not a data error.
- "CTC (plus VAT)" figures on driver exports are multiplied by 1.15 at export time only
  and are never stored.

---

## 8. Business rules that look like bugs

**Please check this list before reporting any of these.** They are all deliberate, and
several have been "fixed" by mistake before.

| Behaviour | Why it is correct |
|---|---|
| The Safetec budget profit summary deducts **Personal Expenses twice** | A business requirement. Do not change it |
| A driver shows a **fractional load count** (e.g. 6.5) | Split loads count 0.5 per driver |
| **Casual food allowance** is in CTC but not in earnings | `CTC = gross + food`, `wages = gross − food`. Making food an earnings line would change net pay |
| A fill-up's **costing month differs from its date** | Costing uses the statement period, not the raw date |
| Posting a new mine rate **changed figures on existing loads** | Mine rates are date-aware and retro-apply to unpaid slips from the effective date |
| Expenses captured after a costing was marked Sent **appear in the next month** | Deliberate roll-forward. They are not lost, and the sent month stays closed |
| A fresh Profit Sheet month **already has last month's expense lines** | Deliberate carry-forward |
| Diesel **admin fee VAT is claimed for one supplier but not others** | For Intsimbi the fee is genuinely billed, so its VAT is real input VAT. For everyone else the 1% is an internal markup and its VAT must not be claimed |
| **No "unpaid" status** on an invoice | Reverting from paid goes to sent or overdue |
| The same **diesel litres show rounded** in one place and precise in another | Display rounding to one decimal |

---

## 9. Glossary

| Term | Meaning |
|---|---|
| **Statement period** | The supplier-statement month a transaction is settled in. May differ from its calendar date, and can be deliberately moved |
| **Fill-up / top-up** | Diesel transaction types, fixed per supplier |
| **Slip # vs Trans ID** | The depot slip number (authoritative) versus the supplier's own transaction id |
| **No slip** | A diesel entry created from an invoice line where no slip number was typed in |
| **Split load** | One load shared by two drivers, 0.5 credit each |
| **Pay cycle** | A driver's monthly payroll container — trip logs, additional loads, food payments, overrides |
| **CTC** | Cost to company. For casuals, gross + food allowance |
| **Mine Bonus** | R150 per load for Group-A mines. Older data calls it the Assmang bonus |
| **Costing** | The monthly subcontractor settlement sheet — income versus expenses per truck |
| **Final lock / verified3** | Step 3 of verification: an admin lock making a record read-only |
| **Placeholder invoice** | An auto-created pending supplier invoice for a diesel slip awaiting the real invoice |
| **Rate-pending** | A diesel slip logged before its rate per litre is known |
| **POH number** | A Tradekor purchase-order reference |
| **NBCRFLI** | National Bargaining Council for the Road Freight and Logistics Industry — the source of permanent drivers' statutory deductions |
| **Entity** | One of the trading companies. Almost every record belongs to exactly one |

---

## 10. Writing a useful ticket

The system is multi-tenant, period-based and lock-heavy, so the same words can describe
very different situations. A ticket that includes the following can usually be
investigated without a follow-up conversation:

**Always:**

1. **Which entity** — Safetec, OBHI, BTP, Thembis, Bokamosho, Summerpalace, Re Ama
2. **Which screen**, by its name in the sidebar
3. **The period** — which month and year you were looking at
4. **What you expected, and what you saw instead**

**Then whichever identifiers apply** — these are what makes a record findable:

- Invoice number (e.g. `INV-01512-K`, `OBHI03667`)
- Vehicle registration (e.g. `KRW188EC`)
- Supplier or customer name
- Driver name or employee number
- Mine name
- Slip number or Trans ID, for anything diesel
- The exact figure in question, and where you got the correct one from

**Especially helpful:**

- A screenshot, including the filter bar at the top of the screen — filters explain a
  surprising share of "missing data" reports
- Whether the record is **locked or verified** (amber values, a padlock, a blocking
  message on save)
- Whether it **used to be right** and changed, or has never been right
- Whether it affects **one record or all of them** — one truck or the whole fleet, one
  invoice or every invoice

**A good example:**

> **Entity:** Safetec · **Screen:** Supplier Profile → Kopani Logistics · **Period:** September 2026
>
> Invoice `INV-01512-K` has 19 diesel lines, but only 15 appear on the Diesel Log.
> Missing: KRW188EC 278.5 L (11 Sep), KNS946EC 313.2 L (12 Sep), KDZ484EC 875.2 L,
> KSZ397EC 763.1 L. Each of those four trucks appears **twice** on the invoice, and the
> second entry is the one missing in every case — none of the lines have slip numbers.
> Expected all 19 to appear. Screenshot of the expanded invoice attached.

That ticket names the entity, screen and period, gives the invoice number and the exact
registrations and litres, and — most valuably — states the **pattern** rather than just
one example. The pattern is usually what identifies the cause.
