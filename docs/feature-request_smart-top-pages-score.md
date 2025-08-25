# Feature Request: Smart “Top Pages” Scoring (TPS)

**Owner:** Growth/SEO  
**Requestor:** Rodrigo (Ro) Galindo  
**Date:** 2025-08-12  
**Status:** Proposed

---

## 1) Summary

Replace simple “sort by clicks” with a **composite Top Page Score (TPS)** that ranks pages by *actual traffic, efficiency, visibility, and momentum*. Keep the current GSC-like view as a toggle. Output a ranked table and a companion “Opportunity” list for optimization planning.

**Why:** GSC’s “Top pages” = clicks only. This feature surfaces pages that are *performing now* **and** those with *high upside* (big impressions, below-expected CTR, improving trend).

---

## 2) Problem Statement

- Current dashboards rank pages strictly by clicks, hiding **rising performers** and **high-upside pages**.
- Marketers need a **defensible, tunable** score to prioritize content, tests, and internal linking.

---

## 3) Proposed Solution

Introduce a **Top Page Score (TPS)** per page for a selected date range, plus a **companion Opportunity score**.

### Inputs (per page, aggregated over selected range)
- `clicks`, `impressions`, `ctr`, `position`
- Same metrics for **previous equal-length period** → to compute momentum
- Optional: `weeks_active` (how many weeks in-range the page had impressions/clicks)

### Normalizations (0–1 scale)
- Use **log** for clicks & impressions to reduce outlier dominance, then min–max or percentiles to 0–1
- Convert position to a positive score: `P_raw = max(0, (11 - position)/10)` → min–max to 0–1
- **Momentum**: `(clicks - clicks_prev) / max(1, clicks_prev)`, clipped to [-1, +1], rescaled to [0,1]
- **CTR uplift**: compare *actual CTR* vs an *expected CTR* for the observed position

### Expected CTR (simple default model)
`CTR_expected = clamp( a / position^b , 0.01, 0.6 )` where defaults `a=0.35, b=0.9`  
`CTR_lift = ctr / CTR_expected` → clamp to [0.5, 2.0] → rescale to 0–1

> Implementation can start with the default curve and later allow a property-level calibrated curve.

---

## 4) Top Page Score (TPS)

**Balanced, acquisition-focused default:**

```
TPS = 0.35*C     # actual traffic (clicks, logged & normalized)
    + 0.20*E     # CTR uplift vs expected at current rank
    + 0.15*P     # position score (higher rank → higher score)
    + 0.15*I     # impressions (visibility / footprint)
    + 0.10*M     # momentum vs previous period
    + 0.05*K     # consistency (weeks active / total weeks) — optional
```

Where:
- `C` = normalized clicks (log & scale 0–1)  
- `I` = normalized impressions (log & scale 0–1)  
- `P` = normalized position score (0–1)  
- `E` = normalized CTR uplift vs expected (0–1)  
- `M` = normalized momentum (0–1)  
- `K` = consistency (0–1)

**Preset variants:**
- **Visibility/Brand:** `TPS_vis = 0.25*C + 0.25*I + 0.20*P + 0.15*E + 0.15*M`
- **Performance/Leads:** `TPS_perf = 0.45*C + 0.25*E + 0.15*P + 0.10*M + 0.05*I`

---

## 5) Opportunity Score (for prioritization backlog)

```
Opportunity = 0.40*I             # big footprint to harvest
            + 0.30*(1 - P)       # rank is weak → upside
            + 0.30*max(0, 0.6 - E)  # CTR below expectation → fix titles/snippets/intent
```

Use `Opportunity` DESC to populate “What to fix next” list; use `TPS` DESC for “current top pages”.

---

## 6) Data Contract & Aggregation

**Required grain:** weekly or daily page-level metrics.  
**Aggregation for a date range:**  
- `clicks_sum`, `impressions_sum` (sums)  
- `position_avg = sum(position * impressions) / sum(impressions)` (impression-weighted)  
- `ctr = clicks_sum / impressions_sum`  
- `weeks_active = count(distinct weeks with impressions > 0)`  
- Prior period uses the same logic on the previous equal-length window.

---

## 7) API & UI

