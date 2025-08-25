// Lightweight OG metadata and image manager
// - Prioritizes text over images
// - Dedupes requests per URL
// - Lazy-loads images with IntersectionObserver
// - Smooth fade-in without flicker; keeps existing background until ready
// - Uses in-memory cache + localStorage TTL cache

const LOCAL_STORAGE_KEY = 'og_metadata_cache_v1';
const LOCAL_STORAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function nowTs() {
    return Date.now();
}

function normalizeUrl(url) {
    try {
        const u = new URL(url, url.startsWith('http') ? undefined : 'https://');
        // Normalize: protocol + host + pathname (no trailing slash unless root)
        let pathname = u.pathname || '/';
        if (pathname.length > 1) {
            pathname = pathname.replace(/\/+$/, '');
        }
        return `${u.protocol}//${u.host}${pathname}`;
    } catch (e) {
        return url;
    }
}

class OgMetadataManager {
    constructor() {
        this.metadataCache = new Map(); // url -> { title, image }
        this.titleNodesIndex = new Map(); // url -> Set<HTMLElement>
        this.imageNodesIndex = new Map(); // url -> Set<HTMLElement>
        this.inFlightImageLoads = new Map(); // url -> Promise<HTMLImageElement>
        this.priorityUrls = new Set();
        this.intersectionObserver = null;
        this._isInitialized = false;
    }

    _decodeHtmlEntities(str) {
        try {
            if (!str || typeof str !== 'string') return str || '';
            const parser = new DOMParser();
            const doc = parser.parseFromString(str, 'text/html');
            return (doc.documentElement.textContent || '').trim();
        } catch (_) {
            return (str || '').toString();
        }
    }

    _sanitizeTitle(raw) {
        try {
            const decoded = this._decodeHtmlEntities(typeof raw === 'string' ? raw : (raw ?? ''));
            return decoded.replace(/\s+/g, ' ').trim();
        } catch (_) {
            return (raw ?? '').toString();
        }
    }

    async init() {
        if (this._isInitialized) return;
        this._isInitialized = true;

        // Restore cached metadata from localStorage
        this._restoreLocalCache();

        // Best-effort fetch of prebuilt metadata file (non-blocking)
        this._fetchPrebuiltMetadata();

        // Prepare IntersectionObserver for lazy image loading
        this._ensureIntersectionObserver();

        // Inject minimal CSS override for og-image visibility/fade-in
        this._injectCssOnce();
    }

    _restoreLocalCache() {
        try {
            const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (!parsed || !parsed.data || !parsed.savedAt) return;
            if (nowTs() - parsed.savedAt > LOCAL_STORAGE_TTL_MS) return; // expired
            Object.entries(parsed.data).forEach(([url, meta]) => {
                if (meta && (meta.title || meta.image)) {
                    this.metadataCache.set(normalizeUrl(url), meta);
                }
            });
        } catch (_) {
            // ignore
        }
    }

