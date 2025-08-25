// Reusable All Pages Navbar component
// Emits: 'viewchange', 'sortchange', 'sortdirchange', 'search'
export class AllPagesNavbar {
    constructor(config = {}) {
        this.config = {
            mountId: config.mountId || '',
            showViewToggle: config.showViewToggle !== false,
            showSorting: config.showSorting !== false,
            showSearch: config.showSearch !== false,
            defaultView: config.defaultView || 'grid',
            sortField: config.sortField || 'Auto',
            sortDirection: config.sortDirection || 'desc',
            searchPlaceholder: config.searchPlaceholder || 'Search pages...',
            // For compatibility with existing IDs used by TopPagesTableComponent
            containerId: config.containerId || 'topPagesTableContainer',
            // New: type filter
            showTypeFilter: config.showTypeFilter !== false,
            defaultType: config.defaultType || 'All'
        };

        this.root = null;
        this._sentinel = null;
        this._placeholder = null;
        this._io = null;
        this._isSticky = false;
        this._resizeHandler = null;
        this._resizeObserver = null;
        this._alignTarget = null;
        this.render();
        this.bindEvents();
        this.setupStickyBehavior();
    }

    getElement() {
        return this.root;
    }

    /**
     * Sticky navbar behavior using IntersectionObserver.
     * Preserves layout with a placeholder when fixed, and aligns width/left to main content.
     */
    setupStickyBehavior() {
        const mount = document.getElementById(this.config.mountId);
        if (!mount || !this.root) return;

        // Create a sentinel to detect when the navbar reaches the top of viewport
        const sentinel = document.createElement('div');
        sentinel.setAttribute('aria-hidden', 'true');
        sentinel.style.position = 'relative';
        sentinel.style.width = '100%';
        sentinel.style.height = '1px';
        sentinel.style.margin = '0';
        sentinel.style.padding = '0';
        sentinel.style.opacity = '0';
        mount.insertBefore(sentinel, this.root);
        this._sentinel = sentinel;

        // Placeholder to prevent layout jump when navbar becomes fixed
        const placeholder = document.createElement('div');
        placeholder.className = 'all-pages-navbar-placeholder';
        placeholder.setAttribute('aria-hidden', 'true');
        placeholder.style.display = 'none';
        placeholder.style.width = '100%';
        placeholder.style.height = '0px';
        mount.insertBefore(placeholder, this.root);
        this._placeholder = placeholder;

        // Observe sentinel intersection with viewport top
        this._io = new IntersectionObserver((entries) => {
            if (!entries || !entries.length) return;
            const entry = entries[0];
            if (entry.isIntersecting) {
                this.disableSticky();
            } else {
                this.enableSticky();
            }
        }, { root: null, threshold: [0] });
        this._io.observe(this._sentinel);

        // Track alignment target for precise width/left updates
        // Prefer the nearest table container so sticky width matches the component, not the whole main content
        this._alignTarget = this.root.closest('.table-container')
            || this.root.closest('.main-content')
            || document.querySelector('.main-content')
            || this.root.parentElement
            || this.root;
        if (window.ResizeObserver) {
            this._resizeObserver = new ResizeObserver(() => {
                if (this._isSticky) {
                    this.updateStickyGeometry();
                    this.syncPlaceholderHeight();
                }
            });
            try { this._resizeObserver.observe(this._alignTarget); } catch (_) {}
        }

        // Keep geometry updated while sticky
        this._resizeHandler = () => {
            if (this._isSticky) {
                this.updateStickyGeometry();
                this.syncPlaceholderHeight();
            }
        };
        window.addEventListener('resize', this._resizeHandler, { passive: true });
    }

    // Update left/width so fixed navbar aligns with main content container
    updateStickyGeometry() {
        if (!this.root) return;
        const alignmentTarget = this._alignTarget || this.root.parentElement || this.root;
        const rect = alignmentTarget.getBoundingClientRect();
        this.root.style.left = `${rect.left}px`;
        this.root.style.width = `${rect.width}px`;
    }

    // Ensure placeholder matches navbar height to avoid layout shift
    syncPlaceholderHeight() {
        if (!this._placeholder || !this.root) return;
        const height = this.root.offsetHeight;
        this._placeholder.style.height = `${height}px`;
    }