### API
- `POST /top-pages/score`
- **Body:** 
```json
{{
  "property_id": "sc-domain:example.com",
  "start_date": "2025-05-01",
  "end_date": "2025-06-30",
  "previous_period": true,
  "weights_preset": "balanced",  // "visibility" | "performance" | "custom"
  "weights_custom": null,         // optional dict of weights when preset = custom
  "scaling": "percentile",        // "minmax" | "percentile"
  "expected_ctr": {{"a":0.35,"b":0.9}},  // optional override
  "include_opportunity": true,
  "limit": 1000,
  "filters": {{ "country": null, "device": null, "search_type": "web" }}
}}
```
- **Response:** array of rows  
`page, clicks, impressions, ctr, position, TPS, Opportunity, C,I,P,E,M,K`

### UI
- New **“Smart Top Pages”** toggle next to current Top pages
- Preset selector: **Balanced / Performance / Visibility / Custom**
- “Show Opportunity list” checkbox
- Sorting by TPS (default) with option to change

---

## 8) Acceptance Criteria

1. Given a date range, the endpoint returns N pages with **TPS** and optional **Opportunity**.  
2. TPS **changes** appropriately when presets/weights change.  
3. With all weights set to zero except clicks, the order matches **“sort by clicks DESC”**.  
4. **Impression-weighted position** matches UI averages within ±0.1.  
5. Scoring stable across small data gaps; momentum is clipped to [-1,+1].  
6. P95 response time ≤ 3s for up to 100k pages; memory within budget.

---

## 9) Edge Cases & Rules

- **Zero-impression pages**: exclude from scoring.  
- **Zero previous-period clicks**: momentum = 1 if current clicks > 0; else 0.  
- **Outliers**: use log for C/I, clip CTR_lift to [0.5, 2.0].  
- **Short ranges**: if range < 7 days, set `K=0` and downweight `M` by 50%.  
- **Bots/noise**: rely on GSC-filtered data; add optional min-impressions threshold (e.g., 30).

---

## 10) Telemetry & QA

- Ship with **event logging**: weights used, preset, number of pages scored, response time.  
- Track adoption (toggle usage), and correlate **TPS deciles** with conversions/leads.  
- Create unit tests for: scaling, CTR_expected, momentum, acceptance criteria #3/#4.

---

## 11) Pseudocode (reference)

```python
def score_page(row, weights, a=0.35, b=0.9, scaling="percentile"):
    C = scale(log1p(row.clicks), method=scaling)
    I = scale(log1p(row.impressions), method=scaling)
    P = scale(max(0.0, (11 - row.position)/10.0), method=scaling)
    ctr_exp = clamp(a / (row.position ** b), 0.01, 0.6)
    ctr_lift = clamp(row.ctr / max(ctr_exp, 1e-4), 0.5, 2.0)
    E = (ctr_lift - 0.5) / 1.5
    M = ((row.clicks - row.clicks_prev) / max(1, row.clicks_prev))
    M = (min(1.0, max(-1.0, M)) + 1) / 2
    K = row.weeks_active / row.total_weeks if row.total_weeks else 0
    return (weights.C*C + weights.I*I + weights.P*P +
            weights.E*E + weights.M*M + weights.K*K)
```

---

## 12) Rollout Plan

1. **Phase 1 (Beta):** API only + internal dashboard; preset = Balanced.  
2. **Phase 2:** UI toggle, presets exposed, Opportunity list added.  
3. **Phase 3:** Property-level calibration of expected CTR curve; custom weights saved per workspace.

---

## 13) Documentation Notes (for end users)

- **TPS** = composite score for ranking current top pages.  
- **Opportunity** = where to focus next; high impressions + low rank/CTR efficiency.  
- Presets change the emphasis; use **Performance** for sales/lead sprints, **Visibility** for brand reach.

---

## 14) Risks & Mitigations

- **Gaming the metric:** Keep multiple presets and show raw metrics alongside the score.  
- **Overfitting CTR curve:** Start with defaults; later enable auto-calibration per property.  
- **Complexity:** Keep a one-click toggle to “Clicks only (GSC-style)”.

---

## 15) Glossary

- **CTR uplift:** How your CTR compares to what’s typical at your rank.  
- **Momentum:** Growth vs previous equal period.  
- **Consistency:** Number of weeks with traffic within the range.

---

**End of request.**
