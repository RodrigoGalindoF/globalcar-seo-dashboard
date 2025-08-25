import { logger } from './logger.js';

/**
 * TPS (Top Page Score) Scoring Engine
 * Implements smart composite scoring for ranking pages by traffic, efficiency, visibility, and momentum
 */
export class TPSScoringEngine {
    constructor(config = {}) {
        this.config = {
            // Balanced scoring weights (only mode available)
            weights: {
                balanced: {
                    C: 0.35,  // Clicks (traffic)
                    E: 0.20,  // CTR uplift vs expected
                    P: 0.15,  // Position score
                    I: 0.15,  // Impressions (visibility)
                    M: 0.10,  // Momentum
                    K: 0.05   // Consistency
                }
            },
            // Expected CTR curve parameters
            expectedCTR: {
                a: 0.35,
                b: 0.9
            },
            // Scaling method
            scaling: 'percentile', // 'percentile' or 'minmax'
            // Minimum impressions threshold
            minImpressions: 10, // Lowered from 30 to include more pages
            ...config
        };
        
        this.logger = logger;
    }

    /**
     * Calculate TPS scores for a set of pages
     * @param {Array} pages - Array of page objects with metrics
     * @param {Object} dateRange - Date range object
     * @returns {Array} Array of pages with TPS and Opportunity scores
     */
    calculateTPSScores(pages, dateRange) {
        try {
            this.logger.info('Starting TPS score calculation', {
                pageCount: pages.length,
                dateRange
            });

            // Validate input
            if (!Array.isArray(pages) || pages.length === 0) {
                this.logger.warn('No pages provided for TPS calculation');
                return [];
            }

            // Always use balanced weights
            const weights = this.config.weights.balanced;
            
            // Filter out pages with insufficient data
            const validPages = pages.filter(page => this.isValidPage(page));
            
            if (validPages.length === 0) {
                this.logger.warn('No valid pages found for TPS calculation');
                return [];
            }

            // Calculate scores for each page
            const scoredPages = validPages.map(page => {
                const scores = this.calculatePageScores(page, weights);
                return {
                    ...page,
                    TPS: scores.TPS,
                    Opportunity: scores.Opportunity,
                    scoreComponents: scores.components
                };
            });

            // Sort by TPS score (descending)
            scoredPages.sort((a, b) => b.TPS - a.TPS);

            this.logger.info('TPS score calculation completed', {
                totalPages: pages.length,
                validPages: validPages.length,
                topScore: scoredPages[0]?.TPS,
                bottomScore: scoredPages[scoredPages.length - 1]?.TPS
            });

            return scoredPages;

        } catch (error) {
            this.logger.error('Error calculating TPS scores', error);
            return [];
        }
    }

    /**
     * Calculate TPS score for a single page
     * @param {Object} page - Single page object with metrics
     * @param {Object} dateRange - Date range object
     * @returns {number} TPS score for the page
     */
    calculateTPSScore(page, dateRange) {
        try {
            // Validate input
            if (!page || !this.isValidPage(page)) {
                return 0;
            }

            // Always use balanced weights
            const weights = this.config.weights.balanced;
            
            // Calculate scores for the single page
            const scores = this.calculatePageScores(page, weights);
            
            return scores.TPS;

        } catch (error) {
            this.logger.error('Error calculating TPS score for single page', { page, error });
            return 0;
        }
    }

    /**
     * Get weights for the specified preset
     */
    getWeights(preset, customWeights) {
        if (preset === 'custom' && customWeights) {
            return { ...this.config.weights.balanced, ...customWeights };
        }
        
        const presetWeights = this.config.weights[preset];
        if (!presetWeights) {
            this.logger.warn(`Unknown preset '${preset}', using balanced`);
            return this.config.weights.balanced;
        }
        
        return presetWeights;
    }

    /**
     * Check if a page has valid data for scoring
     */
    isValidPage(page) {
        return page && 
               page.Impressions >= this.config.minImpressions &&
               page.Position > 0 &&
               page.Position < 100; // Reasonable position range
    }

    /**
     * Calculate individual page scores
     */
    calculatePageScores(page, weights) {
        try {
            // Extract metrics
            const clicks = page.Clicks || 0;
            const impressions = page.Impressions || 0;
            const position = page.Position || 100;
            const ctr = page.CTR || 0;
            
            // Parse CTR if it's a percentage string
            const ctrValue = typeof ctr === 'string' ? parseFloat(ctr.replace('%', '')) / 100 : ctr;

            // Calculate individual component scores
            const components = {
                C: this.calculateClicksScore(clicks, impressions),
                I: this.calculateImpressionsScore(impressions),
                P: this.calculatePositionScore(position),
                E: this.calculateCTRUpliftScore(ctrValue, position),
                M: this.calculateMomentumScore(page),
                K: this.calculateConsistencyScore(page)
            };

            // Calculate TPS score
            const TPS = Object.keys(weights).reduce((score, key) => {
                return score + (weights[key] * (components[key] || 0));
            }, 0);

            // Calculate Opportunity score
            const Opportunity = this.calculateOpportunityScore(impressions, position, components.E);

            return {
                TPS: Math.round(TPS * 1000) / 1000, // Round to 3 decimal places
                Opportunity: Math.round(Opportunity * 1000) / 1000,
                components
            };

        } catch (error) {
            this.logger.error('Error calculating page scores', { page, error });
            return {
                TPS: 0,
                Opportunity: 0,
                components: { C: 0, I: 0, P: 0, E: 0, M: 0, K: 0 }
            };
        }
    }

