# Sluice — Google Slides Deck (Checkpoint 2)

Paste-ready content for a 12-slide deck. Each slide has: the on-slide text,
a layout hint, which screenshot to use (all in `docs/screenshots/`), and
speaker notes. Suggested theme: dark background (#0B0E14), white headings,
cyan→emerald gradient accent (#22D3EE → #34D399), mono font for numbers.

---

## Slide 1 — Title

**On slide**

> # SLUICE
> ### Payroll that flows, block by block.
> Streaming USDC salaries on Arc — tax splits itself, income becomes a
> liquid asset, and idle escrow earns yield across chains.
>
> Programmable Money Hackathon · DeFi Track · @mrnetwork0001

**Layout**: big wordmark left, `01-landing.png` (hero screenshot) right.
**Notes**: One sentence intro: "Sluice turns a salary from a monthly batch
payment into a programmable, per-second money stream on Arc."

---

## Slide 2 — The problem

**On slide**

> ## Payroll is a batch job from the 1970s
> - Workers deliver value every second — but get paid **every 30 days**
> - Between pay runs, employees are their employer's **unsecured creditors**
> - Tax withholding is manual back-office work, reconciled after the fact
> - Payroll escrow sits **idle** — the largest dead capital pool in any company
> - Future income is real value that workers **cannot access or trade**

**Layout**: text only, one bullet per line, last two in accent color.
**Notes**: The pain is universal: timing mismatch, compliance overhead,
dead capital, illiquid income. Each maps to a Sluice feature.

---

## Slide 3 — The solution

**On slide**

> ## Salary as programmable money
> Employer escrows USDC **once** → salary vests **every second** on Arc
> - **Tax splits itself** — configured bps route to a tax vault on every withdrawal
> - **Income is an asset** — each stream is an ERC-3525 token: split, sell, borrow, insure
> - **Escrow works** — idle payroll routes to cross-chain yield, recalled on demand
> - Built where money is programmable: **Arc L1 — USDC gas, sub-second finality**

**Layout**: `02-dashboard.png` full-bleed right half.
**Notes**: "Everything you're about to see is live and clickable today —
26 passing contract tests, CI green, fully working frontend."

---

## Slide 4 — How it works

**On slide**

> ## Three moves, one contract
> **1. Escrow once** — employer funds a stream: amount, duration, tax bps, tax vault
> **2. Vest per second** — employee holds an ERC-3525 SFT whose value = USDC left to stream
> **3. Withdraw — or automate** — tax routes itself; Swap Kit rules convert each paycheck
>
> `createStream → vest 0.001929 USDC/s → withdrawFromStream`

**Layout**: three numbered columns; `04-stream-detail.png` below (the live
vesting view with claimable ticking).
**Notes**: Point at the rate: "This stream vests 0.001929 USDC per second —
the employee watches their balance grow in real time."

---

## Slide 5 — Income is now a liquid asset (ERC-3525)

**On slide**

> ## Every salary is a semi-fungible token
> - Token **value = remaining streamable USDC** — the stream IS the asset
> - **Split** part of your salary to another address (schedule carries pro-rata)
> - **Merge** same-schedule streams, **transfer** whole streams
> - Standard rails → composable with any protocol that speaks tokens

**Layout**: text left; code-style callout right:
`transferFrom(streamId, to, value) → new stream SFT`.
**Notes**: "This is the primitive everything else is built on. Value
transfers keep vesting math exact — covered by dedicated fork tests."

---

## Slide 6 — Instant liquidity: factoring + advances

**On slide**

> ## Need cash before payday?
> **P2P stream marketplace** — list future income at a discount; an LP pays
> you today and collects the full stream. SFT + payment settle atomically.
> **Salary advances** — borrow up to 50% of unwithdrawn value, zero
> interest, zero liquidations: the advance repays itself as salary vests.

**Layout**: `07-marketplace.png` (shows a live 10%-off listing + upside math).
**Notes**: "A $1,200 stream listed at $1,080 — buyer earns the spread,
seller gets liquidity now. No credit checks, no loan sharks."

---

## Slide 7 — Self-insured salaries

**On slide**

> ## A credit-default pool for payroll
> - Employee pays a **one-time 0.5% premium** → stream is insured
> - Employer cancels early? The **unvested remainder is claimable** from the pool
> - Pool is **underwritten by USDC stakers** who earn every premium (share-based)
> - Live demo pool: **50,000+ USDC** staked

**Layout**: three-step flow diagram (premium in → default event → payout),
numbers in mono accent.
**Notes**: "Insurance turns 'trust your employer' into 'trust the pool' —
and gives LPs a real yield source: premiums."

---

## Slide 8 — Chain-abstracted payroll (CCTP)

**On slide**

> ## Arc settles. Every other chain is an on/off ramp.
> - **Fund from any chain** — one CCTP burn on Base opens a stream on Arc
> - **Withdraw to any chain** — net salary exits via CCTP; tax stays on Arc
> - **Buy a stream from any chain** — burn + hook settles the purchase atomically
> - The word "bridge" appears **nowhere** in the UI

**Layout**: simple two-chain diagram — Base (burn) ⇄ relayer ⇄ Arc
(mint + hook → SluiceGate → Sluice). Use `16-fund-from-base.png` as inset.
**Notes**: "CCTP v2 hooks make the destination chain programmable: the mint
itself opens the stream or executes the buyout. Verified end-to-end on our
twin-chain rig — the messenger mirrors CCTP v2's depositForBurnWithHook, so
pointing at real testnet domains via Circle's Bridge Kit is config, not code."

---

## Slide 9 — Idle escrow earns — everywhere

**On slide**

> ## Cross-chain auto-yield treasury
> - Escrow above a **40% liquidity buffer** sweeps into the treasury
> - Rebalances across venues: **Arc money market (4.2%)** + **Base vault (8.6%)** via CCTP
> - Withdrawal outruns the buffer? Liquidity **auto-recalls mid-transaction**
> - Remote positions come home **with their yield** through a hooked CCTP return

**Layout**: `18-treasury-final.png` — the NAV/venues/activity-feed view.
**Notes**: Walk the activity feed on the screenshot: "Swept 34,215 → split
across two chains → recalled home with yield → redeployed. All on-chain
events, all automated."

---

## Slide 10 — Built on the Circle stack

**On slide**

> ## Native to Arc + Circle
> | | |
> |---|---|
> | **Arc L1** | USDC gas · sub-second finality · chain 5042002 |
> | **CCTP v2 pattern** | burn/mint + hooks for every cross-chain flow |
> | **Swap Kit** | per-paycheck auto-conversion (e.g. 20% → EURC) |
> | **App Kit / Bridge Kit** | integrated in the frontend, testnet-ready |
> | **ERC-3525** | semi-fungible salary streams |

**Layout**: logo row / table; `06-automation-history.png` small inset for
the Swap Kit trigger history.
**Notes**: "We use Circle's newest primitives as the product's spine, not
as a checkbox."

---

## Slide 11 — Status: it works today

**On slide**

> ## Not a mockup
> - ✅ **26/26 Foundry tests** — vesting math, SFT splits, marketplace, insurance, full cross-chain stack
> - ✅ **CI green** on every commit
> - ✅ **Full frontend** — dashboard, stream detail, marketplace, treasury, automation
> - ✅ **Every flow driven end-to-end in a real browser** — including a 0.25 USDC withdrawal arriving on Base as exactly 0.23 net of tax
> - ✅ One-command demo: `./dev.sh` (twin chains + relayer + app)

**Layout**: checklist left, collage of 2–3 screenshots right
(`05-withdraw-trigger.png`, `15-bought-from-base.png`).
**Notes**: "Everything in this deck is reproducible from the repo in one
command."

---

## Slide 12 — Roadmap & ask

**On slide**

> ## Next
> - **Arc testnet deployment** — script ready, USDC-gas native
> - **Real CCTP domains** via Circle Bridge Kit + Gateway unified balances
> - **sluiceapp.xyz** — public launch
> - Employer dashboards, payroll batches, fiat off-ramp partners
>
> ### github.com/mrnetwork0001/Sluice
> **Open the sluice.**

**Layout**: roadmap timeline; repo link large; end on the gradient wordmark.
**Notes**: Close: "Payroll is the largest recurring money flow on earth.
Making it programmable is what this chain was built for."

---

## Build checklist (15–20 min)

1. Google Slides → new deck → theme: dark (#0B0E14 background, white text).
2. Paste each slide's text; put numbers/code in a mono font (Roboto Mono).
3. Drag screenshots in from `docs/screenshots/` per the layout hints.
4. Accent color for bold claims: #22D3EE or #34D399.
5. Share → "Anyone with the link — Viewer" → copy link for the form.
