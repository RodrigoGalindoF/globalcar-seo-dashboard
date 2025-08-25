import { logger } from './logger.js';

// ===== Navbar Manager =====
class NavbarManager {
    constructor() {
        this.currentSection = 'overview';
        this.isSidebarOpen = false;
        this.isInitialized = false;
    }

    initialize() {
        if (this.isInitialized) return;
        
        this.setupEventListeners();
        this.makeFunctionsGlobal();
        
        this.isInitialized = true;
        logger.info('Navbar manager initialized');
    }

    setupEventListeners() {
        // Set up navigation item click handlers
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const sectionId = this.getSectionIdFromNavItem(item);
                if (sectionId) {
                    this.showSection(sectionId);
                }
            });
        });

        // Set up sidebar toggle handler
        const sidebarToggle = document.querySelector('.sidebar-toggle');
        if (sidebarToggle) {
            sidebarToggle.addEventListener('click', (e) => {
                e.preventDefault();
                this.toggleSidebar();
            });
        }

        logger.info('Navbar event listeners set up');
    }

    getSectionIdFromNavItem(navItem) {
        // Extract section ID from navigation item
        const href = navItem.getAttribute('href');
        if (href && href.startsWith('#')) {
            return href.substring(1);
        }
        
        // Fallback: try to get from data attribute
        return navItem.dataset.section || null;
    }

    showSection(sectionId) {
        if (!sectionId) {
            logger.warn('No section ID provided to showSection');
            return;
        }

        // Hide all sections
        const sections = document.querySelectorAll('.dashboard-section');
        sections.forEach(section => {
            section.style.display = 'none';
        });

        // Show the requested section
        const targetSection = document.getElementById(sectionId);
        if (targetSection) {
            targetSection.style.display = 'block';
            this.currentSection = sectionId;
            
            // Update navigation state
            this.updateNavigationState(sectionId);
            
            logger.info(`Section displayed: ${sectionId}`);
        } else {
            logger.warn(`Section not found: ${sectionId}`);
        }
    }

    updateNavigationState(activeSectionId) {
        // Remove active class from all nav items
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            item.classList.remove('active');
        });

        // Add active class to current nav item
        const activeNavItem = document.querySelector(`[href="#${activeSectionId}"], [data-section="${activeSectionId}"]`);
        if (activeNavItem) {
            activeNavItem.classList.add('active');
        }
    }

    toggleSidebar() {
        const sidebar = document.querySelector('.sidebar');
        const mainContent = document.querySelector('.main-content');
        
        if (sidebar && mainContent) {
            this.isSidebarOpen = !this.isSidebarOpen;
            
            if (this.isSidebarOpen) {
                sidebar.classList.add('open');
                mainContent.classList.add('sidebar-open');
            } else {
                sidebar.classList.remove('open');
                mainContent.classList.remove('sidebar-open');
            }
            
            logger.info(`Sidebar ${this.isSidebarOpen ? 'opened' : 'closed'}`);
        }
    }

    getCurrentSection() {
        return this.currentSection;
    }

    makeFunctionsGlobal() {
        // Make navigation functions available globally
        window.showSection = (sectionId) => this.showSection(sectionId);
        window.toggleSidebar = () => this.toggleSidebar();
        
        logger.info('Navigation functions exposed globally');
    }
}

// ===== Global Instance =====
const navbarManager = new NavbarManager();

// ===== Export Functions =====
export const showSection = (sectionId) => navbarManager.showSection(sectionId);
export const toggleSidebar = () => navbarManager.toggleSidebar();

// ===== Auto-initialization =====
if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            navbarManager.initialize();
        });
    } else {
        navbarManager.initialize();
    }
} 