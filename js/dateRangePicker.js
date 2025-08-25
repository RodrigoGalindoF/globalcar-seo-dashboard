import { 
  parseISO, 
  toISO, 
  formatDisplay, 
  addDays,
  registerDatePicker, 
  unregisterDatePicker, 
  updateGlobalDateRange, 
  getCurrentGlobalDateRange
} from './dateUtils.js';
import { logger } from './logger.js';

// ===== Date Range Component System =====

/**
 * DateRangeComponent - Self-contained date range picker component
 * Each instance manages its own display and state while staying synchronized
 */
class DateRangeComponent {
  constructor(element, options = {}) {
    this.element = element;
    this.options = {
      autoApply: true,
      showQuickRanges: true,
      showCustomDates: true,
      onDateChange: null,
      ...options
    };
    
    this.picker = null;
    this.isInitialized = false;
    
    this.init();
  }
  
  init() {
    if (this.isInitialized) return;
    
    // Create the date range picker instance
    this.picker = new DateRangePicker(this.element);
    
    // Set up custom event handlers if provided
    if (this.options.onDateChange) {
      this.element.addEventListener('dateRangeChanged', (event) => {
        this.options.onDateChange(event.detail);
      });
    }
    
    // Set up chart date range change listener for real-time synchronization
    this.setupChartDateRangeListener();
    
    this.isInitialized = true;
  }
  
  updateDisplay(rangeObj) {
    if (this.picker && this.picker.updatePill) {
      this.picker.updatePill(rangeObj);
    }
  }
  
  setupChartDateRangeListener() {
    // Listen for chart date range change events
    window.addEventListener('chartDateRangeChanged', (event) => {
      const { dateRange, source } = event.detail;
      
      // Only update if the source is the chart zoom manager (not from date picker)
      if (source === 'chartZoomManager' && dateRange) {
        this.updateDisplay(dateRange);
      }
    });
    
    // Listen for date range display update events
    window.addEventListener('dateRangeDisplayUpdate', (event) => {
      const { rangeObj } = event.detail;
      if (rangeObj) {
        this.updateDisplay(rangeObj);
      }
    });
  }
  
  destroy() {
    if (this.picker) {
      this.picker.destroy();
      this.picker = null;
    }
    this.isInitialized = false;
  }
}

/**
 * DateRangeComponentManager - Manages multiple date range component instances
 * Provides global synchronization and automatic detection of new elements
 */
class DateRangeComponentManager {
  constructor() {
    this.components = new Map();
    this.observer = null;
    this.isInitialized = false;
  }
  
  init() {
    if (this.isInitialized) return;
    
    // Set up mutation observer to detect new date range elements
    this.setupObserver();
    
    // Initialize existing elements
    this.initializeExistingElements();
    
    this.isInitialized = true;
  }
  
  setupObserver() {
    this.observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if the added node is a date range element
            if (node.classList && node.classList.contains('date-range')) {
              this.createComponent(node);
            }
            
            // Check for date range elements within the added node
            const dateRanges = node.querySelectorAll ? node.querySelectorAll('.date-range') : [];
            dateRanges.forEach(element => this.createComponent(element));
          }
        });
      });
    });
    
    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
  
  initializeExistingElements() {
    const dateRanges = document.querySelectorAll('.date-range');
    dateRanges.forEach(element => this.createComponent(element));
  }
  
  createComponent(element, options = {}) {
    // Don't create duplicate components
    if (this.components.has(element)) {
      return this.components.get(element);
    }
    
    const component = new DateRangeComponent(element, options);
    this.components.set(element, component);
    
    return component;
  }
  
  destroyComponent(element) {
    const component = this.components.get(element);
    if (component) {
      component.destroy();
      this.components.delete(element);
    }
  }
  
  updateAllDisplays(rangeObj) {
    this.components.forEach(component => {
      component.updateDisplay(rangeObj);
    });
  }
  
  destroy() {
    this.components.forEach(component => {
      component.destroy();
    });
    this.components.clear();
    
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    
    this.isInitialized = false;
  }
}

