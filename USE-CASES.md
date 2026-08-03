# Where the money is

**Commercial use cases for the-synactic — financial intelligence, OSINT, and the
context layer underneath agentic systems.**

Praxen Development & Engineering · Advanced Research Division

* * *

## The thesis in one paragraph

Agentic systems do not fail because the model reasons badly. They fail because
the context lied and nothing in the pipeline said so. A number arrives with no
provenance, a zero means "absent" instead of "measured zero", a field name
promises a measurement the payload cannot support — and the model, working
exactly as designed, produces a confident answer built on it. The scarce good is
not more data. It is **context that refuses to lie**, delivered in a shape an
agent can consume. That is what this instrument is for, and it is the thing
almost nobody is selling.

## Six ways context lies, all six found here, all six fixed

This is not a hypothetical failure mode. In a single engineering session against
this codebase, six distinct instances were found, measured and corrected. Each
one would have produced a confident wrong answer in an agent, and **not one of
them raised an error**.

| What the payload said | What was true |
|---|---|
| `available: false` shipped alongside `winRate: 0`, `directionAccuracy: 0`, `avgSimulatedReturnPct: 0` | There was no backtest at all. A consumer not checking `available` reads a 0% win rate as a measurement. |
| Country risk `combinedScore: 70`, presented with a four-component breakdown | All four components were `0`. The 70 was a conflict-database floor plus a static baseline — a floor wearing the costume of a measurement. |
| Prediction-market `volume` rendered in one column across two venues | One venue reports event-level volume beside a *child* market's price; the other reports that contract's own. The column implied a comparability that does not exist. |
| A venue's `liquidity_dollars` field, ready to map into a shared `liquidity` key | `0.0000` on 149 of 149 markets. A dead field. Mapping it would have published "zero liquidity" for every record on that venue. |
| "Backtest unavailable for this symbol" | The upstream was returning HTTP 429 to our own User-Agent. No relay fallback existed, so a rate-limit became a silent, permanent "no data". |
| A market-data tool call returning a helpful envelope | 267,646 bytes against a 131,072-byte budget. The naive first call any agent makes returns a hint instead of data. |

Two more from the same period, for flavour: a seeder that published 75 records,
verified them in the cache, and then exited with a failure code — so the
scheduler logged `FAILED` every 45 minutes for a job that worked. And prediction
markets resolving in 11 days rendered identically to markets resolving in 73
years.

**Every one of these is now labelled, fixed, or disclosed in the payload.** That
is the product.

## What that is worth, and to whom

### 1. Context-as-a-service for agentic trading systems

The topology that matters: a downstream trading system holds the exchange
accounts, the licensed price feeds, and the execution path. It has prices. What
it does not have is *why the price is moving* — the sanctions action, the
chokepoint disruption, the military posture change, the advisory downgrade.

the-synactic supplies that causal layer over MCP, keyed to instruments, with
provenance and freshness on every record. The trading system fuses it with its
own market data. **Clean split: the licences stay where the accounts are, and
the intelligence arrives as context rather than as a competing price feed.**

Buyers: systematic and discretionary funds, commodity desks, family offices
running their own execution.

### 2. Event-conditioned base rates

This is the capability a charting tool categorically cannot offer. Not "what is
the RSI" but *"how has this instrument actually behaved in the five days after a
sanctions designation, a chokepoint closure, or a CII spike — and how many times
has that happened?"*

It requires no venue market data at all: historical price series plus our own
event history is sufficient. It converts an intuition every macro trader has into
a measured base rate with a sample size attached. And because the event history
carries provenance, the answer is auditable rather than asserted.

### 3. Provenance-grade research support

For anyone who must show their work — regulated advisers, expert networks,
litigation support, journalism, diligence teams — the audit trail *is* the
deliverable. Every figure traceable to a source and a fetch time; every gap
declared rather than smoothed. A report that can survive the question "where did
this number come from?" is worth materially more than one that cannot.

### 4. Supply-chain and commodity exposure

Chokepoint status, maritime disruption, sanctions programs, energy flows and
tariff movement, mapped to specific corridors and counterparties. Bought by
procurement and supply-chain risk teams, commodity traders, and the insurers
underwriting both.

### 5. Parametric and exposure underwriting

Climate anomalies, conflict events, infrastructure failure and radiation
monitoring, delivered with the timestamp discipline a parametric trigger
requires. The value here is precisely the honesty: a trigger fed by a fabricated
zero is a paid claim or a missed one.

### 6. The one nobody is selling — agent context evaluation

Every organization deploying agents against financial or geopolitical data has
the same unanswered question: **does my agent notice when the data is wrong?**

We built the harness to answer that for ourselves. Oracle fixtures asserting
presence *and absence*; contract truthing against captured live payloads;
adversarial verification that defaults to refuted. That methodology is
independently valuable, and it is a service, not a subscription.

## Why this instrument specifically

Context engineering is not a slogan here; the primitives already exist and are in
production:

- **Provenance envelopes on every layer** — upstream fetch time, record count,
  source version and seed state travel with the data, so an agent can reason
  about staleness instead of guessing.
- **Declared absence.** The bootstrap payload carries an explicit `missing[]`
  list. A layer that has no data says so rather than returning an empty array
  that reads as "nothing is happening".
- **Server-side projection.** Tools accept a JMESPath expression so a caller
  takes only the fields it needs — typically an 80–95% reduction in tokens. The
  context window is treated as the scarce resource it is.
- **Explicit output budgets** per tool, and tool descriptions compressed to a
  selection signal, because an agent's *choice* of tool is itself a context
  problem.
- **Honest degradation.** Upstream unavailability is reported as unavailability.
  Cache writes are verified by reading them back — an HTTP 200 is not success,
  the persisted key is.

68 typed MCP tools, 163 autonomous collectors, and a charter that says the
instrument observes and never trades.

## What we will not sell

Stated plainly, because the constraints are the credibility:

- **No execution.** The instrument will never place an order, execute a trade, or
  move money. That is permanent and it is in the charter.
- **No personalized investment advice.** Base rates and context, not
  recommendations.
- **No relicensed venue data.** Where venue market data is carried it is
  read-only and individually authorized, with the authorization recorded before
  any code reads it. Data we are not licensed to redistribute, we do not
  redistribute — including to ourselves.
- **No fabricated confidence.** If a figure cannot be substantiated it is absent,
  and its absence is declared. A product whose entire pitch is honest context
  cannot make an exception for its own marketing.

* * *

Praxen builds the machines that build the briefings. Own your instrument.

**Praxen Development & Engineering** · [cld-dev.io](https://cld-dev.io)
