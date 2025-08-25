### Output Inventory: Folders, Files, Columns, Purpose, and Dashboard Usage

This document lists the output directories produced by the pipeline in `scripts/main.py`, the file naming conventions, the CSV columns found in each file (validated against generated outputs), and how each dataset is intended to be used in the external Dashboard.

### Directory tree

```
Seach Console - API Requests/
  Chart-Daily_Data/
    property_{domain}_daily_all_countries_all_data.csv
    property_{domain}_daily_country_{CODE}_all_data.csv  (one per country)

  weekly_data_output/
    quota_tracker.json
    aggregated/
      {sanitized_url}_weekly_all_data.csv               (one per discovered URL)
    by_country/
      {CODE}/
        {sanitized_url}_weekly_all_data.csv             (one per URL per country)

  keywords/
    Site_Daily/
      all_countries.csv
      by_country/
        {CODE}.csv
    Page_Weekly/
      aggregated/
        {sanitized_url}.csv
      by_country/
        {CODE}/
          {sanitized_url}.csv
```

Notes:
- `{domain}` is sanitized (protocol separators, slashes, dots → underscores). Example: `property_https_www_getglobalcare_com_...`
- `{sanitized_url}` replaces `://`, `/`, and `.` with `_`.
- `{CODE}` is ISO‑3166‑1 alpha‑3: USA, MEX, CAN, ESP, COL, PER, ARG, CHL, AUS, NZL.

### Chart-Daily_Data/ (Property daily chart data)
- Files:
  - `property_{domain}_daily_all_countries_all_data.csv`
  - `property_{domain}_daily_country_{CODE}_all_data.csv`
- Columns (validated from sample):
  - `start_date`, `end_date`, `date`, `clicks`, `impressions`, `ctr`, `position`
    - For daily series, `start_date == end_date == date`.
- Purpose:
  - Drives the main Overview chart (daily), matching GSC default metrics.
  - Per-country CSVs power the country filter in the chart.

### weekly_data_output/ (Page-level weekly performance)
- Files:
  - `aggregated/{sanitized_url}_weekly_all_data.csv`
  - `by_country/{CODE}/{sanitized_url}_weekly_all_data.csv`
  - `quota_tracker.json` (internal quota telemetry)
- Columns (validated from sample):
  - `start_date`, `end_date`, `country`, `clicks`, `impressions`, `ctr`, `position`
    - Aggregated files include `country` in the output header (present in current outputs); value is the country label used by the API source. Per-country files also include `country` for explicitness.
- Purpose:
  - Aggregated files provide one row per URL per week for the Page-level chart (all countries combined).
  - Per-country files provide one row per URL per week per country for the Page-level chart when filtering by a specific country.

### keywords/ (Queries)
- Site_Daily/
  - Files:
    - `all_countries.csv`
    - `by_country/{CODE}.csv`
  - Columns (validated from samples):
    - `start_date`, `end_date`, `country`, `query`, `clicks`, `impressions`, `ctr`, `position`
  - Purpose:
    - Powers site-level keywords tables and daily trends in the Dashboard; per-country CSVs enable a country selector.

- Page_Weekly/
  - Files:
    - `aggregated/{sanitized_url}.csv`
    - `by_country/{CODE}/{sanitized_url}.csv`
  - Columns (structure mirrors site-daily keywords with weekly windows; typical columns):
    - `start_date`, `end_date`, `query`, `clicks`, `impressions`, `ctr`, `position` (aggregated)
    - `start_date`, `end_date`, `country`, `query`, `clicks`, `impressions`, `ctr`, `position` (by-country)
  - Purpose:
    - Powers per‑URL keywords insights aligned with weekly cadence; per‑country files enable country filtering.

### How the Dashboard should consume these
- Overview chart: read `Chart-Daily_Data/property_{domain}_daily_all_countries_all_data.csv` by default; when user selects a country, swap to the corresponding `property_{domain}_daily_country_{CODE}_all_data.csv`.
- Page detail chart: default to `weekly_data_output/aggregated/{sanitized_url}_weekly_all_data.csv`; when a country is selected, change to `weekly_data_output/by_country/{CODE}/{sanitized_url}_weekly_all_data.csv`.
- Site keywords: default to `keywords/Site_Daily/all_countries.csv`; switch to `keywords/Site_Daily/by_country/{CODE}.csv` for country views.
- URL keywords: default to `keywords/Page_Weekly/aggregated/{sanitized_url}.csv`; switch to `keywords/Page_Weekly/by_country/{CODE}/{sanitized_url}.csv` for country views.

### Provenance and alignment
- All outputs derive from the GSC Search Analytics API with `dataState = final` and `searchType = web`.
- Date range is the last 16 months (end at today−2).
- URLs are auto‑discovered from GSC; no sitemap/CSV required.

### Examples (from current outputs)
- Property daily (country):
  - `Chart-Daily_Data/property_https_www_getglobalcare_com_daily_country_USA_all_data.csv`
  - Columns sample: `start_date,end_date,date,clicks,impressions,ctr,position`
- Page weekly (aggregated):
  - `weekly_data_output/aggregated/https_www_getglobalcare_com_dental-implants_weekly_all_data.csv`
  - Columns sample: `start_date,end_date,country,clicks,impressions,ctr,position`
- Site daily keywords (all):
  - `keywords/Site_Daily/all_countries.csv`
  - Columns sample: `start_date,end_date,country,query,clicks,impressions,ctr,position`

For deeper context on the intended usage and API requests used, see `docs/data-exports-spec.md`.


