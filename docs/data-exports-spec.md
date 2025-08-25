### Search Console Data Exports: Scope, Usage, Flow, and Schemas

This guide specifies exactly what data is retrieved from Google Search Console (GSC), how it maps to the GSC UI, how it will be used in the product (charts and tables), which code modules perform each step, and how outputs are organized and named. It mirrors the default GSC Performance UI while providing required per‑country slices.

Code map:
- `scripts/main.py`: Orchestrates the 3‑step pipeline (property daily, page weekly, keywords), computes last‑16‑months window, auto‑discovers URLs from GSC.
- `src/core/api_client.py`: GSC client and exporter (authentication, `searchanalytics.query`, pagination, retries, CSV write).
- `src/core/batch_processor.py`: Implements exports and helpers: property daily, page weekly performance, site daily keywords, URL weekly keywords, and page enumeration.
- Infra: `src/core/quota_manager.py`, `src/core/progress_tracker.py`, `src/ui/status_monitor.py`, `src/utils/retry_utils.py`.

### Defaults
- **Date range**: last 16 months, ending at today − 2 days (finalized data)
- **Data state**: final
- **Search type**: web
- **Countries (ISO‑3166‑1 alpha‑3)**: USA, MEX, CAN, ESP, COL, PER, ARG, CHL, AUS, NZL

### Output directories
- Property daily chart data: `Chart-Daily_Data/`
- Page-level weekly data: `weekly_data_output/`
  - Aggregated (all countries): `weekly_data_output/aggregated/`
  - By-country: `weekly_data_output/by_country/{CODE}/`
- Keywords (queries): `keywords/`
  - Site daily: `keywords/Site_Daily/`
    - All countries: `keywords/Site_Daily/all_countries.csv`
    - By-country: `keywords/Site_Daily/by_country/{CODE}.csv`
  - Page weekly: `keywords/Page_Weekly/`
    - Aggregated (all countries): `keywords/Page_Weekly/aggregated/{sanitized_url}.csv`
    - By-country: `keywords/Page_Weekly/by_country/{CODE}/{sanitized_url}.csv`

File names use a sanitized version of the domain/URL: protocol separators, slashes and dots replaced with underscores.

### How the data is used (UX intent)
- Property daily (chart): Drives the main Overview chart, identical to GSC default (daily series of clicks, impressions, CTR, position). Per‑country files power the country filter.
- Page‑level weekly (performance): Feeds the Page detail views. Aggregated weekly per URL drives the main chart; per‑country files enable switching the chart to a specific country.
- Keywords – site daily: Powers site‑level keywords trends/tables (aggregated + per‑country).
- Keywords – URL weekly: Powers per‑URL keywords views aligned with weekly cadence (aggregated + per‑country).

### Pagination and limits
- The API returns up to 25,000 rows per request. When needed, we paginate via `startRow` until all rows are retrieved.
- Exponential retry, quota-aware delays, and resume support are built-in to the processing pipeline.

---

## 1) Property Daily Performance (chart-aligned)

Purpose: Replicate the default GSC Performance chart (daily time series) with metrics clicks, impressions, CTR, and average position.

GSC defaults mirrored: `dimensions=["date"]`, all countries, all devices, search type = web.

- Source: site property (no page filter)
- Dimensions: `date`
- Metrics per row: `clicks`, `impressions`, `ctr`, `position`
- Variants exported:
  - All countries combined
  - Per country for: USA, MEX, CAN, ESP, COL, PER, ARG, CHL, AUS, NZL

Output files (examples):
- `Chart-Daily_Data/property_https_www_example_com_daily_all_countries.csv`
- `Chart-Daily_Data/property_https_www_example_com_daily_country_USA.csv`

CSV schema:
- Columns: `start_date`, `end_date`, `date`, `clicks`, `impressions`, `ctr`, `position`
  - For daily exports, `start_date == end_date == date`.

Request shape (all countries):

```json
{
  "startDate": "START_16M",
  "endDate": "TODAY_MINUS_2",
  "dimensions": ["date"],
  "searchType": "web",
  "dataState": "final",
  "rowLimit": 25000
}
```

Request shape (per country):

```json
{
  "startDate": "START_16M",
  "endDate": "TODAY_MINUS_2",
  "dimensions": ["date"],
  "dimensionFilterGroups": [
    { "filters": [ { "dimension": "country", "operator": "equals", "expression": "USA" } ] }
  ],
  "searchType": "web",
  "dataState": "final",
  "rowLimit": 25000
}
```