// Global component manager instance
let componentManager = null;

// ===== Public API Functions =====

/**
 * Create a date range component for the specified element
 */
export function createDateRangeComponent(element, options = {}) {
  if (!componentManager) {
    componentManager = new DateRangeComponentManager();
    componentManager.init();
  }
  
  return componentManager.createComponent(element, options);
}

/**
 * Destroy a date range component
 */
export function destroyDateRangeComponent(element) {
  if (componentManager) {
    componentManager.destroyComponent(element);
  }
}

/**
 * Update all date range component displays
 */
export function updateAllDateRangeDisplays() {
  if (componentManager) {
    const currentRange = getCurrentGlobalDateRange();
    componentManager.updateAllDisplays(currentRange);
  }
  
  // Dispatch event for other components that need to update
  const event = new CustomEvent('dateRangeDisplayUpdate', {
    detail: { rangeObj: getCurrentGlobalDateRange() }
  });
  window.dispatchEvent(event);
}

/**
 * Get the global component manager instance
 */
export function getDateRangeComponentManager() {
  if (!componentManager) {
    componentManager = new DateRangeComponentManager();
    componentManager.init();
  }
  return componentManager;
}

// ===== Date Range Picker Class =====

class DateRangePicker {
  constructor(pillEl) {
    this.pillEl = pillEl;
    this.overlay = null;
    this.startInput = null;
    this.endInput = null;
    this.init();
    
    // Register this picker with the synchronization system
    registerDatePicker(this);
  }

  init() {
    this.buildDom();
    this.pillEl.addEventListener('click', () => this.open());
    
    // Add event listeners for automatic application when dates are selected
    this.startInput.addEventListener('change', () => this.handleDateChange());
    this.endInput.addEventListener('change', () => this.handleDateChange());
    
    // Initialize with current global state after DOM is built
    setTimeout(() => this.initializeFromGlobalState(), 0);
  }

