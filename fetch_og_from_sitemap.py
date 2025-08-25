#!/usr/bin/env python3
"""
Fetch OG metadata (og:title, og:image) for URLs present in your dashboard data and
write to og_metadata.json in the project root.

What it does:
- Scans weekly URL CSVs under Data/weekly_data_output/aggregated/ (default)
  OR reads URLs from dashboard_data.json
- Includes a URL if ANY of its rows has a positive metric (> 0) in clicks,
  impressions, ctr, or position
- Fetches OG metadata concurrently with timeouts and fallbacks
- Writes a UI-compatible JSON: { "items": [ { url, title, image }, ... ] }

Design constraints:
- No external dependencies; use Python stdlib only
- Concurrency via ThreadPoolExecutor
- Timeouts and basic error handling
- Fallbacks: twitter:image, <title>

Usage examples:
  # Default: scan weekly URL directory, write og_metadata.json
  python3 fetch_og_from_sitemap.py

  # Read from dashboard_data.json instead
  python3 fetch_og_from_sitemap.py --source dashboard

  # Customize workers/output/limit and overwrite existing entries
  python3 fetch_og_from_sitemap.py --max-workers 24 --limit 500 --output og_metadata.json --overwrite
"""
from __future__ import annotations

import argparse
import concurrent.futures
import csv
import gzip
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Iterable, List, Dict, Optional, Tuple, Set
import html as html_lib


# Defaults and paths
DEFAULT_OUTPUT = "og_metadata.json"
DEFAULT_MAX_WORKERS = 16
DEFAULT_WEEKLY_DIR = os.path.join("Data", "weekly_data_output", "aggregated")
DEFAULT_DASHBOARD_JSON = "dashboard_data.json"

DEFAULT_UA = (
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
    'AppleWebKit/605.1.15 (KHTML, like Gecko) '
    'Version/17.4 Safari/605.1.15'
)


def http_get(url: str, timeout: float = 15.0, accept_gzip: bool = True) -> bytes:
    headers = {
        'User-Agent': DEFAULT_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    }
    if accept_gzip:
        headers['Accept-Encoding'] = 'gzip, deflate'
    req = urllib.request.Request(url, headers=headers, method='GET')
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = resp.read()
        encoding = resp.headers.get('Content-Encoding', '').lower()
        if 'gzip' in encoding:
            try:
                data = gzip.decompress(data)
            except Exception:
                pass
        return data


def _safe_float(value: object) -> float:
    if value is None:
        return 0.0
    try:
        if isinstance(value, (int, float)):
            return float(value)
        s = str(value).strip()
        if s.endswith('%'):
            return float(s[:-1] or '0')
        return float(s)
    except Exception:
        return 0.0


def _row_has_positive_metric(row: Dict[str, object]) -> bool:
    # clicks, impressions, ctr, position considered positive if >0
    clicks = _safe_float(row.get('clicks'))
    imps = _safe_float(row.get('impressions'))
    ctr_val = _safe_float(row.get('ctr'))
    pos = _safe_float(row.get('position'))
    return (clicks > 0) or (imps > 0) or (ctr_val > 0) or (pos > 0)


def _sanitized_filename_to_url(filename: str) -> str:
    """Reconstruct URL from weekly file name in aggregated folder.

    Example: Data/weekly_data_output/aggregated/https_www_getglobalcare_com_about-globalcare_weekly_all_data.csv
    -> https://www.getglobalcare.com/about-globalcare
    """
    base = os.path.basename(filename)
    if base.endswith("_weekly_all_data.csv"):
        base = base[:-len("_weekly_all_data.csv")]
    base = base.replace('.csv', '')

    prefix = "https_www_getglobalcare_com"
    if base.startswith(prefix):
        remainder = base[len(prefix):]
    else:
        remainder = base

    while remainder.startswith('_'):
        remainder = remainder[1:]
    path = remainder.replace('_', '/')

    base_url = "https://www.getglobalcare.com"
    if path:
        if not path.startswith('/'):
            path = '/' + path
    else:
        path = '/'
    url = f"{base_url}{path}"
    return url


