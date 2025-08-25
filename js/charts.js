import { logger } from './logger.js';
import { parsePercentage } from './utils.js';
import { parseDate } from './dateUtils.js';
import { getChartZoomScrollManager, updateChartZoomManager } from './chartZoomScroll.js';

// ===== Reusable Chart Model =====
class ReusableChartModel {
    constructor(chartId, containerId, options = {}) {
        this.chartId = chartId;
        this.containerId = containerId;
        this.options = {
            defaultMetrics: ['clicks', 'impressions'],
            colors: {
                clicks: '#1a73e8',
                impressions: '#ea4335',
                ctr: '#34a853',
                position: '#fbbc04'
            },
            ...options
        };
        
        this.selectedMetrics = new Set(this.options.defaultMetrics);
        this.chart = null;
        this.data = null;
        this.isUpdating = false;
        
        logger.debug(`ReusableChartModel created for ${chartId} with container ${containerId}`);
    }

    setData(data) {
        this.data = data;
    }

    getData() {
        return this.data;
    }

    setSelectedMetrics(metrics) {
        this.selectedMetrics = new Set(metrics);
    }

    getSelectedMetrics() {
        return new Set(this.selectedMetrics);
    }

    addMetric(metric) {
        this.selectedMetrics.add(metric);
    }

    removeMetric(metric) {
        this.selectedMetrics.delete(metric);
    }

    hasMetric(metric) {
        return this.selectedMetrics.has(metric);
    }

    setChart(chart) {
        this.chart = chart;
    }

    getChart() {
        return this.chart;
    }

    destroy() {
        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }
    }

    setUpdating(updating) {
        this.isUpdating = updating;
    }

    isChartUpdating() {
        return this.isUpdating;
    }
}

// ===== Chart State Management =====
class ChartState {
    constructor() {
        this.globalData = {};
        this.charts = {};
        this.chartModels = new Map(); // Store reusable chart models
    }

    setGlobalData(data) {
        this.globalData = data;
    }

    getGlobalData() {
        return this.globalData;
    }

    setCharts(charts) {
        this.charts = charts;
    }

    getCharts() {
        return this.charts;
    }

    addChart(chartId, chart) {
        this.charts[chartId] = chart;
    }

    removeChart(chartId) {
        if (this.charts[chartId]) {
            this.charts[chartId].destroy();
            delete this.charts[chartId];
        }
    }

    clearCharts() {
        Object.keys(this.charts).forEach(chartId => {
            this.removeChart(chartId);
        });
    }

    // Chart Model Management
    addChartModel(chartId, model) {
        this.chartModels.set(chartId, model);
    }

    getChartModel(chartId) {
        return this.chartModels.get(chartId);
    }

    removeChartModel(chartId) {
        const model = this.chartModels.get(chartId);
        if (model) {
            model.destroy();
            this.chartModels.delete(chartId);
        }
    }

    getAllChartModels() {
        return this.chartModels;
    }
}



// ===== Error Handling =====
class ChartErrorHandler {
    static handleChartError(error, context) {
        logger.error('Chart error occurred', { 
            error: error.message, 
            context,
            stack: error.stack 
        });

        // Show user-friendly error message
        this.showChartError(context);
    }

    static showChartError(context) {
        const errorMessage = document.createElement('div');
        errorMessage.className = 'chart-error';
        errorMessage.innerHTML = `
            <div class="error-content">
                <span class="error-icon">⚠️</span>
                <span class="error-text">Chart failed to load. Please try refreshing the data.</span>
                <button class="error-retry" onclick="location.reload()">Retry</button>
            </div>
        `;
        errorMessage.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: #fee2e2;
            color: #dc2626;
            padding: 1rem;
            border-radius: 0.5rem;
            border: 1px solid #fca5a5;
            z-index: 1000;
            text-align: center;
        `;
        
        let chartContainer = null;
        if (context && typeof context.chartId === 'string' && context.chartId) {
            chartContainer = document.getElementById(context.chartId) || document.querySelector(`#${context.chartId}`);
        }
        if (!chartContainer) {
            chartContainer = document.querySelector('.chart-container');
        }
        if (chartContainer) {
            if (getComputedStyle(chartContainer).position === 'static') {
                chartContainer.style.position = 'relative';
            }
            chartContainer.appendChild(errorMessage);
        }
    }

    static clearChartError(chartId) {
        let container = null;
        if (typeof chartId === 'string' && chartId) {
            container = document.getElementById(chartId) || document.querySelector(`#${chartId}`);
        }
        if (!container) {
            container = document.querySelector('.chart-container');
        }
        const errorElement = container ? container.querySelector('.chart-error') : null;
        if (errorElement) {
            errorElement.remove();
        }
    }
}