  buildDom() {
    const overlay = document.createElement('div');
    overlay.id = 'drpOverlay';
    overlay.style.cssText = `position: fixed; inset:0; background: rgba(0,0,0,.35); display:none; z-index:10000;`;

    const panel = document.createElement('div');
    panel.id = 'drpPanel';
    panel.style.cssText = `background:#fff; width:520px; border-radius:12px; padding:1.5rem; position:absolute; top:80px; left:50%; transform:translateX(-50%); box-shadow:0 12px 24px rgba(0,0,0,.15);`;

    // Header
    const h = document.createElement('h4');
    h.textContent = 'Select Date Range';
    h.style.cssText = 'margin:0 0 0.5rem 0; font-size:1.125rem; font-weight:600;';
    
    // Add subtitle explaining auto-apply behavior
    const subtitle = document.createElement('p');
    subtitle.textContent = 'Click any option or select custom dates to apply automatically';
    subtitle.style.cssText = 'margin:0 0 1.5rem 0; font-size:0.875rem; color:#6b7280;';

    // Enhanced date inputs with better styling
    const inputContainer = document.createElement('div');
    inputContainer.style.cssText = 'display: flex; gap: 1rem; margin-bottom: 1.5rem;';
    
    const startContainer = document.createElement('div');
    startContainer.style.cssText = 'flex: 1;';
    const startLabel = document.createElement('label');
    startLabel.textContent = 'Start Date';
    startLabel.style.cssText = 'display: block; margin-bottom: 0.5rem; font-size: 0.875rem; font-weight: 500; color: #374151;';
    const startInput = document.createElement('input');
    startInput.type = 'date';
    startInput.style.cssText = 'width: 100%; padding: 0.75rem; border: 1px solid #d1d5db; border-radius: 0.5rem; font-size: 0.875rem; background: #f9fafb; transition: all 0.2s ease;';
    startInput.addEventListener('focus', () => {
      startInput.style.borderColor = '#4f46e5';
      startInput.style.background = '#ffffff';
    });
    startInput.addEventListener('blur', () => {
      startInput.style.borderColor = '#d1d5db';
      startInput.style.background = '#f9fafb';
    });

    const endContainer = document.createElement('div');
    endContainer.style.cssText = 'flex: 1;';
    const endLabel = document.createElement('label');
    endLabel.textContent = 'End Date';
    endLabel.style.cssText = 'display: block; margin-bottom: 0.5rem; font-size: 0.875rem; font-weight: 500; color: #374151;';
    const endInput = document.createElement('input');
    endInput.type = 'date';
    endInput.style.cssText = 'width: 100%; padding: 0.75rem; border: 1px solid #d1d5db; border-radius: 0.5rem; font-size: 0.875rem; background: #f9fafb; transition: all 0.2s ease;';
    endInput.addEventListener('focus', () => {
      endInput.style.borderColor = '#4f46e5';
      endInput.style.background = '#ffffff';
    });
    endInput.addEventListener('blur', () => {
      endInput.style.borderColor = '#d1d5db';
      endInput.style.background = '#f9fafb';
    });

    this.startInput = startInput;
    this.endInput = endInput;

    startContainer.append(startLabel, startInput);
    endContainer.append(endLabel, endInput);
    inputContainer.append(startContainer, endContainer);

    // Quick ranges with enhanced styling
    const quick = document.createElement('div');
    quick.style.cssText = 'display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; margin-bottom: 1.5rem;';
    
    const ranges = [
      { label: 'Last 7 Days', days: 7 },
      { label: 'Last 30 Days', days: 30 },
      { label: 'Last 60 Days', days: 60 },
      { label: 'Last 90 Days', days: 90 },
      { label: 'Year to Date', ytd: true },
      { label: 'Last Year', lastYear: true }
    ];
    
    ranges.forEach(r => {
      const btn = document.createElement('button');
      btn.textContent = r.label;
      btn.style.cssText = `
        padding: 0.75rem 1rem;
        border: 1px solid #e5e7eb;
        border-radius: 0.5rem;
        background: #ffffff;
        cursor: pointer;
        font-size: 0.875rem;
        font-weight: 500;
        color: #374151;
        transition: all 0.2s ease;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
      `;
      
      btn.addEventListener('mouseenter', () => {
        btn.style.background = '#4f46e5';
        btn.style.color = '#ffffff';
        btn.style.borderColor = '#4f46e5';
        btn.style.transform = 'translateY(-1px)';
        btn.style.boxShadow = '0 4px 12px rgba(79, 70, 229, 0.3)';
      });
      
      btn.addEventListener('mouseleave', () => {
        btn.style.background = '#ffffff';
        btn.style.color = '#374151';
        btn.style.borderColor = '#e5e7eb';
        btn.style.transform = 'translateY(0)';
        btn.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.05)';
      });
      
      btn.onclick = () => this.applyQuick(r);
      quick.appendChild(btn);
    });

    // Footer buttons with enhanced styling
    const footer = document.createElement('div');
    footer.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid #e5e7eb;';
    
    // Clear Filters button
    const clearFilters = document.createElement('button');
    clearFilters.textContent = 'Clear Filters';
    clearFilters.style.cssText = `
      padding: 0.75rem 1.5rem;
      border: 1px solid #dc2626;
      border-radius: 0.5rem;
      background: #ffffff;
      cursor: pointer;
      font-size: 0.875rem;
      font-weight: 500;
      color: #dc2626;
      transition: all 0.2s ease;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    `;
    
    clearFilters.addEventListener('mouseenter', () => {
      clearFilters.style.background = '#dc2626';
      clearFilters.style.color = '#ffffff';
    });
    