    enableSticky() {
        if (!this.root || this._isSticky) return;
        this._isSticky = true;
        this._placeholder.style.display = 'block';
        this.syncPlaceholderHeight();
        this.root.classList.add('sticky');
        this.root.style.position = 'fixed';
        this.root.style.top = '0px';
        this.root.style.zIndex = '1000';
        this.updateStickyGeometry();
    }

    disableSticky() {
        if (!this.root || !this._isSticky) return;
        this._isSticky = false;
        this._placeholder.style.display = 'none';
        this._placeholder.style.height = '0px';
        this.root.classList.remove('sticky');
        this.root.style.position = '';
        this.root.style.top = '';
        this.root.style.left = '';
        this.root.style.width = '';
        this.root.style.zIndex = '';
    }

    on(type, handler) {
        if (!this.root) return;
        this.root.addEventListener(type, (e) => handler(e.detail));
    }

    dispatch(type, detail = {}) {
        if (!this.root) return;
        const evt = new CustomEvent(type, { detail, bubbles: true });
        this.root.dispatchEvent(evt);
    }

    render() {
        const mount = document.getElementById(this.config.mountId);
        if (!mount) return;

        // Build navbar container
        const navbar = document.createElement('div');
        navbar.className = 'all-pages-navbar';

        const parts = [];

        if (this.config.showViewToggle) {
            parts.push(`
                <div class="view-toggle control-chip">
                    <button class="view-btn ${this.config.defaultView === 'grid' ? 'active' : ''}" 
                            id="${this.config.containerId}_gridViewBtn" 
                            title="Grid View" aria-pressed="${this.config.defaultView === 'grid'}">
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"></path>
                        </svg>
                    </button>
                    <button class="view-btn ${this.config.defaultView === 'table' ? 'active' : ''}" 
                            id="${this.config.containerId}_tableViewBtn" 
                            title="Table View" aria-pressed="${this.config.defaultView === 'table'}">
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                        </svg>
                    </button>
                </div>
            `);
        }

        if (this.config.showSorting) {
            const currentSortLabel = (
                this.config.sortField === 'Auto' ? 'Top Pages' :
                this.config.sortField
            );
            // Sort field dropdown as its own chip
            parts.push(`
                <div class="sorting-controls control-chip">
                    <div class="country-dropdown" id="${this.config.containerId}_sortDropdown">
                        <button type="button" class="country-dropdown-toggle" id="${this.config.containerId}_sortToggle" aria-expanded="false" aria-haspopup="listbox" title="Sort by">
                            <span id="${this.config.containerId}_sortToggleText">${currentSortLabel}</span>
                            <svg class="country-dropdown-caret" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 011.08 1.04l-4.24 4.5a.75.75 0 01-1.08 0l-4.24-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd"/></svg>
                        </button>
                        <div class="country-dropdown-menu" id="${this.config.containerId}_sortMenu" role="listbox" aria-labelledby="${this.config.containerId}_sortToggle">
                            <div class="country-dropdown-item" role="option" data-value="Auto" aria-selected="${this.config.sortField === 'Auto'}">Top Pages</div>
                            <div class="country-dropdown-item" role="option" data-value="Clicks" aria-selected="${this.config.sortField === 'Clicks'}">Clicks</div>
                            <div class="country-dropdown-item" role="option" data-value="Impressions" aria-selected="${this.config.sortField === 'Impressions'}">Impressions</div>
                            <div class="country-dropdown-item" role="option" data-value="CTR" aria-selected="${this.config.sortField === 'CTR'}">CTR</div>
                            <div class="country-dropdown-item" role="option" data-value="Position" aria-selected="${this.config.sortField === 'Position'}">Position</div>
                        </div>
                    </div>
                </div>
            `);

            // Sort direction button as a separate chip (not visually grouped with dropdown)
            parts.push(`
                <div class="control-chip sort-direction-chip">
                    <button id="${this.config.containerId}_sortDirection" 
                            class="sort-direction-btn ${this.config.sortDirection}" 
                            title="${this.config.sortDirection === 'desc' ? 'Descending' : 'Ascending'}" 
                            aria-pressed="${this.config.sortDirection !== 'desc'}">
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            ${this.config.sortDirection === 'desc' 
                                ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14"/>' +
                                  '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 14l5 5 5-5"/>'
                                : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19V5"/>' +
                                  '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 10l5-5 5 5"/>'}
                        </svg>
                    </button>
                </div>
            `);
        }

        if (this.config.showSearch) {
            parts.push(`
                <div class="search-box">
                    <svg class="search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                    </svg>
                    <input type="text" class="search-input" 
                           placeholder="${this.config.searchPlaceholder}" 
                           id="${this.config.containerId}_search">
                </div>
            `);
        }

        // Optional Type Filter (hover-expand like country dropdown)
        if (this.config.showTypeFilter) {
            const currentTypeLabel = (
                this.config.defaultType === 'Blog' ? 'Blog Post' :
                this.config.defaultType === 'All' ? 'All Pages' :
                this.config.defaultType
            );
            parts.unshift(`
                <div class="filter-group">
                    <div class="country-dropdown" id="${this.config.containerId}_typeDropdown">
                        <button type="button" class="country-dropdown-toggle" id="${this.config.containerId}_typeToggle" aria-expanded="false" aria-haspopup="listbox" title="Filter by Type">
                            <span id="${this.config.containerId}_typeToggleText">${currentTypeLabel}</span>
                            <svg class="country-dropdown-caret" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 011.08 1.04l-4.24 4.5a.75.75 0 01-1.08 0l-4.24-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd"/></svg>
                        </button>
                        <div class="country-dropdown-menu" id="${this.config.containerId}_typeMenu" role="listbox" aria-labelledby="${this.config.containerId}_typeToggle">
                            <div class="country-dropdown-item" role="option" data-value="All" aria-selected="${this.config.defaultType === 'All'}">All Pages</div>
                            <div class="country-dropdown-item" role="option" data-value="Blog" aria-selected="${this.config.defaultType === 'Blog'}">Blog Post</div>
                            <div class="country-dropdown-item" role="option" data-value="Page" aria-selected="${this.config.defaultType === 'Page'}">Page</div>
                            <div class="country-dropdown-item" role="option" data-value="Clinics" aria-selected="${this.config.defaultType === 'Clinics'}">Clinics</div>
                            <div class="country-dropdown-item" role="option" data-value="Doctors" aria-selected="${this.config.defaultType === 'Doctors'}">Doctors</div>
                            <div class="country-dropdown-item" role="option" data-value="Locations" aria-selected="${this.config.defaultType === 'Locations'}">Locations</div>
                        </div>
                    </div>
                </div>
            `);
        }

        navbar.innerHTML = parts.join('\n');
        mount.innerHTML = '';
        mount.appendChild(navbar);
        this.root = navbar;
    }