// ===== Performance Optimization =====
class ChartPerformanceOptimizer {
    static debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
}

// ===== Unified Chart Creation Function =====

/**
 * Unified function to create or update any chart with consistent logic
 * @param {string} chartId - The canvas element ID
 * @param {Array} dates - Array of date objects
 * @param {Array} datasets - Array of dataset configurations
 * @param {Object} options - Chart options
 * @param {Object} existingChart - Existing chart instance to update
 * @returns {Object} Chart instance
 */
function createUnifiedChart(chartId, dates, datasets, options = {}, existingChart = null) {
    try {
        const chartElement = document.getElementById(chartId);
        if (!chartElement) {
            logger.warn(`Chart element not found: ${chartId}`);
            return null;
        }

        const ctx = chartElement.getContext('2d');
        if (!ctx) {
            logger.error(`Failed to get canvas context for: ${chartId}`);
            return null;
        }
        
        // Clear any existing error messages
        ChartErrorHandler.clearChartError(chartId);
        
        // Destroy existing chart if provided
        if (existingChart) {
            try {
                existingChart.destroy();
            } catch (error) {
                logger.warn('Failed to destroy existing chart', { chartId, error: error.message });
            }
        }

        // Validate and optimize data
        if (!dates || dates.length === 0) {
            logger.warn('No date data provided for chart', { chartId });
            return null;
        }
        
        // Validate data structure
        const validDates = dates.filter(date => {
            if (!date) return false;
            const dateValue = date.Date || date.date;
            if (!dateValue) return false;
            
            try {
                const parsedDate = new Date(dateValue);
                return !isNaN(parsedDate.getTime());
            } catch (e) {
                return false;
            }
        });
        
        if (validDates.length === 0) {
            logger.error('No valid date data found in chart data', { 
                chartId, 
                totalDates: dates.length,
                sampleDate: dates[0]
            });
            return null;
        }
        
        if (validDates.length !== dates.length) {
            logger.warn(`Filtered out ${dates.length - validDates.length} invalid dates`, { 
                chartId, 
                originalCount: dates.length,
                validCount: validDates.length
            });
        }
        
        // Use validated dates
        const datesToUse = validDates;

        // Preserve one-to-one alignment between labels and dataset values
        const optimizedDates = datesToUse;
        const optimizedDatasets = datasets;

        // Create labels using consistent logic
        const labels = optimizedDates.map((d) => {
            try {
                const date = new Date(d.Date || d.date);
                if (isNaN(date.getTime())) {
                    return 'Invalid Date';
                }
                return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            } catch (error) {
                logger.warn('Failed to format date label', { date: d, error: error.message });
                return 'Unknown';
            }
        });

        // Default chart options with consistent scaling
        const defaultOptions = {
            responsive: true,
            maintainAspectRatio: false,
            spanGaps: true, // Always connect lines even if there are missing values
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                tooltip: {
                    backgroundColor: '#ffffff',
                    titleColor: '#202124',
                    bodyColor: '#5f6368',
                    borderColor: '#dadce0',
                    borderWidth: 1,
                    cornerRadius: 8,
                    displayColors: true,
                    titleFont: {
                        size: 14,
                        weight: '500',
                        family: 'Roboto, Arial, sans-serif'
                    },
                    bodyFont: {
                        size: 13,
                        family: 'Roboto, Arial, sans-serif'
                    },
                    padding: 12,
                    boxPadding: 6,
                    boxWidth: 6,
                    boxHeight: 6,
                    callbacks: {
                        title: function(context) {
                            const dataIndex = context[0].dataIndex;
                            
                            // Check if zoom manager is handling tooltips
                            const zoomManager = window.chartZoomScrollManager || getChartZoomScrollManager();
                            if (zoomManager && zoomManager.chart && zoomManager.isHandlingTooltips) {
                                // Let zoom manager handle the tooltip
                                return zoomManager.getTooltipTitle(context);
                            }
                            
                            // Original logic for when zoom manager is not active
                            // Use consistent date parsing to match filtering logic
                            try {
                                const dateString = optimizedDates[dataIndex].Date || optimizedDates[dataIndex].date;
                                const date = parseDate(dateString);
                                if (!date) {
                                    return 'Invalid Date';
                                }
                                return date.toLocaleDateString('en-US', { 
                                    month: 'short', 
                                    day: 'numeric', 
                                    year: 'numeric' 
                                }).replace(',', '');
                            } catch (error) {
                                return 'Unknown Date';
                            }
                        },
                        label: function(context) {
                            const label = context.dataset.label || '';
                            const dataIndex = context.dataIndex;
                            
                            // Check if zoom manager is handling tooltips
                            const zoomManager = window.chartZoomScrollManager || getChartZoomScrollManager();
                            if (zoomManager && zoomManager.chart && zoomManager.isHandlingTooltips) {
                                // Let zoom manager handle the tooltip
                                return zoomManager.getTooltipLabel(context);
                            }
                            
                            // Original logic for when zoom manager is not active
                            // Get original value from the dataset's originalData
                            const originalValue = context.dataset.originalData?.[dataIndex];
                            
                            if (originalValue === undefined || originalValue === null) {
                                return `${label}: No data`;
                            }
                            
                            // Format the value appropriately based on metric type
                            if (label === 'CTR (%)') {
                                return `${label}: ${originalValue}`;
                            } else if (label === 'Position') {
                                return `${label}: ${originalValue.toFixed(1)}`;
                            } else {
                                return `${label}: ${originalValue.toLocaleString()}`;
                            }
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        display: true,
                        color: '#f1f3f4',
                        drawBorder: false
                    },
                    ticks: {
                        color: '#5f6368',
                        font: {
                            size: 12,
                            family: 'Roboto, Arial, sans-serif'
                        },
                        maxTicksLimit: function() {
                            // Check if we're at max zoom level (month view)
                            const zoomLevel = window.chartZoomLevel || 1;
                            const isMaxZoom = zoomLevel >= 30;
                            
                            // At max zoom, show all days (no limit)
                            // At regular zoom, limit to 12 for readability
                            return isMaxZoom ? undefined : 12;
                        }(),
                        callback: function(value, index, ticks) {
                            // value is already the label or index depending on Chart.js version
                            // try to resolve to a string label robustly without relying on this.getLabelForValue
                            let label = '';
                            try {
                                if (typeof value === 'string') {
                                    label = value;
                                } else if (Array.isArray(this.getLabels?.())) {
                                    const idx = typeof value === 'number' ? value : index;
                                    label = this.getLabels()[idx] ?? '';
                                } else if (typeof this.getLabelForValue === 'function') {
                                    label = this.getLabelForValue(value) || '';
                                }
                            } catch (_) {
                                label = '';
                            }
                            if (!label) return '';
                            
                            // Check if we're at max zoom level (month view)
                            const zoomLevel = window.chartZoomLevel || 1;
                            const isMaxZoom = zoomLevel >= 30;
                            
                            if (isMaxZoom) {
                                // Month view - labels are day numbers
                                if (label && !isNaN(parseInt(label))) {
                                    const dayNum = parseInt(label);
                                    // Show "Month Day, Year" format for first and last day, day numbers for others
                                    if (index === 0 || index === ticks.length - 1) {
                                        // Get month info from zoom manager
                                        const zoomManager = window.chartZoomScrollManager;
                                        if (zoomManager && zoomManager.currentMonthInfo) {
                                            const { monthName, year } = zoomManager.currentMonthInfo;
                                            return `${monthName} ${dayNum}, ${year}`;
                                        }
                                        // Fallback to current date
                                        const currentDate = new Date();
                                        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                                                           'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                                        const month = monthNames[currentDate.getMonth()];
                                        const year = currentDate.getFullYear();
                                        return `${month} ${dayNum}, ${year}`;
                                    }
                                    // Return just the day number for other days
                                    return dayNum.toString();
                                }
                                
                                // Try to parse as date for fallback
                                const date = new Date(label);
                                if (!isNaN(date.getTime())) {
                                    // Show "Month Day, Year" format for first and last day, day numbers for others
                                    if (index === 0 || index === ticks.length - 1) {
                                        return date.toLocaleDateString('en-US', { 
                                            month: 'short', 
                                            day: 'numeric',
                                            year: 'numeric'
                                        });
                                    } else {
                                        return date.getDate().toString();
                                    }
                                }
                            } else {
                                // Regular zoom - labels should already be in "Month Year" format
                                if (label && label.includes(' ')) {
                                    return label;
                                }
                                
                                // Try to parse as date for fallback
                                const date = new Date(label);
                                if (!isNaN(date.getTime())) {
                                    return date.toLocaleDateString('en-US', { 
                                        month: 'short', 
                                        year: 'numeric' 
                                    });
                                }
                            }
                            
                            // Final fallback
                            return label || '';
                        }
                    },
                    border: {
                        display: false
                    }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: false // Removed default title - will be set dynamically
                    },
                    beginAtZero: true,
                    grid: {
                        color: '#f1f3f4',
                        drawBorder: false
                    },
                    ticks: {
                        color: '#5f6368',
                        font: {
                            size: 12,
                            family: 'Roboto, Arial, sans-serif'
                        }
                    }
                }
            },
            elements: {
                line: {
                    borderWidth: 2
                }
            }
        };

        // Merge with provided options
        const finalOptions = {
            ...defaultOptions,
            ...options,
            plugins: {
                ...defaultOptions.plugins,
                ...options.plugins
            },
            scales: {
                ...defaultOptions.scales,
                ...options.scales
            }
        };

        // Ensure Chart.js is available
        if (typeof Chart === 'undefined') {
            logger.error('Chart.js library not loaded. Cannot create chart.');
            ChartErrorHandler.showChartError({ chartId, function: 'createUnifiedChart' });
            
            // Dispatch event for UI to show error
            window.dispatchEvent(new CustomEvent('chartError', {
                detail: { 
                    chartId, 
                    error: 'Chart.js library not loaded',
                    function: 'createUnifiedChart'
                }
            }));
            
            return null;
        }

        // Create chart
        let chart;
        try {
            chart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: optimizedDatasets
                },
                options: finalOptions
            });
            
            logger.info(`Chart created successfully for ${chartId}`, {
                datasetsCount: optimizedDatasets.length,
                labelsCount: labels.length
            });
        } catch (chartError) {
            logger.error(`Failed to create chart for ${chartId}:`, chartError);
            ChartErrorHandler.showChartError({ chartId, function: 'createUnifiedChart' });
            
            // Dispatch event for UI to show error
            window.dispatchEvent(new CustomEvent('chartError', {
                detail: { 
                    chartId, 
                    error: chartError.message,
                    function: 'createUnifiedChart'
                }
            }));
            
            return null;
        }

        logger.info(`Unified chart created/updated: ${chartId}`, {
            datasetsCount: optimizedDatasets.length,
            labelsCount: labels.length,
            originalDataPoints: dates.length,
            optimizedDataPoints: optimizedDates.length
        });

        return chart;
    } catch (error) {
        ChartErrorHandler.handleChartError(error, { chartId, function: 'createUnifiedChart' });
        return null;
    }
}

