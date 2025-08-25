import { logger } from './logger.js';
import { parseDate } from './dateUtils.js';

// ===== Chart Zoom Manager =====

class ChartZoomManager {
    constructor() {
        // Core state
        this.zoomLevel = 1;
        this.zoomCenter = 0.5; // 0-1, represents position in data (0 = start, 1 = end)
        this.panOffset = 0; // Additional offset for drag panning
        
        // Zoom filtering state
        this.zoomFilterTimeout = null; // Timeout for zoom filtering operations
        
        // Zoom center tracking
        this.zoomCenterDataIndex = null; // The actual data point index that should remain centered
        this.isZoomingFromPoint = false; // Flag to indicate if we're zooming from a specific point
        
        // State management flags
        this.isUpdatingChart = false; // Prevent recursive chart updates
        this.isUpdatingGlobalRange = false; // Prevent recursive date range updates
        this.isInternalUpdate = false; // Flag for internal state changes
        this.isHandlingTooltips = false; // Flag to indicate if zoom manager is controlling tooltips
        
        // Zoom configuration
        this.zoomLevels = {
            min: 0.1,  // Show 10% of data (zoomed out)
            max: 30,   // Show ~1 month of daily data (zoomed in)
            step: 0.35 // Slightly smaller step for smoother zoom
        };
        
        // Chart references
        this.chart = null;
        this.originalLabels = [];
        this.originalDatasets = [];
        this.globalDates = [];
        this.dateIndexByISO = new Map();
        
        // Calculated state
        this.totalDataPoints = 0;
        this.visibleDataPoints = 0;
        this.startDataIndex = 0;
        this.endDataIndex = 0;
        
        
        // rAF scheduling to coalesce zoom updates for smoothness
        this._scheduledUpdate = null;
        this._scheduledSync = null;
        
        logger.debug('ChartZoomManager initialized');
    }

    init() {
        this.setupEventListeners();
        
        // Initialize global zoom level
        window.chartZoomLevel = this.zoomLevel;
        

        
        logger.info('ChartZoomManager initialized');
    }