    bindEvents() {
        if (!this.root) return;

        // View toggle
        const gridBtn = document.getElementById(`${this.config.containerId}_gridViewBtn`);
        const tableBtn = document.getElementById(`${this.config.containerId}_tableViewBtn`);
        if (gridBtn) {
            gridBtn.addEventListener('click', () => this.dispatch('viewchange', { view: 'grid' }));
        }
        if (tableBtn) {
            tableBtn.addEventListener('click', () => this.dispatch('viewchange', { view: 'table' }));
        }

        // Sort field (custom dropdown)
        const sortMenu = document.getElementById(`${this.config.containerId}_sortMenu`);
        const sortToggleText = document.getElementById(`${this.config.containerId}_sortToggleText`);
        if (sortMenu && sortToggleText) {
            sortMenu.querySelectorAll('.country-dropdown-item').forEach(item => {
                item.addEventListener('click', () => {
                    const value = item.getAttribute('data-value') || 'Auto';
                    const label = value === 'Auto' ? 'Top Pages' : value;
                    sortMenu.querySelectorAll('.country-dropdown-item').forEach(i => i.setAttribute('aria-selected', String(i === item)));
                    sortToggleText.textContent = label;
                    this.dispatch('sortchange', { field: value });
                    // Close dropdown after selection
                    const dropdownEl = document.getElementById(`${this.config.containerId}_sortDropdown`);
                    const toggleBtn = document.getElementById(`${this.config.containerId}_sortToggle`);
                    if (dropdownEl) dropdownEl.classList.remove('open');
                    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
                });
            });
        }

        // Sort direction
        const sortDirBtn = document.getElementById(`${this.config.containerId}_sortDirection`);
        if (sortDirBtn) {
            sortDirBtn.addEventListener('click', () => {
                const current = sortDirBtn.classList.contains('desc') ? 'desc' : 'asc';
                const next = current === 'desc' ? 'asc' : 'desc';
                this.dispatch('sortdirchange', { direction: next });
            });
        }

        // Search
        const searchInput = document.getElementById(`${this.config.containerId}_search`);
        if (searchInput) {
            let isComposing = false;
            searchInput.addEventListener('compositionstart', () => { isComposing = true; });
            searchInput.addEventListener('compositionend', (e) => {
                isComposing = false;
                this.dispatch('search', { term: e.target.value || '' });
            });
            searchInput.addEventListener('input', (e) => {
                if (isComposing) return;
                this.dispatch('search', { term: e.target.value || '' });
            });
        }

        // Type filter (custom dropdown)
        const typeMenu = document.getElementById(`${this.config.containerId}_typeMenu`);
        const typeToggleText = document.getElementById(`${this.config.containerId}_typeToggleText`);
        if (typeMenu && typeToggleText) {
            typeMenu.querySelectorAll('.country-dropdown-item').forEach(item => {
                item.addEventListener('click', () => {
                    const value = item.getAttribute('data-value') || 'All';
                    const label = value === 'Blog' ? 'Blog Post' : value;
                    typeMenu.querySelectorAll('.country-dropdown-item').forEach(i => i.setAttribute('aria-selected', String(i === item)));
                    typeToggleText.textContent = label;
                    this.dispatch('typefilter', { type: value });
                    // Close dropdown after selection
                    const dropdownEl = document.getElementById(`${this.config.containerId}_typeDropdown`);
                    const toggleBtn = document.getElementById(`${this.config.containerId}_typeToggle`);
                    if (dropdownEl) dropdownEl.classList.remove('open');
                    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
                });
            });
        }

        // Robust hover/click open-close behavior for Sort and Type dropdowns
        this.setupHoverDropdownBehavior(
            `${this.config.containerId}_sortDropdown`,
            `${this.config.containerId}_sortToggle`,
            `${this.config.containerId}_sortMenu`
        );
        if (this.config.showTypeFilter) {
            this.setupHoverDropdownBehavior(
                `${this.config.containerId}_typeDropdown`,
                `${this.config.containerId}_typeToggle`,
                `${this.config.containerId}_typeMenu`
            );
        }
    }

