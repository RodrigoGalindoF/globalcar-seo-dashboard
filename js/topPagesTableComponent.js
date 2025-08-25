import { formatNumber, parsePercentage, getPageImage, getPageTitle, normalizePageUrl } from './utils.js';
import { ogMetadataManager } from './ogMetadataManager.js';
import { defaultTPSEngine } from './tpsScoringEngine.js';
import { getCurrentGlobalDateRange } from './dateUtils.js';
import { AllPagesNavbar } from './allPagesNavbar.js';

/**
 * Reusable Top Pages Table Component
 * Encapsulates all functionality for displaying top pages in both table and grid views
 */
export class TopPagesTableComponent {
    constructor(config = {}) {
        this.config = {
            containerId: config.containerId || 'topPagesTableContainer',
            title: config.title || 'Top Pages Table',
            searchPlaceholder: config.searchPlaceholder || 'Search pages...',
            maxItems: config.maxItems || 10,
            enableSearch: config.enableSearch !== false,
            enableViewToggle: config.enableViewToggle !== false,
            enableSorting: config.enableSorting !== false,
            defaultView: config.defaultView || 'grid', // 'grid' or 'table'
            onPageClick: config.onPageClick || null,
            ...config
        };
        
        this.pages = [];
        this.filteredPages = [];
        this.currentView = this.config.defaultView;
        this.searchTerm = '';
        this.typeFilter = 'Blog';
        this.sortField = 'Auto'; // Default to Auto mode
        this.sortDirection = 'desc';
        
        // Smooth transitions: Track current DOM state to prevent flickering
        this.currentDOMState = {
            lastRenderedData: null
        };
        
        // Update strategy: Use incremental updates to prevent flickering
        this.updateStrategy = 'incremental'; // 'incremental' or 'full'
        
        // Scroll position management for smooth filtering
        this.scrollManager = {
            savedPosition: 0,
            container: null,
            shouldPreservePosition: false
        };
        
        // Render scheduling and coalescing
        this._renderRaf = null; // Outer rAF for filter+render coalescing
        this._innerRaf = null;  // Inner rAF for view updates (incremental/full)
        this._isRendering = false; // Guard against re-entrant renders
        this._loadingOverlayTimer = null; // Delayed overlay timer
        this._currentLoadingOverlay = null; // Reference to current overlay element
        // Typing state for search to skip heavy work while user types
        this._isTyping = false;
        this._searchDebounceTimer = null;
        this._searchDebounceMs = 280;

        // Click binding trackers
        this._boundCards = new WeakSet();
        this._boundRows = new WeakSet();
        
        // Navbar instance
        this.navbar = null;
        
        this.init();
    }
    
    /**
     * Initialize the component
     */
    init() {
        this.createHTML();
        this.initializeNavbar();
        this.bindEvents();
        this.addSmoothTransitions();
        this.initializeScrollManager();
        // Initialize OG metadata system once (non-blocking)
        try { ogMetadataManager.init?.(); } catch (_) {}
    }

    /**
     * Determine page type from URL
     * - 'clinics' if includes '/clinics/'
     * - 'blog' if includes '/blog/'
     * - otherwise 'page'
     */
    getPageType(url) {
        const val = (url || '').toLowerCase();
        // Robust matching to handle normalized URLs without trailing slashes and slugs with '_' or '-'
        const isClinics = /getglobalcare\.com\/clinics(?:[\/_\-]|$)/.test(val);
        if (isClinics) return 'clinics';
        const isDoctors = /getglobalcare\.com\/our-doctors(?:[\/_\-]|$)/.test(val);
        if (isDoctors) return 'doctors';
        const isLocations = /getglobalcare\.com\/locations(?:[\/_\-]|$)/.test(val);
        if (isLocations) return 'locations';
        const isBlog = /getglobalcare\.com\/blog(?:[\/_\-]|$)/.test(val);
        if (isBlog) return 'blog';
        return 'page';
    }

    /**
     * Map numeric position to severity class matching CSS: good | medium | poor
     */
    getPositionSeverityClass(position) {
        const pos = typeof position === 'number' && isFinite(position) ? position : Infinity;
        if (pos <= 10) return 'good';
        if (pos <= 20) return 'medium';
        return 'poor';
    }
    
    /**
     * Safe position formatting
     */
    formatPosition(value) {
        const num = Number(value);
        return Number.isFinite(num) ? num.toFixed(1) : '-';
    }
    
