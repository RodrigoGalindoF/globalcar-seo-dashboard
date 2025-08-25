import { logger } from './logger.js';
import { formatNumber, formatPercentage } from './utils.js';

// ===== KPI Component Configuration =====
const KPI_CONFIG = {
    totalClicks: {
        label: 'Total Clicks',
        icon: `<svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"></path>
        </svg>`,
        iconColor: 'rgba(79, 70, 229, 0.1)',
        textColor: 'var(--primary-color)',
        formatter: formatNumber
    },
    totalImpressions: {
        label: 'Total Impressions',
        icon: `<svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
        </svg>`,
        iconColor: 'rgba(124, 58, 237, 0.1)',
        textColor: 'var(--secondary-color)',
        formatter: formatNumber
    },
    avgCTR: {
        label: 'Average CTR',
        icon: `<svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path>
        </svg>`,
        iconColor: 'rgba(16, 185, 129, 0.1)',
        textColor: 'var(--success-color)',
        formatter: formatPercentage
    },
    avgPosition: {
        label: 'Average Position',
        icon: `<svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
        </svg>`,
        iconColor: 'rgba(245, 158, 11, 0.1)',
        textColor: 'var(--warning-color)',
        formatter: (value) => value.toFixed(1)
    }
};

// ===== KPI Component Class =====
class KPIComponent {
    constructor(containerId, config = {}) {
        this.containerId = containerId;
        this.container = document.getElementById(containerId);
        this.config = { ...KPI_CONFIG, ...config };
        this.instances = new Map();
        
        if (!this.container) {
            logger.error(`KPI container not found: ${containerId}`);
            return;
        }
    }
    
    // Create a single KPI card
    _createKPICard(metricKey) {
        const config = this.config[metricKey];
        if (!config) {
            logger.error(`KPI configuration not found for: ${metricKey}`);
            return null;
        }
        
        const cardId = `kpi_${metricKey}`;
        const card = document.createElement('div');
        card.className = 'metric-card';
        card.id = cardId;
        
        card.innerHTML = `
            <div class="metric-header">
                <span class="metric-label">${config.label}</span>
                <div class="metric-icon" style="background-color: ${config.iconColor}; color: ${config.textColor};">
                    ${config.icon}
                </div>
            </div>
            <div class="metric-value" id="${cardId}_value">-</div>
        `;
        
        this.instances.set(cardId, {
            metricKey,
            config,
            card,
            valueElement: card.querySelector(`#${cardId}_value`)
        });
        
        return card;
    }
    
    // Check if KPI component is properly initialized
    isInitialized() {
        return this.container && this.instances.size > 0;
    }
    
    // Check if KPI section already exists
    hasKPISection() {
        return this.container.children.length > 0;
    }
    
    // Create multiple KPI cards based on configuration
    createKPISection(metricKeys = Object.keys(this.config)) {
        // Only create HTML structure if it doesn't exist yet
        if (!this.hasKPISection()) {
            metricKeys.forEach(metricKey => {
                if (this.config[metricKey]) {
                    const card = this._createKPICard(metricKey);
                    if (card) {
                        this.container.appendChild(card);
                    }
                }
            });
        }
    }
    
    // Safely update KPI values without losing HTML structure
    safeUpdateKPIs(data) {
        // If component is not initialized, initialize it first
        if (!this.isInitialized()) {
            logger.info('KPI component not initialized, creating KPI section...');
            this.createKPISection();
        }
        
        // Then update the values
        this.updateKPIs(data);
    }
    