    clearFilters.addEventListener('mouseleave', () => {
      clearFilters.style.background = '#ffffff';
      clearFilters.style.color = '#dc2626';
    });
    
    clearFilters.onclick = () => this.clearFilters();
    
    // Cancel button
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.style.cssText = `
      padding: 0.75rem 1.5rem;
      border: 1px solid #e5e7eb;
      border-radius: 0.5rem;
      background: #ffffff;
      cursor: pointer;
      font-size: 0.875rem;
      font-weight: 500;
      color: #374151;
      transition: all 0.2s ease;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    `;
    
    cancel.addEventListener('mouseenter', () => {
      cancel.style.background = '#f3f4f6';
      cancel.style.borderColor = '#d1d5db';
    });
    
    cancel.addEventListener('mouseleave', () => {
      cancel.style.background = '#ffffff';
      cancel.style.borderColor = '#e5e7eb';
    });
    
    cancel.onclick = () => this.close();
    
    footer.append(clearFilters, cancel);

    panel.append(h, subtitle, inputContainer, quick, footer);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    this.overlay = overlay;
  }

  open() {
    this.overlay.style.display = 'block';
    // Add click outside listener when opening
    this.addClickOutsideListener();
  }

  close() {
    this.overlay.style.display = 'none';
    // Remove click outside listener when closing
    this.removeClickOutsideListener();
  }

  addClickOutsideListener() {
    // Remove any existing listener first
    this.removeClickOutsideListener();
    
    // Add click listener to the overlay
    this.clickOutsideHandler = (event) => {
      // Check if the click was on the overlay but not on the panel
      if (event.target === this.overlay) {
        this.close();
      }
    };
    
    this.overlay.addEventListener('click', this.clickOutsideHandler);
  }

  removeClickOutsideListener() {
    if (this.clickOutsideHandler) {
      this.overlay.removeEventListener('click', this.clickOutsideHandler);
      this.clickOutsideHandler = null;
    }
  }

  applyQuick(range) {
    // Prevent multiple simultaneous calls
    if (this.isApplyingQuick) {
      return;
    }
    
    this.isApplyingQuick = true;
    
    const today = new Date();
    if (range.days) {
      const start = addDays(today, -range.days + 1);
      this.startInput.value = toISO(start);
      this.endInput.value = toISO(today);
    } else if (range.ytd) {
      const start = new Date(today.getFullYear(), 0, 1);
      this.startInput.value = toISO(start);
      this.endInput.value = toISO(today);
    } else if (range.lastYear) {
      const start = new Date(today.getFullYear() - 1, 0, 1);
      const end = new Date(today.getFullYear() - 1, 11, 31);
      this.startInput.value = toISO(start);
      this.endInput.value = toISO(end);
    }
    
    // Immediately apply the quick selection and close
    const rangeObj = { 
      start: this.startInput.value || null, 
      end: this.endInput.value || null 
    };
    updateGlobalDateRange(rangeObj, this);
    this.close();
    this.isApplyingQuick = false;
  }

  handleDateChange() {
    const start = this.startInput.value;
    const end = this.endInput.value;
    
    // Only apply if both dates are selected
    if (start && end) {
      const rangeObj = { start: start, end: end };
      updateGlobalDateRange(rangeObj, this);
      this.close();
    }
  }

  clearFilters() {
    // Clear date inputs
    this.startInput.value = '';
    this.endInput.value = '';
    
    // Apply "All data" (no date filter)
    const rangeObj = { start: null, end: null };
    updateGlobalDateRange(rangeObj, this);
    
    // Reset chart zoom to show all available data
    this.resetChartZoom();
    
    // Reset metrics to default
    this.resetMetrics();
    
    // Hide filter status indicator
    this.hideFilterStatus();
    
    // Close the picker
    this.close();
  }

  resetChartZoom() {
    // Import and use the chart zoom manager to reset zoom
    import('./chartZoomScroll.js').then(({ getChartZoomScrollManager }) => {
      const multiChartManager = getChartZoomScrollManager();
      if (multiChartManager) {
        if (typeof multiChartManager.resetToDefault === 'function') {
          multiChartManager.resetToDefault();
        } else if (typeof multiChartManager.resetChartView === 'function') {
          multiChartManager.resetChartView();
        }
      }
    }).catch(error => {
      console.warn('Could not reset chart zoom:', error);
    });
  }

  resetMetrics() {
    // Import and use the charts module to reset metrics
    import('./charts.js').then(({ resetMetrics }) => {
      if (typeof resetMetrics === 'function') {
        resetMetrics();
      }
    }).catch(error => {
      console.warn('Could not reset metrics:', error);
    });
  }

  hideFilterStatus() {
    // Hide the filter status indicator
    const filterStatus = document.getElementById('filterStatus');
    if (filterStatus) {
      filterStatus.style.display = 'none';
    }
  }

  updatePill(range) {
    const textElement = this.pillEl.querySelector('span');
    if (!textElement) return;
    
    if (!range || !range.start || !range.end) {
      // When "All data" is selected, show the full available date range
      // Try to get it from the global data metadata
      if (window.globalData && window.globalData.metadata && window.globalData.metadata.global_date_range) {
        const { start, end } = window.globalData.metadata.global_date_range;
        if (start && end) {
          // Import formatDisplay function to format the dates properly
          import('./dateUtils.js').then(({ formatDisplay }) => {
            textElement.textContent = `${formatDisplay(start)} – ${formatDisplay(end)}`;
          }).catch(() => {
            // Fallback if import fails
            textElement.textContent = `${start} – ${end}`;
          });
        } else {
          textElement.textContent = 'All data';
        }
      } else {
        textElement.textContent = 'All data';
      }
    } else if (range.start === range.end) {
      textElement.textContent = formatDisplay(range.start);
    } else {
      textElement.textContent = `${formatDisplay(range.start)} – ${formatDisplay(range.end)}`;
    }
  }
  
  // Initialize with current global state if it exists
  initializeFromGlobalState() {
    const currentRange = getCurrentGlobalDateRange();
    
    // Don't overwrite input values if the date picker is currently open
    const isPickerOpen = this.overlay && this.overlay.style.display === 'block';
    if (isPickerOpen) {
      this.updatePill(currentRange);
      return;
    }
    
    if (currentRange) {
      this.updatePill(currentRange);
      if (currentRange.start) this.startInput.value = currentRange.start;
      if (currentRange.end) this.endInput.value = currentRange.end;
    } else {
      // Even when there's no current range, update the pill to show the full available date range
      this.updatePill(null);
      if (this.startInput) this.startInput.value = '';
      if (this.endInput) this.endInput.value = '';
    }
  }
  
  // Clean up when picker is destroyed
  destroy() {
    unregisterDatePicker(this);
    // Remove click outside listener before removing overlay
    this.removeClickOutsideListener();
    if (this.overlay) {
      this.overlay.remove();
    }
  }
}

// ===== Initialization =====

// Auto-init when module is loaded
let isInitialized = false;
export function initDateRangePicker() {
  if (isInitialized) {
    return;
  }
  isInitialized = true;
  
  // Initialize the component manager
  const manager = getDateRangeComponentManager();
  
  // Set up global sync event listener for component synchronization
  window.addEventListener('dateRangeSynchronized', (event) => {
    const sourcePickerInstance = event.detail?.sourcePickerInstance;
    const rangeObj = event.detail?.dateRange;
    
    // Update all component displays
    if (manager) {
      manager.updateAllDisplays(rangeObj);
    }
  });
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    try {
      initDateRangePicker();
    } catch (error) {
      console.error('Error initializing DateRangePicker:', error);
    }
  });
} else {
  try {
    initDateRangePicker();
  } catch (error) {
    console.error('Error initializing DateRangePicker:', error);
  }
} 