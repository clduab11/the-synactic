# Where the money is

**Commercial use cases for the-synactic — financial intelligence, OSINT, and the
context layer underneath agentic systems.**

Praxen Development & Engineering · Advanced Research Division

Every figure below carries a source. Where a number could not be verified it is
marked as such and not used. Market-size estimates are given as ranges with the
research firm named, because they disagree by up to 9x — see *What we don't know*.

* * *

## The thesis in one paragraph

Agentic systems do not fail because the model reasons badly. They fail because
the context lied and nothing in the pipeline said so. A number arrives with no
provenance, a zero means "absent" instead of "measured zero", a field name
promises a measurement the payload cannot support — and the model, working
exactly as designed, produces a confident answer built on it. The scarce good is
not more data. It is **context that refuses to lie**, delivered in a shape an
agent can consume.

## This is measurable, and the measurements are bad

| Benchmark | Result |
|---|---|
| FinanceBench ([arXiv:2311.11944](https://arxiv.org/abs/2311.11944)) | GPT-4-Turbo with retrieval **incorrectly answered or refused 81%** of questions |
| Finance Agent Benchmark ([arXiv:2508.00828](https://arxiv.org/abs/2508.00828)) | Best model **46.8% accuracy at $3.79/query** — fully tooled, with EDGAR access |
| BigFinanceBench ([arXiv:2606.03829](https://arxiv.org/abs/2606.03829)) | Frontier models **35–45%**; rubric scores ~17 points *higher* than accuracy |
| FinGround ([arXiv:2604.23588](https://arxiv.org/abs/2604.23588)) | Standard retrieval hallucinates at 18.6%; **computational claims at 28.4%** — the worst of six categories |

And in production, the failures were provenance failures, not reasoning
failures. **Bloomberg corrected at least 36 AI-generated article summaries**
between January and March 2025 — the firm with the best proprietary financial
corpus on earth could not reliably auto-summarize its own articles. **Deloitte
Australia refunded** part of a A$440,000 government report containing a
fabricated court quote. **EY retracted a report** after ~70% of its citations
were found fabricated or broken.

Nobody got embarrassed because a model reasoned badly. They got embarrassed
because it cited a source that did not exist.

The two most sophisticated buy-side deployments reached the same conclusion
independently: Balyasny runs a **dual-LLM checker** before its research agent
releases a dossier, and Man Group's PM on AlphaGPT says *"I wouldn't call it
autopilot, because we have a lot of checkpoints in place."* Both built
verification layers because raw agent output wasn't trustable.

## Six ways context lies, all six found here, all six fixed

Not hypothetical. In a single engineering session against this codebase, six
distinct instances were found, measured and corrected. Each would have produced a
confident wrong answer in an agent, and **not one raised an error**.

| What the payload said | What was true |
|---|---|
| `available: false` shipped alongside `winRate: 0`, `directionAccuracy: 0` | There was no backtest at all. A consumer not checking `available` reads 0% as a measurement. |
| Country risk `combinedScore: 70` with a four-component breakdown | All four components were `0`. The 70 was a conflict-database floor wearing the costume of a measurement. |
| Prediction-market `volume` in one column across two venues | One venue reports event-level volume beside a *child* market's price; the other reports that contract's own. |
| A venue `liquidity_dollars` field ready to map into a shared key | `0.0000` on 149 of 149 markets. Mapping it would have published "zero liquidity" for every record on that venue. |
| "Backtest unavailable for this symbol" | The upstream was returning HTTP 429 to our own User-Agent. No fallback existed, so a rate limit became a silent, permanent "no data". |
| A market-data tool call returning a helpful envelope | 267,646 bytes against a 131,072-byte budget. The naive first call any agent makes returns a hint instead of data. |

**Every one is now labelled, fixed, or disclosed in the payload.** That discipline
is the product.

## What the market pays

Almost nobody in the enterprise tier publishes prices — but UK G-Cloud legally
requires suppliers to, which surfaces SKU-level figures that exist nowhere else.

**Recorded Future prices Geopolitical Intelligence identically to its flagship
Threat Intelligence module** — [£67,500/yr for 2 users, £135,000 for 5, £405,000
for 30](https://assets.applytosupply.digitalmarketplace.service.gov.uk/g-cloud-14/documents/718412/609101270005042-pricing-document-2024-05-02-1457.pdf)
(G-Cloud 14, May 2024). Their own pricing page says only "contact us." Flashpoint
lists at [$19,600 per Ignite seat](https://assets.applytosupply.digitalmarketplace.service.gov.uk/g-cloud-14/documents/708941/328519522033699-pricing-document-2024-05-03-0935.pdf),
roughly 3–5x cheaper. Dataminr's US Air Force contract is
[$298.8m over five years](https://api.usaspending.gov/api/v2/awards/CONT_AWD_FA701421C0024_9700_-NONE-_-NONE-/);
its per-seat price is redacted even in procurement records.

At the terminal tier: Bloomberg **$31,980/yr** per seat, corroborated by a UK
government contract at £20,469.50/seat-yr. FactSet's realised revenue per
professional is **$9,783** — derived from its own FY2025 10-K (237,324
professionals, $2.32bn revenue) — roughly a third of Bloomberg's list.

**The spread is the finding.** Recorded Future's geopolitical entry is ~$85k/yr.
GDELT Cloud gives MCP tool access away at **$0** on its free tier. Between those
poles sit Koyfin at $39/mo and RANE WorldView at under $8/week — and the
$50–500/month band in geopolitical intelligence is close to empty. That is either
an open lane or evidence that buyers don't exist there. We don't know which, and
the document should not pretend otherwise.

**Redistribution is the actual commercial variable**, not volume. The jump from
"internal use" to "display to your users" is 2.2x at Intrinio ($150→$333), 8.8x
at Databento ($199→$1,750), 12.5x at Massive ($199→$2,499). **Four of nine
developer data vendors won't sell redistribution rights at any published price.**
This instrument already prices that lever — API Starter at $99.99 excludes
customer redistribution, API Business at $299.99 includes it.

## Where the money is, specifically

### 1. Context-as-a-service for agentic trading systems

A downstream trading system holds the exchange accounts, the licensed feeds and
the execution path. It has prices. What it lacks is *why the price is moving* —
the sanctions action, the chokepoint disruption, the posture change.

We supply that causal layer over MCP, keyed to instruments, with provenance and
freshness on every record. **The licences stay where the accounts are**, and the
intelligence arrives as context rather than as a competing price feed. Buyers:
systematic and discretionary funds, commodity desks, family offices. Reference
point: alt-data buyers average **~$1.6m/yr across ~20 vendors**, large
multi-strats **$5m/yr across 43** (Neudata).

### 2. Event-conditioned base rates

The capability a charting tool categorically cannot offer. Not "what is the RSI"
but *"how has this instrument behaved in the five days after a sanctions
designation — and how many times has that happened?"*

It needs no venue market data: price history plus our own event history
suffices. It converts an intuition every macro trader has into a measured base
rate with a sample size attached, and because the event history carries
provenance the answer is auditable rather than asserted.

### 3. Provenance-grade research support

For anyone who must show their work, the audit trail *is* the deliverable. FINRA's
2026 Annual Regulatory Oversight Report effectively specifies the product:
*"storing prompt and output logs for accountability… tracking which model version
was used and when; and validation and human-in-the-loop review"* — and names
**stale data** as a supervisory risk, asking firms to examine *"data provenance."*

The SEC is enforcing the adjacent failure: **Delphia ($225,000) and Global
Predictions ($175,000)** for AI-washing in March 2024.

### 4. Supply-chain and commodity exposure

Chokepoints, maritime disruption, sanctions programs, energy flows and tariff
movement mapped to corridors and counterparties. No published pricing exists for
Everstream, Interos, Kharon or Sayari — an opaque segment, which cuts both ways.

### 5. Parametric and exposure underwriting

Climate, conflict, infrastructure and radiation signals with the timestamp
discipline a parametric trigger requires. **"More than two-thirds of
multinationals now use political risk management tools"**, and political-risk
modelling saw the largest increase of any risk framework
([Howden Re, Jan 2026](https://www.howdenre.com/news-insights/political-violence-srcc-and-geopolitical-risk-howden-res-view-11-renewals)).
The value here is precisely the honesty: a trigger fed by a fabricated zero is a
paid claim or a missed one.

### 6. The open lane

Incumbents got to "trustworthy context for agents" first — FactSet shipped an MCP
server in December 2025 (beta with 45 firms, 800+ users), S&P Global/Kensho and
LSEG followed, and Daloopa hyperlinks every number to its source document.

**But every one of them sells reference, fundamentals or filings data. Nobody is
selling verified, citable, machine-readable geopolitical *event* context to
agents** — nobody is doing for events what Daloopa does for fundamentals. That is
the gap, and it is the one this instrument was already built for.

## The narrow lanes

The six above are the categories. Money is not made in categories — it is made
in lanes narrow enough that the incumbent's product manager cannot justify the
roadmap slot. Each of these maps to capability already in the instrument, names
a buyer who already writes cheques for a worse version, and states the thing
only provenance makes possible.

### Hail-fraud defence, per-parcel, per-date

NOAA SWDI hail-swath and NX3TVS tornado records plus NCEI hourly observations,
queried at a lat/lon and a date. The claim is not "was there weather" — it is
*"was there hail at this roof on 14 March, and how large."*

Property insurers lose real money to roofing contractors who canvass a
storm-adjacent postcode and file for parcels the swath never touched. Denials
need defensible evidence, and the incumbent products certify weather reports
one address at a time at retail prices. The instrument answers it as a tool call
with the source, the station, and the observation window attached — which is
exactly the shape an adjuster's file and an appraisal-clause dispute both need.

Buyer: property carriers, TPAs, defence-side construction counsel.

### Charter-party force majeure, adjudicated on the transit record

Chokepoint status and vessel-traffic history against a specific date and route.
When an owner declares force majeure and a charterer disputes it, the argument
is *whether the passage was actually impassable* — and it is argued in London
and Singapore arbitration on evidence assembled after the fact.

An event history with per-record provenance and freshness state is a
contemporaneous transit record rather than a reconstruction. The capability that
matters is the one nobody sells: not "is the strait open now" but "what did the
transit picture look like on the day, and what is the source."

Buyer: shipowners, charterers, P&I clubs, maritime arbitration practices.

### GPS-spoofing exposure for lessors, not pilots

`gpsjam` interference geography joined to NOTAM closures and airspace state. The
safety conversation is well covered. The *asset* conversation is not: an aircraft
lessor needs to know whether its airframe is being flown through persistent
spoofing corridors, because it bears on hull-war placement, maintenance
reserves, and lease-covenant argument at redelivery.

Nobody is selling interference exposure keyed to a tail number's routing. The
data is public; the join is the product.

Buyer: lessors, hull-war underwriters, aviation insurance brokers.

### SRCC triggers for multi-site retail

Strikes, riots and civil commotion cover is priced on unrest that is dense,
local, and short. Unrest-event streams plus the composite index give a trigger
with a defensible timestamp — and the honesty discipline is load-bearing here in
a way it is not elsewhere, because **a parametric trigger fed by a fabricated
zero is a paid claim or a missed one**, and the difference between "no unrest"
and "no data about unrest" is the entire product.

Buyer: SRCC underwriters, multi-site hospitality and retail risk managers.

### Event-contract mispricing against a measured base rate

The instrument carries prediction-market state *and* its own event history. That
combination answers a question neither carries alone: **where does the crowd's
implied probability disagree with the measured base rate for that event class,
and on what sample size.**

This is not a signal to trade on — the instrument does not trade, permanently.
It is a research surface for whoever does, and it is only credible because the
base rate is auditable back to dated events rather than asserted.

Buyer: event-contract desks, research shops covering them.

### Pre-positioning for humanitarian logistics

Displacement statistics against conflict events and climate anomalies, with
federal procurement notices as the buying channel in the same instrument. The
narrow version is not "forecast a crisis" — it is *"which corridor's inventory
should move this month, and what is the evidence I show the funder."*

Grant-funded logistics lives and dies on justifying spend before the need is
visible. An auditable evidence trail is not a nicety there; it is the reporting
requirement.

Buyer: NGO logistics, humanitarian procurement, donor-reporting teams.

### Cloud-concentration accumulation for cyber underwriters

Service-status monitoring across major SaaS and infrastructure providers, joined
to company-headquarters geography and cyber threat feeds. Cyber's unsolved
problem is accumulation: **if one provider goes down, which insureds go down
with it** — and the answer is a dependency map nobody maintains honestly.

The instrument already watches those status pages as first-class OSINT. Turning
that into an accumulation view is a join, not a new collection programme.

Buyer: cyber underwriters, reinsurance cat modellers.

### Dual-use export-control screening on the commodity graph

Commodity geography, supply-chain stress, tariff movement and sanctions
programmes against a bill of materials. The compliance question is narrow and
expensive to answer: *does this shipment touch a controlled corridor or a
designated counterparty, and can I show the check was run on dated evidence.*

Provenance is the deliverable, not the data. An export-control file that cannot
say when it knew something is not a defence.

Buyer: dual-use exporters, trade-finance compliance, customs brokerage.

### Duty-of-care files that survive a deposition

Travel advisories, conflict events and country risk, captured with the date and
the source at decision time rather than reconstructed afterwards. When an
employee is harmed abroad, the question is not whether the company had a policy
— it is what it knew, and when.

The commodity is not the risk score. It is the dated, sourced record that the
score was computed from, held in a form that survives being asked "how did you
know that on the ninth."

Buyer: corporate security, D&O and duty-of-care counsel, travel risk managers.

---

Note what these have in common. Not one is "we have more data." Every one is a
**join across two feeds nobody bothers to join**, sold to a buyer who is already
paying for the worse half — and every one is only sellable because the numbers
carry their provenance. That is the thesis at the top of this document, applied
until it gets specific enough to invoice.

## The regulatory turn that lands directly on this

Between February 2025 and July 2026, four venues moved from silence to express AI
terms — and one of them **names MCP by name**.

**Cboe** made AI use a fee-liable licence category effective 1 July 2026. Its
enumerated non-display list includes *"Facilitating transmission of Cboe Data
into Large Language Models through API or **MCP**."* SEC filing SR-CBOE-2026-040
amended the rule text on the record to catch *"any method of accessing, **or
facilitating access to**, a Market Data product… for a purpose that is **not
solely** in support of display for a natural person"* — language drafted to
capture a party who pipes data toward a model without operating it. That is the
shape of an MCP relay.

**CME** went the other way: a flat prohibition on the public-website tier against
*"any machine learning (ML), artificial intelligence (AI) or large language model
(LLM) purposes,"* explicitly including *"inclusion in any vector database, index,
or knowledge base used for retrieval-augmented generation (RAG)."*

**And the economics of machine consumption are brutal.** NYSE charges **$78/month
per professional human** and **$22,400/month per non-display category** — one
machine costs roughly what 287 professionals cost, and analytics counts as
non-display, not display.

The strategic consequence is not "avoid this." It is that **the boundary
discipline already in this repo is the moat**: every venue individually
authorized in writing, recorded before a line of code reads it. Firms that wired
first and read the terms later are about to find out what Category 4 costs.

## What we will not sell

Stated plainly, because the constraints are the credibility:

- **No execution.** The instrument will never place an order, execute a trade, or
  move money. Permanent, and in the charter.
- **No personalized investment advice.** Base rates and context, not
  recommendations. This is also a legal perimeter: the publisher's exclusion
  under *Lowe v. SEC* requires advice be general, impersonal and **not timed to
  specific market activity** — and SEC staff have said directly that making
  recommendations *"only in response to specific market activity… could place
  your activities outside the publisher's exclusion."* An event-triggered feed is
  by construction timed to events, so the product must stay on the context side
  of that line.
- **No relicensed venue data.** Where venue data is carried it is read-only and
  individually authorized, with the authorization recorded before any code reads
  it. Data we are not licensed to redistribute, we do not redistribute —
  including to ourselves.
- **No fabricated confidence.** If a figure cannot be substantiated it is absent,
  and its absence is declared.

## What we don't know

- **Whether the $50–500/month geopolitical tier has buyers.** The gap is real;
  emptiness may be absent demand rather than an open lane. No data either way.
- **Whether MCP monetization is a business or a feature.** The evidence leans
  feature: MCP is free almost everywhere, the spec has no payments primitive
  (SEP-2007 is still Draft), both major directories prohibit in-surface
  monetization, and per-call infrastructure runs ~$0.005 per 1,000. Against that,
  GDELT and Quiver both price MCP access today.
- **Whether Skills displace MCP.** A live threat to any MCP-first bet.
- **Market sizes are unreliable.** OSINT 2026 estimates range $15.9–23bn across
  four firms; alternative data ranges 9x depending on whether you measure
  bottom-up ($2.8bn, Neudata) or top-down ($21.6bn, Precedence). Allied Market
  Research predicted OSINT would hit $29.19bn by 2026 — **it overshot by 27–84%.**
  Only two figures here are bottom-up from observable revenue and worth standing
  behind: Burton-Taylor's **$49.2bn** financial market data total and Neudata's
  **$2.8bn** alt-data total.

* * *

Praxen builds the machines that build the briefings. Own your instrument.

**Praxen Development & Engineering** · [cld-dev.io](https://cld-dev.io)