/**
 * Unified data normalization function
 * @param {Array} data - Raw data array
 * @returns {Array} Normalized data array (0-100 range)
 */
function normalizeData(data) {
    try {
        const values = data.filter(v => v !== null && v !== undefined && !isNaN(v));
        if (values.length === 0) return data.map(() => 0);
        
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = max - min;
        
        if (range === 0) return data.map(() => 50); // If all values are the same, center at 50
        
        const normalizedData = data.map(value => {
            if (value === null || value === undefined || isNaN(value)) return 0;
            const normalized = ((value - min) / range) * 100;
            // Remove clamping to preserve true relative relationships
            // Only ensure the value is finite
            return Number.isFinite(normalized) ? normalized : 0;
        });
        return normalizedData;
    } catch (error) {
        logger.error('Failed to normalize data', { error: error.message });
        return data.map(() => 0);
    }
}

// ===== Chart Management Functions =====

// ===== Metric Management Functions =====

/**
 * Toggle metric visibility
 * @param {string} metric - Metric to toggle
 */
export function toggleMetric(metric) {
    try {
        const button = document.getElementById(`btn-${metric}`);
        if (!button) {
            logger.warn(`Button not found for metric: ${metric}`);
            return;
        }

        const isActive = button.classList.contains('active');
        
        // Get the performance chart model (default chart)
        let performanceModel = chartState.getChartModel('performance');
        if (!performanceModel) {
            // Create the performance chart model if it doesn't exist
            performanceModel = new ReusableChartModel('performance', 'performanceChart', {
                defaultMetrics: ['clicks', 'impressions']
            });
            chartState.addChartModel('performance', performanceModel);
        }
        
        if (isActive) {
            performanceModel.removeMetric(metric);
            button.classList.remove('active');
        } else {
            performanceModel.addMetric(metric);
            button.classList.add('active');
        }
        
        // Ensure at least one metric is selected
        if (performanceModel.getSelectedMetrics().size === 0) {
            performanceModel.addMetric('clicks');
            const clicksButton = document.getElementById('btn-clicks');
            if (clicksButton) {
                clicksButton.classList.add('active');
            }
        }
        
        // Update the chart with current data
        if (performanceModel.getData()) {
            updateChartModel(performanceModel, performanceModel.getData())();
        }
        
        logger.info(`Metric ${metric} ${!isActive ? 'enabled' : 'disabled'} for performance chart`);
    } catch (error) {
        logger.error('Failed to toggle metric', { metric, error: error.message });
    }
}