    setupEventListeners() {
        // Find the chart wrapper element (contains both canvas and axis areas)
        const chartWrapper = document.querySelector('.chart-wrapper');
        if (!chartWrapper) {
            logger.warn('Chart wrapper element not found');
            return;
        }

        // Mouse wheel for zooming - on chart wrapper, but only process if over data area
        chartWrapper.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });

        // Mouse move to keep zoom center in sync with cursor position
        chartWrapper.addEventListener('mousemove', (e) => this.handleMouseMove(e), { passive: true });

        // Keyboard events (global)
        document.addEventListener('keydown', (e) => this.handleKeyDown(e), { passive: false });

        // Chart update events (filter by chartId when provided)
        window.addEventListener('chartUpdated', (evt) => {
            try {
                const evtChartId = evt?.detail?.chartId;
                if (evtChartId && this.chartId && evtChartId !== this.chartId) return;
            } catch (_) {}
            this.onChartUpdate();
        });
        
        logger.debug('Chart zoom event listeners set');
    }

    // ===== Helper Functions =====

    /**
     * Check if the mouse is over the chart data area (canvas) vs axis areas
     * @param {MouseEvent} e - The mouse event
     * @returns {boolean} True if over chart data area, false if over axis areas
     */
    isOverChartDataArea(e) {
        const targetId = this.containerId || 'performanceChart';
        const chartCanvas = document.getElementById(targetId);
        if (!chartCanvas) {
            logger.warn('Chart canvas not found in isOverChartDataArea');
            return false;
        }
        
        const canvasRect = chartCanvas.getBoundingClientRect();
        const mouseX = e.clientX;
        const mouseY = e.clientY;
        
        // Check if mouse is within the canvas bounds with a small margin for better UX
        const margin = 2; // 2px margin for easier interaction
        const isOverCanvas = mouseX >= (canvasRect.left - margin) && 
                           mouseX <= (canvasRect.right + margin) && 
                           mouseY >= (canvasRect.top - margin) && 
                           mouseY <= (canvasRect.bottom + margin);
        
        return isOverCanvas;
    }

    // ===== Event Handlers =====

    handleWheel(e) {
        // Only handle wheel events if over the chart data area (canvas)
        if (!this.isOverChartDataArea(e)) {
            return; // Allow normal page scrolling over axis areas
        }
        
        // Prevent default behavior to avoid page scrolling
        e.preventDefault();
        e.stopPropagation();
        
        // Calculate mouse position relative to chart canvas
        const targetId = this.containerId || 'performanceChart';
        const chartCanvas = document.getElementById(targetId);
        if (!chartCanvas) return;
        
        const rect = chartCanvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const chartWidth = rect.width;
        const mousePosition = mouseX / chartWidth;
        
        // Map mouse position to the exact data point under the cursor
        if (this.totalDataPoints > 0) {
            // Calculate which data point the mouse is hovering over
            const dataIndex = Math.floor(mousePosition * this.totalDataPoints);
            this.zoomCenterDataIndex = Math.max(0, Math.min(this.totalDataPoints - 1, dataIndex));
            this.isZoomingFromPoint = true;
        }
        
        // Determine zoom direction with smoother step calculation
        const delta = e.deltaY > 0 ? -1 : 1;
        
        // Use a more gradual zoom step for smoother experience
        let zoomChange;
        if (Math.abs(e.deltaY) > 50) {
            // Larger scroll = bigger zoom change
            zoomChange = delta * this.zoomLevels.step * 1.5;
        } else {
            // Smaller scroll = smaller zoom change
            zoomChange = delta * this.zoomLevels.step * 0.8;
        }
        
        const newZoom = this.zoomLevel + zoomChange;
        
        // Check zoom limits
        if (delta < 0 && this.zoomLevel <= this.zoomLevels.min) {
            return;
        }
        
        if (delta > 0 && this.zoomLevel >= this.zoomLevels.max) {
            return;
        }
        
        // Apply zoom change with smooth transition
        this.setZoomLevel(newZoom);
    }

    handleMouseMove(e) {
        // Only update zoom center when mouse is over chart data area
        if (!this.isOverChartDataArea(e)) {
            return;
        }
        
        // Update zoom center when mouse moves (for zoom-from-point functionality)
        const targetId = this.containerId || 'performanceChart';
        const chartCanvas = document.getElementById(targetId);
        if (!chartCanvas) return;
        
        const rect = chartCanvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const chartWidth = rect.width;
        
        // Ensure mouse position is within bounds
        const boundedMouseX = Math.max(0, Math.min(chartWidth, mouseX));
        this.zoomCenter = boundedMouseX / chartWidth;
        
        // Reset zoom-from-point flag when mouse moves (not actively zooming)
        if (!this.isZoomingFromPoint) {
            this.zoomCenterDataIndex = null;
        }
    }

    handleKeyDown(e) {
        switch (e.key) {
            case '+':
            case '=':
                e.preventDefault();
                if (this.zoomLevel < this.zoomLevels.max) {
                    // Reset zoom-from-point state for keyboard zoom
                    this.isZoomingFromPoint = false;
                    this.zoomCenterDataIndex = null;
                    this.zoomIn();
                }
                break;
            case '-':
                e.preventDefault();
                // Reset zoom-from-point state for keyboard zoom
                this.isZoomingFromPoint = false;
                this.zoomCenterDataIndex = null;
                this.zoomOut();
                break;
            case '0':
                e.preventDefault();
                this.resetToDefault();
                break;
            case 'ArrowLeft':
                e.preventDefault();
                if (this.zoomLevel > 1 && this.zoomLevel < this.zoomLevels.max) {
                    this.panLeft();
                }
                break;
            case 'ArrowRight':
                e.preventDefault();
                if (this.zoomLevel > 1 && this.zoomLevel < this.zoomLevels.max) {
                    this.panRight();
                }
                break;
        }
    }

    // ===== Core Zoom Methods =====

    zoomIn() {
        if (this.zoomLevel >= this.zoomLevels.max) return;
        
        // Reset zoom-from-point flag when using buttons
        this.isZoomingFromPoint = false;
        this.zoomCenterDataIndex = null;
        
        const newZoom = Math.min(this.zoomLevels.max, this.zoomLevel + this.zoomLevels.step);
        this.setZoomLevel(newZoom);
    }

    zoomOut() {
        // Reset zoom-from-point flag when using buttons
        this.isZoomingFromPoint = false;
        this.zoomCenterDataIndex = null;
        
        const newZoom = Math.max(this.zoomLevels.min, this.zoomLevel - this.zoomLevels.step);
        this.setZoomLevel(newZoom);
    }

    setZoomLevel(newZoom) {
        // Validate input
        if (!isFinite(newZoom) || newZoom <= 0) {
            logger.warn('Invalid zoom level provided', { newZoom });
            return;
        }

        const oldZoom = this.zoomLevel;
        
        // Clamp to valid range
        const clampedZoom = Math.max(this.zoomLevels.min, Math.min(this.zoomLevels.max, newZoom));
        
        if (clampedZoom === this.zoomLevel) {
            return; // No change needed
        }



        this.zoomLevel = clampedZoom;
        window.chartZoomLevel = clampedZoom;

        // Maintain zoom center if we're zooming from a specific point
        if (this.isZoomingFromPoint && this.zoomCenterDataIndex !== null && this.totalDataPoints > 0) {
            // The target data point should remain centered throughout the zoom
            const targetDataIndex = this.zoomCenterDataIndex;
            
            // Calculate how many data points should be visible at this zoom level
            const newVisiblePoints = Math.max(1, Math.floor(this.totalDataPoints / clampedZoom));
            
            // Calculate the ideal start and end indices to center the target point
            const halfVisible = Math.floor(newVisiblePoints / 2);
            let idealStartIndex = targetDataIndex - halfVisible;
            let idealEndIndex = targetDataIndex + halfVisible;
            
            // Adjust for boundaries
            if (idealStartIndex < 0) {
                idealStartIndex = 0;
                idealEndIndex = Math.min(this.totalDataPoints, newVisiblePoints);
            }
            
            if (idealEndIndex > this.totalDataPoints) {
                idealEndIndex = this.totalDataPoints;
                idealStartIndex = Math.max(0, idealEndIndex - newVisiblePoints);
            }
            
            // Calculate the actual center position
            const actualCenterIndex = (idealStartIndex + idealEndIndex) / 2;
            this.zoomCenter = actualCenterIndex / this.totalDataPoints;
            
            // Reset pan offset since we're calculating the center position directly
            this.panOffset = 0;
        } else {
            // Reset pan offset when zooming without a specific center point
            this.panOffset = 0;
        }

        // Handle different zoom levels
        if (clampedZoom >= this.zoomLevels.max) {
            this.scheduleChartUpdate(() => this.zoomToMonth());
        } else {
            // Check if transitioning from max zoom
            const wasAtMaxZoom = oldZoom >= this.zoomLevels.max;
            if (wasAtMaxZoom) {
                this.scheduleChartUpdate(() => this.transitionFromMaxZoom());
            } else {
                this.scheduleChartUpdate(() => this.updateChartView());
            }
        }


        

        
        // Sync with global date range and dispatch events for real-time synchronization
        this.scheduleGlobalSync();


    }
    // Schedule chart updates inside rAF to avoid multiple updates per frame
    scheduleChartUpdate(fn) {
        if (this._scheduledUpdate) {
            // Replace the pending update with the latest intent
            this._scheduledUpdate.fn = fn;
            return;
        }
        this._scheduledUpdate = { fn };
        requestAnimationFrame(() => {
            try {
                this._scheduledUpdate.fn();
            } finally {
                this._scheduledUpdate = null;
            }
        });
    }

    // Schedule global sync inside rAF and debounce within the class
    scheduleGlobalSync() {
        if (this._scheduledSync) return;
        this._scheduledSync = true;
        requestAnimationFrame(() => {
            try {
                this.syncWithGlobalDateRange();
            } finally {
                this._scheduledSync = false;
            }
        });
    }

    // ===== Chart Update Methods =====

    updateChartView() {
        if (!this.chart || !this.originalLabels.length || this.isUpdatingChart) {
            return;
        }

        // If we're at max zoom, don't recalculate visible range as it would override month data
        if (this.zoomLevel >= this.zoomLevels.max) {
            return;
        }

        // Ensure pan offset is within bounds before calculating visible range
        this.boundPanOffset();

        // Calculate visible data range centered on zoom center with pan offset
        this.calculateVisibleRange();

        // Update chart with filtered data
        this.updateChartWithFilteredData();
        
        // Immediately sync date range after chart view update
        this.syncWithGlobalDateRange();
    }

    calculateVisibleRange() {
        if (!this.originalLabels || this.originalLabels.length === 0) {
            logger.warn('No chart data available for visible range calculation');
            return;
        }

        this.totalDataPoints = this.originalLabels.length;
        
        // Ensure zoom level is valid before calculating visible points
        if (!isFinite(this.zoomLevel) || this.zoomLevel <= 0) {
            logger.warn('Invalid zoom level detected, resetting to 1', { zoomLevel: this.zoomLevel });
            this.zoomLevel = 1;
            window.chartZoomLevel = 1;
        }
        
        this.visibleDataPoints = Math.max(1, Math.floor(this.totalDataPoints / this.zoomLevel));
        
        // Calculate center position based on zoom mode
        let centerIndex;
        
        if (this.isZoomingFromPoint && this.zoomCenterDataIndex !== null) {
            // When zooming from a specific point (but NOT during drag), use that data point as center
            centerIndex = this.zoomCenterDataIndex;
            
            // Ensure the center index is within bounds
            centerIndex = Math.max(0, Math.min(this.totalDataPoints - 1, centerIndex));
        } else {
            // Use zoom center position with pan offset for general navigation
            const effectiveCenter = this.zoomCenter + this.panOffset;
            centerIndex = Math.floor(effectiveCenter * this.totalDataPoints);
        }
        
        // Calculate start and end indices centered on the target point
        const halfVisible = Math.floor(this.visibleDataPoints / 2);
        this.startDataIndex = Math.max(0, centerIndex - halfVisible);
        this.endDataIndex = Math.min(this.totalDataPoints, this.startDataIndex + this.visibleDataPoints);
        
        // Adjust if we hit the boundaries while maintaining the target point as close to center as possible
        if (this.endDataIndex >= this.totalDataPoints) {
            this.endDataIndex = this.totalDataPoints;
            this.startDataIndex = Math.max(0, this.endDataIndex - this.visibleDataPoints);
            
            // Update zoom center to reflect actual center
            const actualCenterIndex = (this.startDataIndex + this.endDataIndex) / 2;
            this.zoomCenter = actualCenterIndex / this.totalDataPoints;
        }
        
        if (this.startDataIndex <= 0) {
            this.startDataIndex = 0;
            this.endDataIndex = Math.min(this.totalDataPoints, this.visibleDataPoints);
            
            // Update zoom center to reflect actual center
            const actualCenterIndex = (this.startDataIndex + this.endDataIndex) / 2;
            this.zoomCenter = actualCenterIndex / this.totalDataPoints;
        }
        
        // Update pan offset to reflect any boundary adjustments
        if (!this.isZoomingFromPoint) {
            const actualCenterIndex = (this.startDataIndex + this.endDataIndex) / 2;
            this.panOffset = (actualCenterIndex / this.totalDataPoints) - this.zoomCenter;
        }
    }

    updateChartWithFilteredData() {
        if (!this.chart || this.isUpdatingChart) return;
        
        this.isUpdatingChart = true;
        
        try {
            // Regenerate labels based on the actual filtered data
            let filteredLabels;
            if (this.zoomLevel >= this.zoomLevels.max) {
                // Month view handles labels separately in createCompleteMonthView
                filteredLabels = this.originalLabels.slice(this.startDataIndex, this.endDataIndex);
            } else {
                // Fast path: slice prebuilt labels instead of recomputing them
                filteredLabels = this.originalLabels.slice(this.startDataIndex, this.endDataIndex);
            }

            const filteredDatasets = this.originalDatasets.map(dataset => ({
                ...dataset,
                data: dataset.data.slice(this.startDataIndex, this.endDataIndex),
                originalData: dataset.originalData ? dataset.originalData.slice(this.startDataIndex, this.endDataIndex) : undefined
            }));

            // Update chart with filtered data
            this.chart.data.labels = filteredLabels;
            this.chart.data.datasets = filteredDatasets;

            // Ensure chart options preserve gap behavior for null values
            if (this.chart.options) {
                this.chart.options.spanGaps = false; // Don't connect lines across gaps
                
                // At month view (max zoom), show all days by removing tick limits
                if (this.zoomLevel >= this.zoomLevels.max && this.chart.options.scales && this.chart.options.scales.x) {
                    this.chart.options.scales.x.ticks.maxTicksLimit = 100;
                    this.chart.options.scales.x.ticks.autoSkip = false;
                } else if (this.chart.options.scales && this.chart.options.scales.x) {
                    // At all other zoom levels, revert to normal tick limiting for readability
                    this.chart.options.scales.x.ticks.maxTicksLimit = 12;
                    this.chart.options.scales.x.ticks.autoSkip = true;
                }
            }

            // Update tooltip callbacks to work with filtered data
            this.updateTooltipCallbacks();

            // Use 'none' animation mode for smoother zoom performance
            this.chart.update('none');
            
        } finally {
            this.isUpdatingChart = false;
        }
        

    }

    zoomToMonth() {
        if (!this.originalLabels.length) return;

        // Find the month containing the zoom center
        let centerIndex;
        
        if (this.isZoomingFromPoint && this.zoomCenterDataIndex !== null) {
            // Use the target data point as center
            centerIndex = this.zoomCenterDataIndex;
        } else {
            // Use the current zoom center
            centerIndex = Math.floor(this.zoomCenter * this.totalDataPoints);
        }
        
        // Resolve center date from globalDates when available for accuracy
        let centerDate;
        if (this.globalDates && this.globalDates.length > centerIndex) {
            const dateStr = this.globalDates[centerIndex]?.Date || this.globalDates[centerIndex]?.date;
            centerDate = parseDate(dateStr) || new Date(dateStr);
        }
        if (!centerDate || isNaN(centerDate.getTime())) {
            centerDate = new Date(this.originalLabels[centerIndex]);
        }
        
        // Get month boundaries
        const monthStart = new Date(centerDate.getFullYear(), centerDate.getMonth(), 1);
        const monthEnd = new Date(centerDate.getFullYear(), centerDate.getMonth() + 1, 0);
        
        this.createCompleteMonthView(monthStart, monthEnd, centerDate);
    }

    createCompleteMonthView(monthStart, monthEnd, centerDate) {
        if (!this.chart || this.isUpdatingChart) return;
        
        this.isUpdatingChart = true;
        
        try {
            const monthLabels = [];
            const monthDatasets = [];
            
            // Store month info for x-axis display
            this.currentMonthInfo = {
                month: monthStart.getMonth(),
                year: monthStart.getFullYear(),
                monthName: monthStart.toLocaleDateString('en-US', { month: 'short' })
            };
            
            // Create all days in month with proper labels
            const daysInMonth = monthEnd.getDate();
            for (let day = 1; day <= daysInMonth; day++) {
                const date = new Date(monthStart.getFullYear(), monthStart.getMonth(), day);
                // For month view, show "Month Day" for first and last day, day numbers for others
                if (day === 1 || day === daysInMonth) {
                    const monthName = monthStart.toLocaleDateString('en-US', { month: 'short' });
                    monthLabels.push(`${monthName} ${day}`);
                } else {
                    monthLabels.push(day.toString());
                }
            }
            
            // If we're zooming from a specific point, calculate which day should be centered
            let targetDay = null;
            if (this.isZoomingFromPoint && this.zoomCenterDataIndex !== null) {
                // Get the target date from the original data
                const targetDate = new Date(this.originalLabels[this.zoomCenterDataIndex]);
                const targetDayOfMonth = targetDate.getDate();
                
                // Ensure the target day is within the current month
                if (targetDate.getMonth() === monthStart.getMonth() && 
                    targetDate.getFullYear() === monthStart.getFullYear()) {
                    targetDay = targetDayOfMonth;
                    
                    logger.debug('Target day resolved for max zoom', {
                        targetDataIndex: this.zoomCenterDataIndex,
                        targetDate: targetDate.toISOString(),
                        targetDay,
                        monthStart: monthStart.toISOString(),
                        monthEnd: monthEnd.toISOString()
                    });
                }
            }
            
            // Create datasets with proper gap handling
            if (this.originalDatasets && this.originalDatasets.length > 0) {
                for (const originalDataset of this.originalDatasets) {
                    const monthData = [];
                    const monthOriginalData = [];
                    
                    for (let day = 1; day <= daysInMonth; day++) {
                        const date = new Date(monthStart.getFullYear(), monthStart.getMonth(), day);
                        const dateStr = date.toISOString().split('T')[0];
                        
                        // Find data for this day by looking in the global dates
                        let dataValue = null;
                        let originalValue = null;
                        
                        if (this.globalDates && this.globalDates.length > 0) {
                            const dataIndex = this.dateIndexByISO?.get(dateStr) ?? -1;
                            
                            if (dataIndex !== -1 && originalDataset.originalData && originalDataset.originalData[dataIndex] !== undefined) {
                                originalValue = originalDataset.originalData[dataIndex];
                                dataValue = originalDataset.data[dataIndex];
                            }
                        }
                        
                        monthData.push(dataValue);
                        monthOriginalData.push(originalValue);
                    }
                    
                    // Create month dataset with proper visualization
                    const monthDataset = {
                        ...originalDataset,
                        data: monthData,
                        originalData: monthOriginalData,
                        pointRadius: 3, // Show points at max zoom
                        pointHoverRadius: 6,
                        spanGaps: false // Don't connect across gaps
                    };
                    
                    monthDatasets.push(monthDataset);
                }
            }
            
            // Update chart
            this.chart.data.labels = monthLabels;
            this.chart.data.datasets = monthDatasets;
            
            // Update chart options for month view
            if (this.chart.options && this.chart.options.scales && this.chart.options.scales.x) {
                this.chart.options.spanGaps = false;
                // At month view (max zoom), show all days by removing tick limits
                this.chart.options.scales.x.ticks.maxTicksLimit = 100;
                this.chart.options.scales.x.ticks.autoSkip = false;
            }
            
            // Ensure tooltip callbacks are enabled for month view
            this.updateTooltipCallbacks();
            
            this.chart.update('none');
            
            logger.debug('Month view prepared', {
                month: centerDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
                daysInMonth: monthEnd.getDate(),
                dataPointsFound: monthDatasets.length > 0 ? monthDatasets[0].data.filter(d => d !== null).length : 0,
                sampleLabels: monthLabels.slice(0, 5),
                monthInfo: this.currentMonthInfo,
                targetDay,
                isZoomingFromPoint: this.isZoomingFromPoint
            });
            
        } finally {
            this.isUpdatingChart = false;
        }
    }

    transitionFromMaxZoom() {
        // Reset to normal zoom behavior
        this.totalDataPoints = this.originalLabels.length;
        
        // If we were zooming from a specific point, maintain that point as center
        if (this.isZoomingFromPoint && this.zoomCenterDataIndex !== null) {
            // Calculate the zoom center based on the target data point
            this.zoomCenter = this.zoomCenterDataIndex / this.totalDataPoints;
            this.panOffset = 0;
            
            logger.debug('Transitioned from max zoom with target point', {
                zoomCenterDataIndex: this.zoomCenterDataIndex,
                zoomCenter: this.zoomCenter,
                totalDataPoints: this.totalDataPoints
            });
        }
        
        // Restore normal tick limits for non-month zoom levels
        if (this.chart && this.chart.options && this.chart.options.scales && this.chart.options.scales.x) {
            this.chart.options.scales.x.ticks.maxTicksLimit = 12;
            this.chart.options.scales.x.ticks.autoSkip = true;
        }
        
        this.calculateVisibleRange();
        this.updateChartWithFilteredData();
        
        // Clear month info
        this.currentMonthInfo = null;
    }


    // ===== Synchronization Methods =====

    syncWithGlobalDateRange() {
        if (this.isUpdatingGlobalRange || this.isInternalUpdate) return;

        // Calculate current visible date range
        const currentVisibleRange = this.calculateCurrentVisibleDateRange();
        if (!currentVisibleRange) return;

        // Always update the date range display instantly for UX feedback
        this.dispatchChartDateRangeChange(currentVisibleRange);

        // Defer global filtering until user stops zooming for 0.5s
        if (this.zoomFilterTimeout) {
            clearTimeout(this.zoomFilterTimeout);
        }
        this.zoomFilterTimeout = setTimeout(() => {
            // Dynamically import to avoid relying on window globals
            import('./dateUtils.js').then(({ updateGlobalDateRange }) => {
                if (typeof updateGlobalDateRange === 'function') {
                    updateGlobalDateRange(currentVisibleRange, 'chartZoomManager');
                }
            }).catch(error => {
                logger.error('Failed to import dateUtils for deferred zoom filtering', error);
            });
        }, 150);
    }

    /**
     * Calculate the current visible date range based on chart zoom state
     * @returns {Object|null} Date range object with start and end dates, or null if no data
     */
    calculateCurrentVisibleDateRange() {
        // Use globalDates if available, otherwise fall back to originalLabels
        const dateSource = this.globalDates && this.globalDates.length > 0 ? this.globalDates : this.originalLabels;
        
        if (!dateSource || dateSource.length === 0) {
            logger.debug('No date source available for date range calculation');
            return null;
        }

        let startDate, endDate;

        if (this.zoomLevel === 1) {
            // Default view - show all data
            if (this.globalDates && this.globalDates.length > 0) {
                // Use actual date objects from globalDates
                const firstDateObj = this.globalDates[0];
                const lastDateObj = this.globalDates[this.globalDates.length - 1];
                
                // Parse dates consistently to avoid timezone issues
                const firstDateStr = firstDateObj.Date || firstDateObj.date;
                const lastDateStr = lastDateObj.Date || lastDateObj.date;
                
                                    // Use consistent date parsing to avoid timezone shifts
                    startDate = parseDate(firstDateStr);
                    endDate = parseDate(lastDateStr);
            } else {
                // Fallback to original labels with consistent parsing
                startDate = parseDate(this.originalLabels[0]);
                endDate = parseDate(this.originalLabels[this.originalLabels.length - 1]);
            }
        } else if (this.zoomLevel >= this.zoomLevels.max) {
            // Max zoom - month view
            if (this.chart?.data?.labels?.length > 0) {
                // For month view, we need to calculate the actual month dates
                if (this.currentMonthInfo) {
                    const year = this.currentMonthInfo.year;
                    const month = this.currentMonthInfo.month;
                    startDate = new Date(year, month, 1);
                    endDate = new Date(year, month + 1, 0);
                } else {
                    // Fallback to first and last labels
                    startDate = new Date(this.chart.data.labels[0]);
                    endDate = new Date(this.chart.data.labels[this.chart.data.labels.length - 1]);
                }
            } else {
                logger.debug('No data for max-zoom date range calculation');
                return null;
            }
        } else {
            // Zoomed view - calculate based on what's actually visible in the chart
            // Use the same logic as tooltips to ensure consistency
            if (this.startDataIndex >= 0 && this.endDataIndex > this.startDataIndex && this.endDataIndex <= dateSource.length) {
                if (this.globalDates && this.globalDates.length > 0) {
                    // Calculate exactly what the tooltips show for first and last points
                    const visibleDataPoints = this.endDataIndex - this.startDataIndex;
                    
                    // First visible point: dataIndex = 0 maps to originalIndex = this.startDataIndex + 0
                    const firstTooltipIndex = this.startDataIndex + 0;
                    // Last visible point: dataIndex = (visibleDataPoints - 1) maps to originalIndex = this.startDataIndex + (visibleDataPoints - 1)
                    const lastTooltipIndex = this.startDataIndex + (visibleDataPoints - 1);
                    
                    const firstDateObj = this.globalDates[firstTooltipIndex];
                    const lastDateObj = this.globalDates[lastTooltipIndex];
                    
                    // Parse dates consistently to avoid timezone issues
                    const firstDateStr = firstDateObj.Date || firstDateObj.date;
                    const lastDateStr = lastDateObj.Date || lastDateObj.date;
                    
                    // Use consistent date parsing to avoid timezone shifts
                    startDate = parseDate(firstDateStr);
                    endDate = parseDate(lastDateStr);
                } else {
                    // Fallback to original labels
                    startDate = new Date(this.originalLabels[this.startDataIndex]);
                    endDate = new Date(this.originalLabels[this.endDataIndex - 1]);
                    
                    logger.debug('Using originalLabels for date range calculation', {
                        startDataIndex: this.startDataIndex,
                        endDataIndex: this.endDataIndex,
                        startLabel: this.originalLabels[this.startDataIndex],
                        endLabel: this.originalLabels[this.endDataIndex - 1],
                        totalLabels: this.originalLabels.length
                    });
                }
            } else {
                logger.debug('Invalid indices for date range calculation', {
                    startDataIndex: this.startDataIndex,
                    endDataIndex: this.endDataIndex,
                    totalDateSource: dateSource.length,
                    hasGlobalDates: !!this.globalDates
                });
                return null;
            }
        }

        if (!startDate || !endDate || isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            logger.debug('Invalid dates for date range', {
                startDate,
                endDate,
                zoomLevel: this.zoomLevel
            });
            return null;
        }

        const dateRange = {
            start: startDate.toISOString().split('T')[0],
            end: endDate.toISOString().split('T')[0]
        };



        return dateRange;
    }

    /**
     * Dispatch chart date range change event for real-time synchronization
     * @param {Object} dateRange - The current visible date range
     */
    dispatchChartDateRangeChange(dateRange) {
        const event = new CustomEvent('chartDateRangeChanged', {
            detail: {
                dateRange: dateRange,
                source: 'chartZoomManager',
                zoomLevel: this.zoomLevel,
                startDataIndex: this.startDataIndex,
                endDataIndex: this.endDataIndex
            }
        });
        window.dispatchEvent(event);
        

    }

    /**
     * Update chart view to match a specific date range
     * @param {Object} dateRange - Date range object with start and end dates
     */
    updateChartToDateRange(dateRange) {
        if (!dateRange || !this.originalLabels || this.originalLabels.length === 0) {
            return;
        }

        const startDate = new Date(dateRange.start);
        const endDate = new Date(dateRange.end);

        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            logger.warn('Invalid date range provided for chart update', dateRange);
            return;
        }

        // Find the data indices that match the date range
        let startIndex = 0;
        let endIndex = this.originalLabels.length;

        const useGlobal = Array.isArray(this.globalDates) && this.globalDates.length === this.originalLabels.length;
        if (useGlobal) {
            // Binary search for startIndex (first >= startDate)
            const getDateAt = (idx) => {
                const d = this.globalDates[idx];
                const raw = d?.Date || d?.date;
                return parseDate(raw) || new Date(raw);
            };
            let lo = 0, hi = this.globalDates.length - 1;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                const d = getDateAt(mid);
                if (d >= startDate) {
                    startIndex = mid;
                    hi = mid - 1;
                } else {
                    lo = mid + 1;
                }
            }
            // Binary search for endIndex (first > endDate)
            lo = startIndex; hi = this.globalDates.length - 1; endIndex = this.globalDates.length;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                const d = getDateAt(mid);
                if (d > endDate) {
                    endIndex = mid;
                    hi = mid - 1;
                } else {
                    lo = mid + 1;
                }
            }
        } else {
            // Fallback to labels (less precise)
            for (let i = 0; i < this.originalLabels.length; i++) {
                const labelDate = new Date(this.originalLabels[i]);
                if (labelDate >= startDate) {
                    startIndex = i;
                    break;
                }
            }
            for (let i = startIndex; i < this.originalLabels.length; i++) {
                const labelDate = new Date(this.originalLabels[i]);
                if (labelDate > endDate) {
                    endIndex = i;
                    break;
                }
            }
        }

        // Calculate the appropriate zoom level
        const selectedDataPoints = endIndex - startIndex;
        if (selectedDataPoints > 0) {
            const newZoomLevel = Math.max(1, Math.min(this.zoomLevels.max, 
                this.originalLabels.length / selectedDataPoints));
            
            // Prevent re-entrant global sync and clear any pending zoom-triggered filtering
            this.cleanupZoomFiltering();
            this.isInternalUpdate = true;
            this.isUpdatingGlobalRange = true;
            this.startDataIndex = startIndex;
            this.endDataIndex = endIndex;
            this.zoomCenter = (startIndex + endIndex) / 2 / this.originalLabels.length;
            this.panOffset = 0;
            this.zoomLevel = newZoomLevel;
            window.chartZoomLevel = newZoomLevel;

            try {
                // Update chart view without triggering sync back to global range
                this.updateChartView();
            } finally {
                this.isInternalUpdate = false;
                this.isUpdatingGlobalRange = false;
            }


            logger.debug('Chart updated to match date range', {
                dateRange,
                startIndex,
                endIndex,
                zoomLevel: this.zoomLevel,
                selectedDataPoints
            });
        }
    }

    // ===== Panning Methods =====

    calculateMaxPanOffset() {
        if (!this.totalDataPoints || this.zoomLevel <= 1) return 0;
        
        // Calculate how much we can pan based on visible data points
        const visibleRatio = this.visibleDataPoints / this.totalDataPoints;
        const maxPanRatio = (1 - visibleRatio) / 2; // Half of the remaining data
        
        return maxPanRatio;
    }

    boundPanOffset() {
        if (this.zoomLevel <= 1) {
            this.panOffset = 0;
            return;
        }
        
        const maxPanOffset = this.calculateMaxPanOffset();
        this.panOffset = Math.max(-maxPanOffset, Math.min(maxPanOffset, this.panOffset));
    }



    updateTooltipCallbacks() {
        if (!this.chart || !this.chart.options || !this.chart.options.plugins || !this.chart.options.plugins.tooltip) {
            return;
        }

        // Re-enable zoom manager tooltip handling with proper delegation
        this.isHandlingTooltips = true;
        window.chartZoomScrollManager = this;
    }

    // Tooltip title method called by charts.js
    getTooltipTitle(context) {
        const dataIndex = context[0].dataIndex;
        
        try {
            // Handle different zoom levels
            if (this.zoomLevel >= this.zoomLevels.max) {
                // Month view - derive the exact date from month/year context and hovered index
                if (this.chart?.data?.labels && dataIndex >= 0 && dataIndex < this.chart.data.labels.length) {
                    if (this.currentMonthInfo) {
                        // Prefer index-based day to avoid parsing label strings like "Aug 1"
                        let day = dataIndex + 1;
                        // If label contains a day number, use it to be extra safe
                        const rawLabel = String(this.chart.data.labels[dataIndex] ?? '');
                        const match = rawLabel.match(/\d+/);
                        if (match) {
                            const parsed = parseInt(match[0], 10);
                            if (!isNaN(parsed)) day = parsed;
                        }
                        const month = this.currentMonthInfo.month;
                        const year = this.currentMonthInfo.year;
                        const date = new Date(year, month, day);
                        if (!isNaN(date.getTime())) {
                            return date.toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric'
                            }).replace(',', '');
                        }
                    }
                    // As a last resort (should be rare), avoid ambiguous parsing that defaults year to 2001
                    return 'Unknown Date';
                }
            } else {
                // Regular zoom view - map back to original data
                let originalIndex;
                
                if (this.zoomLevel === 1) {
                    // Default view - direct mapping
                    originalIndex = dataIndex;
                } else {
                    // Zoomed view - map filtered index back to original data index
                    originalIndex = this.startDataIndex + dataIndex;
                }
                
                // Get the original date from global data
                if (this.globalDates && originalIndex >= 0 && originalIndex < this.globalDates.length) {
                    const originalDateObj = this.globalDates[originalIndex];
                    if (originalDateObj) {
                        const dateStr = originalDateObj.Date || originalDateObj.date;
                        if (dateStr) {
                            const date = parseDate(dateStr);
                            if (date) {
                                return date.toLocaleDateString('en-US', { 
                                    month: 'short', 
                                    day: 'numeric', 
                                    year: 'numeric' 
                                }).replace(',', '');
                            }
                        }
                    }
                } else {
                    // Fallback: try to get date from chart labels
                    if (this.chart?.data?.labels && dataIndex >= 0 && dataIndex < this.chart.data.labels.length) {
                        const label = this.chart.data.labels[dataIndex];
                        if (label) {
                            const date = new Date(label);
                            if (!isNaN(date.getTime())) {
                                return date.toLocaleDateString('en-US', { 
                                    month: 'short', 
                                    day: 'numeric', 
                                    year: 'numeric' 
                                }).replace(',', '');
                            }
                        }
                    }
                }
            }
            
            // Final fallback: try to parse the chart label directly
            if (this.chart?.data?.labels && dataIndex >= 0 && dataIndex < this.chart.data.labels.length) {
                const label = this.chart.data.labels[dataIndex];
                if (label) {
                    // Try to parse the label as a date
                    const date = new Date(label);
                    if (!isNaN(date.getTime())) {
                        return date.toLocaleDateString('en-US', { 
                            month: 'short', 
                            day: 'numeric', 
                            year: 'numeric' 
                        }).replace(',', '');
                    }
                }
            }
            
            return 'Unknown Date';
        } catch (error) {
            logger.error('Error in getTooltipTitle', error);
            return 'Date Error';
        }
    }

    // Tooltip label method called by charts.js
    getTooltipLabel(context) {
        const label = context.dataset.label || '';
        const dataIndex = context.dataIndex;
        
        try {
            let originalValue;
            
            if (this.zoomLevel >= this.zoomLevels.max) {
                // Month view - use the current dataset's originalData directly
                originalValue = context.dataset.originalData?.[dataIndex];
            } else {
                // Regular zoom view - map back to original data
                let originalIndex;
                
                if (this.zoomLevel === 1) {
                    // Default view - direct mapping
                    originalIndex = dataIndex;
                } else {
                    // Zoomed view - map filtered index back to original data index
                    originalIndex = this.startDataIndex + dataIndex;
                }
                
                // Find the corresponding original dataset
                const originalDataset = this.originalDatasets.find(ds => ds.label === label);
                if (originalDataset?.originalData && originalIndex >= 0 && originalIndex < originalDataset.originalData.length) {
                    originalValue = originalDataset.originalData[originalIndex];
                }
            }
            
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
        } catch (error) {
            logger.error('Error in getTooltipLabel', error);
            return `${label}: Error`;
        }
    }

    panLeft() {
        if (this.zoomLevel > 1 && this.zoomLevel < this.zoomLevels.max) {
            // Reset zoom-from-point state when panning
            this.isZoomingFromPoint = false;
            this.zoomCenterDataIndex = null;
            
            
            const maxPanOffset = this.calculateMaxPanOffset();
            this.panOffset = Math.min(maxPanOffset, this.panOffset + 0.1);
            this.updateChartView();
            
            // Sync with global date range for real-time synchronization
            this.syncWithGlobalDateRange();
        }
    }

    panRight() {
        if (this.zoomLevel > 1 && this.zoomLevel < this.zoomLevels.max) {
            // Reset zoom-from-point state when panning
            this.isZoomingFromPoint = false;
            this.zoomCenterDataIndex = null;
            
            
            const maxPanOffset = this.calculateMaxPanOffset();
            this.panOffset = Math.max(-maxPanOffset, this.panOffset - 0.1);
            this.updateChartView();
            
            // Sync with global date range for real-time synchronization
            this.syncWithGlobalDateRange();
        }
    }



    // ===== External Event Handlers =====

    onChartUpdate() {
        if (this.isUpdatingChart) return;

        logger.debug('onChartUpdate called', {
            hasChart: !!(this.chart || window.charts?.[this.chartId] || window.charts?.performance),
            chartDataSets: (this.chart || window.charts?.[this.chartId] || window.charts?.performance)?.data?.datasets?.length || 0,
            chartLabels: (this.chart || window.charts?.[this.chartId] || window.charts?.performance)?.data?.labels?.length || 0
        });

        // Get chart instance (prefer existing, then by id, then legacy performance)
        if (!this.chart) {
            this.chart = window.charts?.[this.chartId] || window.charts?.performance;
        }
        if (!this.chart) {
            logger.warn('No chart instance found');
            return;
        }

        // Check if data changed significantly
        const newLabels = this.chart.data.labels;
        const newDatasets = this.chart.data.datasets;
        
        const dataChanged = !this.originalLabels.length || 
                          this.originalLabels.length !== newLabels.length ||
                          this.originalLabels[0] !== newLabels[0] ||
                          this.originalLabels[this.originalLabels.length - 1] !== newLabels[newLabels.length - 1];

        // Check if datasets changed (e.g., when metrics are toggled)
        const datasetsChanged = !this.originalDatasets.length ||
                              this.originalDatasets.length !== newDatasets.length ||
                              this.originalDatasets.some((original, index) => {
                                  const newDataset = newDatasets[index];
                                  return !newDataset || original.label !== newDataset.label;
                              });

        if (dataChanged || datasetsChanged) {
            logger.info('Chart data or datasets changed, updating zoom manager', {
                dataChanged,
                datasetsChanged,
                originalDatasetsCount: this.originalDatasets.length,
                newDatasetsCount: newDatasets.length,
                originalLabels: this.originalDatasets.map(d => d.label),
                newLabels: newDatasets.map(d => d.label)
            });
            
            // Store new data
            this.originalLabels = [...newLabels];
            this.originalDatasets = newDatasets.map(dataset => ({
                ...dataset,
                data: [...dataset.data],
                originalData: dataset.originalData ? [...dataset.originalData] : undefined
            }));

            this.globalDates = [];
            this.dateIndexByISO = new Map();

            // Get the original dates from the chart's original data
            if (this.chart && this.chart.data.datasets && this.chart.data.datasets.length > 0) {
                const firstDataset = this.chart.data.datasets[0];
                if (firstDataset.originalData && firstDataset.originalData.length > 0) {
                    // Try to get dates from window.globalData first
                    const globalData = window.globalData;
                    if (globalData && globalData.dates && globalData.dates.length > 0) {
                        this.globalDates = globalData.dates;
                        // Build fast index for ISO date lookup
                        try {
                            for (let i = 0; i < this.globalDates.length; i++) {
                                const d = this.globalDates[i];
                                const raw = d?.Date || d?.date;
                                if (!raw) continue;
                                const dateObj = raw instanceof Date ? raw : new Date(raw);
                                if (!isNaN(dateObj.getTime())) {
                                    const iso = dateObj.toISOString().split('T')[0];
                                    if (!this.dateIndexByISO.has(iso)) this.dateIndexByISO.set(iso, i);
                                }
                            }
                        } catch (_) {}
                        logger.info('Initialized globalDates from window.globalData', {
                            globalDatesLength: this.globalDates.length,
                            sampleDate: this.globalDates[0]
                        });
                    } else {
                        this.globalDates = this.chart.data.labels;
                        logger.info('Initialized globalDates from chart labels', {
                            globalDatesLength: this.globalDates.length,
                            sampleLabel: this.globalDates[0]
                        });
                    }
                }
            }

            // Reset zoom state for new data
            this.isInternalUpdate = true;
            this.zoomLevel = 1;
            this.zoomCenter = 0.5;
            this.panOffset = 0;
            window.chartZoomLevel = 1;
            
            // Reset zoom-from-point state for new data
            this.isZoomingFromPoint = false;
            this.zoomCenterDataIndex = null;
            
            // Initialize totalDataPoints for zoom center calculations
            this.totalDataPoints = this.originalLabels.length;
            
            this.isInternalUpdate = false;
            
            // Set up tooltip handling for new chart
            this.isHandlingTooltips = true;
            window.chartZoomScrollManager = this;


        } else {
            // Even if data didn't change, ensure we're handling tooltips
            this.isHandlingTooltips = true;
            window.chartZoomScrollManager = this;
        }

        logger.debug('Chart update processed', {
            dataChanged,
            datasetsChanged,
            isHandlingTooltips: this.isHandlingTooltips,
            globalDatesLength: this.globalDates?.length || 0,
            originalLabelsLength: this.originalLabels?.length || 0,
            sampleGlobalDate: this.globalDates?.[0]
        });
    }

    onDateRangeChange() {
        if (this.isUpdatingGlobalRange || !this.originalLabels.length) return;

        const globalDateRange = window.currentGlobalDateRange;
        
        if (!globalDateRange || (!globalDateRange.start && !globalDateRange.end)) {
            this.resetToDefault();
            return;
        }

        // Use the new method to update chart to match date range
        this.updateChartToDateRange(globalDateRange);

        logger.debug('Date range change processed', { 
            dateRange: globalDateRange, 
            zoomLevel: this.zoomLevel 
        });
    }

    // ===== Zoom Filtering Utilities =====
    /**
     * Add cleanup method for zoom filtering timeouts
     */
    cleanupZoomFiltering() {
        if (this.zoomFilterTimeout) {
            clearTimeout(this.zoomFilterTimeout);
            this.zoomFilterTimeout = null;
        }
    }

    // ===== Utility Methods =====

    resetToDefault() {
        if (!this.originalLabels.length) return;

        this.isInternalUpdate = true;
        
        // Clean up zoom filtering timeouts
        this.cleanupZoomFiltering();
        
        // Reset zoom state
        this.zoomLevel = 1;
        this.zoomCenter = 0.5;
        this.panOffset = 0;
        this.startDataIndex = 0;
        this.endDataIndex = this.originalLabels.length;
        window.chartZoomLevel = 1;
        
        // Reset zoom-from-point state
        this.isZoomingFromPoint = false;
        this.zoomCenterDataIndex = null;
        
        this.isInternalUpdate = false;

        // Reset chart to show all data
        if (this.chart && !this.isUpdatingChart) {
            this.isUpdatingChart = true;
            try {
                this.chart.data.labels = [...this.originalLabels];
                this.chart.data.datasets = this.originalDatasets.map(dataset => ({
                    ...dataset,
                    data: [...dataset.data],
                    originalData: dataset.originalData ? [...dataset.originalData] : undefined
                }));
                
                // Reset chart options for default view
                if (this.chart.options) {
                    this.chart.options.spanGaps = true; // Connect lines in default view
                }
                
                // Ensure tooltip handling is active
                this.isHandlingTooltips = true;
                window.chartZoomScrollManager = this;
                this.updateTooltipCallbacks();
                
                this.chart.update('none');
            } finally {
                this.isUpdatingChart = false;
            }
        }



        logger.info('Chart reset to default view', {
            zoomLevel: this.zoomLevel,
            totalDataPoints: this.originalLabels.length,
            isHandlingTooltips: this.isHandlingTooltips
        });
    }



    // ===== Public API =====

    getZoomLevel() { return this.zoomLevel; }
    getZoomCenter() { return this.zoomCenter; }
    setZoomLevelPublic(level) { this.setZoomLevel(level); }
    reset() { this.resetToDefault(); }
    
    /**
     * Handle chart date range change events from date picker
     * @param {Object} dateRange - Date range object with start and end dates
     */
    handleChartDateRangeChange(dateRange) {
        if (!dateRange || this.isInternalUpdate) return;
        
        this.updateChartToDateRange(dateRange);
    }
}

