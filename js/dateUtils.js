/* dateUtils.js – Comprehensive date management system */

import { logger } from './logger.js';
import { showFilterLoading, hideFilterLoading } from './utils.js';

// ===== Core Date Utilities =====

/**
 * Parse YYYY-MM-DD or Date object → Date (always local time)
 * This ensures consistent date handling across the entire application
 */
export function parseISO(val) {
  if (val instanceof Date) return new Date(val.getTime());
  if (typeof val === 'string') {
    const [y, m, d] = val.split('-').map(Number);
    return new Date(y, m - 1, d); // Always create local time
  }
  return new Date();
}

/**
 * Create a date from string ensuring local time (no timezone shifts)
 */
export function parseDate(dateString) {
  if (!dateString) return null;
  if (dateString instanceof Date) return new Date(dateString.getTime());
  
  // Handle YYYY-MM-DD format specifically to avoid timezone issues
  if (typeof dateString === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return parseISO(dateString);
  }
  
  // For other formats, try to parse but ensure local time
  const parsed = new Date(dateString);
  if (isNaN(parsed.getTime())) {
    logger.warn('Invalid date string:', dateString);
    return null;
  }
  return parsed;
}

export function toISO(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(date, days) {
  const d = parseISO(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function startOfMonth(date) {
  const d = parseISO(date);
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function endOfMonth(date) {
  const d = parseISO(date);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

export function daysBetween(a, b) {
  const diff = Math.abs(parseISO(b) - parseISO(a));
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// Display format: e.g., "April 12, 2025"
export function formatDisplay(date) {
  const d = parseISO(date);
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
}

// ===== Date Range Parsing =====

const MONTH_MAP = {
  Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11
};

/**
 * Convert "Apr-2025" or "2025" to {start: Date, end: Date}
 */
export function rangeFromDateLabel(label) {
  if (!label) return null;
  if (/^\d{4}$/.test(label)) {
    const y = Number(label);
    const start = new Date(y, 0, 1);
    const end = new Date(y, 11, 31);
    return { start, end };
  }
  const m = label.slice(0,3);
  const y = Number(label.slice(4));
  if (MONTH_MAP[m] !== undefined) {
    const idx = MONTH_MAP[m];
    const start = new Date(y, idx, 1);
    const end = new Date(y, idx+1, 0);
    return { start, end };
  }
  return null;
}

// ===== Date Range Filtering =====

/**
 * Check if a record falls within a date range
 * Uses consistent date parsing to avoid timezone issues
 */
export function recordInRange(record, range) {
  if (!range || !range.start || !range.end) return true; // no filter
  
  // Use consistent date parsing for range bounds
  const start = parseDate(range.start);
  const end = parseDate(range.end);
  
  if (!start || !end) {
    logger.warn('Invalid date range for filtering:', range);
    return true; // Keep record if range is invalid
  }

  if (record.Date) {
    const d = parseDate(record.Date);
    if (!d) return false; // Exclude records with invalid dates
    
    // Inclusive comparison: start <= date <= end
    return d >= start && d <= end;
  }
  
  // Handle weekly URL data format (start_date, end_date)
  if (record.start_date && record.end_date) {
    const recordStart = parseDate(record.start_date);
    const recordEnd = parseDate(record.end_date);
    
    if (!recordStart || !recordEnd) return false; // Exclude records with invalid dates
    
    // Check if the weekly record overlaps with the filter range
    // Overlap condition: recordEnd >= filterStart && recordStart <= filterEnd
    return recordEnd >= start && recordStart <= end;
  }
  
  if (record.dateRange) {
    const r = rangeFromDateLabel(record.dateRange);
    if (r) {
      // For date ranges, check if they overlap with the filter range
      return r.end >= start && r.start <= end;
    }
  }
  
  return true; // if record lacks date info keep it
}

// ===== Date Range Formatting =====

/**
 * Format date range for display
 */
export function formatDateRangeForDisplay(rangeObj) {
  if (!rangeObj || !rangeObj.start || !rangeObj.end) {
    // When "All data" is selected, try to get the full available date range
    if (typeof window !== 'undefined' && window.globalData && window.globalData.metadata && window.globalData.metadata.global_date_range) {
      const { start, end } = window.globalData.metadata.global_date_range;
      if (start && end) {
        return `${formatDisplay(start)} – ${formatDisplay(end)}`;
      }
    }
    return 'All data';
  }
  
  if (rangeObj.start === rangeObj.end) {
    return formatDisplay(rangeObj.start);
  }
  
  return `${formatDisplay(rangeObj.start)} – ${formatDisplay(rangeObj.end)}`;
}

/**
 * Format a single date for display
 */
export function formatDate(dateStr) {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
  } catch (error) {
    return dateStr;
  }
}

// ===== State Management =====
let currentGlobalDateRange = null;
let isUpdatingGlobalDateRange = false;
let isZoomDrivenUpdate = false;
let isManualDateRangeUpdate = false;
let zoomUpdateCompletionTimeout = null;

// ===== Registered Components =====
const registeredPickers = new Set();
const registeredDisplayElements = new Set();

// ===== Dependencies =====
let getGlobalData = () => ({}); // Function to get current data
let updateFunctions = {}; // Functions to update dashboard components

/**
 * Update global date range with clear separation between zoom and manual updates
 * @param {Object} rangeObj - Date range object
 * @param {string|Object} source - Source of the update ('chartZoomManager' for zoom, picker instance for manual)
 */
export function updateGlobalDateRange(rangeObj, source = null) {
  // Prevent multiple simultaneous calls
  if (isUpdatingGlobalDateRange) {
    return;
  }
  
  isUpdatingGlobalDateRange = true;
  
  // Determine update type
  const isZoomSource = source === 'chartZoomManager' || source?.constructor?.name === 'ChartZoomManager';
  const isManualSource = !isZoomSource && source;
  
  // Set appropriate flags
  if (isZoomSource) {
    isZoomDrivenUpdate = true;
    isManualDateRangeUpdate = false;
    
    // Clear any existing timeout to reset the zoom flag
    if (zoomUpdateCompletionTimeout) {
      clearTimeout(zoomUpdateCompletionTimeout);
    }
    
    // Set a timeout to reset the zoom flag after all updates have had time to complete
    zoomUpdateCompletionTimeout = setTimeout(() => {
      isZoomDrivenUpdate = false;
    }, 200); // Increased timeout for zoom operations
    
  } else if (isManualSource) {
    isManualDateRangeUpdate = true;
    isZoomDrivenUpdate = false;
    
    // Clear zoom timeout since this is a manual update
    if (zoomUpdateCompletionTimeout) {
      clearTimeout(zoomUpdateCompletionTimeout);
      zoomUpdateCompletionTimeout = null;
    }
  }
  
  currentGlobalDateRange = rangeObj;
  window.currentGlobalDateRange = rangeObj;
  
  // Update all registered pickers (except the source to avoid loops)
  getRegisteredPickers().forEach(picker => {
    if (picker !== source && picker.updatePill) {
      try {
        picker.updatePill(rangeObj);
      } catch (error) {
        logger.error('Error updating picker pill', error);
      }
    }
  });
  
  // Update all registered display elements
  updateDateRangeDisplays(rangeObj);
  
  // Handle data filtering based on update type
  if (isManualSource) {
    // Manual date range selection should trigger data filtering
    logger.debug('Manual date range update detected, calling applyDateRange', { rangeObj, source });
    applyDateRange(rangeObj, false);
  } else if (isZoomSource) {
    // Zoom operations now ALSO trigger data filtering
    logger.debug('Zoom date range update detected, triggering data filtering', { rangeObj, source });
    applyDateRange(rangeObj, true);
  }
  
  // Dispatch appropriate events based on update type
  if (isZoomSource) {
    // Dispatch zoom-specific event
    const zoomEvent = new CustomEvent('zoomDateRangeSynchronized', {
      detail: { 
        dateRange: rangeObj,
        source: 'chartZoomManager'
      }
    });
    window.dispatchEvent(zoomEvent);
  } else {
    // Dispatch manual date range event
    const manualEvent = new CustomEvent('manualDateRangeSynchronized', {
      detail: { 
        dateRange: rangeObj,
        source: source?.constructor?.name || 'manual'
      }
    });
    window.dispatchEvent(manualEvent);
  }
  
  // Reset flags
  isUpdatingGlobalDateRange = false;
  // Note: isZoomDrivenUpdate is now reset via timeout to allow async updates to complete
  // Only reset manual flag immediately since manual updates are typically synchronous
  if (isManualSource) {
    isManualDateRangeUpdate = false;
  }
}

/**
 * Check if current update is zoom-driven
 */
// Flags exposed only internally; public accessors removed for cleanliness

// Initialize registeredPickers lazily to avoid circular dependency
function getRegisteredPickers() {
  return registeredPickers;
}

/**
 * Register a date picker for synchronization
 */
export function registerDatePicker(picker) {
  registeredPickers.add(picker);
  logger.debug('Date picker registered for synchronization');
}

/**
 * Unregister a date picker
 */
export function unregisterDatePicker(picker) {
  registeredPickers.delete(picker);
  logger.debug('Date picker unregistered from synchronization');
}

/**
 * Register a display element that shows current date range
 */
export function registerDateRangeDisplay(elementId) {
  registeredDisplayElements.add(elementId);
  logger.debug('Date range display element registered', { elementId });
}

/**
 * Update all date range display elements
 */
function updateDateRangeDisplays(rangeObj) {
  const displayText = formatDateRangeForDisplay(rangeObj);
  
  registeredDisplayElements.forEach(elementId => {
    const element = document.getElementById(elementId);
    if (element) {
      element.textContent = displayText;
    }
  });
  
  // Also update any other standard date range display elements
  const standardElements = [
    'dateRangeText',
    'overviewDateRangeText'
  ];
  
  standardElements.forEach(elementId => {
    const element = document.getElementById(elementId);
    if (element) {
      element.textContent = displayText;
    }
  });
  
  // Dispatch a custom event to notify date range components
  const event = new CustomEvent('dateRangeDisplayUpdate', {
    detail: { rangeObj, displayText }
  });
  window.dispatchEvent(event);
}

/**
 * Get current global date range
 */
export function getCurrentGlobalDateRange() {
  return currentGlobalDateRange;
}

/**
 * Clear all date range selections and reset to "All data"
 */
export function clearAllDateRanges() {
  // (removed) clearAllDateRanges - unused
}

// ===== Unified Date Range Application =====

// Debouncing for filter operations to prevent excessive calls
let filterDebounceTimer = null;
let lastFilterRequest = null;

// Add zoom-specific debouncing for better performance
let zoomFilterDebounceTimer = null;
let lastZoomFilterRequest = null;

/**
 * Apply date range filter with zoom-specific optimizations
 * @param {Object} rangeObj - Date range object
 * @param {boolean} isZoomOperation - Whether this is triggered by zoom
 */
export function applyDateRange(rangeObj, isZoomOperation = false) {
  logger.debug('Applying date range filter', { rangeObj, isZoomOperation });

  // For zoom operations, delay the global loader to avoid flicker during quick zooms
  // For manual operations, show immediately
  if (!applyDateRange._loaderTimers) applyDateRange._loaderTimers = {};
  const timers = applyDateRange._loaderTimers;

  const showLoader = () => {
    try { showFilterLoading('Date Range Filter'); } catch (_) {}
  };
  const clearPendingLoader = () => {
    if (timers.zoomLoader) {
      clearTimeout(timers.zoomLoader);
      timers.zoomLoader = null;
    }
  };

  clearPendingLoader();
  // Do not show a blocking loader during zoom interactions; keep UI fully interactive
  if (!isZoomOperation) {
    showLoader();
  }
  
  // Use different debouncing strategies for zoom vs manual operations
  if (isZoomOperation) {
    // For zoom operations, use shorter debounce for responsiveness
    if (zoomFilterDebounceTimer) {
      clearTimeout(zoomFilterDebounceTimer);
    }
    
    // Check if this is a duplicate zoom request
    const requestKey = JSON.stringify(rangeObj);
    if (requestKey === lastZoomFilterRequest) {
      hideFilterLoading('Date Range Filter');
      return;
    }
    lastZoomFilterRequest = requestKey;
    
    zoomFilterDebounceTimer = setTimeout(() => {
      // Coalesce to next frame for smoother UI during continuous wheel events
      requestAnimationFrame(() => performDateRangeFiltering(rangeObj, true));
    }, 60); // tighter debounce for near real-time updates
  } else {
    // For manual operations, use existing debouncing
    if (filterDebounceTimer) {
      clearTimeout(filterDebounceTimer);
    }
    
    // Check if this is a duplicate request
    const requestKey = JSON.stringify(rangeObj);
    if (requestKey === lastFilterRequest) {
      hideFilterLoading('Date Range Filter');
      return;
    }
    lastFilterRequest = requestKey;
    
    filterDebounceTimer = setTimeout(() => {
      performDateRangeFiltering(rangeObj, false);
    }, 50); // 50ms debounce for manual operations
  }
  
  // Add visual feedback during filtering
  // For zoom operations, avoid dimming to prevent flicker; for manual, dim
  const allKpiCards = document.querySelectorAll('.metric-card');
  if (!isZoomOperation) {
    allKpiCards.forEach(card => {
      card.style.opacity = '0.6';
      card.style.transition = 'opacity 0.2s ease';
    });
  }
  
  if (!rangeObj || !rangeObj.start || !rangeObj.end) {
    currentGlobalDateRange = null; // all data
  } else {
    currentGlobalDateRange = rangeObj;
  }
  
  // Check if dependencies are set
  if (!getGlobalData() || Object.keys(getGlobalData()).length === 0) {
    logger.warn('Global data not available for date filtering');
    // Restore visual state
    allKpiCards.forEach(card => {
      card.style.opacity = '1';
    });
    hideFilterLoading('Date Range Filter');
    return;
  }
}

/**
 * Perform the actual date range filtering with optimized algorithms
 */
function performDateRangeFiltering(rangeObj, isZoomOperation = false) {
  const startTime = performance.now();
  
  const globalData = getGlobalData();
  const filtered = { ...globalData };
  
  // Use more efficient filtering strategies
  Object.keys(filtered).forEach(key => {
    if (Array.isArray(filtered[key])) {
      const originalCount = filtered[key].length;
      
      // Treat pages like other arrays here; Top Pages uses weekly CSV aggregation elsewhere
      filtered[key] = filtered[key].filter(item => recordInRange(item, currentGlobalDateRange));
      
      const filteredCount = filtered[key].length;
      
      logger.debug(`Filtered ${key}`, {
        originalCount,
        filteredCount,
        removedCount: originalCount - filteredCount,
        isZoomOperation
      });
    }
  });
  
  // Store the filtered data for export functionality
  if (typeof window !== 'undefined' && window.currentFilteredData !== undefined) {
    window.currentFilteredData = filtered;
  }
  
  const filterTime = performance.now() - startTime;
  logger.info(`Date range filtering completed in ${filterTime.toFixed(2)}ms`, { isZoomOperation });
  
  // Re-render sections with error handling and performance monitoring
  // Use requestAnimationFrame for smooth UI updates
  requestAnimationFrame(() => {
    try {
      const updateStartTime = performance.now();
      
      if (typeof updateFunctions.overviewMetrics === 'function') {
        updateFunctions.overviewMetrics(filtered);
      }
      // For zoom operations, schedule heavy components cooperatively and cancellably
      if (typeof updateFunctions.topPagesTable === 'function') {
        if (isZoomOperation) {
          // Defer heavy work until the next frame; component code manages its own batching/cancellation
          requestAnimationFrame(() => updateFunctions.topPagesTable(filtered));
        } else {
          updateFunctions.topPagesTable(filtered);
        }
      }
      if (typeof updateFunctions.blogPerformance === 'function') {
        if (isZoomOperation) {
          requestAnimationFrame(() => updateFunctions.blogPerformance(filtered));
        } else {
          updateFunctions.blogPerformance(filtered);
        }
      }
      
      const updateTime = performance.now() - updateStartTime;
      logger.info(`Dashboard updates completed in ${updateTime.toFixed(2)}ms`, { isZoomOperation });
      
      // Notify other components
      if (typeof window !== 'undefined') {
        window.postMessage({ type: 'dateRangeChanged', data: filtered }, '*');
        
        const dateRangeEvent = new CustomEvent('dateRangeChanged', {
          detail: { data: filtered }
        });
        window.dispatchEvent(dateRangeEvent);
      }
      
      // Restore visual state after successful update
      setTimeout(() => {
        const allKpiCards = document.querySelectorAll('.metric-card');
        allKpiCards.forEach(card => {
          card.style.opacity = '1';
        });
      }, 100);
      
      logger.debug('Date range filter applied successfully', { isZoomOperation });
    } catch (error) {
      logger.error('Error applying date range filter', error);
      
      // Restore visual state on error
      const allKpiCards = document.querySelectorAll('.metric-card');
      allKpiCards.forEach(card => {
        card.style.opacity = '1';
      });
    } finally {
      // Hide loading indicator after operation completes
      hideFilterLoading('Date Range Filter');
      // Also clear any pending delayed loader timers
      if (applyDateRange._loaderTimers?.zoomLoader) {
        clearTimeout(applyDateRange._loaderTimers.zoomLoader);
        applyDateRange._loaderTimers.zoomLoader = null;
      }
    }
  });
}

// ===== Date Selector Utilities =====

/**
 * Get available months from data
 */
export function getAvailableMonths() {
  if (getGlobalData().dateRanges && getGlobalData().dateRanges.length > 0) {
    return getGlobalData().dateRanges;
  }
  
  // For individual files, try to infer available months
  const months = new Set();
  if (getGlobalData().dates && getGlobalData().dates.length > 0) {
    getGlobalData().dates.forEach(date => {
      if (date.Date) {
        const d = new Date(date.Date);
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                          'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const monthKey = `${monthNames[d.getMonth()]}-${d.getFullYear()}`;
        months.add(monthKey);
      }
    });
  }
  
  return Array.from(months);
}

/**
 * Get available years from data
 */
export function getAvailableYears() {
  if (getGlobalData().dateRanges && getGlobalData().dateRanges.length > 0) {
    const years = new Set();
    getGlobalData().dateRanges.forEach(range => {
      const yearMatch = range.match(/\d{4}/);
      if (yearMatch) {
        years.add(parseInt(yearMatch[0]));
      }
    });
    return Array.from(years);
  }
  
  // For individual files, try to infer available years
  const years = new Set();
  if (getGlobalData().dates && getGlobalData().dates.length > 0) {
    getGlobalData().dates.forEach(date => {
      if (date.Date) {
        const d = new Date(date.Date);
        years.add(d.getFullYear());
      }
    });
  }
  
  return Array.from(years);
}

// ===== Dependency Management =====

/**
 * Set global dependencies for date management system
 */
export function setDependencies(dataOrFunction, updateFns = {}) {
  // Accept either data object or function that returns data
  if (typeof dataOrFunction === 'function') {
    getGlobalData = dataOrFunction;
  } else {
    getGlobalData = () => dataOrFunction;
  }
  
  updateFunctions = {
    overviewMetrics: updateFns.overviewMetrics || (() => {}),
    performanceChart: updateFns.performanceChart || (() => {}),
    topPagesTable: updateFns.topPagesTable || (() => {}),
    blogPerformance: updateFns.blogPerformance || (() => {}),
    dashboardWithFilter: updateFns.dashboardWithFilter || (() => {})
  };
  
  logger.info('DateUtils dependencies set', {
    hasDataFunction: typeof getGlobalData === 'function',
    updateFunctionsAvailable: Object.keys(updateFunctions).filter(key => typeof updateFunctions[key] === 'function')
  });
}

// ===== Initialization =====

/**
 * Initialize date management system
 */
export function initializeDateManagement() {
  logger.info('Initializing date management system');
  
  // Listen for navigation changes to maintain sync state
  window.addEventListener('popstate', () => {
    // Always update date range displays, even when there's no current range
    // This ensures the full available date range is shown when "All data" is selected
    updateDateRangeDisplays(currentGlobalDateRange);
  });
  
  // Initialize date range displays when the system starts
  // This ensures the correct date range is shown on page load
  setTimeout(() => {
    updateDateRangeDisplays(currentGlobalDateRange);
  }, 100);
  
  logger.info('Date management system initialized');
}

// Auto-initialize when module loads
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeDateManagement);
  } else {
    initializeDateManagement();
  }
} 