/**
 * Reset all metrics to default
 */
export function resetMetrics() {
    try {
        // Get the performance chart model (default chart)
        let performanceModel = chartState.getChartModel('performance');
        if (!performanceModel) {
            // Create the performance chart model if it doesn't exist
            performanceModel = new ReusableChartModel('performance', 'performanceChart', {
                defaultMetrics: ['clicks', 'impressions']
            });
            chartState.addChartModel('performance', performanceModel);
        }
        
        // Reset to show only clicks and impressions (default state)
        performanceModel.setSelectedMetrics(['clicks', 'impressions']);
        
        // Update buttons - activate only clicks and impressions, deactivate others
        const allMetrics = ['clicks', 'impressions', 'ctr', 'position'];
        const defaultActiveMetrics = ['clicks', 'impressions'];
        
        allMetrics.forEach(metric => {
            const button = document.getElementById(`btn-${metric}`);
            if (button) {
                if (defaultActiveMetrics.includes(metric)) {
                    button.classList.add('active');
                } else {
                    button.classList.remove('active');
                }
            }
        });
        
        // Update the chart with current data
        if (performanceModel.getData()) {
            updateChartModel(performanceModel, performanceModel.getData())();
        }
        
        logger.info('Default metrics (clicks and impressions) enabled for performance chart');
    } catch (error) {
        logger.error('Failed to reset metrics', { error: error.message });
    }
}

