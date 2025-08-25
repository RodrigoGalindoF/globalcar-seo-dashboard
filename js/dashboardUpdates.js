import { logger } from './logger.js';
import { createKPIComponent, updateKPISection } from './kpiComponent.js';
import { TopPagesTableComponent } from './topPagesTableComponent.js';
import { getChartModel, createChartModel, updateChartById } from './charts.js';

// ===== Global Variables =====
let globalData = {};
let kpiComponent = null;
let topPagesTableComponent = null;

// ===== Dashboard Update Functions =====
export async function updateDashboard() {
    logger.info('Updating dashboard...');
    
    updateDateRange();
    updateOverviewMetrics();
    updatePerformanceChart();
    
    logger.info('Dashboard update completed');
}

export function updateDateRange() {
    // Import date utility functions
    import('./dateUtils.js').then(({ getCurrentGlobalDateRange, formatDateRangeForDisplay }) => {
        const currentRange = getCurrentGlobalDateRange();
        const metaRange = globalData?.metadata?.global_date_range;
        const hasMeta = !!(metaRange && metaRange.start && metaRange.end);

        let displayText = 'All data';
        if (currentRange && currentRange.start && currentRange.end) {
            displayText = formatDateRangeForDisplay(currentRange);
        } else if (hasMeta) {
            displayText = formatDateRangeForDisplay({ start: metaRange.start, end: metaRange.end });
        }

        // Update all date range display elements
        const dateRangeElements = ['dateRangeText'];
        dateRangeElements.forEach(elementId => {
            const element = document.getElementById(elementId);
            if (element) element.textContent = displayText;
        });

        logger.info('Date range display updated', {
            source: currentRange ? 'selection' : (hasMeta ? 'metadata' : 'default'),
            dateRange: displayText
        });
    }).catch(err => {
        // Fallback if date utils can't be loaded
        logger.warn('Could not load date utils for range display', err);

        const metaRange = globalData?.metadata?.global_date_range;
        const fallbackText = (metaRange && metaRange.start && metaRange.end)
            ? `${metaRange.start} – ${metaRange.end}`
            : 'All data';

        ['dateRangeText'].forEach(elementId => {
            const element = document.getElementById(elementId);
            if (element) element.textContent = fallbackText;
        });
    });
}

export function updateOverviewMetrics(data) {
    // Always use provided (possibly filtered) data; fall back to global
    const dataToUse = data || globalData;
    
    const updateStartTime = performance.now();
    
    // Use requestAnimationFrame for smooth updates
    requestAnimationFrame(() => {
        try {
            // Initialize KPI component if not already done
            if (!kpiComponent) {
                kpiComponent = createKPIComponent('overviewMetrics');
                kpiComponent.createKPISection();
                logger.info('KPI component initialized for overview section');
            }
            
            // Update KPI values using the component with the correct data
            if (kpiComponent.safeUpdateKPIs) {
                kpiComponent.safeUpdateKPIs(dataToUse);
            } else {
                updateKPISection(kpiComponent, dataToUse);
            }
            
            const updateTime = performance.now() - updateStartTime;
            logger.info(`Overview metrics updated (${data ? 'filtered' : 'global'}) in ${updateTime.toFixed(2)}ms`);
        } catch (error) {
            logger.error('Error updating overview metrics:', error);
            const updateTime = performance.now() - updateStartTime;
            logger.warn(`Overview metrics update failed after ${updateTime.toFixed(2)}ms`);
        }
    });
}

// ===== Chart UI Helper Functions =====
function showChartLoading() {
    const loadingIndicator = document.getElementById('chartLoadingIndicator');
    const errorIndicator = document.getElementById('chartErrorIndicator');
    const chartCanvas = document.getElementById('performanceChart');
    
    if (loadingIndicator) loadingIndicator.style.display = 'block';
    if (errorIndicator) errorIndicator.style.display = 'none';
    if (chartCanvas) chartCanvas.style.display = 'none';
}

function hideChartLoading() {
    const loadingIndicator = document.getElementById('chartLoadingIndicator');
    const chartCanvas = document.getElementById('performanceChart');
    
    if (loadingIndicator) loadingIndicator.style.display = 'none';
    if (chartCanvas) chartCanvas.style.display = 'block';
}

function showChartError() {
    const loadingIndicator = document.getElementById('chartLoadingIndicator');
    const errorIndicator = document.getElementById('chartErrorIndicator');
    const chartCanvas = document.getElementById('performanceChart');
    
    if (loadingIndicator) loadingIndicator.style.display = 'none';
    if (errorIndicator) errorIndicator.style.display = 'block';
    if (chartCanvas) chartCanvas.style.display = 'none';
}