---

## 2) Page-level Weekly Performance
Usage intent:
- Aggregated dataset drives the main Page‑level chart (weekly granularity).
- Country datasets enable switching the Page‑level chart to a specific country.

Purpose: Provide a weekly time series per URL for the same metrics used by the chart. We export both aggregated (all countries) and by-country versions for the specified countries.

Flow:
1. Enumerate all pages with traffic over the 16‑month range using a property-level request with `dimensions: ["page"]` (pagination applied as needed).
2. Split the date range into 7‑day windows.
3. For each URL and each week:
   - First request: aggregated (no country filter)
   - Then, one request per country (USA, MEX, CAN, ESP, COL, PER, ARG, CHL, AUS, NZL)

Output files (examples):
- Aggregated: `weekly_data_output/aggregated/https_www_example_com_path_weekly_all_data.csv`
- By-country: `weekly_data_output/by_country/USA/https_www_example_com_path_weekly_all_data.csv`

CSV schema (aggregated):
- Columns: `start_date`, `end_date`, `clicks`, `impressions`, `ctr`, `position`

CSV schema (by-country):
- Columns: `start_date`, `end_date`, `country`, `clicks`, `impressions`, `ctr`, `position`

Request shape (per URL, aggregated week):

```json
{
  "startDate": "WEEK_START",
  "endDate": "WEEK_END",
  "dimensions": [],
  "dimensionFilterGroups": [
    { "filters": [ { "dimension": "page", "operator": "equals", "expression": "https://www.example.com/path" } ] }
  ],
  "searchType": "web",
  "dataState": "final",
  "rowLimit": 25000
}
```

Request shape (per URL, per country, per week):

```json
{
  "startDate": "WEEK_START",
  "endDate": "WEEK_END",
  "dimensions": [],
  "dimensionFilterGroups": [
    { "filters": [
      { "dimension": "page", "operator": "equals", "expression": "https://www.example.com/path" },
      { "dimension": "country", "operator": "equals", "expression": "USA" }
    ] }
  ],
  "searchType": "web",
  "dataState": "final",
  "rowLimit": 25000
}
```

---

## 3) Keywords (Queries)

Purpose: Retrieve the queries the site/URL ranks for, aligned to daily (site) and weekly (page) cadences. Exports both aggregated (all countries) and by-country slices.

Usage intent:
- Site‑daily keywords: property‑level keywords tables and trends.
- URL‑weekly keywords: per‑URL keywords views with weekly cadence.

### 3.1 Site-level Daily Keywords

- Dimensions: `query`
- Metrics per row: `clicks`, `impressions`, `ctr`, `position`
- Export cadence: daily; combined into a single CSV with date columns
- Files:
  - All countries: `keywords/Site_Daily/all_countries.csv`
  - By-country: `keywords/Site_Daily/by_country/{CODE}.csv`

CSV schema:
- Columns: `start_date`, `end_date`, `query`, `clicks`, `impressions`, `ctr`, `position`
  - For daily exports, `start_date == end_date`.

Request shape (single day, all countries):

```json
{
  "startDate": "DAY",
  "endDate": "DAY",
  "dimensions": ["query"],
  "searchType": "web",
  "dataState": "final",
  "rowLimit": 25000
}
```

Request shape (single day, per country):

```json
{
  "startDate": "DAY",
  "endDate": "DAY",
  "dimensions": ["query"],
  "dimensionFilterGroups": [
    { "filters": [ { "dimension": "country", "operator": "equals", "expression": "USA" } ] }
  ],
  "searchType": "web",
  "dataState": "final",
  "rowLimit": 25000
}
```

### 3.2 URL-level Weekly Keywords

- Dimensions: `query`
- Metrics per row: `clicks`, `impressions`, `ctr`, `position`
- Export cadence: weekly windows per URL
- Files:
  - Aggregated: `keywords/Page_Weekly/aggregated/{sanitized_url}.csv`
  - By-country: `keywords/Page_Weekly/by_country/{CODE}/{sanitized_url}.csv`

CSV schema:
- Aggregated columns: `start_date`, `end_date`, `query`, `clicks`, `impressions`, `ctr`, `position`
- By-country columns: `start_date`, `end_date`, `country`, `query`, `clicks`, `impressions`, `ctr`, `position`

Request shape (per URL, aggregated week):