/**
 * Get currently selected metrics
 * @returns {Set} Set of selected metric keys
 */
export function getSelectedMetrics() {
    // Get the performance chart model (default chart)
    let performanceModel = chartState.getChartModel('performance');
    if (!performanceModel) {
        // Create the performance chart model if it doesn't exist
        performanceModel = new ReusableChartModel('performance', 'performanceChart', {
            defaultMetrics: ['clicks', 'impressions']
        });
        chartState.addChartModel('performance', performanceModel);
    }
    return performanceModel.getSelectedMetrics();
}

/**
 * Set selected metrics
 * @param {Array} metrics - Array of metric keys to select
 */
export function setSelectedMetrics(metrics) {
    try {
        // Get the performance chart model (default chart)
        let performanceModel = chartState.getChartModel('performance');
        if (!performanceModel) {
            // Create the performance chart model if it doesn't exist
            performanceModel = new ReusableChartModel('performance', 'performanceChart', {
                defaultMetrics: ['clicks', 'impressions']
            });
            chartState.addChartModel('performance', performanceModel);
        }
        
        performanceModel.setSelectedMetrics(metrics);
        
        // Update button states
        const allMetrics = ['clicks', 'impressions', 'ctr', 'position'];
        allMetrics.forEach(metric => {
            const button = document.getElementById(`btn-${metric}`);
            if (button) {
                if (performanceModel.hasMetric(metric)) {
                    button.classList.add('active');
                } else {
                    button.classList.remove('active');
                }
            }
        });
        
        // Update the chart with current data
        if (performanceModel.getData()) {
            updateChartModel(performanceModel, performanceModel.getData())();
        }
    } catch (error) {
        logger.error('Failed to set selected metrics', { metrics, error: error.message });
    }
}

// ===== Chart Update Functions =====

/**
 * Update the main performance chart
 * @param {Object} data - Chart data
 */