    _persistLocalCache() {
        try {
            const data = {};
            this.metadataCache.forEach((meta, url) => {
                data[url] = meta;
            });
            const payload = { data, savedAt: nowTs() };
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(payload));
        } catch (_) {
            // ignore storage quota errors
        }
    }

    async _fetchPrebuiltMetadata() {
        try {
            const res = await fetch(`og_metadata.json?ts=${Date.now()}`, { cache: 'no-store' });
            if (!res.ok) return;
            const json = await res.json();
            // Accept either { url: {title,image} } or { items: [{url,title,image}] }
            if (Array.isArray(json)) {
                json.forEach(item => this._ingestItem(item));
            } else if (json && json.items && Array.isArray(json.items)) {
                json.items.forEach(item => this._ingestItem(item));
            } else if (json && typeof json === 'object') {
                Object.entries(json).forEach(([url, meta]) => {
                    this._ingestItem({ url, ...meta });
                });
            }
            this._persistLocalCache();
            // Immediately refresh any bound nodes
            this._refreshAllBoundNodes();
            // Dispatch a global event for interested listeners
            try {
                window.dispatchEvent(new CustomEvent('ogMetadataUpdated'));
            } catch (_) {}
        } catch (_) {
            // Silent fail if file not present
        }
    }

    _ingestItem(item) {
        if (!item) return;
        const url = normalizeUrl(item.url || item.loc || item.page);
        if (!url) return;
        const title = this._sanitizeTitle(item.title || item.ogTitle || item.pageTitle || '');
        const image = item.image || item.ogImage || '';
        const existing = this.metadataCache.get(url) || {};
        const merged = {
            title: this._sanitizeTitle(existing.title) || title || undefined,
            image: existing.image || image || undefined
        };
        this.metadataCache.set(url, merged);
    }

    _refreshAllBoundNodes() {
        // Update titles
        this.titleNodesIndex.forEach((nodes, url) => {
            const meta = this.metadataCache.get(url);
            if (!meta || !meta.title) return;
            const safeTitle = this._sanitizeTitle(meta.title);
            nodes.forEach(node => {
                try {
                    if (node && node.textContent !== safeTitle) {
                        node.textContent = safeTitle;
                    }
                } catch (_) {}
            });
        });

        // Update images
        this.imageNodesIndex.forEach((holders, url) => {
            const meta = this.metadataCache.get(url);
            if (!meta || !meta.image) return;
            holders.forEach(holder => {
                try {
                    let img = holder.querySelector('img.og-image');
                    if (!img) {
                        img = document.createElement('img');
                        img.className = 'og-image';
                        img.setAttribute('alt', '');
                        img.decoding = 'async';
                        img.loading = 'lazy';
                        holder.appendChild(img);
                    }
                    img.dataset.src = meta.image;
                    this._observe(img, url);
                } catch (_) {}
            });
        });
    }

    getCachedTitle(url) {
        const meta = this.metadataCache.get(normalizeUrl(url));
        const t = meta?.title;
        return t ? this._sanitizeTitle(t) : null;
    }

    getCachedImage(url) {
        const meta = this.metadataCache.get(normalizeUrl(url));
        return meta?.image || null;
    }

    setPriorityUrls(urls) {
        if (!Array.isArray(urls)) return;
        urls.forEach(u => this.priorityUrls.add(normalizeUrl(u)));
        // Kick off preloading for priority urls (non-blocking)
        this.preloadForUrls(urls);
    }

    async preloadForUrls(urls) {
        if (!Array.isArray(urls)) return;
        const unique = Array.from(new Set(urls.map(normalizeUrl)));
        unique.forEach(url => {
            const imgUrl = this.getCachedImage(url);
            if (imgUrl) {
                this._loadImage(url, imgUrl).catch(() => {});
            }
        });
    }

    applyToContainer(container) {
        if (!container) return;
        // Titles
        const titleNodes = container.querySelectorAll('.page-title[data-url]');
        titleNodes.forEach(node => {
            const url = normalizeUrl(node.dataset.url || '');
            if (!url) return;
            if (!this.titleNodesIndex.has(url)) this.titleNodesIndex.set(url, new Set());
            this.titleNodesIndex.get(url).add(node);
            const cachedTitle = this.getCachedTitle(url);
            if (cachedTitle && cachedTitle.trim().length > 0) {
                // Only update if different to avoid churn
                if (node.textContent !== cachedTitle) {
                    node.textContent = cachedTitle;
                }
            }
        });

        // Images
        const imageHolders = container.querySelectorAll('.page-image[data-url]');
        imageHolders.forEach(holder => {
            const url = normalizeUrl(holder.dataset.url || holder.getAttribute('data-url') || '');
            if (!url) return;
            if (!this.imageNodesIndex.has(url)) this.imageNodesIndex.set(url, new Set());
            this.imageNodesIndex.get(url).add(holder);

            const imageUrl = this.getCachedImage(url);
            if (!imageUrl) return; // Nothing to do yet

            // Prepare an <img> for fade-in if not present
            let img = holder.querySelector('img.og-image');
            if (!img) {
                img = document.createElement('img');
                img.className = 'og-image';
                img.setAttribute('alt', '');
                img.decoding = 'async';
                img.loading = 'lazy'; // hint; we still use IO
                holder.appendChild(img);
            }

            // Defer setting src until intersecting
            img.dataset.src = imageUrl;
            this._observe(img, url);
        });
    }

    _ensureIntersectionObserver() {
        if (this.intersectionObserver) return;
        this.intersectionObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    const url = img?.parentElement?.dataset?.url || img?.dataset?.url || '';
                    const pageUrl = normalizeUrl(url);
                    const src = img.dataset.src;
                    this.intersectionObserver.unobserve(img);
                    if (src) {
                        this._loadImage(pageUrl, src).then(loaded => {
                            // Attach and fade in
                            requestAnimationFrame(() => {
                                img.src = loaded.src;
                                // Force reflow to ensure transition applies
                                void img.offsetWidth;
                                img.classList.add('is-visible');
                            });
                        }).catch(() => {
                            // ignore image errors silently
                        });
                    }
                }
            });
        }, { root: null, rootMargin: '300px 0px', threshold: 0.1 });
    }

    _observe(img, pageUrl) {
        if (!img) return;
        // Ensure parent holder has data-url (needed to recover url in IO callback)
        if (!img.parentElement?.dataset?.url && pageUrl) {
            img.parentElement.dataset.url = pageUrl;
        }
        this._ensureIntersectionObserver();
        try {
            this.intersectionObserver.observe(img);
        } catch (_) {
            // In rare cases IO may fail; fallback to immediate load
            const src = img.dataset.src;
            if (src) {
                this._loadImage(pageUrl, src).then(loaded => {
                    img.src = loaded.src;
                    img.classList.add('is-visible');
                }).catch(() => {});
            }
        }
    }

    async _loadImage(pageUrl, imageUrl) {
        const key = normalizeUrl(pageUrl);
        if (this.inFlightImageLoads.has(key)) {
            return this.inFlightImageLoads.get(key);
        }
        const promise = new Promise((resolve, reject) => {
            try {
                const img = new Image();
                img.decoding = 'async';
                img.onload = async () => {
                    try {
                        if (img.decode) {
                            await img.decode();
                        }
                    } catch (_) {}
                    resolve(img);
                };
                img.onerror = () => reject(new Error('image load failed'));
                img.src = imageUrl;
            } catch (e) {
                reject(e);
            }
        }).finally(() => {
            this.inFlightImageLoads.delete(key);
        });

        this.inFlightImageLoads.set(key, promise);
        return promise;
    }

    _injectCssOnce() {
        if (document.getElementById('og-image-css')) return;
        const style = document.createElement('style');
        style.id = 'og-image-css';
        style.textContent = `
            .page-image img.og-image {
                display: block !important;
                position: absolute;
                top: 0; left: 0; right: 0; bottom: 0;
                width: 100%;
                height: 100%;
                object-fit: cover;
                opacity: 0;
                transition: opacity 0.25s ease-in-out;
            }
            .page-image img.og-image.is-visible {
                opacity: 1;
            }
        `;
        document.head.appendChild(style);
    }
}

export const ogMetadataManager = new OgMetadataManager();

// Expose globally for debug/optional use
if (typeof window !== 'undefined') {
    window.ogMetadataManager = ogMetadataManager;
}