    /**
     * Calculate clicks score (normalized)
     */
    calculateClicksScore(clicks, impressions) {
        if (clicks === 0 || impressions === 0) return 0;
        
        // Use log scale to reduce outlier dominance
        const logClicks = Math.log1p(clicks);
        // Normalize against a reasonable range (0 to log of max expected clicks)
        const maxExpectedClicks = Math.log1p(impressions * 2); // Allow for 2x current impressions
        return this.normalizeValue(logClicks, 0, maxExpectedClicks);
    }

    /**
     * Calculate impressions score (normalized)
     */
    calculateImpressionsScore(impressions) {
        if (impressions === 0) return 0;
        
        // Use log scale for impressions
        const logImpressions = Math.log1p(impressions);
        // Normalize against a reasonable range (0 to log of 10x current impressions)
        const maxExpectedImpressions = Math.log1p(impressions * 10);
        return this.normalizeValue(logImpressions, 0, maxExpectedImpressions);
    }

    /**
     * Calculate position score (higher rank = higher score)
     */
    calculatePositionScore(position) {
        if (position <= 0) return 0;
        
        // Convert position to positive score: (11 - position) / 10
        // Position 1 = 1.0, Position 10 = 0.1, Position 11+ = 0
        const rawScore = Math.max(0, (11 - position) / 10);
        return this.normalizeValue(rawScore, 0, 1);
    }

    /**
     * Calculate CTR uplift score vs expected
     */
    calculateCTRUpliftScore(ctr, position) {
        if (ctr <= 0 || position <= 0) return 0;
        
        // Calculate expected CTR based on position
        const expectedCTR = this.calculateExpectedCTR(position);
        
        // Calculate uplift ratio
        const uplift = ctr / Math.max(expectedCTR, 0.0001);
        
        // Clip to reasonable range [0.5, 2.0] and normalize to [0, 1]
        const clippedUplift = Math.max(0.5, Math.min(2.0, uplift));
        return (clippedUplift - 0.5) / 1.5;
    }

    /**
     * Calculate expected CTR based on position
     */
    calculateExpectedCTR(position) {
        const { a, b } = this.config.expectedCTR;
        const expected = a / Math.pow(position, b);
        return Math.max(0.01, Math.min(0.6, expected));
    }

    /**
     * Calculate momentum score (growth vs previous period)
     */
    calculateMomentumScore(page) {
        // For now, return a neutral score since we don't have historical data
        // This can be enhanced when historical data is available
        return 0.5;
    }

    /**
     * Calculate consistency score
     */
    calculateConsistencyScore(page) {
        // For now, return a neutral score since we don't have weeks_active data
        // This can be enhanced when consistency data is available
        return 0.5;
    }

    /**
     * Calculate opportunity score for optimization prioritization
     */
    calculateOpportunityScore(impressions, position, ctrUpliftScore) {
        // High impressions + weak position + low CTR efficiency = high opportunity
        const logImpressions = Math.log1p(impressions);
        const maxExpectedImpressions = Math.log1p(impressions * 10);
        const impressionScore = this.normalizeValue(logImpressions, 0, maxExpectedImpressions);
        const positionOpportunity = 1 - this.calculatePositionScore(position); // Inverse of position score
        const ctrOpportunity = Math.max(0, 0.6 - ctrUpliftScore); // Below 0.6 = opportunity
        
        return (0.4 * impressionScore) + (0.3 * positionOpportunity) + (0.3 * ctrOpportunity);
    }

    /**
     * Normalize a value to 0-1 range
     */
    normalizeValue(value, min, max) {
        if (max === min) return 0.5; // Avoid division by zero
        
        if (this.config.scaling === 'percentile') {
            // For percentile scaling, we'd need the full dataset
            // For now, use min-max scaling
            return Math.max(0, Math.min(1, (value - min) / (max - min)));
        } else {
            // Min-max scaling
            return Math.max(0, Math.min(1, (value - min) / (max - min)));
        }
    }

    /**
     * Get available presets (only balanced available)
     */
    getAvailablePresets() {
        return ['balanced'];
    }

    /**
     * Update configuration
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        this.logger.info('TPS engine configuration updated', newConfig);
    }

    /**
     * Get current configuration
     */
    getConfig() {
        return { ...this.config };
    }
}

// Export a default instance
export const defaultTPSEngine = new TPSScoringEngine();
