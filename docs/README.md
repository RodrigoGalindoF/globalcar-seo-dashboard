# Search Console Dashboard

A comprehensive dashboard for analyzing Google Search Console data with interactive charts, performance metrics, and detailed insights.

## Features

- **Interactive Charts**: Zoom, pan, and explore data with smooth interactions
- **Performance Metrics**: Track clicks, impressions, CTR, and position
- **Date Range Filtering**: Filter data by custom date ranges
- **Blog Analysis**: Detailed analysis of blog post performance
- **Export Functionality**: Export data in various formats
- **Responsive Design**: Works on desktop and mobile devices

## File Structure

```
Search Console Dashboard/
├── dashboard.html          # Main dashboard HTML
├── index.html             # Redirect to dashboard
├── js/                    # JavaScript modules
│   ├── dashboard.js       # Main dashboard JavaScript
│   ├── charts.js          # Consolidated chart functionality
│   ├── chartZoomScroll.js # Chart zoom and scroll management
│   ├── dashboardUpdates.js # Dashboard update functions
│   ├── dateRangePicker.js # Date range picker component
│   ├── dateUtils.js       # Date utility functions

│   ├── navbar.js          # Navigation bar functionality
│   ├── blogAnalysis.js    # Blog analysis functions

│   ├── logger.js          # Logging utility
│   └── utils.js           # Utility functions
├── css/                   # Stylesheets
│   └── styles.css         # Dashboard styles
├── docs/                  # Documentation
│   ├── README.md          # Project documentation
│   └── CHANGELOG.md       # Change history
├── data/                  # Data files
│   └── Images.csv         # Sample data file
├── Resources/             # Static resources
│   └── global-care-logo.png
└── Search Console - Global Care/ # Data folders
    ├── 2024/
    ├── 2025/
    └── ...
```

## Core Components

### Charts Module (`charts.js`)

The consolidated chart functionality provides a unified interface for creating and managing charts.

#### Key Functions

##### `createChart(chartId, data, config)`
Creates a new chart with the specified configuration.

**Parameters:**
- `chartId` (string): Chart canvas ID
- `data` (Object): Chart data object
- `config` (Object): Chart configuration (optional)

**Returns:** Chart instance

##### `updateChart(chartId, data, config)`
Updates an existing chart with new data.

**Parameters:**
- `chartId` (string): Chart canvas ID
- `data` (Object): New chart data
- `config` (Object): Chart configuration (optional)

##### `toggleMetric(metric)`
Toggles the visibility of a metric on the chart.

**Parameters:**
- `metric` (string): Metric key ('clicks', 'impressions', 'ctr', 'position')

##### `resetMetrics()`
Resets all metrics to their default state.

##### `getSelectedMetrics()`
Gets the currently selected metrics.

**Returns:** Set of selected metric keys

##### `setSelectedMetrics(metrics)`
Sets the selected metrics.

**Parameters:**
- `metrics` (Array): Array of metric keys to select

##### `updateMultiMetricChart(data)`
Updates the main performance chart with new data.

**Parameters:**
- `data` (Object): Chart data object

##### `getChart(chartId)`
Gets a chart instance by ID.

**Parameters:**
- `chartId` (string): Chart ID

**Returns:** Chart instance or null

##### `destroyChart(chartId)`
Destroys a chart by ID.

**Parameters:**
- `chartId` (string): Chart ID

##### `destroyAllCharts()`
Destroys all charts.

### Chart Configuration

The chart system uses a default configuration that can be customized:

```javascript
const DEFAULT_CHART_CONFIG = {
    // Chart styling
    colors: {
        clicks: '#1a73e8',
        impressions: '#ea4335',
        ctr: '#34a853',
        position: '#fbbc04'
    },
    fonts: {
        family: 'Roboto, Arial, sans-serif',
        size: {
            title: 14,
            body: 13,
            axis: 12
        }
    },
    // Interaction settings
    interaction: {
        enableWheelZoom: true,
        enableDragPan: true,
        enableKeyboard: true,
        enableTouch: true
    },
    // Data processing
    data: {
        normalizeValues: true,
        handleGaps: true,
        preserveOriginalData: true
    }
};
```

### Dashboard Updates (`dashboardUpdates.js`)

Functions for updating various dashboard components.

#### Key Functions

##### `updateDashboard()`
Updates the entire dashboard with current data.

##### `updatePerformanceChart(data)`
Updates the performance chart.

**Parameters:**
- `data` (Object): Chart data (defaults to globalData)

##### `updateOverviewMetrics(data)`
Updates the overview metrics section.

**Parameters:**
- `data` (Object): Metrics data (defaults to globalData)

##### `updateTopPagesTable(data)`
Updates the top pages table.

**Parameters:**
- `data` (Object): Pages data (defaults to globalData)

##### `updateBlogPerformance(data)`
Updates the blog performance section.

**Parameters:**
- `data` (Object): Blog data (defaults to globalData)

### Date Management (`dateUtils.js`)

Functions for managing date ranges and filtering.

#### Key Functions

##### `applyDateRange(rangeObj)`
Applies a date range filter to the dashboard.

**Parameters:**
- `rangeObj` (Object): Date range object

