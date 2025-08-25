# Top Pages Implementation Guide

## Overview

Our Search Console Dashboard sources Top Pages data from **weekly URL-level data** instead of Google's default "Top Pages" aggregation. This gives us much more granular control and insights.

## Google Search Console "Top Pages" Parameters

Google Search Console's default "Top Pages" report uses these parameters:

### **Metrics Calculated:**
1. **Clicks**: Total clicks for the page URL
2. **Impressions**: Total impressions for the page URL  
3. **CTR (Click-Through Rate)**: (Clicks ÷ Impressions) × 100
4. **Average Position**: Weighted average position across all queries for that page

### **Aggregation Method:**
- **Data Source**: Query-level data grouped by page URL
- **Time Period**: Aggregated across the selected date range
- **Ranking Logic**: Usually sorted by Clicks (descending) by default
- **Filtering**: Can be filtered by date range, device, country, search type

### **Key Characteristics:**
- Shows **page-level performance** (not query-level)
- Aggregates all queries that led to impressions/clicks for each page
- Position is **impression-weighted average** across all queries
- CTR reflects the page's overall performance across all its ranking queries

## Our Implementation

### **Data Source: Weekly URL-Level Data**
- **Location**: `weekly_data_output/` folder
- **Structure**: Each CSV contains query-level data for specific URLs over weekly periods
- **Format**: `start_date,end_date,query,page,clicks,impressions,ctr,position`

### **Aggregation Logic** (in `process_data.py`)

```python
# For each page URL, aggregate across all queries and time periods
for page_url, weekly_records in url_data.items():
    # Sum total metrics
    total_clicks = sum(record['clicks'] for record in weekly_records)
    total_impressions = sum(record['impressions'] for record in weekly_records)
    
    # Calculate weighted averages for CTR and position
    total_ctr = 0
    total_position = 0
    valid_records = 0
    
    for record in weekly_records:
        if record['impressions'] > 0:  # Only count records with impressions
            ctr_value = float(record['ctr'].replace('%', ''))
            total_ctr += ctr_value
            total_position += record['position']
            valid_records += 1
    
    avg_ctr = total_ctr / valid_records if valid_records > 0 else 0
    avg_position = total_position / valid_records if valid_records > 0 else 0
```

### **Output Format**
```json
{
  "Top pages": "https://www.getglobalcare.com/blog/example",
  "Clicks": 150,
  "Impressions": 2500,
  "CTR": "6.00%",
  "Position": 12.5
}
```

## Advantages of Our Approach

### **1. Granular Control**
- We control exactly which URLs are included
- Can filter by content type (blog, clinics, locations, etc.)
- Full control over aggregation logic

### **2. Better Date Filtering**
- Weekly data allows precise date range filtering
- Can show trends over specific periods
- Supports both broad and narrow time windows

### **3. Enhanced Insights**
- Access to underlying query-level data
- Can analyze which queries drive traffic to each page
- Better understanding of content performance

### **4. Consistent with SEO Best Practices**
- Matches how SEO professionals typically analyze page performance
- Allows for content-specific analysis (blog performance vs. service pages)
- Enables better content optimization strategies

## Date Range Filtering Implementation

When users select a date range:

1. **Filter weekly data** to only include records where `start_date` falls within the selected range
2. **Re-aggregate** the filtered data using the same logic
3. **Update Top Pages cards** to reflect the filtered timeframe
4. **Maintain consistency** between main KPIs and Top Pages data

## Performance Considerations

- **Data Volume**: 92 unique URLs with thousands of query records
- **Aggregation Speed**: Fast in-memory processing during filtering
- **Memory Usage**: Efficient data structures for real-time filtering
- **UI Responsiveness**: Immediate updates when date ranges change