// ===== Multi-Chart Zoom Manager =====

class MultiChartZoomManager {
    constructor() {
        this.chartManagers = new Map(); // Map of chartId -> ChartZoomManager
        this.activeChartId = null; // Currently active chart
        this.globalData = null;
        
        logger.info('MultiChartZoomManager initialized');
    }

    /**
     * Create or get a zoom manager for a specific chart
     * @param {string} chartId - Chart identifier
     * @param {string} containerId - Chart container ID
     * @returns {ChartZoomManager} Zoom manager instance
     */
    getChartManager(chartId, containerId = null) {
        if (!this.chartManagers.has(chartId)) {
            const manager = new ChartZoomManager();
            manager.chartId = chartId; // Add chartId to the manager
            manager.containerId = containerId;
            manager.init();
            this.chartManagers.set(chartId, manager);
            logger.info(`Created zoom manager for chart: ${chartId}`);
        }
        return this.chartManagers.get(chartId);
    }

    /**
     * Set the active chart
     * @param {string} chartId - Chart identifier
     */
    setActiveChart(chartId) {
        this.activeChartId = chartId;
        logger.info(`Active chart set to: ${chartId}`);
    }

    /**
     * Get the active chart manager
     * @returns {ChartZoomManager|null} Active chart manager
     */
    getActiveChartManager() {
        if (!this.activeChartId) {
            return null;
        }
        return this.chartManagers.get(this.activeChartId);
    }

