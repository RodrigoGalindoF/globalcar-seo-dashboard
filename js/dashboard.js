
// ===== Import Statements =====
import { logger } from './logger.js';
import { parseDate } from './dateUtils.js';
import { showSection, toggleSidebar } from './navbar.js';

import { 
    createDateRangeComponent,
    destroyDateRangeComponent,
    updateAllDateRangeDisplays,
    getDateRangeComponentManager,
    initDateRangePicker
} from './dateRangePicker.js';
import { 
    updateDashboard, 
    updateDateRange, 
    updateOverviewMetrics, 
    updatePerformanceChart, 
    updateTopPagesTable, 
    setDependencies as setDashboardUpdatesDependencies
} from './dashboardUpdates.js';
import { 
    toggleMetric,
    resetMetrics,
    setDependencies as setChartsDependencies
} from './charts.js';
import { 
    initializeChartZoomScroll,
    getChartZoomScrollManager
} from './chartZoomScroll.js';

import { 
    applyDateRange,
    updateGlobalDateRange,
    getCurrentGlobalDateRange,
    setDependencies as setDateRangeDependencies,
    initializeDateManagement,
    registerDateRangeDisplay
} from './dateUtils.js';
import { normalizePageUrl } from './utils.js';
import { defaultTPSEngine } from './tpsScoringEngine.js';
import { ogMetadataManager } from './ogMetadataManager.js';
import { 
    initializeAutoDataLoading, 
    transformAutoDataToDashboardFormat
} from './autoDataLoader.js';

// ===== Safety Wrapper Functions =====
// These functions provide safety checks for when functions aren't loaded yet

// Make date range functions available globally for KPI and Top Pages sync
window.getCurrentGlobalDateRange = getCurrentGlobalDateRange;

window.showSection = function(sectionId) {
    setTimeout(() => {
        if (typeof window.showSection === 'function' && window.showSection !== arguments.callee) {
            window.showSection(sectionId);
        }
    }, 100);
};

window.toggleSidebar = function() {
    setTimeout(() => {
        if (typeof window.toggleSidebar === 'function' && window.toggleSidebar !== arguments.callee) {
            window.toggleSidebar();
        }
    }, 100);
};

// ===== Global Variables =====
let globalData = {
    countries: [],
    dates: [],
    devices: [],
    filters: [],
    pages: [],
    queries: [],
    searchAppearance: [],
    images: [],
    indexedPages: [],
    unsubmittedPages: [],
    dateRanges: []
};


let charts = {};
let currentFilteredData = null; // Track currently filtered data

// Make currentFilteredData accessible globally for date range filter
window.currentFilteredData = currentFilteredData;
window.globalData = globalData; // Make globalData accessible globally

// ===== Country Filter (Main Chart) =====
let aggregatedDatesCache = [];
let currentCountryFilter = '';
let sanitizedDomainCache = '';
let topPagesCandidatesCache = [];
const byCountryCsvCache = new Map(); // key: `${iso3}|${sanitized}` -> rows
const aggregatedWeeklyCsvCache = new Map(); // key: `${sanitized}` -> rows
let aggregatedDailyLoaded = false; // ensure aggregated daily CSV only loads once

const countryNameToISO3 = {
    'United States': 'USA',
    'Mexico': 'MEX',
    'Canada': 'CAN'
};