    /**
     * Format CTR for display, accepting number or string
     */
    formatCTR(value) {
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed.endsWith('%')) return trimmed;
            const n = Number(trimmed);
            if (!Number.isFinite(n)) return '0%';
            const pct = n <= 1 ? n * 100 : n;
            return `${pct.toFixed(2)}%`;
        }
        const num = Number(value);
        if (!Number.isFinite(num)) return '0%';
        const pct = num <= 1 ? num * 100 : num;
        return `${pct.toFixed(2)}%`;
    }

    /**
     * Invoke onPageClick handler if provided (function or window function name)
     */
    invokePageClick(url, event) {
        try {
            const handler = this.config.onPageClick;
            if (!handler) return;
            if (typeof handler === 'function') {
                handler(url, event);
            } else if (typeof handler === 'string' && typeof window !== 'undefined') {
                const fn = window[handler];
                if (typeof fn === 'function') fn(url, event);
            }
        } catch (_) {}
    }
    
    /**
     * Initialize scroll position management
     */
    initializeScrollManager() {
        // Find the scrollable container (could be window or a specific container)
        this.scrollManager.container = this.findScrollContainer();
    }
    
    /**
     * Find the appropriate scroll container for this component
     */
    findScrollContainer() {
        const container = document.getElementById(this.config.containerId);
        if (!container) return window;
        
        // Walk up the DOM tree to find a scrollable parent
        let element = container.parentElement;
        while (element && element !== document.body) {
            const style = window.getComputedStyle(element);
            if (style.overflow === 'auto' || style.overflow === 'scroll' || 
                style.overflowY === 'auto' || style.overflowY === 'scroll') {
                return element;
            }
            element = element.parentElement;
        }
        
        return window; // Default to window if no scrollable parent found
    }
    
    /**
     * Save current scroll position before DOM updates
     */
    saveScrollPosition() {
        if (this.scrollManager.container === window) {
            this.scrollManager.savedPosition = window.pageYOffset || document.documentElement.scrollTop;
        } else {
            this.scrollManager.savedPosition = this.scrollManager.container.scrollTop;
        }
        this.scrollManager.shouldPreservePosition = true;
    }
    
    /**
     * Restore scroll position after DOM updates with intelligent adjustment
     */
    restoreScrollPosition() {
        if (!this.scrollManager.shouldPreservePosition) return;
        
        // Use requestAnimationFrame to ensure DOM is fully updated
        requestAnimationFrame(() => {
            const targetPosition = this.calculateTargetScrollPosition();
            
            if (this.scrollManager.container === window) {
                window.scrollTo({
                    top: targetPosition,
                    behavior: 'auto' // Use 'auto' for instant, smooth positioning
                });
            } else {
                this.scrollManager.container.scrollTop = targetPosition;
            }
            
            this.scrollManager.shouldPreservePosition = false;
        });
    }
    
    /**
     * Calculate appropriate target scroll position based on content changes
     */
    calculateTargetScrollPosition() {
        const savedPosition = this.scrollManager.savedPosition;
        
        // Get current document/container height
        let maxScrollPosition;
        if (this.scrollManager.container === window) {
            maxScrollPosition = document.documentElement.scrollHeight - window.innerHeight;
        } else {
            maxScrollPosition = this.scrollManager.container.scrollHeight - this.scrollManager.container.clientHeight;
        }
        
        // If the saved position is beyond the new content bounds, adjust it
        if (savedPosition > maxScrollPosition) {
            // Content got shorter, position user near the end but not beyond bounds
            return Math.max(0, maxScrollPosition);
        }
        
        // Otherwise, restore the exact position
        return savedPosition;
    }
    
    /**
     * Add smooth CSS transitions to prevent flickering
     */
    addSmoothTransitions() {
        const container = document.getElementById(this.config.containerId);
        if (!container) return;
        
        // Add CSS for smooth transitions (de-duplicated by id)
        const styleId = `tp-style-${this.config.containerId}`;
        if (document.getElementById(styleId)) return;
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            #${this.config.containerId} .table-container {
                transition: opacity 0.2s ease-in-out;
            }
            #${this.config.containerId} .pages-grid {
                transition: opacity 0.2s ease-in-out;
            }
            #${this.config.containerId} .data-table {
                transition: opacity 0.2s ease-in-out;
            }
            #${this.config.containerId} .page-card {
                transition: all 0.2s ease-in-out;
            }
            #${this.config.containerId} .page-card:hover {
                transform: translateY(-2px);
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            }
            #${this.config.containerId} .fade-in {
                opacity: 0;
                animation: fadeIn 0.3s ease-in-out forwards;
            }
            @keyframes fadeIn {
                to { opacity: 1; }
            }
            
            /* Optimize transitions for performance */
            #${this.config.containerId} .page-card {
                will-change: opacity, transform;
            }
        `;
        document.head.appendChild(style);
    }
    
    /**
     * Check if we can use incremental updates (same data structure, just reordered)
     */
    canUseIncrementalUpdate(newData) {
        if (!this.currentDOMState.lastRenderedData) return false;
        
        const oldData = this.currentDOMState.lastRenderedData;
        
        // If we have no existing data or new data, fall back to full render
        if (oldData.length === 0 && newData.length === 0) return false;
        
        // Check if we have existing DOM elements to work with
        const existingElements = this.currentView === 'grid' 
            ? document.querySelectorAll(`#${this.config.containerId}_gridView .page-card`)
            : document.querySelectorAll(`#${this.config.containerId}_tbody tr`);
        
        if (existingElements.length === 0) return false;
        
        // More permissive logic: Allow incremental updates for partial overlaps
        const oldUrls = new Set(oldData.map(p => p['Top pages']).filter(Boolean));
        let intersectCount = 0;
        let newCount = 0;
        for (const page of newData) {
            const url = page && page['Top pages'];
            if (!url) continue;
            newCount++;
            if (oldUrls.has(url)) intersectCount++;
        }
        const unionSize = oldUrls.size + newCount - intersectCount;
        const overlapPercentage = intersectCount / Math.max(unionSize, 1);
        
        // Allow incremental updates if:
        // 1. Exact match (same URLs, possibly reordered) - original strict check
        // 2. High overlap (80%+ common URLs) - for filtering scenarios
        // 3. Small changes (adding/removing few items) - for minor filtering
        const isExactMatch = oldUrls.size === newCount && overlapPercentage === 1;
        const isHighOverlap = overlapPercentage >= 0.8;
        const isSmallChange = Math.abs(oldData.length - newData.length) <= 3 && overlapPercentage >= 0.7;
        
        const canUpdate = isExactMatch || isHighOverlap || isSmallChange;
        
        return canUpdate;
    }
    
    /**
     * Perform incremental update to prevent flickering
     */
    async performIncrementalUpdate(newData) {
        // Add a tiny delay to ensure smooth visual transition
        await new Promise(resolve => setTimeout(resolve, 10));
        
        if (this.currentView === 'grid') {
            await this.updateGridIncrementally(newData);
        } else {
            await this.updateTableIncrementally(newData);
        }
        
        // Update the last rendered data
        this.currentDOMState.lastRenderedData = [...newData];
        
        // Restore scroll position after incremental update
        this.restoreScrollPosition();
    }
    
    /**
     * Update grid view incrementally by reordering existing cards
     */
    async updateGridIncrementally(newData) {
        const gridContainer = document.getElementById(`${this.config.containerId}_gridView`);
        if (!gridContainer) return;
        
        // Get all existing cards
        const existingCards = Array.from(gridContainer.querySelectorAll('.page-card'));
        
        // Create a map of URL to card element
        const urlToCard = new Map();
        existingCards.forEach(card => {
            const url = card.dataset.url;
            if (url) urlToCard.set(url, card);
        });
        
        // Reorder cards based on new data
        const fragment = document.createDocumentFragment();
        
        const maxItems = this.getEffectiveMaxItems();
        const dataToProcess = maxItems ? newData.slice(0, maxItems) : newData;
        
        for (const page of dataToProcess) {
            const url = page['Top pages'];
            const existingCard = urlToCard.get(url);
            
            if (existingCard) {
                // Update metrics on existing card without recreating
                this.updateCardMetrics(existingCard, page);
                fragment.appendChild(existingCard);
                urlToCard.delete(url); // Remove from map to track unused cards
            } else {
                // Create new card if it doesn't exist
                const newCard = await this.createCardElement(page);
                fragment.appendChild(newCard);
            }
        }
        
        // Remove unused cards with fade out effect
        for (const [url, card] of urlToCard) {
            card.style.opacity = '0';
            card.style.transform = 'scale(0.8)';
            setTimeout(() => card.remove(), 200);
        }
        
        // Update grid container
        gridContainer.innerHTML = '';
        gridContainer.appendChild(fragment);
        // Ensure click handlers are bound for any newly added cards
        this.bindCardClickHandlers(gridContainer);
        
        // Add fade-in effect to new cards
        gridContainer.querySelectorAll('.page-card').forEach(card => {
            if (!card.classList.contains('fade-in')) {
                card.classList.add('fade-in');
            }
        });

        // Apply OG metadata (titles/images) without blocking UI; skip while typing for snappy search
        try {
            if (!this._isTyping) {
                ogMetadataManager.applyToContainer(gridContainer);
            }
        } catch (e) {}
    }
    
    /**
     * Update table view incrementally by reordering existing rows
     */
    async updateTableIncrementally(newData) {
        const tbody = document.getElementById(`${this.config.containerId}_tbody`);
        if (!tbody) return;
        
        // Get all existing rows
        const existingRows = Array.from(tbody.querySelectorAll('tr'));
        
        // Create a map of URL to row element
        const urlToRow = new Map();
        existingRows.forEach(row => {
            const url = row.dataset.url;
            if (url) urlToRow.set(url, row);
        });
        
        // Reorder rows based on new data
        const fragment = document.createDocumentFragment();
        
        const maxItems = this.getEffectiveMaxItems();
        const dataToProcess = maxItems ? newData.slice(0, maxItems) : newData;
        
        for (const page of dataToProcess) {
            const url = page['Top pages'];
            const existingRow = urlToRow.get(url);
            
            if (existingRow) {
                // Update metrics on existing row without recreating
                this.updateRowMetrics(existingRow, page);
                fragment.appendChild(existingRow);
                urlToRow.delete(url); // Remove from map to track unused rows
            } else {
                // Create new row if it doesn't exist
                const newRow = await this.createRowElement(page);
                fragment.appendChild(newRow);
            }
        }
        
        // Remove unused rows with fade out effect
        for (const [url, row] of urlToRow) {
            row.style.opacity = '0';
            setTimeout(() => row.remove(), 200);
        }
        
        // Update table body
        tbody.innerHTML = '';
        tbody.appendChild(fragment);
        // Ensure row click handlers are bound for any newly added rows
        this.bindRowClickHandlers(tbody);
        
        // Add fade-in effect to new rows
        tbody.querySelectorAll('tr').forEach(row => {
            if (!row.classList.contains('fade-in')) {
                row.classList.add('fade-in');
            }
        });

        // Update titles from OG metadata (no images in table view); skip while typing
        try {
            if (!this._isTyping) {
                ogMetadataManager.applyToContainer(tbody);
            }
        } catch (e) {}
    }
    
    /**
     * Update metrics on existing card without recreating the entire element
     */
    updateCardMetrics(card, page) {
        // Update numeric values only, preserving SVG icons
        const clicksContainer = card.querySelector('.page-metric:nth-child(1) .page-metric-value');
        if (clicksContainer) {
            const clicksNumber = this.ensureMetricNumber(clicksContainer);
            if (clicksNumber) clicksNumber.textContent = page.Clicks || 0;
        }

        const impressionsContainer = card.querySelector('.page-metric:nth-child(2) .page-metric-value');
        if (impressionsContainer) {
            const impressionsNumber = this.ensureMetricNumber(impressionsContainer);
            if (impressionsNumber) impressionsNumber.textContent = formatNumber(page.Impressions || 0);
        }

        const ctrContainer = card.querySelector('.page-metric:nth-child(3) .page-metric-value');
        if (ctrContainer) {
            const ctrNumber = this.ensureMetricNumber(ctrContainer);
            if (ctrNumber) ctrNumber.textContent = this.formatCTR(page.CTR);
        }

        const positionElement = card.querySelector('.page-metric:nth-child(4) .page-metric-value .position-indicator');
        if (positionElement) {
            positionElement.textContent = this.formatPosition(page.Position);
            positionElement.className = `position-indicator ${this.getPositionSeverityClass(page.Position)}`;
        }
    }

    /**
     * Ensure there is a dedicated span to hold the numeric value next to the icon
     * This prevents accidental removal of the SVG when updating text
     */
    ensureMetricNumber(valueContainer) {
        if (!valueContainer) return null;
        let numberSpan = valueContainer.querySelector('.metric-number');
        if (!numberSpan) {
            numberSpan = document.createElement('span');
            numberSpan.className = 'metric-number';

            // Insert right after the SVG icon if present
            const svg = valueContainer.querySelector('svg');
            if (svg && svg.nextSibling) {
                svg.parentNode.insertBefore(numberSpan, svg.nextSibling);
            } else if (svg) {
                valueContainer.appendChild(numberSpan);
            } else {
                // Fallback: append at the end
                valueContainer.appendChild(numberSpan);
            }

            // Clean up stray text nodes to avoid duplicate numbers, keep only SVG + span
            const nodes = Array.from(valueContainer.childNodes);
            nodes.forEach(node => {
                if (node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0) {
                    valueContainer.removeChild(node);
                }
            });
        }
        return numberSpan;
    }
    
    /**
     * Update metrics on existing row without recreating the entire element
     */
    updateRowMetrics(row, page) {
        // Update other metrics
        const clicksElement = row.querySelector('td:nth-child(2)');
        if (clicksElement) clicksElement.textContent = page.Clicks || 0;
        
        const impressionsElement = row.querySelector('td:nth-child(3)');
        if (impressionsElement) impressionsElement.textContent = formatNumber(page.Impressions || 0);
        
        const ctrElement = row.querySelector('td:nth-child(4)');
        if (ctrElement) ctrElement.textContent = this.formatCTR(page.CTR);
        
        const positionElement = row.querySelector('.position-indicator');
        if (positionElement) {
            positionElement.textContent = this.formatPosition(page.Position);
            positionElement.className = `position-indicator ${this.getPositionSeverityClass(page.Position)}`;
        }
    }
    
    /**
     * Show non-disruptive loading state that doesn't interfere with scroll position
     */
    showNonDisruptiveLoadingState() {
        // Remove any existing loading overlays first
        this.removeLoadingStates();

        // Delay showing overlay to avoid flashing on quick updates
        if (this._loadingOverlayTimer) {
            clearTimeout(this._loadingOverlayTimer);
            this._loadingOverlayTimer = null;
        }

        const gridContainer = this.currentView === 'grid'
            ? document.getElementById(`${this.config.containerId}_gridView`)
            : null;
        const tableContainer = this.currentView !== 'grid'
            ? document.getElementById(`${this.config.containerId}`)
            : null;

        const parent = gridContainer || tableContainer;
        if (!parent) return;

        this._loadingOverlayTimer = setTimeout(() => {
            // Build the overlay
            const loadingOverlay = document.createElement('div');
            loadingOverlay.className = 'non-disruptive-loading-overlay';
            loadingOverlay.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(255, 255, 255, 0.7);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10;
                opacity: 0;
                transition: opacity 0.2s ease;
                pointer-events: none;
            `;
            loadingOverlay.innerHTML = `
                <div style="background: white; padding: 1rem; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                    <div class="spinner"></div>
                </div>
            `;

            // Ensure parent has relative positioning
            if (getComputedStyle(parent).position === 'static') {
                parent.style.position = 'relative';
            }

            parent.appendChild(loadingOverlay);
            this._currentLoadingOverlay = loadingOverlay;

            // Fade in slightly later to avoid instant flash
            setTimeout(() => {
                if (loadingOverlay.parentNode) {
                    loadingOverlay.style.opacity = '1';
                }
            }, 100);
        }, 300);
    }
    
    /**
     * Remove all loading states
     */
    removeLoadingStates() {
        // Cancel any pending overlay timers
        if (this._loadingOverlayTimer) {
            clearTimeout(this._loadingOverlayTimer);
            this._loadingOverlayTimer = null;
        }
        // Remove stored overlay if present
        if (this._currentLoadingOverlay && this._currentLoadingOverlay.parentNode) {
            try { this._currentLoadingOverlay.remove(); } catch (_) {}
        }
        this._currentLoadingOverlay = null;
        // Also clean up any stray overlays
        document.querySelectorAll('.non-disruptive-loading-overlay').forEach(overlay => {
            try { overlay.remove(); } catch (_) {}
        });
    }
    
    /**
     * Create a new card element for incremental updates
     */
    async createCardElement(page) {
        const url = page['Top pages'];
        const type = this.getPageType(url);
        const pageType = type;
        const pageTypeLabel = (
            type === 'blog' ? 'Blog Post'
            : type === 'clinics' ? 'Clinics'
            : type === 'doctors' ? 'Doctors'
            : type === 'locations' ? 'Locations'
            : 'Page'
        );
        
        // Get display name and background color using simple system
        const displayName = getPageTitle(url);
        const backgroundColor = getPageImage(url, pageType);
        
        // Create card element
        const card = document.createElement('div');
        card.className = 'page-card';
        card.dataset.url = url;
        
        card.innerHTML = `
            <div class="page-image" data-url="${url}" style="background-color: ${backgroundColor};">
                <!-- Background color placeholder -->
            </div>
            <div class="page-header">
                <div class="page-title" data-url="${url}">${displayName}</div>
                <span class="page-type ${pageType}">${pageTypeLabel}</span>
            </div>
            <div class="page-metrics">
                <div class="page-metric">
                    <div class="page-metric-label">Clicks</div>
                    <div class="page-metric-value">
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"></path>
                        </svg>
                        <span class="metric-number">${page.Clicks || 0}</span>
                    </div>
                </div>
                <div class="page-metric">
                    <div class="page-metric-label">Impressions</div>
                    <div class="page-metric-value">
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/>
                            <circle cx="12" cy="12" r="3" stroke-width="2"/>
                        </svg>
                        <span class="metric-number">${formatNumber(page.Impressions || 0)}</span>
                    </div>
                </div>
                <div class="page-metric">
                    <div class="page-metric-label">CTR</div>
                    <div class="page-metric-value">
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path>
                                </svg>
                        <span class="metric-number">${this.formatCTR(page.CTR)}</span>
                    </div>
                </div>
                <div class="page-metric">
                    <div class="page-metric-label">Position</div>
                    <div class="page-metric-value">
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a0 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
                        </svg>
                        <span class="position-indicator ${this.getPositionSeverityClass(page.Position)}">
                            ${this.formatPosition(page.Position)}
                        </span>
                    </div>
                </div>
            </div>
            <div class="page-actions">
                <a href="${url}" class="btn btn-outline page-open-link" target="_blank" rel="noopener noreferrer" title="Open page in new tab">
                    <svg class="icon-external" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" shape-rendering="geometricPrecision">
                        <path d="M6.75 17.25L17.25 6.75" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" vector-effect="non-scaling-stroke"></path>
                        <path d="M10.5 6.75h6.75v6.75" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"></path>
                    </svg>
                    Open Page
                </a>
            </div>
        `;
        
        // Bind click handler if configured
        if (this.config.onPageClick) {
            card.style.cursor = 'pointer';
            card.addEventListener('click', (ev) => this.invokePageClick(url, ev));
        }
        // Prevent card click when clicking the open link
        const openLink = card.querySelector('.page-open-link');
        if (openLink) {
            openLink.addEventListener('click', (ev) => ev.stopPropagation());
        }
        
        return card;
    }
    
    /**
     * Create a new row element for incremental updates
     */
    async createRowElement(page) {
        const url = page['Top pages'];
        let displayName = '';
        
        // Get display name using simple system
        displayName = getPageTitle(url);
        
        const urlDisplay = `<span class="page-title" data-url="${url}" style="color: var(--primary-color); text-decoration: none; cursor: default;">${displayName}</span>`;
        
        const row = document.createElement('tr');
        row.dataset.url = url;
        
        row.innerHTML = `
            <td style="max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${urlDisplay}
            </td>

            <td>${page.Clicks || 0}</td>
            <td>${formatNumber(page.Impressions || 0)}</td>
            <td>${this.formatCTR(page.CTR)}</td>
            <td>
                <span class="position-indicator ${this.getPositionSeverityClass(page.Position)}">
                    ${this.formatPosition(page.Position)}
                </span>
            </td>
        `;
        
        // Bind click handler if configured
        if (this.config.onPageClick) {
            row.style.cursor = 'pointer';
            row.addEventListener('click', (ev) => this.invokePageClick(url, ev));
        }
        
        return row;
    }
    
    /**
     * Create the HTML structure for the component
     */
    createHTML() {
        const container = document.getElementById(this.config.containerId);
        if (!container) {
            try { console.error(`Container with ID '${this.config.containerId}' not found`); } catch (_) {}
            return;
        }
        
        container.innerHTML = `
            <div class="table-container">
                <div class="table-header">
                    <div class="title-section">
                        <h3 class="table-title">${this.config.title}</h3>
                    </div>
                    <div class="table-controls">
                        <div id="${this.config.containerId}_navbarMount"></div>
                    </div>
                </div>
                
                <!-- Grid View -->
                <div id="${this.config.containerId}_gridView" 
                     class="pages-grid" 
                     style="display: ${this.currentView === 'grid' ? 'grid' : 'none'}; position: relative;">
                    <div class="loading" style="grid-column: 1 / -1;">
                        <div class="spinner"></div>
                    </div>
                </div>
                
                <!-- Table View -->
                <div id="${this.config.containerId}_tableView" 
                     style="overflow-x: auto; display: ${this.currentView === 'table' ? 'block' : 'none'};">
                    <table class="data-table" id="${this.config.containerId}_table">
                        <thead>
                            <tr>
                                <th>Page Name</th>

                                <th>Clicks</th>
                                <th>Impressions</th>
                                <th>CTR</th>
                                <th>Position</th>
                            </tr>
                        </thead>
                        <tbody id="${this.config.containerId}_tbody">
                            <tr>
                                <td colspan="5" class="loading">
                                    <div class="spinner"></div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    /**
     * Initialize the navbar component and render controls
     */
    initializeNavbar() {
        try {
            this.navbar = new AllPagesNavbar({
                mountId: `${this.config.containerId}_navbarMount`,
                containerId: this.config.containerId,
                showViewToggle: this.config.enableViewToggle !== false,
                showSorting: this.config.enableSorting !== false,
                showSearch: this.config.enableSearch !== false,
                showTypeFilter: true,
                defaultType: this.typeFilter,
                defaultView: this.currentView,
                sortField: this.sortField,
                sortDirection: this.sortDirection,
                searchPlaceholder: this.config.searchPlaceholder
            });
        } catch (e) {
            try { console.error('Failed to initialize navbar:', e); } catch (_) {}
        }
    }
    
    /**
     * Bind event listeners
     */
    bindEvents() {
        // Navbar-driven events
        if (this.navbar) {
            // Search
            if (this.config.enableSearch) {
                this.navbar.on('search', ({ term }) => {
                    clearTimeout(this._searchDebounceTimer);
                    this._isTyping = true;
                    const value = term || '';
                    this._searchDebounceTimer = setTimeout(() => {
                        this.searchTerm = value.toLowerCase();
                        this.filterAndRender();
                        // Allow heavy tasks again shortly after rendering
                        setTimeout(() => { this._isTyping = false; }, 60);
                    }, this._searchDebounceMs);
                });
            }

            // Type filter
            this.navbar.on('typefilter', ({ type }) => {
                const allowed = ['All', 'Blog', 'Page', 'Clinics', 'Doctors', 'Locations'];
                this.typeFilter = allowed.includes(type) ? type : 'All';
                this.filterAndRender();
            });

            // Sort field
            if (this.config.enableSorting) {
                this.navbar.on('sortchange', ({ field }) => {
                    this.sortField = field;
                    const desiredDefaultDirection = this.sortField === 'Position' ? 'asc' : 'desc';
                    if (this.sortDirection !== desiredDefaultDirection) {
                        this.sortDirection = desiredDefaultDirection;
                        this.updateSortDirectionButton();
                    }
                    this.updateSortingControls();
                    this.filterAndRender();
                });

                // Sort direction
                this.navbar.on('sortdirchange', ({ direction }) => {
                    this.sortDirection = direction === 'asc' ? 'asc' : 'desc';
                    this.updateSortDirectionButton();
                    this.filterAndRender();
                });
            }

            // View toggle
            if (this.config.enableViewToggle) {
                this.navbar.on('viewchange', ({ view }) => {
                    const desired = view === 'table' ? 'table' : 'grid';
                    this.toggleView(desired);
                    // Ensure navbar reflects current view
                    this.navbar.setView(this.currentView);
                });
            }
        }
    }
    
    /**
     * Setup view toggle functionality
     */
    // setupViewToggle removed in favor of AllPagesNavbar events
    
    /**
     * Toggle between grid and table views
     */
    toggleView(viewType) {
        const gridView = document.getElementById(`${this.config.containerId}_gridView`);
        const tableView = document.getElementById(`${this.config.containerId}_tableView`);
        
        this.currentView = viewType;
        
        // Smooth transition between views
        if (viewType === 'grid') {
            // Fade out table, fade in grid
            tableView.style.opacity = '0';
            setTimeout(() => {
                tableView.style.display = 'none';
                gridView.style.display = 'grid';
                gridView.style.opacity = '0';
                requestAnimationFrame(() => {
                    gridView.style.opacity = '1';
                });
            }, 200);
            
            if (this.navbar) this.navbar.setView('grid');
        } else {
            // Fade out grid, fade in table
            gridView.style.opacity = '0';
            setTimeout(() => {
                gridView.style.display = 'none';
                tableView.style.display = 'block';
                tableView.style.opacity = '0';
                requestAnimationFrame(() => {
                    tableView.style.opacity = '1';
                });
            }, 200);
            
            if (this.navbar) this.navbar.setView('table');
        }
        
        // Re-render the current view with smooth transition
        setTimeout(() => {
            this.renderCurrentView();
        }, 250);
    }
    
    /**
     * Update the component with new data
     */
    async updateData(data) {
        let pages = [];
        
        // Handle both bulk data and filtered data
        if (data.dateRanges && data.dateRanges.length > 1) {
            // Bulk data: Aggregate pages across date ranges properly
            const pagesMap = new Map();
            
            (data.pages || []).forEach(page => {
                if (page['Top pages']) {
                    const url = page['Top pages'];
                    
                    if (pagesMap.has(url)) {
                        // Aggregate metrics for existing page
                        const existing = pagesMap.get(url);
                        existing.Clicks = (existing.Clicks || 0) + (page.Clicks || 0);
                        existing.Impressions = (existing.Impressions || 0) + (page.Impressions || 0);
                        existing.Position = Math.min(existing.Position || Infinity, page.Position || Infinity);
                        // Recalculate CTR based on aggregated data
                        existing.CTR = existing.Impressions > 0 ? 
                            ((existing.Clicks / existing.Impressions) * 100).toFixed(2) + '%' : '0.00%';
                    } else {
                        // Add new page
                        pagesMap.set(url, { ...page });
                    }
                }
            });
            
            // Dedupe by normalized URL after aggregation
            const dedupedMap = new Map();
            Array.from(pagesMap.values()).forEach(page => {
                const key = normalizePageUrl(page['Top pages']);
                if (!key) return;
                if (dedupedMap.has(key)) {
                    const existing = dedupedMap.get(key);
                    const clicks = (existing.Clicks || 0) + (page.Clicks || 0);
                    const imps = (existing.Impressions || 0) + (page.Impressions || 0);
                    const pos = Math.min(existing.Position || Infinity, page.Position || Infinity);
                    dedupedMap.set(key, {
                        ...existing,
                        Clicks: clicks,
                        Impressions: imps,
                        CTR: imps > 0 ? ((clicks / imps) * 100).toFixed(2) + '%' : '0.00%',
                        Position: pos,
                        'Top pages': key
                    });
                } else {
                    dedupedMap.set(key, { ...page, 'Top pages': key });
                }
            });
            pages = Array.from(dedupedMap.values());
            
        } else {
            // Single date range OR filtered data - use pages directly
            // Single date range OR filtered data - use pages directly and dedupe
            const dedupedMap = new Map();
            (data.pages || []).forEach(page => {
                if (!page || !page['Top pages']) return;
                const key = normalizePageUrl(page['Top pages']);
                if (!key) return;
                if (dedupedMap.has(key)) {
                    const existing = dedupedMap.get(key);
                    const clicks = (existing.Clicks || 0) + (page.Clicks || 0);
                    const imps = (existing.Impressions || 0) + (page.Impressions || 0);
                    const pos = Math.min(existing.Position || Infinity, page.Position || Infinity);
                    dedupedMap.set(key, {
                        ...existing,
                        Clicks: clicks,
                        Impressions: imps,
                        CTR: imps > 0 ? ((clicks / imps) * 100).toFixed(2) + '%' : '0.00%',
                        Position: pos,
                        'Top pages': key
                    });
                } else {
                    dedupedMap.set(key, { ...page, 'Top pages': key });
                }
            });
            pages = Array.from(dedupedMap.values());
        }
        
        // Store pages and apply current sorting
        this.pages = pages;
        
        // Update UI controls to reflect current state
        this.updateSortingControls();
        
        this.filterAndRender();
    }
    
    /**
     * Update sorting controls to reflect current state
     */
    updateSortingControls() {
        // Sync UI via navbar
        if (this.navbar) {
            this.navbar.setSortField(this.sortField);
            this.navbar.setSortDirection(this.sortDirection);
        }
    }
    
    /**
     * Update the sort direction button appearance
     */
    updateSortDirectionButton() {
        if (this.navbar) {
            this.navbar.setSortDirection(this.sortDirection);
        }
    }

    /**
     * Check if Top Pages (Auto) is enabled
     */
    isTopPagesEnabled() {
        return this.sortField === 'Auto';
    }

    /**
     * Optimized sorting with instant response
     */
    sortPages(pages) {
        // Handle Auto mode with TPS scoring
        if (this.sortField === 'Auto') {
            return this.sortPagesByTPS(pages);
        }
        
        // Use optimized sorting with early returns
        const sorted = pages.sort((a, b) => {
            let valueA, valueB;
            
            switch (this.sortField) {
                case 'Clicks':
                    valueA = a.Clicks || 0;
                    valueB = b.Clicks || 0;
                    break;
                case 'Impressions':
                    valueA = a.Impressions || 0;
                    valueB = b.Impressions || 0;
                    break;
                case 'CTR':
                    // Parse percentage values for proper sorting with caching
                    if (a._parsedCTR === undefined) {
                        const aVal = parsePercentage(a.CTR) || 0;
                        a._parsedCTR = aVal <= 1 ? aVal * 100 : aVal;
                    }
                    if (b._parsedCTR === undefined) {
                        const bVal = parsePercentage(b.CTR) || 0;
                        b._parsedCTR = bVal <= 1 ? bVal * 100 : bVal;
                    }
                    valueA = a._parsedCTR;
                    valueB = b._parsedCTR;
                    break;
                case 'Position':
                    // For position, lower numbers are better, so we need special handling
                    valueA = a.Position || Infinity;
                    valueB = b.Position || Infinity;
                    break;
                default:
                    valueA = a.Clicks || 0;
                    valueB = b.Clicks || 0;
            }
            
            // Sort direction with optimized comparison
            if (this.sortDirection === 'desc') {
                // For Position, desc means higher position numbers (worse positions) first
                return this.sortField === 'Position' ? valueB - valueA : valueB - valueA;
            } else {
                // For Position, asc means lower position numbers (better positions) first  
                return this.sortField === 'Position' ? valueA - valueB : valueA - valueB;
            }
        });
        
        return sorted;
    }

    /**
     * Optimized TPS sorting with instant response
     */
    sortPagesByTPS(pages) {
        try {
            // Get current date range for TPS calculation
            const dateRange = this.getCurrentDateRange();
            
            // Use cached TPS scores if available to prevent recalculation
            const scoredPages = pages.map(page => {
                // Check if TPS is already calculated and cached
                if (page._tpsScore !== undefined && page._tpsDateRange === JSON.stringify(dateRange)) {
                    return page;
                }
                
                // Calculate TPS score and cache it
                const tpsScore = defaultTPSEngine.calculateTPSScore(page, dateRange);
                page.TPS = tpsScore;
                page._tpsScore = tpsScore;
                page._tpsDateRange = JSON.stringify(dateRange);
                
                return page;
            });
            
            // Sort by TPS score (descending by default)
            if (this.sortDirection === 'desc') {
                scoredPages.sort((a, b) => (b.TPS || 0) - (a.TPS || 0));
            } else {
                scoredPages.sort((a, b) => (a.TPS || 0) - (b.TPS || 0));
            }
            
            return scoredPages;
            
        } catch (error) {
            try { console.error('Error sorting by TPS:', error); } catch (_) {}
            // Fallback to clicks sorting
            return pages.sort((a, b) => (b.Clicks || 0) - (a.Clicks || 0));
        }
    }

    /**
     * Get current date range from global state
     */
    getCurrentDateRange() {
        try {
            // Use imported function directly
            return getCurrentGlobalDateRange();
        } catch (error) {
            try { console.warn('Could not get current date range:', error); } catch (_) {}
            // Fallback: infer from data
            if (this.pages && this.pages.length > 0) {
                return this.inferDateRangeFromPages();
            }
            return null;
        }
    }

    /**
     * Infer date range from pages data
     */
    inferDateRangeFromPages() {
        // This is a fallback method - in practice, the date range should come from the global state
        return {
            start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
            end: new Date()
        };
    }
    
    /**
     * Optimized filtering and rendering with instant response
     */
    filterAndRender() {
        // Save scroll position before any DOM changes
        this.saveScrollPosition();
        // Coalesce multiple rapid calls into a single frame
        if (this._renderRaf) {
            cancelAnimationFrame(this._renderRaf);
            this._renderRaf = null;
        }
        this._renderRaf = requestAnimationFrame(() => {
            this._renderRaf = null;
            // Perform real-time filtering and schedule view updates
            this.performRealTimeFiltering();
        });
    }
    
    /**
     * Perform real-time filtering as fallback
     */
    performRealTimeFiltering() {
        // Optional: local lightweight hint could be added here if needed (no global calls)
        
        // Use more efficient filtering with early returns
        let filtered = this.pages;

        // Type filter: All | Blog | Page | Clinics | Doctors | Locations
        if (this.typeFilter && this.typeFilter !== 'All') {
            filtered = filtered.filter((page) => {
                const url = page['Top pages'] || '';
                const type = this.getPageType(url);
                return (
                    (this.typeFilter === 'Blog' && type === 'blog') ||
                    (this.typeFilter === 'Page' && type === 'page') ||
                    (this.typeFilter === 'Clinics' && type === 'clinics') ||
                    (this.typeFilter === 'Doctors' && type === 'doctors') ||
                    (this.typeFilter === 'Locations' && type === 'locations')
                );
            });
        }
        
        // Only apply search filter if there's a search term
        if (this.searchTerm) {
            const searchLower = this.searchTerm.toLowerCase();
            filtered = filtered.filter(page => {
                const url = (page['Top pages'] || '').toLowerCase();
                const title = (getPageTitle(page['Top pages']) || '').toLowerCase();
                return url.includes(searchLower) || title.includes(searchLower);
            });
        }
        
        // Apply sorting with optimized algorithm
        this.filteredPages = this.sortPages(filtered);
        
        // Use incremental updates to prevent flickering when possible
        if (this.updateStrategy === 'incremental' && this.canUseIncrementalUpdate(this.filteredPages)) {
            // Use requestAnimationFrame for smooth updates, but coalesce to the latest
            if (this._innerRaf) {
                cancelAnimationFrame(this._innerRaf);
                this._innerRaf = null;
            }
            this._innerRaf = requestAnimationFrame(async () => {
                this._innerRaf = null;
                try {
                    await this.performIncrementalUpdate(this.filteredPages);
                } catch (error) {
                    try { console.error('Error in incremental update:', error); } catch (_) {}
                }
            });
        } else {
            // Use improved smooth loading that doesn't disrupt layout
            this.showNonDisruptiveLoadingState();
            // Coalesce full renders to the latest
            if (this._innerRaf) {
                cancelAnimationFrame(this._innerRaf);
                this._innerRaf = null;
            }
            this._innerRaf = requestAnimationFrame(async () => {
                this._innerRaf = null;
                try {
                    await this.renderCurrentView();
                } catch (error) {
                    try { console.error('Error in full render:', error); } catch (_) {}
                }
            });
        }
    }
    
    /**
     * Render the current view (grid or table)
     */
    async renderCurrentView() {
        if (this.currentView === 'grid') {
            await this.renderGrid();
        } else {
            await this.renderTable();
        }
        
        // Remove any loading states
        this.removeLoadingStates();
        
        // Track the rendered data for future incremental updates
        this.currentDOMState.lastRenderedData = [...this.filteredPages];
        
        // Restore scroll position after rendering is complete
        this.restoreScrollPosition();
    }
    
    /**
     * Render the table view
     */
    async renderTable() {
        const tbody = document.getElementById(`${this.config.containerId}_tbody`);
        if (!tbody) return;
        
        // Get pages to render
        const maxItems = this.getEffectiveMaxItems();
        const pagesToRender = maxItems ? this.filteredPages.slice(0, maxItems) : this.filteredPages;
        
        // Render immediately with basic data (no blocking calls)
        const pageRows = pagesToRender.map(page => {
            const url = page['Top pages'];
            
            // Get display name using simple system
            let displayName = getPageTitle(url);
            
            const urlDisplay = `<span style="color: var(--primary-color); text-decoration: none; cursor: default;" data-url="${url}" class="page-title">${displayName}</span>`;
            
            return `
                <tr data-url="${url}">
                    <td style="max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        ${urlDisplay}
                    </td>

                    <td>${page.Clicks || 0}</td>
                    <td>${formatNumber(page.Impressions || 0)}</td>
                    <td>${this.formatCTR(page.CTR)}</td>
                    <td>
                        <span class="position-indicator ${this.getPositionSeverityClass(page.Position)}">
                            ${this.formatPosition(page.Position)}
                        </span>
                    </td>
                </tr>
            `;
        });
        
        // Render immediately
        tbody.innerHTML = pageRows.join('');
        // Bind row click handlers
        this.bindRowClickHandlers(tbody);

        // Apply OG titles to table view
        try {
            ogMetadataManager.applyToContainer(tbody);
        } catch (e) {}
    }
    
    /**
     * Render the grid view
     */
    async renderGrid() {
        const gridContainer = document.getElementById(`${this.config.containerId}_gridView`);
        if (!gridContainer) return;
        
        // Get pages to render
        const maxItems = this.getEffectiveMaxItems();
        const pagesToRender = maxItems ? this.filteredPages.slice(0, maxItems) : this.filteredPages;
        
        // Render immediately
        const pageCards = pagesToRender.map(page => {
            const url = page['Top pages'];
            const type = this.getPageType(url);
            const pageType = type; // 'blog' | 'page' | 'clinics' | 'doctors'
            const pageTypeLabel = (
                type === 'blog' ? 'Blog Post'
                : type === 'clinics' ? 'Clinics'
                : type === 'doctors' ? 'Doctors'
                : type === 'locations' ? 'Locations'
                : 'Page'
            );
            
            // Get display name and background color
            const displayName = getPageTitle(url);
            const backgroundColor = getPageImage(url, pageType);
            
            return `
                <div class="page-card" data-url="${url}">
                    <div class="page-image" data-url="${url}" style="background-color: ${backgroundColor};">
                        <!-- Background color placeholder -->
                    </div>
                    <div class="page-header">
                        <div class="page-title" data-url="${url}">${displayName}</div>
                        <span class="page-type ${pageType}">${pageTypeLabel}</span>
                    </div>
                    <div class="page-metrics">
                        <div class="page-metric">
                            <div class="page-metric-label">Clicks</div>
                            <div class="page-metric-value">
                                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"></path>
                                </svg>
                                <span class="metric-number">${page.Clicks || 0}</span>
                            </div>
                        </div>
                        <div class="page-metric">
                            <div class="page-metric-label">Impressions</div>
                            <div class="page-metric-value">
                                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/>
                                    <circle cx="12" cy="12" r="3" stroke-width="2"/>
                                </svg>
                                <span class="metric-number">${formatNumber(page.Impressions || 0)}</span>
                            </div>
                        </div>
                        <div class="page-metric">
                            <div class="page-metric-label">CTR</div>
                            <div class="page-metric-value">
                                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path>
                                </svg>
                                <span class="metric-number">${this.formatCTR(page.CTR)}</span>
                            </div>
                        </div>
                        <div class="page-metric">
                            <div class="page-metric-label">Position</div>
                            <div class="page-metric-value">
                                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a0 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
                                </svg>
                                <span class="position-indicator ${this.getPositionSeverityClass(page.Position)}">
                                    ${this.formatPosition(page.Position)}
                                </span>
                            </div>
                        </div>
                    </div>
                    <div class="page-actions">
                        <a href="${url}" class="btn btn-outline page-open-link" target="_blank" rel="noopener noreferrer" title="Open page in new tab">
                            <svg class="icon-external" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" shape-rendering="geometricPrecision">
                                <path d="M6.75 17.25L17.25 6.75" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" vector-effect="non-scaling-stroke"></path>
                                <path d="M10.5 6.75h6.75v6.75" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"></path>
                            </svg>
                            Open Page
                        </a>
                    </div>
                </div>
            `;
        });
        
        // Render immediately
        gridContainer.innerHTML = pageCards.join('');
        // Bind card click handlers
        this.bindCardClickHandlers(gridContainer);

        // Prevent card click when clicking the open link
        gridContainer.querySelectorAll('.page-open-link').forEach(link => {
            link.addEventListener('click', (ev) => ev.stopPropagation());
        });

        // Apply OG metadata and prioritize visible Top Pages images
        try {
            ogMetadataManager.applyToContainer(gridContainer);
            if (this.isTopPagesEnabled()) {
                const priorityUrls = pagesToRender.map(p => p['Top pages']).filter(Boolean);
                ogMetadataManager.setPriorityUrls(priorityUrls);
            }
        } catch (e) {}
    }
    

    

    

    
    /**
     * Get the current filtered pages
     */
    getFilteredPages() {
        return this.filteredPages;
    }
    
    /**
     * Get the effective max items to display based on filter type
     */
    getEffectiveMaxItems() {
        // When Top Pages (Auto) is enabled, show top 20 pages
        if (this.isTopPagesEnabled()) {
            return 20;
        }
        // For other filters (Clicks, Impressions, CTR, Position), honor configured limit if provided
        return typeof this.config.maxItems === 'number' ? this.config.maxItems : undefined;
    }
    
    /**
     * Attach click handlers to grid cards if onPageClick is set
     */
    bindCardClickHandlers(container) {
        if (!this.config.onPageClick || !container) return;
        const cards = container.querySelectorAll('.page-card[data-url]');
        cards.forEach(card => {
            if (this._boundCards.has(card)) return;
            card.style.cursor = 'pointer';
            const url = card.dataset.url;
            card.addEventListener('click', (ev) => this.invokePageClick(url, ev));
            this._boundCards.add(card);
        });
    }

    /**
     * Attach click handlers to table rows if onPageClick is set
     */
    bindRowClickHandlers(tbody) {
        if (!this.config.onPageClick || !tbody) return;
        const rows = tbody.querySelectorAll('tr[data-url]');
        rows.forEach(row => {
            if (this._boundRows.has(row)) return;
            row.style.cursor = 'pointer';
            const url = row.dataset.url;
            row.addEventListener('click', (ev) => this.invokePageClick(url, ev));
            this._boundRows.add(row);
        });
    }
    
    /**
     * Get the current search term
     */
    getSearchTerm() {
        return this.searchTerm;
    }
    
    /**
     * Get the current view type
     */
    getCurrentView() {
        return this.currentView;
    }
    
    /**
     * Destroy the component and clean up
     */
    destroy() {
        // Clear the container
        const container = document.getElementById(this.config.containerId);
        if (container) {
            container.innerHTML = '';
        }
        if (this.navbar && this.navbar.destroy) {
            try { this.navbar.destroy(); } catch (_) {}
        }
    }
}