##### `updateGlobalDateRange(rangeObj, source)`
Updates the global date range.

**Parameters:**
- `rangeObj` (Object): Date range object
- `source` (string): Source of the date range change

##### `getCurrentGlobalDateRange()`
Gets the current global date range.

**Returns:** Current date range object

### Date Range Components (`dateRangePicker.js`)

The date range component system provides reusable, self-contained date range pickers.

#### Key Functions

##### `createDateRangeComponent(element, options)`
Creates a new date range component instance.

**Parameters:**
- `element` (HTMLElement): The DOM element to attach the component to
- `options` (Object): Configuration options (optional)

**Returns:** DateRangeComponent instance

##### `destroyDateRangeComponent(element)`
Destroys a date range component instance.

**Parameters:**
- `element` (HTMLElement): The DOM element with the component

##### `updateAllDateRangeDisplays()`
Updates all date range component displays with current global state.

##### `getDateRangeComponentManager()`
Gets the global component manager instance.

**Returns:** DateRangeComponentManager instance

#### Component Features

- **Reusable**: Create multiple instances of date range pickers
- **Auto-synchronized**: All instances automatically sync with global date range changes
- **Self-contained**: Each component manages its own display and state
- **Dynamic**: Automatically detects and initializes new date range elements
- **Configurable**: Customizable options for each component instance

#### Usage Example

```html
<div class="date-range" onclick="toggleDateSelector()">
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
    </svg>
    <span class="date-range-text">All data</span>
</div>
```

The component system automatically detects and initializes all `.date-range` elements.



### Blog Analysis (`blogAnalysis.js`)

Functions for analyzing blog post performance.

#### Key Functions

##### `analyzeBlogPerformance(blogUrl, data, comparisonMode)`
Analyzes performance for a specific blog post.

**Parameters:**
- `blogUrl` (string): Blog post URL
- `data` (Object): Analysis data
- `comparisonMode` (string): Comparison mode ('sequential' or 'baseline')

**Returns:** Analysis results object

##### `analyzeAllBlogPosts(data, comparisonMode)`
Analyzes all blog posts in the data.

**Parameters:**
- `data` (Object): Analysis data
- `comparisonMode` (string): Comparison mode

**Returns:** Array of blog analysis results

##### `analyzePagePerformance(pageUrl, data, comparisonMode)`
Analyzes performance for any page.

**Parameters:**
- `pageUrl` (string): Page URL
- `data` (Object): Analysis data
- `comparisonMode` (string): Comparison mode

**Returns:** Analysis results object

## Usage

### Basic Chart Creation

```javascript
import { createChart, updateChart } from './charts.js';

// Create a chart
const chart = createChart('performanceChart', data, {
    colors: {
        clicks: '#1a73e8',
        impressions: '#ea4335'
    }
});

// Update the chart
updateChart('performanceChart', newData);
```

### Toggle Metrics

```javascript
import { toggleMetric, resetMetrics } from './charts.js';

// Toggle a metric
toggleMetric('clicks');

// Reset all metrics
resetMetrics();
```

### Date Range Filtering

```javascript
import { applyDateRange } from './dateUtils.js';

// Apply a date range
applyDateRange({
    start: '2024-01-01',
    end: '2024-12-31'
});
```

### Blog Analysis

```javascript
import { analyzeBlogPerformance } from './blogAnalysis.js';

// Analyze a blog post
const analysis = analyzeBlogPerformance(
    'https://example.com/blog/post',
    data,
    'sequential'
);
```

## Event Handling

The dashboard uses custom events for communication between components:

### Chart Events
```javascript
// Listen for chart updates
window.addEventListener('chartUpdated', () => {
    console.log('Chart updated');
});

// Listen for date range changes
window.addEventListener('chartDateRangeChanged', (event) => {
    const { dateRange, source } = event.detail;
    console.log('Chart date range changed:', dateRange);
});
```

### Date Range Events
```javascript
// Listen for date range synchronization
window.addEventListener('dateRangeSynchronized', (event) => {
    const { source } = event.detail;
    console.log('Date range synchronized from:', source);
});
```

## Data Structure

The dashboard expects data in the following format:

```javascript
{
    dates: [
        {
            Date: '2024-01-01',
            Clicks: 100,
            Impressions: 1000,
            CTR: '10.00%',
            Position: 5.2
        }
        // ... more date records
    ],
    pages: [
        {
            'Top pages': 'https://example.com/page',
            Clicks: 50,
            Impressions: 500,
            CTR: '10.00%',
            Position: 3.1
        }
        // ... more page records
    ]
    // ... other data arrays
}
```

## Browser Compatibility

- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

## Dependencies

- Chart.js (for chart rendering)
- No external dependencies required

## Development

### Setup

1. Clone the repository
2. Open `dashboard.html` in a web browser
3. Upload your Search Console CSV files
4. Explore the dashboard

### Adding New Features

1. Create new functions in the appropriate module
2. Export functions from the module
3. Import and use in `dashboard.js`
4. Make functions globally available if needed for HTML onclick handlers

### Debugging

Use the built-in debugging functions:

```javascript
// Debug global data
window.debugGlobalData();

// Debug blog URLs
window.debugBlogUrls();

// Export logs
window.exportLogs();
``` 