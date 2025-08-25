import { logger } from './logger.js';

// ===== Utility Functions =====
export function formatNumber(num) {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
}

export function parsePercentage(str) {
    // Handle both strings and numbers
    if (typeof str === 'number') {
        return str;
    }
    if (typeof str === 'string') {
        return parseFloat(str.replace('%', '')) || 0;
    }
    return 0;
}

export function formatPercentage(num) {
    return `${num.toFixed(1)}%`;
}

export function toTitleCase(str) {
    return str.replace(/\w\S*/g, (txt) => {
        return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
    });
}

export function getPositionClass(position) {
    if (position <= 3) return 'position-excellent';
    if (position <= 10) return 'position-good';
    if (position <= 20) return 'position-fair';
    return 'position-poor';
}

export function getFileType(fileName) {
    if (!fileName) return 'unknown';
    
    const extension = fileName.split('.').pop().toLowerCase();
    
    const types = {
        'csv': 'data',
        'json': 'data',
        'txt': 'text',
        'md': 'text',
        'pdf': 'document',
        'doc': 'document',
        'docx': 'document',
        'xls': 'spreadsheet',
        'xlsx': 'spreadsheet',
        'jpg': 'image',
        'jpeg': 'image',
        'png': 'image',
        'gif': 'image',
        'svg': 'image'
    };
    
    return types[extension] || 'unknown';
}

export function extractDateRangeFromPath(filePath) {
    const datePatterns = [
        // Year-Month patterns
        /(\d{4})-(\d{1,2})/,
        // Month-Year patterns  
        /([A-Za-z]+)-(\d{4})/,
        // Month Year patterns
        /([A-Za-z]+)\s+(\d{4})/,
        // Date range patterns
        /(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})/
    ];
    
    for (const pattern of datePatterns) {
        const match = filePath.match(pattern);
        if (match) {
            return {
                start: match[1],
                end: match[2] || match[1],
                type: 'extracted'
            };
        }
    }
    
    return null;
}

export function readFileContent(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = e => reject(e);
        reader.readAsText(file);
    });
}

export function inferDateRangeFromData(data) {
    if (!data || (!Array.isArray(data) && typeof data !== 'object')) {
        return null;
    }
    
    let dates = [];
    
    // Handle different data structures
    if (Array.isArray(data)) {
        dates = data.map(item => {
            if (typeof item === 'object' && item !== null) {
                return item.Date || item.date || null;
            }
            return null;
        }).filter(date => date !== null);
    } else if (typeof data === 'object') {
        // Try to extract dates from object structure
        if (data.dates && Array.isArray(data.dates)) {
            dates = data.dates.map(item => item.Date || item.date || item).filter(date => date !== null);
        }
    }
    
    if (dates.length === 0) {
        return null;
    }
    
    // Sort dates to find min and max
    const sortedDates = dates.sort((a, b) => new Date(a) - new Date(b));
    
    return {
        start: sortedDates[0],
        end: sortedDates[sortedDates.length - 1],
        total: dates.length
    };
}

export function getDateRangeStart(dateRange) {
    if (!dateRange) return null;
    
    if (typeof dateRange === 'string') {
        // Handle "Month Year" format
        if (dateRange.includes(' ')) {
            const [month, year] = dateRange.split(' ');
            const monthIndex = getMonthIndex(month);
            if (monthIndex !== -1) {
                return new Date(parseInt(year), monthIndex, 1);
            }
        }
        
        // Handle direct date strings
        const date = new Date(dateRange);
        return isNaN(date.getTime()) ? null : date;
    }
    
    if (dateRange.start) {
        const date = new Date(dateRange.start);
        return isNaN(date.getTime()) ? null : date;
    }
    
    return null;
}

export function getDateRangeEnd(dateRange) {
    if (!dateRange) return null;
    
    if (typeof dateRange === 'string') {
        // Handle "Month Year" format
        if (dateRange.includes(' ')) {
            const [month, year] = dateRange.split(' ');
            const monthIndex = getMonthIndex(month);
            if (monthIndex !== -1) {
                return new Date(parseInt(year), monthIndex + 1, 0); // Last day of month
            }
        }
        
        // Handle direct date strings
        const date = new Date(dateRange);
        return isNaN(date.getTime()) ? null : date;
    }
    
    if (dateRange.end) {
        const date = new Date(dateRange.end);
        return isNaN(date.getTime()) ? null : date;
    }
    
    return null;
}

export function getMonthIndex(monthName) {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    return months.indexOf(monthName.toLowerCase().substring(0, 3));
}