function sanitizeToUnderscore(str) {
    return str.replace(/:\/\//g, '_').replace(/\//g, '_').replace(/\./g, '_');
}

function getSanitizedDomain() {
    if (sanitizedDomainCache) return sanitizedDomainCache;
    try {
        // Prefer a page URL from data
        const samplePage = globalData?.pages?.[0]?.['Top pages'] || 'https://www.getglobalcare.com/';
        const urlObj = new URL(samplePage.startsWith('http') ? samplePage : `https://${samplePage}`);
        const base = `${urlObj.protocol}//${urlObj.hostname}`; // e.g., https://www.getglobalcare.com
        sanitizedDomainCache = sanitizeToUnderscore(base);
        return sanitizedDomainCache;
    } catch (_) {
        sanitizedDomainCache = 'https_www_getglobalcare_com';
        return sanitizedDomainCache;
    }
}

function buildAggregatedDailyPath() {
    return `Data/Chart-Daily_Data/property_${getSanitizedDomain()}_daily_all_countries_all_data.csv`;
}

function buildCountryDailyPath(iso3) {
    return `Data/Chart-Daily_Data/property_${getSanitizedDomain()}_daily_country_${iso3}_all_data.csv`;
}

async function ensureAggregatedDailyLoaded() {
    if (aggregatedDailyLoaded && aggregatedDatesCache && aggregatedDatesCache.length) return;
    const path = buildAggregatedDailyPath();
    try {
        const parsed = await loadDailyCsv(path);
        aggregatedDatesCache = parsed.sort((a, b) => new Date(a.Date) - new Date(b.Date));
        aggregatedDailyLoaded = true;
        logger.info('Aggregated daily CSV loaded for main chart', { path, count: aggregatedDatesCache.length });
    } catch (e) {
        aggregatedDailyLoaded = true;
        logger.error('Failed to load aggregated daily CSV; using existing in-memory dates if any', { path, error: e.message });
        if (!aggregatedDatesCache || !aggregatedDatesCache.length) {
            aggregatedDatesCache = (globalData?.dates || []).slice().sort((a, b) => new Date(a.Date) - new Date(b.Date));
        }
    }
}

function parseDailyCsvRowsToDates(rows) {
    // Expect columns: start_date,end_date,date,clicks,impressions,ctr,position
    return rows.map(r => {
        const clicks = Number(r.clicks || 0);
        const imps = Number(r.impressions || 0);
        let ctrFrac = 0;
        if (r.ctr !== undefined && r.ctr !== null && r.ctr !== '') {
            const val = String(r.ctr);
            ctrFrac = val.includes('%') ? (parseFloat(val.replace('%', '')) / 100) : parseFloat(val) || 0;
        }
        const pos = Number(r.position || 0);
        return {
            Date: r.date || r.start_date || '',
            Clicks: clicks,
            Impressions: imps,
            CTR: `${(ctrFrac * 100).toFixed(2)}%`,
            Position: pos
        };
    }).filter(d => d.Date);
}

function loadDailyCsv(path) {
    return new Promise((resolve, reject) => {
        try {
            const Papa = window.Papa;
            if (!Papa) return reject(new Error('PapaParse not available'));
            Papa.parse(path, {
                download: true,
                header: true,
                dynamicTyping: false,
                skipEmptyLines: true,
                complete: (results) => {
                    if (results && Array.isArray(results.data)) {
                        resolve(parseDailyCsvRowsToDates(results.data));
                    } else {
                        reject(new Error('Invalid CSV parse result'));
                    }
                },
                error: (err) => reject(err)
            });
        } catch (e) {
            reject(e);
        }
    });
}

async function applyCountryToMainChart(countryName) {
    try {
        const chartLoading = document.getElementById('chartLoadingIndicator');
        if (chartLoading) chartLoading.style.display = 'block';

        let datesToUse = [];
        if (countryName && countryNameToISO3[countryName]) {
            const iso3 = countryNameToISO3[countryName];
            const path = buildCountryDailyPath(iso3);
            const parsed = await loadDailyCsv(path);
            // Sort by date ascending
            datesToUse = parsed.sort((a, b) => new Date(a.Date) - new Date(b.Date));
            currentCountryFilter = countryName;
        } else {
            await ensureAggregatedDailyLoaded();
            datesToUse = aggregatedDatesCache;
            currentCountryFilter = '';
        }

        // Compose chart data and persist as current global for zoom + KPI sync
        const chartData = { ...globalData, dates: datesToUse };
        globalData = chartData;
        window.globalData = globalData;

        // Update the performance chart only
        const { updateChartById } = await import('./charts.js');
        updateChartById('performance', chartData);
        
        // Preserve current visible date range with zoom manager
        const currentRange = getCurrentGlobalRangeSafe();
        const zoomMgr = getChartZoomScrollManager?.();
        if (zoomMgr && currentRange && currentRange.start && currentRange.end) {
            try {
                zoomMgr.updateChartToDateRange('performance', currentRange);
            } catch (_) {}
        }

        // Sync KPI section with current selection and visible date range
        await updateKpisForCurrentSelection();

        // Sync Top Pages section using weekly data source
        await updateTopPagesForCurrentSelection();
    } catch (error) {
        logger.error('Failed to apply country filter to main chart', { error: error.message });
        // Fallback to aggregated
        const chartData = { ...globalData, dates: aggregatedDatesCache?.length ? aggregatedDatesCache : (globalData.dates || []) };
        const { updateChartById } = await import('./charts.js');
        updateChartById('performance', chartData);
        const currentRange = getCurrentGlobalRangeSafe();
        const zoomMgr = getChartZoomScrollManager?.();
        if (zoomMgr && currentRange && currentRange.start && currentRange.end) {
            try {
                zoomMgr.updateChartToDateRange('performance', currentRange);
            } catch (_) {}
        }
        await updateKpisForCurrentSelection();
        await updateTopPagesForCurrentSelection();
    } finally {
        const chartLoading = document.getElementById('chartLoadingIndicator');
        if (chartLoading) chartLoading.style.display = 'none';
    }
}

function bindCountryFilter() {
    const selectEl = document.getElementById('countryFilterSelect');
    if (!selectEl) return;

    const dropdownEl = document.getElementById('countryDropdown');
    const toggleBtn = dropdownEl ? dropdownEl.querySelector('.country-dropdown-toggle') : null;
    const selectedTextEl = dropdownEl ? dropdownEl.querySelector('.country-selected-text') : null;
    const menuEl = document.getElementById('countryDropdownMenu');
    const items = Array.from(menuEl ? menuEl.querySelectorAll('.country-dropdown-item') : []);

    // Ensure items are focusable for keyboard navigation
    items.forEach(item => { item.tabIndex = 0; });

    // Hover intent: open only on toggle hover; keep open while hovering the menu
    let hoverCloseTimeout = null;
    const openMenu = () => {
        if (!dropdownEl || !toggleBtn) return;
        clearTimeout(hoverCloseTimeout);
        dropdownEl.classList.add('open');
        toggleBtn.setAttribute('aria-expanded', 'true');
    };
    const closeMenu = (delayMs = 120) => {
        if (!dropdownEl || !toggleBtn) return;
        clearTimeout(hoverCloseTimeout);
        hoverCloseTimeout = setTimeout(() => {
            dropdownEl.classList.remove('open');
            toggleBtn.setAttribute('aria-expanded', 'false');
        }, delayMs);
    };

    function updateLabelFromSelect() {
        if (selectedTextEl) selectedTextEl.textContent = selectEl.value || 'All countries';
        items.forEach(item => {
            const isSelected = (item.dataset.value || '') === (selectEl.value || '');
            item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        });
    }

    // Restore last selection from localStorage if available; default to United States
    try {
        const last = localStorage.getItem('dashboard:lastCountrySelection') || '';
        const hasLast = typeof last === 'string' && Array.from(selectEl.options).some(o => o.value === last) && last !== '';
        const desired = hasLast ? last : 'United States';
        if (selectEl.value !== desired) {
            selectEl.value = desired;
            // Trigger change to apply data and update label
            setTimeout(() => selectEl.dispatchEvent(new Event('change', { bubbles: true })), 0);
        }
    } catch (_) {}

    // Keep existing logic and sync the custom UI
    selectEl.addEventListener('change', (e) => {
        const countryName = e.target.value || '';
        applyCountryToMainChart(countryName);
        updateLabelFromSelect();
        // Persist last selection
        try { localStorage.setItem('dashboard:lastCountrySelection', countryName); } catch (_) {}
    });

    // Click selection for custom items
    items.forEach(item => {
        item.addEventListener('click', () => {
            const value = item.dataset.value || '';
            if (selectEl.value !== value) {
                selectEl.value = value;
                selectEl.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
                updateLabelFromSelect();
            }
            closeMenu(0);
        });

        // Keyboard support on items
        item.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                item.click();
            } else if (e.key === 'Escape') {
                closeMenu(0);
                if (toggleBtn) toggleBtn.focus();
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const currentIndex = items.indexOf(item);
                const nextIndex = e.key === 'ArrowDown'
                    ? (currentIndex + 1) % items.length
                    : (currentIndex - 1 + items.length) % items.length;
                items[nextIndex].focus();
            }
        });

        // Hover handling for menu items (keep open while over items)
        item.addEventListener('mouseenter', () => openMenu());
        item.addEventListener('mouseleave', () => closeMenu());
    });

    // Toggle via button for touch/click devices (hover is handled via CSS)
    if (toggleBtn && dropdownEl) {
        toggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const willOpen = !dropdownEl.classList.contains('open');
            if (willOpen) {
                openMenu();
                if (items.length) items[0].focus();
            } else {
                closeMenu(0);
            }
        });

        toggleBtn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
                e.preventDefault();
                openMenu();
                if (items.length) items[0].focus();
            } else if (e.key === 'Escape') {
                closeMenu(0);
            }
        });

        // Close when clicking outside
        document.addEventListener('click', (e) => {
            if (dropdownEl && !dropdownEl.contains(e.target)) {
                closeMenu(0);
            }
        });

        // Open only when hovering the toggle
        toggleBtn.addEventListener('mouseenter', () => openMenu());
        toggleBtn.addEventListener('mouseleave', () => closeMenu());

        // Keep open while hovering the menu itself
        if (menuEl) {
            menuEl.addEventListener('mouseenter', () => openMenu());
            menuEl.addEventListener('mouseleave', () => closeMenu());
        }
    }

    // Initialize label and selection state
    updateLabelFromSelect();
}