    // Ensure dropdown stays open when moving from toggle to menu; delayed close; outside/Escape closes
    setupHoverDropdownBehavior(dropdownId, toggleId, menuId) {
        const dropdownEl = document.getElementById(dropdownId);
        const toggleBtn = document.getElementById(toggleId);
        const menuEl = document.getElementById(menuId);
        if (!dropdownEl || !toggleBtn || !menuEl) return;

        let hoverCloseTimeout = null;
        const clearCloseTimeout = () => {
            if (hoverCloseTimeout) {
                clearTimeout(hoverCloseTimeout);
                hoverCloseTimeout = null;
            }
        };

        const openMenu = () => {
            clearCloseTimeout();
            dropdownEl.classList.add('open');
            toggleBtn.setAttribute('aria-expanded', 'true');
        };

        const closeMenu = (delayMs = 120) => {
            clearCloseTimeout();
            hoverCloseTimeout = setTimeout(() => {
                dropdownEl.classList.remove('open');
                toggleBtn.setAttribute('aria-expanded', 'false');
            }, delayMs);
        };

        // Hover interactions
        toggleBtn.addEventListener('mouseenter', openMenu);
        toggleBtn.addEventListener('mouseleave', () => closeMenu(140));
        menuEl.addEventListener('mouseenter', openMenu);
        menuEl.addEventListener('mouseleave', () => closeMenu(140));

        // Click toggle for touch/click devices
        toggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const willOpen = !dropdownEl.classList.contains('open');
            if (willOpen) {
                openMenu();
            } else {
                closeMenu(0);
            }
        });

        // Keyboard: Escape to close from toggle or menu
        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                closeMenu(0);
                toggleBtn.focus();
            }
        };
        toggleBtn.addEventListener('keydown', onKeyDown);
        menuEl.addEventListener('keydown', onKeyDown);

        // Close when clicking outside
        const outsideClickHandler = (e) => {
            if (!dropdownEl.contains(e.target)) {
                closeMenu(0);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }

    // External setters to keep UI in sync
    setView(view) {
        const gridBtn = document.getElementById(`${this.config.containerId}_gridViewBtn`);
        const tableBtn = document.getElementById(`${this.config.containerId}_tableViewBtn`);
        if (!gridBtn || !tableBtn) return;
        if (view === 'grid') {
            gridBtn.classList.add('active');
            gridBtn.setAttribute('aria-pressed', 'true');
            tableBtn.classList.remove('active');
            tableBtn.setAttribute('aria-pressed', 'false');
        } else {
            tableBtn.classList.add('active');
            tableBtn.setAttribute('aria-pressed', 'true');
            gridBtn.classList.remove('active');
            gridBtn.setAttribute('aria-pressed', 'false');
        }
    }

    setSortField(field) {
        const text = document.getElementById(`${this.config.containerId}_sortToggleText`);
        if (text) text.textContent = field === 'Auto' ? 'Top Pages' : field;
        const menu = document.getElementById(`${this.config.containerId}_sortMenu`);
        if (menu) {
            menu.querySelectorAll('.country-dropdown-item').forEach(i => {
                const val = i.getAttribute('data-value');
                i.setAttribute('aria-selected', String(val === field));
            });
        }
    }

    setSortDirection(direction) {
        const btn = document.getElementById(`${this.config.containerId}_sortDirection`);
        if (!btn) return;
        btn.className = `sort-direction-btn ${direction}`;
        btn.title = direction === 'desc' ? 'Descending' : 'Ascending';
        btn.setAttribute('aria-pressed', direction !== 'desc' ? 'true' : 'false');
        const svg = btn.querySelector('svg');
        if (svg) {
            svg.innerHTML = direction === 'desc'
                ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14"/>' +
                  '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 14l5 5 5-5"/>'
                : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19V5"/>' +
                  '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 10l5-5 5 5"/>';
        }
    }

    setSearchTerm(term) {
        const input = document.getElementById(`${this.config.containerId}_search`);
        if (input) input.value = term || '';
    }

    setTypeFilter(type) {
        const text = document.getElementById(`${this.config.containerId}_typeToggleText`);
        if (text) {
            if (type === 'Blog') {
                text.textContent = 'Blog Post';
            } else if (type === 'All') {
                text.textContent = 'All Pages';
            } else {
                text.textContent = type || 'All Pages';
            }
        }
        const menu = document.getElementById(`${this.config.containerId}_typeMenu`);
        if (menu) {
            menu.querySelectorAll('.country-dropdown-item').forEach(i => {
                const val = i.getAttribute('data-value');
                i.setAttribute('aria-selected', String(val === (type || 'All')));
            });
        }
    }

    destroy() {
        if (this._io) {
            try { this._io.disconnect(); } catch (_) {}
            this._io = null;
        }
        if (this._resizeHandler) {
            try { window.removeEventListener('resize', this._resizeHandler, { passive: true }); } catch (_) {}
            this._resizeHandler = null;
        }
        if (this._resizeObserver) {
            try { this._resizeObserver.disconnect(); } catch (_) {}
            this._resizeObserver = null;
        }
        if (this._placeholder && this._placeholder.parentNode) {
            try { this._placeholder.parentNode.removeChild(this._placeholder); } catch (_) {}
        }
        if (this._sentinel && this._sentinel.parentNode) {
            try { this._sentinel.parentNode.removeChild(this._sentinel); } catch (_) {}
        }
        this._placeholder = null;
        this._sentinel = null;
        if (this.root && this.root.parentNode) {
            try { this.root.parentNode.removeChild(this.root); } catch (_) {}
        }
        this.root = null;
    }
}