// ===== Reusable Chart Update Function =====
export function updateChartModel(chartModel, data = null) {
    return ChartPerformanceOptimizer.debounce(function() {
        try {
            // Check if Chart.js is available
            if (typeof Chart === 'undefined') {
                logger.error('Chart.js library not loaded. Cannot update chart.');
                return;
            }
            
            // Check if chart container exists
            const container = document.getElementById(chartModel.containerId);
            if (!container) {
                logger.error(`Chart container not found: ${chartModel.containerId}`);
                return;
            }
            
            const chartData = data || chartModel.getData();
            
            // Check if we have data and chart element
            if (!chartData || !chartData.dates || chartData.dates.length === 0) {
                logger.warn(`No date data available for chart update: ${chartModel.chartId}`);
                return;
            }
            
            // Prevent multiple simultaneous updates
            if (chartModel.isChartUpdating()) {
                logger.debug(`Chart update already in progress for ${chartModel.chartId}, skipping`);
                return;
            }
            
            chartModel.setUpdating(true);
        
            // Ensure globalData is set for zoom manager access
            if (chartData && Object.keys(chartData).length > 0) {
                window.globalData = chartData;
                logger.debug(`Set window.globalData for zoom manager: ${chartModel.chartId}`, {
                    dataKeys: Object.keys(chartData),
                    datesLength: chartData.dates?.length || 0
                });
            }
        
            const dates = chartData.dates.sort((a, b) => new Date(a.Date) - new Date(b.Date));
        
            // Get zoom scroll manager
            const zoomManager = getChartZoomScrollManager();
        
            logger.debug(`updateChartModel called for ${chartModel.chartId}`, {
                dataKeys: Object.keys(chartData),
                datesLength: dates.length,
                sampleDate: dates[0],
                hasZoomManager: !!zoomManager
            });
        
            // Check selected metrics and determine normalization strategy
            const selectedMetricsCount = chartModel.getSelectedMetrics().size;
        
            // Only normalize when multiple metrics are selected
            const shouldNormalize = selectedMetricsCount > 1;
        
            // Shared chart options to avoid duplication
            const sharedChartOptions = {
                plugins: {
                    legend: {
                        display: false // Explicitly disable chart legend
                    }
                },
                scales: {
                    x: {
                        grid: {
                            display: true,
                            color: '#f1f3f4',
                            drawBorder: false
                        },
                        ticks: {
                            color: '#5f6368',
                            font: {
                                size: 12,
                                family: 'Roboto, Arial, sans-serif'
                            },
                            maxTicksLimit: function() {
                                // Check if we're at max zoom level (month view)
                                const zoomLevel = window.chartZoomLevel || 1;
                                const isMaxZoom = zoomLevel >= 30;
                                
                                // At max zoom, show all days (no limit)
                                // At regular zoom, limit to 12 for readability
                                return isMaxZoom ? undefined : 12;
                            }()
                        },
                        border: {
                            display: false
                        }
                    }
                }
            };
        
            // Define all possible datasets with Google Search Console styling
            const allDatasets = {
                clicks: {
                    label: 'Clicks',
                    data: shouldNormalize ? normalizeData(dates.map(d => d.Clicks || 0)) : dates.map(d => d.Clicks || 0),
                    originalData: dates.map(d => d.Clicks || 0), // Store original data for tooltip
                    borderColor: '#1a73e8',
                    backgroundColor: 'rgba(26, 115, 232, 0.1)',
                    borderWidth: 2,
                    tension: 0,
                    fill: false,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    pointHoverBackgroundColor: '#1a73e8',
                    pointHoverBorderColor: '#ffffff',
                    pointHoverBorderWidth: 2
                },
                impressions: {
                    label: 'Impressions',
                    data: shouldNormalize ? normalizeData(dates.map(d => d.Impressions || 0)) : dates.map(d => d.Impressions || 0),
                    originalData: dates.map(d => d.Impressions || 0), // Store original data for tooltip
                    borderColor: '#ea4335',
                    backgroundColor: 'rgba(234, 67, 53, 0.1)',
                    borderWidth: 2,
                    tension: 0,
                    fill: false,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    pointHoverBackgroundColor: '#ea4335',
                    pointHoverBorderColor: '#ffffff',
                    pointHoverBorderWidth: 2
                },
                ctr: {
                    label: 'CTR (%)',
                    data: shouldNormalize ? normalizeData(dates.map(d => parsePercentage(d.CTR))) : dates.map(d => parsePercentage(d.CTR)),
                    originalData: dates.map(d => d.CTR || '0%'), // Store original data for tooltip
                    borderColor: '#34a853',
                    backgroundColor: 'rgba(52, 168, 83, 0.1)',
                    borderWidth: 2,
                    tension: 0,
                    fill: false,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    pointHoverBackgroundColor: '#34a853',
                    pointHoverBorderColor: '#ffffff',
                    pointHoverBorderWidth: 2
                },
                position: {
                    label: 'Position',
                    data: shouldNormalize ? normalizeData(dates.map(d => d.Position || 0)) : dates.map(d => d.Position || 0),
                    originalData: dates.map(d => d.Position || 0), // Store original data for tooltip
                    borderColor: '#fbbc04',
                    backgroundColor: 'rgba(251, 188, 4, 0.1)',
                    borderWidth: 2,
                    tension: 0,
                    fill: false,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    pointHoverBackgroundColor: '#fbbc04',
                    pointHoverBorderColor: '#ffffff',
                    pointHoverBorderWidth: 2
                }
            };
        
            // Filter datasets based on selected metrics
            const datasets = Array.from(chartModel.getSelectedMetrics()).map(metric => allDatasets[metric]);
        
            // Configure chart options based on selected metrics
            let chartOptions = {};
        
            if (selectedMetricsCount === 1) {
                // Single metric selected - show real values
                const singleMetric = Array.from(chartModel.getSelectedMetrics())[0];
                let axisTitle = '';
                let tickCallback = null;
            
                // Configure based on metric type
                switch(singleMetric) {
                    case 'clicks':
                        axisTitle = 'Clicks';
                        tickCallback = function(value) {
                            return value.toLocaleString();
                        };
                        break;
                    case 'impressions':
                        axisTitle = 'Impressions';
                        tickCallback = function(value) {
                            return value.toLocaleString();
                        };
                        break;
                    case 'ctr':
                        axisTitle = 'CTR (%)';
                        tickCallback = function(value) {
                            return value.toFixed(1) + '%';
                        };
                        break;
                    case 'position':
                        axisTitle = 'Position';
                        tickCallback = function(value) {
                            return value.toFixed(1);
                        };
                        break;
                }
            
                chartOptions = {
                    ...sharedChartOptions,
                    scales: {
                        ...sharedChartOptions.scales,
                        y: {
                            type: 'linear',
                            display: true,
                            position: 'left',
                            title: {
                                display: true,
                                text: axisTitle,
                                color: '#6B7280',
                                font: {
                                    size: 11,
                                    weight: '500'
                                }
                            },
                            beginAtZero: true,
                            grid: {
                                color: '#f1f3f4',
                                drawBorder: false
                            },
                            ticks: {
                                color: '#5f6368',
                                font: {
                                    size: 12,
                                    family: 'Roboto, Arial, sans-serif'
                                },
                                callback: tickCallback
                            }
                        }
                    }
                };
            
                // All datasets use the single Y-axis
                datasets.forEach(dataset => {
                    dataset.yAxisID = 'y';
                });
            } else {
                // Multiple metrics selected - use normalized scale
                chartOptions = {
                    ...sharedChartOptions,
                    scales: {
                        ...sharedChartOptions.scales,
                        y: {
                            type: 'linear',
                            display: true,
                            position: 'left',
                            title: {
                                display: false
                            },
                            beginAtZero: true,
                            min: 0,
                            max: 100,
                            grid: {
                                color: '#f1f3f4',
                                drawBorder: false
                            },
                            ticks: {
                                color: '#5f6368',
                                font: {
                                    size: 12,
                                    family: 'Roboto, Arial, sans-serif'
                                },
                                callback: function(value) {
                                    return value + '%';
                                }
                            }
                        }
                    }
                };
            
                // All datasets use the single Y-axis
                datasets.forEach(dataset => {
                    dataset.yAxisID = 'y';
                });
            }
        
            // Use unified chart creation with custom options
            const existingChart = chartModel.getChart();
            const newChart = createUnifiedChart(chartModel.containerId, dates, datasets, chartOptions, existingChart);
            if (newChart) {
                chartModel.setChart(newChart);
                chartState.addChart(chartModel.chartId, newChart);
            }
        
            // Notify zoom scroll manager of chart update
            if (zoomManager) {
                window.charts = window.charts || {};
                window.charts[chartModel.chartId] = chartModel.getChart();
                window.dispatchEvent(new CustomEvent('chartUpdated', { 
                    detail: { chartId: chartModel.chartId } 
                }));
            
                // Update the multi-chart zoom manager
                if (typeof updateChartZoomManager === 'function') {
                    updateChartZoomManager(chartModel.chartId, chartModel.getChart(), chartData);
                }
            
                // Also directly notify the zoom manager to ensure it gets the update
                setTimeout(() => {
                    if (zoomManager.onChartUpdate) {
                        zoomManager.onChartUpdate(chartModel.chartId);
                    }
                }, 0);
            }
        
            logger.info(`Chart ${chartModel.chartId} updated with metrics: ${Array.from(chartModel.getSelectedMetrics()).join(', ')}`);
        
        } catch (error) {
            ChartErrorHandler.handleChartError(error, { function: 'updateChartModel', chartId: chartModel.chartId });
        } finally {
            chartModel.setUpdating(false);
        }
    }, 100); // Debounce for 100ms
}