export function dateRangeMatches(recordRange, selectedRange) {
    if (!recordRange || !selectedRange) return true;
    
    try {
        const recordStart = getDateRangeStart(recordRange);
        const recordEnd = getDateRangeEnd(recordRange);
        const selectedStart = getDateRangeStart(selectedRange);
        const selectedEnd = getDateRangeEnd(selectedRange);
        
        if (!recordStart || !recordEnd || !selectedStart || !selectedEnd) {
            return true; // If we can't parse, assume it matches
        }
        
        // Check if there's any overlap
        return recordStart <= selectedEnd && recordEnd >= selectedStart;
    } catch (error) {
        logger.warn('Error comparing date ranges', { recordRange, selectedRange, error: error.message });
        return true; // If there's an error, assume it matches
    }
}

export function exportToCSV(data, filename) {
    if (!data || data.length === 0) {
        logger.warn('No data to export');
        return;
    }
    
    const headers = Object.keys(data[0]);
    const csvContent = [
        headers.join(','),
        ...data.map(row => 
            headers.map(header => {
                const value = row[header];
                // Escape commas and quotes in CSV data
                if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                    return `"${value.replace(/"/g, '""')}"`;
                }
                return value;
            }).join(',')
        )
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

export function cleanUrl(url) {
    if (!url) return '';
    
    try {
        // Remove protocol and trailing slashes
        let cleaned = url.replace(/^https?:\/\//, '');
        cleaned = cleaned.replace(/\/+$/, '');
        
        // Remove www prefix
        cleaned = cleaned.replace(/^www\./, '');
        
        return cleaned;
    } catch (error) {
        return url; // Return original if cleaning fails
    }
}

export function extractPageName(url) {
    if (!url) return 'Unknown Page';
    
    try {
        const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
        const path = urlObj.pathname;
        
        if (path === '/' || path === '') {
            return 'Home Page';
        }
        
        // Extract the last meaningful segment
        const segments = path.split('/').filter(segment => segment.length > 0);
        if (segments.length === 0) {
            return 'Home Page';
        }
        
        const lastSegment = segments[segments.length - 1];
        
        // Clean up the segment
        return lastSegment
            .replace(/[-_]/g, ' ')
            .replace(/\b\w/g, l => l.toUpperCase())
            .trim();
    } catch (error) {
        // Fallback for invalid URLs
        return url.split('/').pop() || 'Unknown Page';
    }
}

export function getPageDisplayName(url) {
    if (!url) return 'Unknown Page';
    
    // Clean up the URL first
    const cleaned = cleanUrl(url);
    
    // Extract meaningful page name
    return extractPageName(cleaned);
}

// ===== Simple Image Placeholder System =====

/**
 * Create a simple background color for pages
 * @param {string} title - Page title (unused in simple version)
 * @param {string} type - Page type ('page' or 'blog')
 * @param {string} url - Page URL (unused in simple version)
 * @returns {string} CSS background color
 */
export function createPagePlaceholder(title, type = 'page', url = '') {
    // Simple background colors based on page type
    if (type === 'blog') {
        return '#f0f9ff'; // Light blue for blog posts
    } else {
        return '#f8fafc'; // Light gray for regular pages
    }
}

/**
 * Get page image - now simply returns a placeholder
 * @param {string} url - Page URL
 * @param {string} type - Page type ('page' or 'blog')
 * @returns {string} Placeholder image data URL
 */
export function getPageImage(url, type = 'page') {
    if (!url) return createPagePlaceholder('Invalid URL', type);
    
    const displayName = getPageDisplayName(url);
    return createPagePlaceholder(displayName, type, url);
}

/**
 * Get page display name
 * @param {string} url - Page URL
 * @returns {string} Page display name
 */
export function getPageTitle(url) {
    if (!url) return 'Unknown Page';
    return getPageDisplayName(url);
}

/**
 * Normalize a page URL for deduplication and consistent comparisons
 * - Forces https protocol
 * - Lowercases host
 * - Removes query string and hash
 * - Removes trailing slash (except for root)
 * - Ensures output format: https://host/path
 */
export function normalizePageUrl(url) {
    if (!url || typeof url !== 'string') return '';
    try {
        // Fix common malformed protocols like https:///example
        const fixed = url.replace(/^https?:\/{3,}/i, (m) => m.toLowerCase().startsWith('https') ? 'https://' : 'http://');
        const u = new URL(fixed, fixed.startsWith('http') ? undefined : 'https://');
        const protocol = 'https:'; // unify to https for consistency
        const host = (u.host || '').toLowerCase();
        let pathname = u.pathname || '/';
        if (pathname.length > 1) {
            pathname = pathname.replace(/\/+$/, '');
        }
        return `${protocol}//${host}${pathname}`;
    } catch (_) {
        try {
            // Best-effort fallback: strip protocol, query, hash, and trailing slash
            let cleaned = String(url);
            cleaned = cleaned.replace(/\?.*$/, '').replace(/#.*$/, '');
            cleaned = cleaned.replace(/^https?:\/\//i, '');
            cleaned = cleaned.replace(/\/+$/, '');
            // Prepend https://
            return `https://${cleaned}`;
        } catch (_) {
            return String(url);
        }
    }
}

// ===== Performance Monitoring =====
class PerformanceMonitor {
    constructor() {
        this.metrics = new Map();
        this.thresholds = new Map();
    }

    startTimer(operationName) {
        this.metrics.set(operationName, {
            startTime: performance.now(),
            duration: 0
        });
        logger.debug(`Started timing: ${operationName}`);
    }

    endTimer(operationName) {
        const metric = this.metrics.get(operationName);
        if (metric) {
            metric.duration = performance.now() - metric.startTime;
            
            const threshold = this.getThreshold(operationName);
            if (threshold && metric.duration > threshold) {
                logger.warn(`Performance warning: ${operationName} took ${metric.duration.toFixed(2)}ms (threshold: ${threshold}ms)`);
            } else {
                logger.debug(`${operationName} completed in ${metric.duration.toFixed(2)}ms`);
            }
        }
    }

    getThreshold(operationName) {
        return this.thresholds.get(operationName) || 100; // Default 100ms threshold
    }

    getSummary() {
        const summary = {};
        this.metrics.forEach((metric, operation) => {
            summary[operation] = {
                duration: metric.duration,
                threshold: this.getThreshold(operation),
                exceeded: metric.duration > this.getThreshold(operation)
            };
        });
        return summary;
    }

    clear() {
        this.metrics.clear();
    }
}

// ===== Global Performance Monitor =====
export const performanceMonitor = new PerformanceMonitor();

// ===== Performance Monitoring Decorators =====
export function withPerformanceMonitoring(operationName, fn) {
    return async function(...args) {
        performanceMonitor.startTimer(operationName);
        try {
            const result = await fn.apply(this, args);
            return result;
        } finally {
            performanceMonitor.endTimer(operationName);
        }
    };
}

export function withPerformanceMonitoringSync(operationName, fn) {
    return function(...args) {
        performanceMonitor.startTimer(operationName);
        try {
            const result = fn.apply(this, args);
            return result;
        } finally {
            performanceMonitor.endTimer(operationName);
        }
    };
}

// ===== Loading Indicator =====
class LoadingIndicator {
    constructor() {
        this.activeIndicators = new Map();
    }

    show(operationName, targetElement = null) {
        if (this.activeIndicators.has(operationName)) {
            return; // Already showing
        }

        const indicator = this.createIndicator(operationName);
        this.activeIndicators.set(operationName, indicator);
        
        if (targetElement) {
            targetElement.appendChild(indicator);
        } else {
            document.body.appendChild(indicator);
        }
    }

    hide(operationName) {
        const indicator = this.activeIndicators.get(operationName);
        if (indicator && indicator.parentNode) {
            indicator.parentNode.removeChild(indicator);
            this.activeIndicators.delete(operationName);
        }
    }

    createIndicator(operationName) {
        const indicator = document.createElement('div');
        indicator.className = 'loading-indicator';
        indicator.innerHTML = `
            <div class="loading-content">
                <div class="loading-spinner"></div>
                <div class="loading-text">Loading ${operationName}...</div>
            </div>
        `;
        
        // Add styles
        indicator.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(255, 255, 255, 0.9);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
            font-family: system-ui, -apple-system, sans-serif;
        `;
        
        // Add CSS for loading content only once
        if (!document.getElementById('global-loading-indicator-styles')) {
            const style = document.createElement('style');
            style.id = 'global-loading-indicator-styles';
            style.textContent = `
                .loading-content {
                    text-align: center;
                    padding: 2rem;
                    background: white;
                    border-radius: 8px;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                }
                
                .loading-spinner {
                    width: 40px;
                    height: 40px;
                    border: 4px solid #f3f4f6;
                    border-top: 4px solid #3b82f6;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                    margin: 0 auto 1rem auto;
                }
                
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                
                .loading-text {
                    color: #374151;
                    font-size: 0.875rem;
                    font-weight: 500;
                }
            `;
            document.head.appendChild(style);
        }
        
        return indicator;
    }

    showMultiple(operations) {
        operations.forEach(op => this.show(op));
    }

    hideMultiple(operations) {
        operations.forEach(op => this.hide(op));
    }

    hideAll() {
        this.activeIndicators.forEach((indicator, operationName) => {
            this.hide(operationName);
        });
    }
}

// ===== Global Loading Indicator =====
export const loadingIndicator = new LoadingIndicator();

// ===== Convenience Functions =====
export function showFilterLoading(operationName) {
    loadingIndicator.show(operationName);
}

export function hideFilterLoading(operationName) {
    loadingIndicator.hide(operationName);
}

// Removed legacy smart image loading compatibility functions (no longer used)