import { logger } from './logger.js';

// ===== Auto Data Loader =====
class AutoDataLoader {
    constructor() {
        this.dataFile = 'dashboard_data.json';
        this.isLoading = false;
        this.loadedData = null;
        this.loadCallbacks = [];
    }

    /**
     * Load data automatically from JSON file
     * @returns {Promise<Object>} Loaded data
     */
    async loadData() {
        if (this.isLoading) {
            // If already loading, wait for it to complete
            return new Promise((resolve) => {
                this.loadCallbacks.push(resolve);
            });
        }

        if (this.loadedData) {
            // Return cached data if available
            return this.loadedData;
        }

        this.isLoading = true;
        logger.info('Auto-loading data from JSON file...');

        try {
            const response = await fetch(this.dataFile);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            // Keep log lightweight; avoid heavy stringify for size estimation
            logger.info('JSON data fetched and parsed successfully');
            
            // Validate data structure (non-fatal for optional fields)
            if (!this.validateDataStructure(data)) {
                throw new Error('Invalid data structure in JSON file');
            }

            this.loadedData = data;
            logger.info('Data loaded successfully', {
                dailyRecords: data.dates?.length || 0,
                pages: data.pages?.length || 0,
                urlData: Object.keys(data.url_data || {}).length,
                dateRange: data.metadata?.global_date_range
            });

            // Resolve any pending callbacks
            this.loadCallbacks.forEach(callback => callback(data));
            this.loadCallbacks = [];

            return data;

        } catch (error) {
            logger.error('Failed to load data from JSON file', { 
                error: error.message,
                file: this.dataFile 
            });
            
            // Resolve callbacks with null
            this.loadCallbacks.forEach(callback => callback(null));
            this.loadCallbacks = [];
            
            throw error;
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Validate the data structure
     * @param {Object} data - Data to validate
     * @returns {boolean} True if valid
     */
    validateDataStructure(data) {
        try {
            // Check required top-level properties
            if (!data || typeof data !== 'object') {
                logger.error('Data is not an object');
                return false;
            }

            // Check for dates array (allow empty/missing -> will default later)
            if (!Array.isArray(data.dates)) {
                logger.warn('Missing or invalid dates array; will default to empty');
                data.dates = [];
            }

            // Check for pages array (allow empty/missing -> will default later)
            if (!Array.isArray(data.pages)) {
                logger.warn('Missing or invalid pages array; will default to empty');
                data.pages = [];
            }

            // url_data is optional; normalize to empty object if missing
            if (!data.url_data || typeof data.url_data !== 'object') {
                logger.warn('Missing or invalid url_data; defaulting to empty object');
                data.url_data = {};
            }

            // metadata is optional but recommended; default to empty
            if (!data.metadata || typeof data.metadata !== 'object') {
                logger.warn('Missing or invalid metadata; defaulting to empty object');
                data.metadata = {};
            }

            // Validate date records (CTR/Position optional; normalizers backfill)
            if (data.dates.length > 0) {
                const sampleDate = data.dates[0];
                const requiredFields = ['Date', 'Clicks', 'Impressions'];
                for (const field of requiredFields) {
                    if (!(field in sampleDate)) {
                        logger.error(`Missing required field in date records: ${field}`);
                        return false;
                    }
                }
            }

            // Validate page records (CTR/Position optional; normalizers backfill)
            if (data.pages.length > 0) {
                const samplePage = data.pages[0];
                const requiredFields = ['Top pages', 'Clicks', 'Impressions'];
                for (const field of requiredFields) {
                    if (!(field in samplePage)) {
                        logger.error(`Missing required field in page records: ${field}`);
                        return false;
                    }
                }
            }

            logger.info('Data structure validation passed');
            return true;

        } catch (error) {
            logger.error('Error validating data structure', { error: error.message });
            return false;
        }
    }

    // (removed) getLoadedData - not used

    // (removed) clearLoadedData - not used

    // (removed) hasData - not used

    // (removed) getDataStats - not used
}

// ===== Global Auto Data Loader Instance =====
const autoDataLoader = new AutoDataLoader();

// ===== Export Functions =====

/**
 * Load data automatically from JSON file
 * @returns {Promise<Object>} Loaded data
 */
async function loadAutoData() {
    return await autoDataLoader.loadData();
}

/**
 * Get currently loaded data
 * @returns {Object|null} Loaded data or null
 */
// (removed) getAutoLoadedData - no longer exported/used

/**
 * Check if auto data is available
 * @returns {boolean} True if data is loaded
 */
// (removed) hasAutoData - no longer exported/used

/**
 * Get auto data statistics
 * @returns {Object|null} Data statistics or null
 */
// (removed) getAutoDataStats - no longer exported/used

/**
 * Clear auto loaded data
 */
// (removed) clearAutoData - no longer exported/used

/**
 * Get the auto data loader instance
 * @returns {AutoDataLoader} Auto data loader instance
 */
// (removed) getAutoDataLoader - no longer exported/used

// ===== Data Transformation Functions =====

/**
 * Transform auto-loaded data to dashboard format
 * @param {Object} autoData - Auto-loaded data
 * @returns {Object} Dashboard-compatible data
 */
export function transformAutoDataToDashboardFormat(autoData) {
    if (!autoData) {
        logger.warn('No auto data provided for transformation');
        return null;
    }

    try {
        // Transform auto data to match expected dashboard structure
        const dashboardData = {
            // Core data from JSON
            dates: autoData.dates || [],
            pages: autoData.pages || [],
            
            // Initialize empty arrays for missing data types (required by dashboard)
            countries: [],
            devices: [],
            queries: [],
            filters: [],
            searchAppearance: [],
            images: [],
            indexedPages: [],
            unsubmittedPages: [],
            
            // Preserve additional data from JSON
            url_data: autoData.url_data || {},
            metadata: autoData.metadata || {},
            keywords_index: autoData.keywords_index || null,
            
            // Create dateRanges array from metadata
            dateRanges: []
        };

        // Generate dateRanges from metadata if available
        if (autoData.metadata && autoData.metadata.global_date_range) {
            const { start, end } = autoData.metadata.global_date_range;
            if (start && end) {
                dashboardData.dateRanges = [`${start} - ${end}`];
            }
        }

        // Validate and normalize data formats
        dashboardData.dates = validateAndNormalizeDates(dashboardData.dates);
        dashboardData.pages = validateAndNormalizePages(dashboardData.pages);

        logger.info('Auto data transformed to dashboard format', {
            datesCount: dashboardData.dates.length,
            pagesCount: dashboardData.pages.length,
            urlDataCount: Object.keys(dashboardData.url_data).length,
            dateRanges: dashboardData.dateRanges,
            metadata: dashboardData.metadata,
            requiredArraysInitialized: [
                'countries', 'devices', 'queries', 'filters', 
                'searchAppearance', 'images', 'indexedPages', 'unsubmittedPages'
            ].every(key => Array.isArray(dashboardData[key]))
        });

        return dashboardData;

    } catch (error) {
        logger.error('Error transforming auto data to dashboard format', { error: error.message });
        return null;
    }
}

/**
 * Validate and normalize dates data
 * @param {Array} dates - Dates array from JSON
 * @returns {Array} Normalized dates array
 */
function validateAndNormalizeDates(dates) {
    if (!Array.isArray(dates)) {
        logger.warn('Invalid dates data, returning empty array');
        return [];
    }

    return dates.map(dateRecord => {
        try {
            // Ensure all required fields exist with proper types
            return {
                Date: dateRecord.Date || '',
                Clicks: Number(dateRecord.Clicks) || 0,
                Impressions: Number(dateRecord.Impressions) || 0,
                CTR: typeof dateRecord.CTR === 'string' ? dateRecord.CTR : `${Number(dateRecord.CTR) || 0}%`,
                Position: Number(dateRecord.Position) || 0
            };
        } catch (error) {
            logger.warn('Failed to normalize date record', { dateRecord, error: error.message });
            return {
                Date: '',
                Clicks: 0,
                Impressions: 0,
                CTR: '0%',
                Position: 0
            };
        }
    }).filter(record => record.Date); // Remove invalid records
}

/**
 * Validate and normalize pages data
 * @param {Array} pages - Pages array from JSON
 * @returns {Array} Normalized pages array
 */
function validateAndNormalizePages(pages) {
    if (!Array.isArray(pages)) {
        logger.warn('Invalid pages data, returning empty array');
        return [];
    }

    return pages.map(pageRecord => {
        try {
            // Ensure all required fields exist with proper types
            return {
                'Top pages': pageRecord['Top pages'] || '',
                Clicks: Number(pageRecord.Clicks) || 0,
                Impressions: Number(pageRecord.Impressions) || 0,
                CTR: typeof pageRecord.CTR === 'string' ? pageRecord.CTR : `${Number(pageRecord.CTR) || 0}%`,
                Position: Number(pageRecord.Position) || 0
            };
        } catch (error) {
            logger.warn('Failed to normalize page record', { pageRecord, error: error.message });
            return {
                'Top pages': '',
                Clicks: 0,
                Impressions: 0,
                CTR: '0%',
                Position: 0
            };
        }
    }).filter(record => record['Top pages']); // Remove invalid records
}

/**
 * Initialize auto data loading system
 * @returns {Promise<Object>} Loaded data
 */
export async function initializeAutoDataLoading() {
    logger.info('Initializing auto data loading system...');
    
    try {
        const data = await loadAutoData();
        
        if (data) {
            logger.info('Auto data loading initialized successfully');
            return data;
        } else {
            logger.warn('No data loaded from auto loader');
            return null;
        }
        
    } catch (error) {
        logger.error('Failed to initialize auto data loading', { error: error.message });
        return null;
    }
}