def gather_urls_from_weekly_dir(weekly_dir: str) -> List[str]:
    urls: List[str] = []
    seen: Set[str] = set()
    try:
        entries = [os.path.join(weekly_dir, f) for f in os.listdir(weekly_dir) if f.endswith('.csv')]
    except FileNotFoundError:
        return []
    except Exception as e:
        print(f"[warn] failed to list weekly dir {weekly_dir}: {e}", file=sys.stderr)
        return []

    for file_path in entries:
        try:
            include_url = False
            with open(file_path, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    if _row_has_positive_metric(row):
                        include_url = True
                        break
            if include_url:
                url = normalize_url(_sanitized_filename_to_url(file_path))
                if url and url not in seen:
                    seen.add(url)
                    urls.append(url)
        except Exception as e:
            print(f"[warn] failed reading {file_path}: {e}", file=sys.stderr)
            continue
    return urls


def gather_urls_from_dashboard_json(dashboard_json_path: str) -> List[str]:
    try:
        with open(dashboard_json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except FileNotFoundError:
        return []
    except Exception as e:
        print(f"[warn] failed to read {dashboard_json_path}: {e}", file=sys.stderr)
        return []

    url_data = data.get('url_data') or {}
    urls: List[str] = []
    seen: Set[str] = set()
    for url, records in url_data.items():
        try:
            include_url = False
            if isinstance(records, list):
                for row in records:
                    if _row_has_positive_metric(row):
                        include_url = True
                        break
            if include_url:
                nu = normalize_url(url)
                if nu and nu not in seen:
                    seen.add(nu)
                    urls.append(nu)
        except Exception:
            continue
    return urls


RE_TITLE = re.compile(r'<title[^>]*>(.*?)</title>', re.IGNORECASE | re.DOTALL)
# Generic META tag and attribute parsers for robust OG extraction
RE_META_TAG = re.compile(r'<meta\s+[^>]*?>', re.IGNORECASE | re.DOTALL)
RE_ATTR = re.compile(r'([a-zA-Z_:\\-]+)\s*=\s*([\'\"])\s*([^\2]*?)\s*\2', re.IGNORECASE | re.DOTALL)


def _parse_meta_attrs(tag_html: str) -> Dict[str, str]:
    attrs: Dict[str, str] = {}
    for m in RE_ATTR.finditer(tag_html):
        key = m.group(1).strip().lower()
        val = m.group(3).strip()
        attrs[key] = val
    return attrs


def extract_og_from_html(html: bytes, base_url: str) -> Tuple[Optional[str], Optional[str]]:
    try:
        text = html.decode('utf-8', errors='replace')
    except Exception:
        text = html.decode('latin-1', errors='replace')

    title: Optional[str] = None
    image: Optional[str] = None

    # Scan all <meta> tags and pick OG/Twitter candidates regardless of attribute order or quoting
    for tag in RE_META_TAG.findall(text):
        attrs = _parse_meta_attrs(tag)
        prop = attrs.get('property') or attrs.get('name') or ''
        prop = prop.lower()
        content = attrs.get('content') or attrs.get('value') or ''
        if not content:
            continue

        if not title and prop in ('og:title', 'twitter:title'):
            title = content.strip()

        if not image and prop in ('og:image', 'og:image:secure_url', 'twitter:image', 'twitter:image:src'):
            image = urllib.parse.urljoin(base_url, content.strip())

        # Early exit if we have both
        if title and image:
            break

    # Normalize/sanitize
    if title:
        try:
            title = html_lib.unescape(title).strip()
        except Exception:
            pass

    # Fallbacks
    if not title:
        m = RE_TITLE.search(text)
        if m:
            t = ' '.join(m.group(1).split())
            try:
                title = html_lib.unescape(t).strip()
            except Exception:
                title = t

    return title, image


def fetch_og_for_url(url: str, timeout: float = 15.0) -> Dict[str, Optional[str]]:
    out = { 'url': url, 'title': None, 'image': None }
    try:
        html = http_get(url, timeout=timeout)
        title, image = extract_og_from_html(html, url)
        out['title'] = title
        out['image'] = image
    except Exception as e:
        print(f"[warn] failed to fetch OG for {url}: {e}", file=sys.stderr)
    return out


def normalize_url(url: str) -> str:
    try:
        u = urllib.parse.urlparse(url)
        scheme = u.scheme or 'https'
        netloc = u.netloc
        path = u.path or '/'
        if path != '/' and path.endswith('/'):
            path = path[:-1]
        return urllib.parse.urlunparse((scheme, netloc, path, '', '', ''))
    except Exception:
        return url


def main():
    parser = argparse.ArgumentParser(description='Fetch OG metadata for URLs present in dashboard data')
    parser.add_argument('--source', choices=['auto','weekly','dashboard'], default='auto', help='Where to discover URLs from (default: auto)')
    parser.add_argument('--weekly-dir', default=DEFAULT_WEEKLY_DIR, help=f'Weekly URL CSV directory (default: {DEFAULT_WEEKLY_DIR})')
    parser.add_argument('--dashboard-json', default=DEFAULT_DASHBOARD_JSON, help=f'Dashboard JSON path (default: {DEFAULT_DASHBOARD_JSON})')
    parser.add_argument('--output', default=DEFAULT_OUTPUT, help=f'Output JSON path (default: {DEFAULT_OUTPUT})')
    parser.add_argument('--max-workers', type=int, default=DEFAULT_MAX_WORKERS, help=f'Max concurrent workers (default: {DEFAULT_MAX_WORKERS})')
    parser.add_argument('--limit', type=int, default=0, help='Limit number of URLs (0 = no limit)')
    parser.add_argument('--overwrite', action='store_true', help='Overwrite existing entries if output exists (default: resume)')
    args = parser.parse_args()

    start = time.time()

    # Discover URLs from selected source
    urls: List[str] = []
    src = args.source
    if src == 'auto':
        w_urls = gather_urls_from_weekly_dir(args.weekly_dir)
        if w_urls:
            urls = w_urls
        else:
            urls = gather_urls_from_dashboard_json(args.dashboard_json)
    elif src == 'weekly':
        urls = gather_urls_from_weekly_dir(args.weekly_dir)
    else:
        urls = gather_urls_from_dashboard_json(args.dashboard_json)

    if not urls:
        print('[error] No URLs discovered from data sources', file=sys.stderr)
        sys.exit(1)

    # Dedupe + normalize
    norm_urls: List[str] = []
    seen: Set[str] = set()
    for u in urls:
        nu = normalize_url(u)
        if nu and nu not in seen:
            seen.add(nu)
            norm_urls.append(nu)

    if args.limit and args.limit > 0:
        norm_urls = norm_urls[:args.limit]

    print(f"[info] Total unique URLs: {len(norm_urls)}")

    # Resume mode: if output exists and not overwriting, skip existing
    existing_map: Dict[str, Dict[str, Optional[str]]] = {}
    if not args.overwrite and os.path.exists(args.output):
        try:
            with open(args.output, 'r', encoding='utf-8') as f:
                existing = json.load(f)
            if isinstance(existing, dict) and 'items' in existing and isinstance(existing['items'], list):
                for item in existing['items']:
                    url = item.get('url')
                    if url:
                        existing_map[normalize_url(url)] = {
                            'title': item.get('title') or None,
                            'image': item.get('image') or None
                        }
            elif isinstance(existing, dict):
                for url, meta in existing.items():
                    existing_map[normalize_url(url)] = {
                        'title': (meta or {}).get('title'),
                        'image': (meta or {}).get('image')
                    }
            elif isinstance(existing, list):
                for item in existing:
                    url = item.get('url')
                    if url:
                        existing_map[normalize_url(url)] = {
                            'title': item.get('title') or None,
                            'image': item.get('image') or None
                        }
            print(f"[info] Loaded {len(existing_map)} existing entries from {args.output}")
        except Exception as e:
            print(f"[warn] failed to read existing output {args.output}: {e}", file=sys.stderr)

    results: List[Dict[str, Optional[str]]] = []
    to_fetch: List[str] = []
    for u in norm_urls:
        if args.overwrite or (u not in existing_map) or (not existing_map[u].get('title') and not existing_map[u].get('image')):
            to_fetch.append(u)

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.max_workers) as executor:
        futures = [executor.submit(fetch_og_for_url, url) for url in to_fetch]
        for i, fut in enumerate(concurrent.futures.as_completed(futures), start=1):
            res = fut.result()
            results.append(res)
            if i % 25 == 0:
                print(f"[info] Processed {i}/{len(to_fetch)} URLs")

    # Build mapping { url: {title, image} }
    mapping: Dict[str, Dict[str, Optional[str]]] = {}
    # Start with existing (resume mode)
    for url, meta in existing_map.items():
        mapping[url] = {
            'title': meta.get('title') or None,
            'image': meta.get('image') or None
        }
    # Overlay fetched results
    for item in results:
        url = item.get('url')
        if not url:
            continue
        mapping[url] = {
            'title': item.get('title') or None,
            'image': item.get('image') or None
        }

    # Also provide an items array for compatibility with the JS ingester
    payload = {
        'items': [ {'url': u, 'title': v.get('title'), 'image': v.get('image')} for u, v in mapping.items() ]
    }

    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    elapsed = time.time() - start
    print(f"[info] Wrote {len(mapping)} entries to {args.output} in {elapsed:.2f}s")


if __name__ == '__main__':
    main()