function getCurrentGlobalRangeSafe() {
    try {
        return getCurrentGlobalDateRange();
    } catch (_) {
        return null;
    }
}

function filterDatesByRange(dates, range) {
    if (!dates || !dates.length || !range || !range.start || !range.end) return dates || [];
    const start = parseDate(range.start);
    const end = parseDate(range.end);
    return dates.filter(d => {
        const dd = parseDate(d.Date || d.date);
        return dd && !isNaN(dd) && dd >= start && dd <= end;
    });
}

async function updateKpisForCurrentSelection() {
    try {
        // Base dates based on current country selection
        let dates = aggregatedDatesCache?.length ? aggregatedDatesCache : (globalData.dates || []);
        if (currentCountryFilter && countryNameToISO3[currentCountryFilter]) {
            dates = (globalData.dates || []).slice();
        }
        // Respect current visible/selected date range
        const range = getCurrentGlobalRangeSafe();
        const filteredDates = filterDatesByRange(dates, range);
        const kpiData = { ...globalData, dates: filteredDates };
        const { updateOverviewMetrics } = await import('./dashboardUpdates.js');
        updateOverviewMetrics(kpiData);
    } catch (e) {
        logger.error('Failed updating KPI for current selection', { error: e.message });
    }
}

// ===== Top Pages Weekly Data Sync =====
function ensureTopPagesCandidates() {
    if (topPagesCandidatesCache.length) return topPagesCandidatesCache;
    // Use existing aggregated pages to pick top candidates by Clicks
    const pages = (globalData?.pages || []).slice().sort((a, b) => (b.Clicks || 0) - (a.Clicks || 0));
    // Keep unique by normalized URL and cap to 200
    const seen = new Set();
    const unique = [];
    for (const p of pages) {
        const raw = p && p['Top pages'];
        if (!raw) continue;
        const norm = normalizePageUrl(raw);
        if (!norm || seen.has(norm)) continue;
        seen.add(norm);
        unique.push(norm);
        if (unique.length >= 200) break;
    }
    topPagesCandidatesCache = unique;
    return topPagesCandidatesCache;
}