// ===== Utility Functions =====

/**
 * Get chart instance by ID
 * @param {string} chartId - Chart ID
 * @returns {Object|null} Chart instance or null
 */
export function getChart(chartId) {
    return chartState.getCharts()[chartId] || null;
}

/**
 * Destroy chart by ID
 * @param {string} chartId - Chart ID
 */
export function destroyChart(chartId) {
    try {
        chartState.removeChart(chartId);
        logger.info(`Chart destroyed: ${chartId}`);
    } catch (error) {
        logger.error('Failed to destroy chart', { chartId, error: error.message });
    }
}

/**
 * Destroy all charts
 */
export function destroyAllCharts() {
    try {
        chartState.clearCharts();
        logger.info('All charts destroyed');
    } catch (error) {
        logger.error('Failed to destroy all charts', { error: error.message });
    }
}

// ===== Dependencies Management =====

/**
 * Set dependencies for the charts module
 * @param {Object} data - Global data object
 * @param {Object} chartsObj - Charts object reference
 * @param {Function} parsePercentageFn - Parse percentage function
 */
export function setDependencies(data, chartsObj, parsePercentageFn) {
    try {
        // Store reference to the data instead of copying it
        chartState.setGlobalData(data);
        chartState.setCharts(chartsObj);
        
        // Also set window.globalData for zoom manager access
        if (data) {
            window.globalData = data;
        }
        
        logger.debug('Charts dependencies set', {
            hasData: !!data,
            dataKeys: data ? Object.keys(data) : [],
            chartsAvailable: !!chartsObj,
            globalDataSet: !!window.globalData
        });
    } catch (error) {
        logger.error('Failed to set chart dependencies', { error: error.message });
    }
}