    /**
     * Update a specific chart
     * @param {string} chartId - Chart identifier
     * @param {Object} chart - Chart instance
     * @param {Object} data - Chart data
     */
    updateChart(chartId, chart, data = null) {
        const manager = this.getChartManager(chartId);
        if (manager) {
            manager.chart = chart;
            // data is not stored on the manager; dates come from window.globalData
            manager.onChartUpdate();
            logger.info(`Updated zoom manager for chart: ${chartId}`);
        }
    }

    /**
     * Handle chart update event
     * @param {string} chartId - Chart identifier
     */
    onChartUpdate(chartId) {
        const manager = this.chartManagers.get(chartId);
        if (manager) {
            manager.onChartUpdate();
        }
    }

    /**
     * Handle date range change for a specific chart
     * @param {string} chartId - Chart identifier
     */
    onDateRangeChange(chartId) {
        const manager = this.chartManagers.get(chartId);
        if (manager) {
            manager.onDateRangeChange();
        }
    }
    
    /**
     * Update chart to match a specific date range
     * @param {string} chartId - Chart identifier
     * @param {Object} dateRange - Date range object
     */
    updateChartToDateRange(chartId, dateRange) {
        const manager = this.chartManagers.get(chartId);
        if (manager) {
            manager.updateChartToDateRange(dateRange);
        }
    }