```json
{
  "startDate": "WEEK_START",
  "endDate": "WEEK_END",
  "dimensions": ["query"],
  "dimensionFilterGroups": [
    { "filters": [ { "dimension": "page", "operator": "equals", "expression": "https://www.example.com/path" } ] }
  ],
  "searchType": "web",
  "dataState": "final",
  "rowLimit": 25000
}
```

Request shape (per URL, per country, per week):

```json
{
  "startDate": "WEEK_START",
  "endDate": "WEEK_END",
  "dimensions": ["query"],
  "dimensionFilterGroups": [
    { "filters": [
      { "dimension": "page", "operator": "equals", "expression": "https://www.example.com/path" },
      { "dimension": "country", "operator": "equals", "expression": "USA" }
    ] }
  ],
  "searchType": "web",
  "dataState": "final",
  "rowLimit": 25000
}
```

---

## Notes and alignment with GSC UI
- The Property Daily dataset (Section 1) matches the default GSC Performance chart: daily time series, metrics clicks/impressions/CTR/position, no filters by default; country selections mirror the UI’s country filter.
- Weekly Page datasets (Section 2) provide the same metrics at a URL granularity and weekly cadence for compactness and trend clarity.
- Keywords datasets (Section 3) expose the ranking queries at the site (daily) and page (weekly) levels, with country slices identical to Performance filters.

If you need additional slices (e.g., device, searchAppearance) or alternative cadences, we can extend the same patterns.

### Appendix: Exact API request shapes

- Property daily (all countries):
```json
{
  "startDate": "START_16M",
  "endDate": "TODAY_MINUS_2",
  "dimensions": ["date"],
  "searchType": "web",
  "dataState": "final",
  "rowLimit": 25000
}
```

- Property daily (per country):
```json
{
  "startDate": "START_16M",
  "endDate": "TODAY_MINUS_2",
  "dimensions": ["date"],
  "dimensionFilterGroups": [
    { "filters": [ { "dimension": "country", "operator": "equals", "expression": "USA" } ] }
  ],
  "searchType": "web",
  "dataState": "final",
  "rowLimit": 25000
}
```

- Weekly per‑URL aggregated (one row per week):
```json
{
  "startDate": "WEEK_START",
  "endDate": "WEEK_END",
  "dimensions": [],
  "dimensionFilterGroups": [
    { "filters": [ { "dimension": "page", "operator": "equals", "expression": "https://www.example.com/path" } ] }
  ],
  "searchType": "web",
  "dataState": "final",
  "rowLimit": 25000
}
```

- Weekly per‑URL per‑country:
```json
{
  "startDate": "WEEK_START",
  "endDate": "WEEK_END",
  "dimensions": [],
  "dimensionFilterGroups": [
    { "filters": [
      { "dimension": "page", "operator": "equals", "expression": "https://www.example.com/path" },
      { "dimension": "country", "operator": "equals", "expression": "USA" }
    ] }
  ],
  "searchType": "web",
  "dataState": "final",
  "rowLimit": 25000
}
```

- Site‑daily keywords (all countries):
```json
{
  "startDate": "DAY",
  "endDate": "DAY",
  "dimensions": ["query"],
  "searchType": "web",
  "dataState": "final",
  "rowLimit": 25000
}
```

- Site‑daily keywords (per country):
```json
{
  "startDate": "DAY",
  "endDate": "DAY",
  "dimensions": ["query"],
  "dimensionFilterGroups": [
    { "filters": [ { "dimension": "country", "operator": "equals", "expression": "USA" } ] }
  ],
  "searchType": "web",
  "dataState": "final",
  "rowLimit": 25000
}
```

- URL‑weekly keywords (aggregated):
```json
{
  "startDate": "WEEK_START",
  "endDate": "WEEK_END",
  "dimensions": ["query"],
  "dimensionFilterGroups": [
    { "filters": [ { "dimension": "page", "operator": "equals", "expression": "https://www.example.com/path" } ] }
  ],
  "searchType": "web",
  "dataState": "final",
  "rowLimit": 25000
}
```

- URL‑weekly keywords (per country):
```json
{
  "startDate": "WEEK_START",
  "endDate": "WEEK_END",
  "dimensions": ["query"],
  "dimensionFilterGroups": [
    { "filters": [
      { "dimension": "page", "operator": "equals", "expression": "https://www.example.com/path" },
      { "dimension": "country", "operator": "equals", "expression": "USA" }
    ] }
  ],
  "searchType": "web",
  "dataState": "final",
  "rowLimit": 25000
}
```


