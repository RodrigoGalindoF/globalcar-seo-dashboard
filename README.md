# Global Care SEO Dashboard

A comprehensive Search Console Dashboard for monitoring and analyzing SEO performance across multiple countries and properties.

## 🚀 Features

- **Multi-Property Dashboard**: Monitor multiple Google Search Console properties simultaneously
- **Country-Specific Analytics**: Detailed performance metrics for 11 countries (USA, Canada, Mexico, Argentina, Chile, Colombia, Peru, Spain, Australia, New Zealand)
- **Real-time Data**: Live updates from Google Search Console API
- **Interactive Charts**: Performance visualization with zoom and scroll capabilities
- **Smart Page Scoring**: AI-powered page performance scoring system
- **Top Pages Analysis**: Identify and analyze your best-performing pages
- **Keyword Tracking**: Monitor keyword performance across different markets
- **Responsive Design**: Works seamlessly on desktop and mobile devices

## 📊 Dashboard Components

### Main Metrics
- **Clicks**: Total click-through traffic
- **Impressions**: Search result appearances
- **CTR**: Click-through rate percentage
- **Position**: Average search ranking position

### Analytics Views
- **Performance Charts**: Interactive time-series charts with zoom/scroll
- **Top Pages Table**: Sortable table of best-performing pages
- **Country Performance**: Regional breakdown of SEO metrics
- **Keyword Analysis**: Weekly and daily keyword performance data

## 🛠️ Technology Stack

- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Charts**: Chart.js with custom zoom/scroll functionality
- **Data Processing**: Python scripts for data aggregation
- **API Integration**: Google Search Console API
- **Responsive Design**: CSS Grid and Flexbox
- **Performance**: Optimized for large datasets

## 📁 Project Structure

```
├── css/                    # Stylesheets
├── js/                     # JavaScript modules
├── Data/                   # Data exports and CSV files
├── docs/                   # Documentation
├── Resources/              # Images and assets
├── dashboard.html          # Main dashboard interface
├── index.html             # Landing page
└── fetch_og_from_sitemap.py  # Python data processor
```

## 🚀 Quick Start

### Prerequisites
- Modern web browser (Chrome, Firefox, Safari, Edge)
- Python 3.7+ (for data processing scripts)
- Google Search Console access

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/RodrigoGalindoF/globalcar-seo-dashboard.git
   cd globalcar-seo-dashboard
   ```

2. **Open the dashboard**
   - Simply open `dashboard.html` in your web browser
   - Or serve the files using a local web server

3. **For data processing** (optional)
   ```bash
   pip install pandas requests
   python fetch_og_from_sitemap.py
   ```

## 📈 Usage

### Dashboard Navigation
- **Overview**: Main performance metrics and charts
- **Top Pages**: Best-performing pages with smart scoring
- **Keywords**: Keyword performance analysis
- **Countries**: Regional performance breakdown

### Chart Interactions
- **Zoom**: Use mouse wheel or pinch gestures
- **Pan**: Click and drag to navigate
- **Metric Toggle**: Switch between clicks, impressions, CTR, and position
- **Date Range**: Select custom time periods

### Data Filtering
- **Country Selection**: Filter by specific countries
- **Page Type**: Filter by blog, page, clinic, doctor, or location
- **Search**: Find specific pages or keywords
- **Sorting**: Sort by any metric in ascending/descending order

## 🔧 Configuration

### Google Search Console Setup
1. Enable Google Search Console API
2. Create service account credentials
3. Add service account to your properties
4. Update API configuration in the dashboard

### Custom Properties
- Add new properties in the configuration
- Update country mappings as needed
- Configure custom metrics and dimensions

## 📊 Data Sources

- **Google Search Console API**: Primary data source
- **Weekly Aggregations**: Country-specific performance data
- **Daily Metrics**: Detailed daily performance tracking
- **Keyword Data**: Search query performance analysis

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Google Search Console API
- Chart.js for visualization
- The open-source community

## 📞 Support

For support and questions:
- Create an issue in this repository
- Contact: [Your Contact Information]

---

**Built with ❤️ for the Global Care team**