    /**
     * Reset a specific chart view
     * @param {string} chartId - Chart identifier
     */
    resetChartView(chartId) {
        const manager = this.chartManagers.get(chartId);
        if (manager) {
            manager.resetToDefault();
        }
    }

    /**
     * Set zoom level for a specific chart
     * @param {string} chartId - Chart identifier
     * @param {number} level - Zoom level
     */
    setChartZoomLevel(chartId, level) {
        const manager = this.chartManagers.get(chartId);
        if (manager) {
            manager.setZoomLevelPublic(level);
        }
    }

    /**
     * Get zoom level for a specific chart
     * @param {string} chartId - Chart identifier
     * @returns {number} Zoom level
     */
    getChartZoomLevel(chartId) {
        const manager = this.chartManagers.get(chartId);
        return manager ? manager.getZoomLevel() : 1;
    }

    /**
     * Destroy a chart manager
     * @param {string} chartId - Chart identifier
     */
    destroyChartManager(chartId) {
        const manager = this.chartManagers.get(chartId);
        if (manager) {
            // Clean up the manager
            manager.chart = null;
            this.chartManagers.delete(chartId);
            logger.info(`Destroyed zoom manager for chart: ${chartId}`);
        }
    }

    /**
     * Get all chart managers
     * @returns {Map} Map of chart managers
     */
    getAllChartManagers() {
        return this.chartManagers;
    }