function sanitizeUrlToFilename(url) {
    try {
        const u = new URL(url.startsWith('http') ? url : `https://${url}`);
        const full = `${u.protocol}//${u.hostname}${u.pathname}`;
        return full.replace(/:\/\//g, '_').replace(/\//g, '_').replace(/\./g, '_');
    } catch (_) {
        return url.replace(/:\/\//g, '_').replace(/\//g, '_').replace(/\./g, '_');
    }
}

function weeklyRowOverlapsRange(row, range) {
    if (!range || !range.start || !range.end) return true;
    const rs = parseDate(row.start_date);
    const re = parseDate(row.end_date);
    const s = parseDate(range.start);
    const e = parseDate(range.end);
    if (!rs || !re || !s || !e) return true;
    return re >= s && rs <= e;
}

function aggregateWeeklyRows(rows) {
    if (!rows || !rows.length) return { clicks: 0, impressions: 0, ctrPct: '0.00%', position: 0 };
    let clicks = 0, impressions = 0, ctrSum = 0, posSum = 0, n = 0;
    for (const r of rows) {
        clicks += Number(r.clicks || 0);
        impressions += Number(r.impressions || 0);
        let ctrFrac = 0;
        if (r.ctr !== undefined) {
            const v = String(r.ctr);
            ctrFrac = v.includes('%') ? (parseFloat(v.replace('%', '')) / 100) : parseFloat(v) || 0;
        }
        const pos = Number(r.position || 0);
        if (r.impressions && Number(r.impressions) > 0) {
            ctrSum += (ctrFrac * 100);
            posSum += pos;
            n += 1;
        }
    }
    const ctrPct = n > 0 ? (ctrSum / n).toFixed(2) + '%' : '0.00%';
    const position = n > 0 ? posSum / n : 0;
    return { clicks, impressions, ctrPct, position };
}

async function loadWeeklyRowsForUrl(sanitizedName, iso3 = '', normalizedUrl = '') {
    // Aggregated source must be read from aggregated weekly CSV files
    if (!iso3) {
        const cacheKey = sanitizedName;
        if (aggregatedWeeklyCsvCache.has(cacheKey)) return aggregatedWeeklyCsvCache.get(cacheKey);
        const path = `Data/weekly_data_output/aggregated/${sanitizedName}_weekly_all_data.csv`;
        const rows = await new Promise((resolve) => {
            const Papa = window.Papa;
            if (!Papa) return resolve([]);
            Papa.parse(path, {
                download: true,
                header: true,
                dynamicTyping: false,
                skipEmptyLines: true,
                complete: (res) => resolve(res?.data || []),
                error: () => resolve([])
            });
        });
        aggregatedWeeklyCsvCache.set(cacheKey, rows);
        return rows;
    }
    const cacheKey = `${iso3}|${sanitizedName}`;
    if (byCountryCsvCache.has(cacheKey)) return byCountryCsvCache.get(cacheKey);
    const path = `Data/weekly_data_output/by_country/${iso3}/${sanitizedName}_weekly_all_data.csv`;
    const rows = await new Promise((resolve, reject) => {
        const Papa = window.Papa;
        if (!Papa) return resolve([]);
        Papa.parse(path, {
            download: true,
            header: true,
            dynamicTyping: false,
            skipEmptyLines: true,
            complete: (res) => resolve(res?.data || []),
            error: () => resolve([])
        });
    });
    byCountryCsvCache.set(cacheKey, rows);
    return rows;
}

async function updateTopPagesForCurrentSelection() {
    try {
        // Support cancellation to keep zoom interactions smooth
        updateTopPagesForCurrentSelection._token = (updateTopPagesForCurrentSelection._token || 0) + 1;
        const runToken = updateTopPagesForCurrentSelection._token;
        const range = getCurrentGlobalRangeSafe();
        const country = currentCountryFilter;
        const iso3 = country ? countryNameToISO3[country] : '';
        const candidates = ensureTopPagesCandidates();

        // Load and aggregate in small batches for responsiveness
        const batchSize = 25;
        const pageMap = new Map(); // normalizedUrl -> aggregated metrics
        let initialDisplayed = false;
        let lastStreamTs = 0;
        for (let i = 0; i < candidates.length; i += batchSize) {
            // Abort if a newer request superseded this one
            if (runToken !== updateTopPagesForCurrentSelection._token) return;
            const batch = candidates.slice(i, i + batchSize);
            const batchPromises = batch.map(async (url) => {
                const normalized = normalizePageUrl(url);
                const sanitized = sanitizeUrlToFilename(normalized);
                const rows = await loadWeeklyRowsForUrl(sanitized, iso3 || '', normalized);
                if (!rows.length) return null;
                const filtered = rows.filter(r => weeklyRowOverlapsRange(r, range));
                // Skip pages with no overlap in the selected date range to avoid zero KPIs
                if (!filtered.length) return null;
                const agg = aggregateWeeklyRows(filtered);
                return {
                    'Top pages': normalized,
                    Clicks: agg.clicks,
                    Impressions: agg.impressions,
                    CTR: agg.ctrPct,
                    Position: agg.position
                };
            });
            const results = await Promise.all(batchPromises);
            results.filter(Boolean).forEach(page => {
                const key = page['Top pages'];
                const existing = pageMap.get(key);
                if (existing) {
                    const clicks = (existing.Clicks || 0) + (page.Clicks || 0);
                    const imps = (existing.Impressions || 0) + (page.Impressions || 0);
                    const pos = Math.min(existing.Position || Infinity, page.Position || Infinity);
                    pageMap.set(key, {
                        ...existing,
                        Clicks: clicks,
                        Impressions: imps,
                        CTR: imps > 0 ? ((clicks / imps) * 100).toFixed(2) + '%' : '0.00%',
                        Position: pos,
                        'Top pages': key
                    });
                } else {
                    pageMap.set(key, { ...page });
                }
            });
            // Build a prioritized list of pages based on current UI state (search/type/sort)
            const prioritizePages = () => {
                try {
                    // Pull UI state from the Top Pages component
                    // eslint-disable-next-line no-undef
                    const { getTopPagesUIState } = window.__dashboardUpdates__ || {};
                    return getTopPagesUIState ? getTopPagesUIState() : null;
                } catch (_) { return null; }
            };

            const uiState = prioritizePages();
            const pagesArray = Array.from(pageMap.values());
            let prioritized = pagesArray;
            if (uiState) {
                const { sortField, sortDirection, typeFilter } = uiState;
                // Apply sort only (leave filtering to component)
                const by = (a, b, key, asc = false) => {
                    const va = a[key] || 0; const vb = b[key] || 0;
                    return asc ? (va - vb) : (vb - va);
                };
                if (sortField === 'Clicks') {
                    prioritized.sort((a, b) => by(a, b, 'Clicks', sortDirection === 'asc'));
                } else if (sortField === 'Impressions') {
                    prioritized.sort((a, b) => by(a, b, 'Impressions', sortDirection === 'asc'));
                } else if (sortField === 'CTR') {
                    const parsePct = v => {
                        if (typeof v === 'string' && v.endsWith('%')) return parseFloat(v);
                        const n = parseFloat(v) || 0; return n <= 1 ? (n * 100) : n;
                    };
                    prioritized.sort((a, b) => {
                        const va = parsePct(a.CTR), vb = parsePct(b.CTR);
                        return (sortDirection === 'asc') ? (va - vb) : (vb - va);
                    });
                } else if (sortField === 'Position') {
                    prioritized.sort((a, b) => {
                        const va = Number.isFinite(a.Position) ? a.Position : Infinity;
                        const vb = Number.isFinite(b.Position) ? b.Position : Infinity;
                        return (sortDirection === 'asc') ? (va - vb) : (vb - va);
                    });
                } else {
                    // Auto (Top Pages): heuristic by Clicks desc as a proxy for initial stream
                    prioritized.sort((a, b) => (b.Clicks || 0) - (a.Clicks || 0));
                }

                // Soft-prioritize currently selected type (no filtering)
                if (typeFilter && typeFilter !== 'All') {
                    const matchesType = (url = '') => {
                        const low = String(url).toLowerCase();
                        if (typeFilter === 'Blog') return /\/blog(?:[\/_\-]|$)/.test(low);
                        if (typeFilter === 'Clinics') return /\/clinics(?:[\/_\-]|$)/.test(low);
                        if (typeFilter === 'Doctors') return /\/our-doctors(?:[\/_\-]|$)/.test(low);
                        if (typeFilter === 'Locations') return /\/locations(?:[\/_\-]|$)/.test(low);
                        if (typeFilter === 'Page') return !( /\/blog(?:[\/_\-]|$)/.test(low) || /\/clinics(?:[\/_\-]|$)/.test(low) || /\/our-doctors(?:[\/_\-]|$)/.test(low) || /\/locations(?:[\/_\-]|$)/.test(low) );
                        return false;
                    };
                    const first = [];
                    const rest = [];
                    for (const p of prioritized) {
                        (matchesType(p['Top pages']) ? first : rest).push(p);
                    }
                    prioritized = first.concat(rest);
                }
            } else {
                // Fallback prioritization by Clicks desc
                prioritized.sort((a, b) => (b.Clicks || 0) - (a.Clicks || 0));
            }

            // Early stop once we have enough for display (component shows 20 on Auto)
            if (pageMap.size >= 100) break;
            // Yield to main thread between batches for UI responsiveness
            await new Promise(requestAnimationFrame);

            // Stream an initial render as soon as we have at least 1 page
            if (!initialDisplayed && prioritized.length >= 1) {
                const partial = prioritized.slice(0, Math.min(20, prioritized.length));
                const dataForComponent = { ...globalData, pages: partial };
                const { updateTopPagesTable } = await import('./dashboardUpdates.js');
                if (runToken !== updateTopPagesForCurrentSelection._token) return;
                await updateTopPagesTable(dataForComponent);
                if (runToken !== updateTopPagesForCurrentSelection._token) return;
                initialDisplayed = true;
                lastStreamTs = performance.now();
                continue;
            }

            // After initial display, stream updates at most ~5 times/second
            if (initialDisplayed) {
                const now = performance.now();
                if (now - lastStreamTs > 200) {
                    const partial = prioritized.slice(0, 100);
                    const dataForComponent = { ...globalData, pages: partial };
                    const { updateTopPagesTable } = await import('./dashboardUpdates.js');
                    if (runToken !== updateTopPagesForCurrentSelection._token) return;
                    await updateTopPagesTable(dataForComponent);
                    if (runToken !== updateTopPagesForCurrentSelection._token) return;
                    lastStreamTs = now;
                }
            }
        }

        // Use only weekly_data_output-derived pages (no fallback to JSON)
        const aggregatedPages = Array.from(pageMap.values());
        const uiState = (window.__dashboardUpdates__ && window.__dashboardUpdates__.getTopPagesUIState) 
            ? window.__dashboardUpdates__.getTopPagesUIState() : null;
        let finalPages = aggregatedPages;
        if (uiState) {
            const { sortField, sortDirection, typeFilter } = uiState;
            // Apply sort only (no filter/search here; component handles it)
            const by = (a, b, key, asc = false) => {
                const va = a[key] || 0; const vb = b[key] || 0;
                return asc ? (va - vb) : (vb - va);
            };
            if (sortField === 'Clicks') {
                finalPages.sort((a, b) => by(a, b, 'Clicks', sortDirection === 'asc'));
            } else if (sortField === 'Impressions') {
                finalPages.sort((a, b) => by(a, b, 'Impressions', sortDirection === 'asc'));
            } else if (sortField === 'CTR') {
                const parsePct = v => { if (typeof v === 'string' && v.endsWith('%')) return parseFloat(v); const n = parseFloat(v) || 0; return n <= 1 ? (n * 100) : n; };
                finalPages.sort((a, b) => { const va = parsePct(a.CTR), vb = parsePct(b.CTR); return (sortDirection === 'asc') ? (va - vb) : (vb - va); });
            } else if (sortField === 'Position') {
                finalPages.sort((a, b) => { const va = Number.isFinite(a.Position) ? a.Position : Infinity; const vb = Number.isFinite(b.Position) ? b.Position : Infinity; return (sortDirection === 'asc') ? (va - vb) : (vb - va); });
            } else {
                finalPages.sort((a, b) => (b.Clicks || 0) - (a.Clicks || 0));
            }

            // Soft-prioritize selected type without filtering
            if (typeFilter && typeFilter !== 'All') {
                const matchesType = (url = '') => {
                    const low = String(url).toLowerCase();
                    if (typeFilter === 'Blog') return /\/blog(?:[\/_\-]|$)/.test(low);
                    if (typeFilter === 'Clinics') return /\/clinics(?:[\/_\-]|$)/.test(low);
                    if (typeFilter === 'Doctors') return /\/our-doctors(?:[\/_\-]|$)/.test(low);
                    if (typeFilter === 'Locations') return /\/locations(?:[\/_\-]|$)/.test(low);
                    if (typeFilter === 'Page') return !( /\/blog(?:[\/_\-]|$)/.test(low) || /\/clinics(?:[\/_\-]|$)/.test(low) || /\/our-doctors(?:[\/_\-]|$)/.test(low) || /\/locations(?:[\/_\-]|$)/.test(low) );
                    return false;
                };
                const first = [];
                const rest = [];
                for (const p of finalPages) {
                    (matchesType(p['Top pages']) ? first : rest).push(p);
                }
                finalPages = first.concat(rest);
            }
        } else {
            finalPages.sort((a, b) => (b.Clicks || 0) - (a.Clicks || 0));
        }
        const dataForComponent = { ...globalData, pages: finalPages };
        const { updateTopPagesTable } = await import('./dashboardUpdates.js');
        // Abort delivering result if superseded
        if (runToken !== updateTopPagesForCurrentSelection._token) return;
        await updateTopPagesTable(dataForComponent);
    } catch (e) {
        logger.error('Failed updating Top Pages for current selection', { error: e.message });
    }
}

// View toggle is handled internally by the TopPagesTableComponent

// ===== UI Helper Functions =====

/**
 * Show loading state while initializing dashboard
 */
function showLoadingState() {
    // Update date range text to show loading
    const dateRangeElements = [
        document.getElementById('dateRangeText'),
    ];
    
    dateRangeElements.forEach(element => {
        if (element) {
            element.textContent = 'Loading...';
        }
    });
    
    logger.info('Loading state displayed');
}

/**
 * Hide loading state
 */
function hideLoadingState() {
    logger.info('Loading state hidden');
}

/**
 * Show error state when data loading fails
 */
function showDataLoadError(error) {
    logger.error('Data load error displayed', { error: error.message });
}

/**
 * Show error message when data preloading fails
 */
 

// ===== Dashboard Initialization =====
async function initializeDashboard() {
    logger.info('Initializing dashboard components...');
    
    // Check if Chart.js is loaded
    if (typeof Chart === 'undefined') {
        logger.error('Chart.js library not loaded. Please check the CDN link.');
        showDataLoadError(new Error('Chart.js library not available'));
        return;
    }
    
    // Show loading state
    showLoadingState();

    // Initialize OG metadata manager (non-blocking)
    try { ogMetadataManager.init(); } catch (e) {}
    
    // Try to load auto data first
    try {
        logger.info('Attempting to load auto data...');
        const autoData = await initializeAutoDataLoading();
        
        if (autoData) {
            logger.info('Auto data loaded successfully', {
                datesCount: autoData.dates?.length,
                pagesCount: autoData.pages?.length,
                urlDataCount: Object.keys(autoData.url_data || {}).length
            });
            
            // Transform auto data to dashboard format
            const dashboardData = transformAutoDataToDashboardFormat(autoData);
            
            if (dashboardData) {
                // Update global data with auto-loaded data
                globalData = { ...globalData, ...dashboardData };
                window.globalData = globalData;
                
                logger.info('Global data updated with auto-loaded data', {
                    dailyRecords: globalData.dates?.length || 0,
                    pages: globalData.pages?.length || 0,
                    urlDataCount: Object.keys(globalData.url_data || {}).length
                });
                
                // Debug: Check data structure
                if (globalData.dates && globalData.dates.length > 0) {
                    logger.info('Sample date data:', {
                        firstDate: globalData.dates[0],
                        lastDate: globalData.dates[globalData.dates.length - 1],
                        sampleRecord: globalData.dates[0]
                    });
                }

                setDashboardUpdatesDependencies(globalData, charts);
                setChartsDependencies(globalData, charts);
                setDateRangeDependencies(() => globalData, { 
                    overviewMetrics: updateOverviewMetrics, 
                    performanceChart: updatePerformanceChart, 
                    // Top Pages should sync with zoom/date changes but use weekly CSV data source
                    topPagesTable: async (filteredData) => {
                        // When date range changes, update Top Pages using weekly CSV data
                        // but respect the filtered date range for aggregation
                        await updateTopPagesForCurrentSelection();
                    }
                });
                
                logger.info('Chart dependencies set up:', {
                    hasGlobalData: !!globalData,
                    globalDataKeys: globalData ? Object.keys(globalData) : [],
                    hasCharts: !!charts,
                    chartsKeys: charts ? Object.keys(charts) : []
                });
                
                // Ensure chart container exists before updating dashboard
                const chartContainer = document.getElementById('performanceChart');
                if (!chartContainer) {
                    logger.error('Performance chart container not found. Cannot initialize charts.');
                    showDataLoadError(new Error('Chart container missing'));
                    return;
                }
                
                // Ensure chart container is properly set up
                if (!chartContainer.getContext) {
                    logger.error('Chart container is not a valid canvas element.');
                    showDataLoadError(new Error('Invalid chart container'));
                    return;
                }
                
                logger.info('Chart container validated successfully:', {
                    id: chartContainer.id,
                    width: chartContainer.width,
                    height: chartContainer.height,
                    hasContext: !!chartContainer.getContext
                });
                
                // Update the dashboard with the loaded data
                logger.info('About to call updateDashboard()');
                try {
                    await updateDashboard();
                    logger.info('updateDashboard() completed successfully');
                    
                                    // Start comprehensive data preloading for instant filter switching
                // Smart image manager has been removed - using simple background colors
                logger.info('Smart image manager disabled - using simple background colors');

                // Optional: prioritize initial visible Top Pages once container is ready
                setTimeout(() => {
                    try {
                        const container = document.getElementById('topPagesTableContainer');
                        if (container) {
                            ogMetadataManager.applyToContainer(container);
                        }
                    } catch (_) {}
                }, 0);
                    
                } catch (error) {
                    logger.error('updateDashboard() failed', { error: error.message, stack: error.stack });
                }
                
                // Auto-navigate to overview section
                setTimeout(() => {
                    showSection('overview');
                }, 100);
            } else {
                logger.error('Data transformation failed');
            }
        } else {
            logger.warn('No auto data available');
            
            setDashboardUpdatesDependencies(globalData, charts);
            setChartsDependencies(globalData, charts);
            setDateRangeDependencies(() => globalData, { 
                overviewMetrics: updateOverviewMetrics, 
                performanceChart: updatePerformanceChart, 
                topPagesTable: () => {}
            });
        }
    } catch (error) {
        logger.error('Auto data loading failed', { error: error.message });
        showDataLoadError(error);
        
        setDashboardUpdatesDependencies(globalData, charts);
        setChartsDependencies(globalData, charts);
        setDateRangeDependencies(() => globalData, { 
            overviewMetrics: updateOverviewMetrics, 
            performanceChart: updatePerformanceChart, 
            // Ensure Top Pages is driven exclusively by weekly_data_output via dashboard.js handlers
            topPagesTable: () => {}
        });
    }
    
    // Hide loading state regardless of outcome
    hideLoadingState();
    
    // Initialize date management
    initializeDateManagement();
    
    // Initialize date range picker component system
    initDateRangePicker();
    
    // View toggle listeners not needed; handled by TopPagesTableComponent
    
    // Initialize chart zoom and scroll functionality
    const chartZoomManager = initializeChartZoomScroll();
    
    // Set up chart manager for the performance chart
    if (chartZoomManager) {
        const performanceChartManager = chartZoomManager.getChartManager('performance', 'performanceChart');
        if (performanceChartManager) {
            // Set up the chart manager to handle date range changes
            performanceChartManager.chart = window.charts?.performance;
            performanceChartManager.onChartUpdate();
            
            logger.info('Chart zoom manager initialized for performance chart');
        } else {
            logger.warn('Failed to get performance chart manager');
        }
    } else {
        logger.warn('Chart zoom manager not available');
    }
    
    // Removed zoomDateRangeSynchronized listener (filtering is handled directly by zoom manager after debounce)
    
    // Set up manual date range change listener
    window.addEventListener('manualDateRangeSynchronized', (event) => {
        const { dateRange } = event.detail;
        
        // Manual date range changes should trigger chart updates
        const multiChartManager = getChartZoomScrollManager();
        if (multiChartManager) {
            // Update the performance chart to match the manual date range
            multiChartManager.updateChartToDateRange('performance', dateRange);
        }
        // Keep KPI in sync with date range changes and current country filter
        updateKpisForCurrentSelection();
        // Top Pages update is handled by dateUtils.applyDateRange via setDateRangeDependencies
    });
    
    // Removed: Top Pages is already updated via dateUtils.applyDateRange zoom debounce
    
    // Removed chartDateRangeChanged immediate filtering (handled by zoom manager debounce)
    
    // Chart error event listener
    window.addEventListener('chartError', (event) => {
        const { chartId, error } = event.detail;
        logger.error(`Chart error for ${chartId}:`, error);
        
        // Show chart error indicator
        const errorIndicator = document.getElementById('chartErrorIndicator');
        if (errorIndicator) {
            errorIndicator.style.display = 'block';
            errorIndicator.innerHTML = `<span>⚠️ Chart error: ${error}</span>`;
        }
    });
    
    // Expose all functions globally after initialization
    exposeGlobalFunctions();
    
    // Show overview section by default
    showSection('overview');

    // Initialize main chart from daily CSVs (aggregated or last-selected country)
    try {
        let initialCountry = 'United States';
        try {
            const last = localStorage.getItem('dashboard:lastCountrySelection') || '';
            if (typeof last === 'string' && last) initialCountry = last;
        } catch (_) {}
        await applyCountryToMainChart(initialCountry);
    } catch (e) {
        logger.error('Initial daily CSV chart load failed', { error: e.message });
    }

    // Bind country filter after initial render
    bindCountryFilter();
    
    logger.info('Dashboard initialization complete');
}



// ===== Global Function Exposure =====
function exposeGlobalFunctions() {
    // Navbar functions
    window.showSection = showSection;
    window.toggleSidebar = toggleSidebar;

    // Date range component system functions
    window.createDateRangeComponent = createDateRangeComponent;
    window.destroyDateRangeComponent = destroyDateRangeComponent;
    window.updateAllDateRangeDisplays = updateAllDateRangeDisplays;
    window.getDateRangeComponentManager = getDateRangeComponentManager;

    // Chart functions
    window.toggleMetric = toggleMetric;
    window.resetMetrics = resetMetrics;
    window.toggleBlogMetric = toggleMetric; // Alias for blog metrics

    // Utility functions not exposed here anymore
    // Smart image manager has been removed - using simple background colors



    logger.info('Global functions exposed');
}

// ===== Error Handling =====
window.addEventListener('error', (event) => {
    logger.error('Global error caught', {
        message: event.message,
        filename: event.filename,
        line: event.lineno,
        column: event.colno,
        error: event.error
    });
});

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeDashboard);