export function updatePerformanceChart(data) {
    const dataToUse = data || globalData;
    
    const updateStartTime = performance.now();
    
    // Show loading indicator
    showChartLoading();
    
    // Use requestAnimationFrame for smooth updates
    requestAnimationFrame(() => {
        try {
            // Check if chart container exists
            const chartContainer = document.getElementById('performanceChart');
            if (!chartContainer) {
                logger.error('Performance chart container not found. Cannot create chart.');
                // Ensure UI reflects error state and spinner is cleared
                showChartError();
                return;
            }
            
            // Use the new reusable chart model system
            let performanceModel = getChartModel('performance');
            if (!performanceModel) {
                // Create the performance chart model if it doesn't exist
                logger.info('Creating new performance chart model...');
                performanceModel = createChartModel('performance', 'performanceChart', {
                    defaultMetrics: ['clicks', 'impressions']
                });
                logger.info('Performance chart model created:', performanceModel);
            } else {
                logger.info('Using existing performance chart model:', performanceModel);
            }
            
            // Check if data has required structure
            if (!dataToUse || !dataToUse.dates || dataToUse.dates.length === 0) {
                logger.warn('No date data available for chart update');
                // Ensure UI reflects error state and spinner is cleared
                showChartError();
                return;
            }
            
            // Update the chart with new data
            updateChartById('performance', dataToUse);
            
            const updateTime = performance.now() - updateStartTime;
            logger.info(`Performance chart updated (${data ? 'filtered' : 'global'}) in ${updateTime.toFixed(2)}ms`);
            
            // Hide loading indicator on success
            hideChartLoading();
        } catch (error) {
            logger.error('Error updating performance chart:', error);
            const updateTime = performance.now() - updateStartTime;
            logger.warn(`Performance chart update failed after ${updateTime.toFixed(2)}ms`);
            
            // Show error indicator
            showChartError();
        }
    });
}

export async function updateTopPagesTable(data) {
    // Always use provided (possibly filtered) data; fall back to global
    const dataToUse = data || globalData;
    
    const updateStartTime = performance.now();
    logger.info('Top Pages update', {
        hasProvidedData: !!data,
        dataSource: data ? 'filtered' : 'global',
        pagesDataLength: dataToUse.pages?.length || 0,
        dateRangesLength: dataToUse.dateRanges?.length || 0
    });
    
    // Use requestAnimationFrame for smooth updates
    return new Promise((resolve) => {
        requestAnimationFrame(async () => {
            try {
                // Initialize the Top Pages Table component if not already done
                if (!topPagesTableComponent) {
                    topPagesTableComponent = new TopPagesTableComponent({
                        containerId: 'topPagesTableContainer',
                        title: 'All Pages',
                        searchPlaceholder: 'Search pages...',
                        maxItems: 50, // Default limit for manual sorting filters
                        enableSearch: true,
                        enableViewToggle: true,
                        enableSorting: true,
                        defaultView: 'grid'
                    });
                    logger.info('Top Pages Table component initialized');
                }
                
                // Update the component with new data
                await topPagesTableComponent.updateData(dataToUse);
                
                const updateTime = performance.now() - updateStartTime;
                logger.info(`Top Pages table updated (${data ? 'filtered' : 'global'}) in ${updateTime.toFixed(2)}ms`);
                
                resolve();
            } catch (error) {
                logger.error('Error updating top pages table:', error);
                const updateTime = performance.now() - updateStartTime;
                logger.warn(`Top pages table update failed after ${updateTime.toFixed(2)}ms`);
                resolve();
            }
        });
    });
}

// Function to set dependencies
export function setDependencies(data, chartsObj) {
    globalData = data;
    logger.info('Dashboard updates dependencies set', {
        hasGlobalData: !!globalData,
        globalDataKeys: globalData ? Object.keys(globalData) : []
    });
    
    // Initialize the Top Pages Table component if not already done
    if (!topPagesTableComponent) {
        topPagesTableComponent = new TopPagesTableComponent({
            containerId: 'topPagesTableContainer',
            title: 'All Pages',
            searchPlaceholder: 'Search pages...',
            maxItems: 50, // Default limit for manual sorting filters
            enableSearch: true,
            enableViewToggle: true,
            enableSorting: true,
            defaultView: 'grid'
        });
        logger.info('Top Pages Table component initialized in setDependencies');
    }
}

// Expose current Top Pages UI state for prioritization logic
export function getTopPagesUIState() {
    try {
        const state = {
            sortField: topPagesTableComponent?.sortField || 'Auto',
            sortDirection: topPagesTableComponent?.sortDirection || 'desc',
            typeFilter: topPagesTableComponent?.typeFilter || 'All',
            searchTerm: typeof topPagesTableComponent?.getSearchTerm === 'function' 
                ? (topPagesTableComponent.getSearchTerm() || '') 
                : '',
            view: typeof topPagesTableComponent?.getCurrentView === 'function' 
                ? (topPagesTableComponent.getCurrentView() || 'grid') 
                : 'grid'
        };
        return state;
    } catch (e) {
        return { sortField: 'Auto', sortDirection: 'desc', typeFilter: 'All', searchTerm: '', view: 'grid' };
    }
}

// Attach an accessor on window for other modules (e.g., dashboard.js) to read UI state
if (typeof window !== 'undefined') {
    window.__dashboardUpdates__ = window.__dashboardUpdates__ || {};
    window.__dashboardUpdates__.getTopPagesUIState = getTopPagesUIState;
}





