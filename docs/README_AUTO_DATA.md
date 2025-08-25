# Auto Data Loading System

This system automatically loads Search Console data from CSV files and makes it available to the dashboard without manual file uploads.

## How It Works

1. **Data Processing**: The Python script (`process_data.py`) processes CSV files from:
   - `Data/Chart-Daily_Data/` (all-countries property daily data)
   - `Data/weekly_data_output/aggregated/` (per-URL weekly data aggregated across countries)

2. **JSON Generation**: Creates an optimized `dashboard_data.json` file

3. **Auto Loading**: The dashboard automatically loads this JSON file on startup

## Setup Instructions

### 1. Run the Python Script

```bash
python process_data.py
```

This will:
- Discover the global date range from all CSV files
- Process property daily data
- Process weekly URL data  
- Fill missing dates with zeros for accurate graphing
- Create `dashboard_data.json`

### 2. Start the Dashboard

```bash
# Using Python's built-in server
python -m http.server 8000

# Or using Node.js http-server
npx http-server -p 8000
```

### 3. Access the Dashboard

Open your browser and go to:
```
http://localhost:8000/dashboard.html
```

The dashboard will automatically load the data from `dashboard_data.json`.

## Data Structure

The generated JSON file contains:

```json
{
  "metadata": {
    "generated_at": "2024-01-01T12:00:00",
    "global_date_range": {
      "start": "2024-01-01",
      "end": "2024-12-31"
    },
    "data_sources": {
      "property_daily_files": 1,
      "url_weekly_files": 100
    }
  },
  "dates": [
    {
      "Date": "2024-01-01",
      "Clicks": 150,
      "Impressions": 1000,
      "CTR": "15.00%",
      "Position": 5.2
    }
  ],
  "pages": [
    {
      "Top pages": "https://example.com/page",
      "Clicks": 50,
      "Impressions": 300,
      "CTR": "16.67%",
      "Position": 4.1
    }
  ],
  "url_data": {
    "https://example.com/page": [
      {
        "start_date": "2024-01-01",
        "end_date": "2024-01-07",
        "query": "example query",
        "page": "https://example.com/page",
        "clicks": 10,
        "impressions": 50,
        "ctr": "20.00%",
        "position": 3.5
      }
    ]
  }
}
```

## Features

### Automatic Data Loading
- Dashboard automatically loads data on startup
- No manual file uploads required
- Graceful fallback if no data is available

### Missing Data Handling
- Missing dates are filled with zeros
- Ensures accurate graphing and analysis
- Maintains data continuity

### Performance Optimized
- JSON format for fast loading
- Structured data for efficient processing
- Cached loading to prevent duplicate requests

### Error Handling
- Validates data structure
- Provides detailed error messages
- Graceful degradation if data is unavailable

## Troubleshooting

### No Data Loaded
1. Check that `dashboard_data.json` exists
2. Verify the JSON file is valid
3. Check browser console for errors
4. Ensure you're running on a web server (not file://)

### Data Not Updating
1. Re-run `python process_data.py`
2. Clear browser cache
3. Refresh the page

### Performance Issues
1. Check the size of `dashboard_data.json`
2. Consider reducing the date range
3. Optimize CSV files if needed

## File Structure

```
Search Console Dashboard/
├── process_data.py              # Python data processor
├── dashboard_data.json          # Generated data file
├── Data/
│   ├── Chart-Daily_Data/        # Property daily CSV files (all countries)
│   └── weekly_data_output/
│       └── aggregated/          # URL weekly CSV files (aggregated per URL)
├── js/
│   ├── autoDataLoader.js        # Auto data loading module
│   └── dashboard.js             # Updated dashboard
└── dashboard.html               # Updated dashboard page
```

## CSV File Requirements

### Property Daily Data
- Location: `Data/Chart-Daily_Data/`
- Format: `start_date,end_date,date,clicks,impressions,ctr,position` (ctr as fraction 0..1)
- Example: `property_https_www_getglobalcare_com_daily_all_countries_all_data.csv`

### URL Weekly Data (Aggregated)
- Location: `Data/weekly_data_output/aggregated/`
- Format: `start_date,end_date,country,clicks,impressions,ctr,position` (ctr as fraction 0..1)
- Example: `https_www_getglobalcare_com__weekly_all_data.csv` (sanitized URL in filename)

## Benefits

1. **No Manual Uploads**: Data loads automatically
2. **Accurate Graphing**: Missing data handled properly
3. **Fast Loading**: Optimized JSON format
4. **Easy Updates**: Just re-run the Python script
5. **Error Resilient**: Graceful handling of missing data
6. **Performance Optimized**: Efficient data structure

## Future Enhancements

- Automatic data refresh
- Real-time data processing
- Multiple data source support
- Data compression for large datasets
- Incremental updates