    /**
     * Set global data for all charts
     * @param {Object} data - Global data
     */
    setGlobalData(data) {
        this.globalData = data;
        // Update all chart managers with the global data
        this.chartManagers.forEach(manager => {
            // no-op: managers read dates from window.globalData on update
        });
    }
}

// ===== Global Instances =====

let chartZoomManager = null; // Single-chart legacy support
let multiChartZoomManager = null; // Preferred multi-chart manager

// ===== Export Functions =====

export function initializeChartZoomScroll() {
    if (!multiChartZoomManager) {
        multiChartZoomManager = new MultiChartZoomManager();
    }
    return multiChartZoomManager;
}

export function getChartZoomScrollManager() {
    return multiChartZoomManager || chartZoomManager; // Return multi-chart manager if available, fallback to single
}

// ===== Multi-Chart Manager Functions =====

export function getMultiChartZoomManager() {
    return multiChartZoomManager;
}

export function getChartManager(chartId, containerId = null) {
    if (multiChartZoomManager) {
        return multiChartZoomManager.getChartManager(chartId, containerId);
    }
    return null;
}

export function updateChartZoomManager(chartId, chart, data = null) {
    if (multiChartZoomManager) {
        multiChartZoomManager.updateChart(chartId, chart, data);
    }
}

export function setActiveChart(chartId) {
    if (multiChartZoomManager) {
        multiChartZoomManager.setActiveChart(chartId);
    }
}

export function resetChartView(chartId = null) {
    if (chartId && multiChartZoomManager) {
        multiChartZoomManager.resetChartView(chartId);
    } else if (chartZoomManager) {
        chartZoomManager?.resetToDefault();
    }
}

export function setChartZoomLevel(level, chartId = null) {
    if (chartId && multiChartZoomManager) {
        multiChartZoomManager.setChartZoomLevel(chartId, level);
    } else if (chartZoomManager) {
        chartZoomManager?.setZoomLevelPublic(level);
    }
}

export function getChartZoomLevel(chartId = null) {
    if (chartId && multiChartZoomManager) {
        return multiChartZoomManager.getChartZoomLevel(chartId);
    } else if (chartZoomManager) {
        return chartZoomManager?.getZoomLevel() || 1;
    }
    return 1;
}

// ===== Auto-initialization =====

if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initializeChartZoomScroll();
        });
    } else {
        initializeChartZoomScroll();
    }
} 