// ===== Global Chart State Instance =====
const chartState = new ChartState();

// ===== Chart Model Management Functions =====

/**
 * Create a new reusable chart model
 * @param {string} chartId - Unique chart identifier
 * @param {string} containerId - HTML container ID
 * @param {Object} options - Chart options
 * @returns {ReusableChartModel} Chart model instance
 */
export function createChartModel(chartId, containerId, options = {}) {
    const model = new ReusableChartModel(chartId, containerId, options);
    chartState.addChartModel(chartId, model);
    logger.info(`Chart model created: ${chartId}`);
    return model;
}

/**
 * Get an existing chart model
 * @param {string} chartId - Chart identifier
 * @returns {ReusableChartModel|null} Chart model or null
 */
export function getChartModel(chartId) {
    return chartState.getChartModel(chartId);
}

/**
 * Update a specific chart model with data - optimized for instant response
 * @param {string} chartId - Chart identifier
 * @param {Object} data - Chart data
 */
export function updateChartById(chartId, data) {
    const updateStartTime = performance.now();
    logger.info(`Updating chart ${chartId} with optimized rendering...`);
    
    const model = chartState.getChartModel(chartId);
    if (model) {
        model.setData(data);
        
        // Use requestAnimationFrame for smooth updates
        requestAnimationFrame(() => {
            try {
                updateChartModel(model, data)();
                
                // Update chart zoom manager if available
                const chartZoomManager = getChartZoomScrollManager();
                if (chartZoomManager) {
                    const chartManager = chartZoomManager.getChartManager(chartId);
                    if (chartManager) {
                        const chart = getChart(chartId);
                        if (chart) {
                            chartManager.chart = chart;
                            chartManager.onChartUpdate();
                        }
                    }
                }
                
                const updateTime = performance.now() - updateStartTime;
                logger.info(`Chart ${chartId} update completed in ${updateTime.toFixed(2)}ms`);
                
            } catch (error) {
                logger.error(`Error updating chart ${chartId}:`, error);
                const updateTime = performance.now() - updateStartTime;
                logger.warn(`Chart ${chartId} update failed after ${updateTime.toFixed(2)}ms`);
            }
        });
    } else {
        logger.warn(`Chart model not found: ${chartId}`);
    }
}

/**
 * Destroy a chart model
 * @param {string} chartId - Chart identifier
 */
export function destroyChartModel(chartId) {
    chartState.removeChartModel(chartId);
    logger.info(`Chart model destroyed: ${chartId}`);
}

// Export the unified functions for use in other modules
export { 
    createUnifiedChart, 
    normalizeData, 
    chartState, 
    ReusableChartModel
};

// End of charts.js module 