    // Update KPI values
    updateKPIs(data) {
        logger.info('KPI updateKPIs called with data:', {
            hasData: !!data,
            dataKeys: data ? Object.keys(data) : [],
            datesLength: data?.dates?.length || 0,
            pagesLength: data?.pages?.length || 0,
            instancesCount: this.instances.size,
            hasKPISection: this.hasKPISection()
        });
        
        // Ensure KPI section exists before updating
        if (!this.hasKPISection()) {
            logger.warn('KPI section not found, recreating...');
            this.createKPISection();
        }
        
        this.instances.forEach((instance, cardId) => {
            const { metricKey, config, valueElement } = instance;
            
            if (valueElement) {
                // Add subtle loading animation
                valueElement.style.opacity = '0.5';
                valueElement.style.transition = 'opacity 0.2s ease';
                
                // Calculate metric value based on data
                const value = this.calculateMetricValue(metricKey, data);
                
                logger.debug(`KPI ${metricKey}: calculated value = ${value}`);
                
                // Update the display with a small delay for better UX
                setTimeout(() => {
                    valueElement.textContent = config.formatter ? config.formatter(value) : value;
                    valueElement.style.opacity = '1';
                }, 50);
            } else {
                logger.warn(`Value element not found for KPI card: ${cardId}`);
            }
        });
        
        logger.info('KPI values updated', { 
            instanceCount: this.instances.size,
            dataKeys: Object.keys(data),
            hasKPISection: this.hasKPISection()
        });
    }
    
    // Calculate metric value from data
    calculateMetricValue(metricKey, data) {
        logger.debug(`Calculating metric ${metricKey} with data:`, {
            hasDates: !!data?.dates,
            datesLength: data?.dates?.length || 0,
            hasPages: !!data?.pages,
            pagesLength: data?.pages?.length || 0,
            sampleDate: data?.dates?.[0],
            samplePage: data?.pages?.[0]
        });
        
        // Handle overview metrics
        let totalClicks = 0;
        let totalImpressions = 0;
        let totalCTR = 0;
        let avgPosition = 0;
        
        // Use the same calculation logic as the original updateOverviewMetrics
        if (data.dates && data.dates.length > 0) {
            const clicksSum = data.dates.reduce((s, r) => s + (r.Clicks || r.clicks || 0), 0);
            const impressionsSum = data.dates.reduce((s, r) => s + (r.Impressions || r.impressions || 0), 0);
            
            const weightedPosSum = data.dates.reduce((s, r) => {
                const pos = r.Position || r.position || r['Average position'] || 0;
                const imps = r.Impressions || r.impressions || 0;
                return s + pos * imps;
            }, 0);
            
            totalClicks = clicksSum;
            totalImpressions = impressionsSum;
            totalCTR = impressionsSum > 0 ? (clicksSum / impressionsSum * 100) : 0;
            avgPosition = impressionsSum > 0 ? (weightedPosSum / impressionsSum) : 0;
            
            logger.debug(`Calculated from dates: clicks=${totalClicks}, impressions=${totalImpressions}, ctr=${totalCTR}, position=${avgPosition}`);
            
        } else if (data.pages && data.pages.length > 0) {
            let positionSum = 0;
            let pageCount = 0;
            
            data.pages.forEach(page => {
                const clicks = page.Clicks || page.clicks || page['Clicks'] || 0;
                const impressions = page.Impressions || page.impressions || page['Impressions'] || 0;
                const position = page.Position || page.position || page['Position'] || page['Average position'] || 0;
                
                totalClicks += clicks;
                totalImpressions += impressions;
                if (position && position > 0) {
                    positionSum += position;
                    pageCount++;
                }
            });
            
            totalCTR = totalImpressions > 0 ? (totalClicks / totalImpressions * 100) : 0;
            avgPosition = pageCount > 0 ? (positionSum / pageCount) : 0;
            
            logger.debug(`Calculated from pages: clicks=${totalClicks}, impressions=${totalImpressions}, ctr=${totalCTR}, position=${avgPosition}`);
        } else {
            logger.warn(`No dates or pages data available for KPI calculation`);
        }
        
        // Return the appropriate metric value
        switch (metricKey) {
            case 'totalClicks':
                return totalClicks;
            case 'totalImpressions':
                return totalImpressions;
            case 'avgCTR':
                return totalCTR;
            case 'avgPosition':
                return avgPosition;
            default:
                return 0;
        }
    }
    
    // Get all instances
    getInstances() {
        return this.instances;
    }
}

// ===== Export Functions =====
export function createKPIComponent(containerId, config = {}) {
    return new KPIComponent(containerId, config);
}

export function updateKPISection(kpiComponent, data) {
    if (kpiComponent && typeof kpiComponent.updateKPIs === 'function') {
        kpiComponent.updateKPIs(data);
    } else {
        logger.error('Invalid KPI component provided for update');
    }
}

export { KPI_CONFIG }; 