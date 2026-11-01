// ==UserScript==
// @name         MAH Digikala Extensions
// @name:fa      افزونه‌های MAH دیجی‌کالا
// @namespace    https://mah.local/digikala
// @version      1.9.1
// @author       Mohammad Ali Haghshenas
// @license      Apache-2.0
// @copyright    2026, Mohammad Ali Haghshenas (https://github.com/H-MAli)
// @homepageURL  https://github.com/H-MAli/mah-digikala-extensions
// @supportURL   https://github.com/H-MAli/mah-digikala-extensions/issues
// @updateURL    https://raw.githubusercontent.com/H-MAli/mah-digikala-extensions/main/mah-digikala.extensions.user.js
// @downloadURL  https://raw.githubusercontent.com/H-MAli/mah-digikala-extensions/main/mah-digikala.extensions.user.js
// @description  Enhancements for Digikala: a sortable, filterable table view for product listings, a light / dark theme switcher, price comparison with other shops, price history with a discount check, and a watchlist with price alerts.
// @description:fa  بهبودهایی برای دیجی‌کالا: نمای جدولی کالاها با مرتب‌سازی و فیلتر، انتخاب حالت نمایش روشن / تاریک، مقایسه‌ی قیمت با فروشگاه‌های دیگر، سابقه‌ی قیمت با بررسی تخفیف، و فهرست پیگیری با هشدار قیمت.
// @match        https://www.digikala.com/*
// @match        https://auth.digikala.com/*
// @match        https://accounts.digikala.com/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @connect      api.torob.com
// @connect      torob.com
// @connect      emalls.ir
// @connect      search.basalam.com
// @connect      basalam.com
// @connect      www.amazon.com
// @connect      www.amazon.ae
// @connect      www.amazon.com.tr
// @connect      www.amazon.de
// @connect      www.ebay.com
// @connect      open.er-api.com
// @connect      www.google.com
// ==/UserScript==

(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Storage and settings
   * Everything is kept in the userscript manager's storage: it is shared by
   * www / auth / accounts and survives clearing the site's own data.
   * ------------------------------------------------------------------ */
  const store = {
    get(key, def) {
      try { const v = GM_getValue(key); return v === undefined ? def : v; } catch (e) { return def; }
    },
    set(key, v) { try { GM_setValue(key, v); } catch (e) { /* storage unavailable */ } },
    del(key) { try { GM_deleteValue(key); } catch (e) { /* storage unavailable */ } },
    keys() { try { return GM_listValues(); } catch (e) { return []; } },
    // fn(newValue) runs when another tab changes the value
    watch(key, fn) {
      try { GM_addValueChangeListener(key, (_key, _old, newV, remote) => { if (remote) fn(newV); }); } catch (e) { /* not supported */ }
    },
  };

  // Up to 1.5 the theme and the dollar rate lived in the site's localStorage (one copy per subdomain): move them over once.
  (function migrateLocalStorage() {
    const moves = [['mah-dk-theme', 'theme', String], ['mah-dk-usd-toman', 'usdManual', parseFloat]];
    for (const [oldKey, key, conv] of moves) {
      let v = null;
      try { v = localStorage.getItem(oldKey); } catch (e) { return; }
      if (v == null) continue;
      if (store.get(key) === undefined) store.set(key, conv(v));
      try { localStorage.removeItem(oldKey); } catch (e) { /* ignore */ }
    }
  })();

  const SETTINGS_KEY = 'settings';
  const DEFAULT_SETTINGS = {
    digits: 'fa', // 'fa' = Persian digits (like the site), 'en' = Latin digits
    features: { table: true, theme: true, compare: true, history: true },
    shops: { torob: true, emalls: true, basalam: true, foreign: true }, // price-comparison tabs
    // how prices are recorded: 'manual' (button on the product page only), 'visit' (when a product page is opened),
    // or a schedule ('6h' | '12h' | 'daily' | 'weekly') for the watchlist on top of 'visit'
    history: { freq: 'daily' },
    // watchlist alerts: price drop, back in stock, and whether to show them as desktop notifications too
    alerts: { drop: true, stock: true, desktop: false },
    table: { cols: {} }, // column picker: { key: true | false } over each column's default
  };
  // Saved values over the defaults, one level deep, so settings added in later versions get their default.
  function mergeSettings(saved) {
    const out = {};
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      const d = DEFAULT_SETTINGS[k];
      const v = saved && saved[k];
      if (d && typeof d === 'object') out[k] = Object.assign({}, d, v && typeof v === 'object' ? v : {});
      else out[k] = v !== undefined ? v : d;
    }
    return out;
  }
  let settingsCache = null;
  const settings = () => settingsCache || (settingsCache = mergeSettings(store.get(SETTINGS_KEY)));
  const feature = (name) => settings().features[name] !== false;
  const settingsListeners = [];
  const settingsChanged = () => settingsListeners.forEach((fn) => fn());
  // fn receives a copy of the settings to change in place
  function updateSettings(fn) {
    const next = JSON.parse(JSON.stringify(settings()));
    fn(next);
    settingsCache = mergeSettings(next);
    store.set(SETTINGS_KEY, settingsCache);
    settingsChanged();
  }
  store.watch(SETTINGS_KEY, () => { settingsCache = null; settingsChanged(); });

  /* ------------------------------------------------------------------ *
   * Config
   * ------------------------------------------------------------------ */
  // The pages on which the button is shown are listed in PAGE_TYPES (further below).
  // Items fetched when the table is first opened, and added by each "load more" press.
  const INITIAL_CAP = 1000;
  const LOAD_MORE_STEP = 1000;
  // Read once: a change in the settings applies from the next page load.
  const LOCALE = settings().digits === 'en' ? 'en-US' : 'fa-IR';
  const PCT = LOCALE.startsWith('fa') ? '٪' : '%';

  const BTN_ID = 'mah-dk-btn';
  const STYLE_ID = 'mah-dk-style';
  const HOST_ID = 'mah-dk-host';

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Digikala shows decimals with a plain dot (its font draws "٫" badly), so do the same.
  const L = (n) => n.toLocaleString(LOCALE).replace(/٫/g, '.');
  const fmt = (n) => (n == null ? '—' : L(Math.round(n)));
  const fmtScore = (n) =>
    n == null ? '—' : n.toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).replace(/٫/g, '.');
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const FA = '۰۱۲۳۴۵۶۷۸۹';
  const AR = '٠١٢٣٤٥٦٧٨٩';
  const latin = (s) =>
    String(s || '')
      .replace(/[۰-۹]/g, (d) => FA.indexOf(d))
      .replace(/[٠-٩]/g, (d) => AR.indexOf(d))
      .replace(/[,٬،\s\u200c\u200e\u200f]/g, '')
      .replace(/٫/g, '.');
  const num = (s) => {
    const m = latin(s).match(/\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  };

  // Inline icons (Digikala's <dds-icon> does not render inside a shadow root).
  const IC = {
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    download: '<path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14"/>',
    up: '<path d="M12 19V5m0 0l-5 5m5-5l5 5"/>',
    down: '<path d="M12 5v14m0 0l-5-5m5 5l5-5"/>',
    sort: '<path d="M8 19V5m0 0L4.5 8.5M8 5l3.5 3.5M16 5v14m0 0l-3.5-3.5M16 19l3.5-3.5"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r=".8"/><circle cx="4.5" cy="12" r=".8"/><circle cx="4.5" cy="18" r=".8"/>',
    star: '<path fill="currentColor" stroke="none" d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    tag: '<path d="M3 12.5V4h8.5L21 13.5 13.5 21z"/><circle cx="8" cy="8.5" r="1.3"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  };
  const svg = (name, size = 20) =>
    `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" ` +
    `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[name]}</svg>`;

  /* ------------------------------------------------------------------ *
   * Card parsing (used for the fallback and for cards the API lacks)
   * ------------------------------------------------------------------ */
  function parseCard(a) {
    const art = a.querySelector('article');
    if (!art) return null; // skeleton / not a product card
    const href = a.getAttribute('href') || '';
    const id = (href.match(/dkp-(\d+)/) || [])[1];
    if (!id) return null;
    const variant = (href.match(/variant_id=(\d+)/) || [])[1] || '';

    // grid cards use <h2>, carousel/list cards use <h3>
    const title = ((art.querySelector('h2, h3, h4') || {}).textContent || '').trim();

    // score: a numeric <p> directly followed by the (custom-element) star icon
    let score = null;
    for (const p of art.querySelectorAll('p')) {
      const nx = p.nextElementSibling;
      if (/^\d+(\.\d+)?$/.test(latin(p.textContent)) && nx && nx.tagName.includes('-')) {
        score = num(p.textContent);
        break;
      }
    }

    // off percentage pill
    let pct = null;
    for (const sp of art.querySelectorAll('span')) {
      if (/[٪%]/.test(sp.textContent) && String(sp.parentElement.className).includes('rounded')) {
        pct = num(sp.textContent);
        break;
      }
    }

    // price before off (struck through) and final price
    const oldEl = art.querySelector('.line-through');
    const old = oldEl ? num(oldEl.textContent) : null;
    let price = null;
    for (const sp of art.querySelectorAll('span')) {
      if (sp.children.length) continue;
      if (oldEl && oldEl.contains(sp)) continue;
      if (/^\d+(\.\d+)?$/.test(latin(sp.textContent))) {
        price = num(sp.textContent);
        break;
      }
    }

    if (!title || price == null) return null; // still loading, or unavailable

    let offAmt = null;
    if (old != null && old > price) offAmt = old - price;
    if (pct == null && offAmt != null) pct = Math.round((offAmt / old) * 100);

    let path = href;
    try { path = new URL(href, location.origin).pathname; } catch (e) { /* keep */ }

    const im = art.querySelector('img');
    const src = im ? im.currentSrc || im.src || '' : '';

    return {
      key: id + '|' + variant,
      id,
      title,
      url: location.origin + path,
      img: /^https?:/.test(src) ? src : '',
      unit: unitPrice(title, price),
      score,
      price,
      old,
      pct,
      offAmt,
    };
  }

  /* ------------------------------------------------------------------ *
   * Supported pages. Each entry says where the button shows up and which
   * list API the page's own infinite scroll uses (same product format).
   * ------------------------------------------------------------------ */
  const PAGE_TYPES = [
    {
      // https://www.digikala.com/incredible-offers/
      re: /^\/incredible-offers(\/|$)/,
      apiUrl: () => 'https://api.digikala.com/v1/incredible-offers/products/',
      mergeCards: true, // also add cards that are on the page but not in the list API (daily-deals carousel)
    },
    {
      // https://www.digikala.com/search/category-mobile-phone/  ->  /v1/categories/mobile-phone/search/
      re: /^\/search\/category-([^/]+)/,
      apiUrl: (m) => 'https://api.digikala.com/v1/categories/' + m[1] + '/search/',
      mergeCards: false,
    },
    {
      // https://www.digikala.com/search/?q=...  ->  /v1/search/?q=... (the query is passed on with the page's other parameters)
      re: /^\/search\/?$/,
      apiUrl: () => 'https://api.digikala.com/v1/search/',
      mergeCards: false,
    },
    {
      // https://www.digikala.com/brand/samsung/  ->  /v1/brands/samsung/
      re: /^\/brand\/([^/]+)/,
      apiUrl: (m) => 'https://api.digikala.com/v1/brands/' + m[1] + '/',
      mergeCards: false,
    },
    {
      // https://www.digikala.com/seller/5A52N/  ->  /v1/sellers/5A52N/  (not the /seller/pro/ landing pages)
      re: /^\/seller\/(?!pro\/)([^/]+)/,
      apiUrl: (m) => 'https://api.digikala.com/v1/sellers/' + m[1] + '/',
      mergeCards: false,
    },
  ];

  function pageType() {
    for (const t of PAGE_TYPES) {
      const m = location.pathname.match(t.re);
      if (m) return Object.assign({ m }, t);
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * Unit price from the product title (see DISCLAIMER.md, section 4.5):
   * a weight or volume ("۵۰۰ گرم", "۱.۵ لیتری"), times a pack count when there
   * is one ("بسته ۶ عددی"); or just a pack count -> price per item.
   * Dosages ("۵۰۰ میلی‌گرم") are ignored. Nothing when the title is unclear.
   * ------------------------------------------------------------------ */
  const UNIT_LABEL = { kg: 'کیلوگرم', l: 'لیتر', pc: 'عدد' };
  const UNIT_RANK = { kg: 1, l: 2, pc: 3 }; // sorting compares like with like
  function parseSize(title) {
    let s = String(title || '')
      .replace(/[۰-۹]/g, (d) => FA.indexOf(d))
      .replace(/[٠-٩]/g, (d) => AR.indexOf(d))
      .replace(/٫/g, '.')
      .replace(/(\d),(\d)/g, '$1.$2')
      .replace(/[\u200c\u200e\u200f]/g, ' ')
      .replace(/ي/g, 'ی')
      .toLowerCase();
    const N = '(\\d+(?:\\.\\d+)?)';
    const END = '(?![a-z\\u0600-\\u06ff])';
    s = s.replace(new RegExp(N + '\\s*(?:میلی\\s*گرم|mg)' + END, 'g'), ' ');
    const find = (unit) => { const m = s.match(new RegExp(N + '\\s*(?:' + unit + ')' + END)); return m ? parseFloat(m[1]) : null; };
    let kg = find('کیلو\\s*گرمی?|کیلویی|کیلو|kg');
    if (kg == null) { const g = find('گرمی?|gr|g'); if (g != null) kg = g / 1000; }
    let l = null;
    if (kg == null) {
      const ml = find('میلی\\s*لیتری?|ml|سی\\s*سی|cc');
      if (ml != null) l = ml / 1000;
      else l = find('لیتری?|lit(?:er|re)?');
    }
    let count = null;
    const pack = s.match(new RegExp('بسته\\s*' + N)) || s.match(new RegExp(N + '\\s*(?:عددی|تایی|عدد|pcs|pack)' + END));
    if (pack) count = parseFloat(pack[1]);
    if (!(count > 0 && count <= 1000)) count = null;
    if (kg > 0) return { u: 'kg', q: kg * (count || 1) };
    if (l > 0) return { u: 'l', q: l * (count || 1) };
    if (count > 1) return { u: 'pc', q: count };
    return null;
  }
  // -> { v: Tomans per unit, u } or null
  function unitPrice(title, price) {
    const sz = price > 0 ? parseSize(title) : null;
    return sz && sz.q > 0 ? { v: price / sz.q, u: sz.u } : null;
  }

  /* ------------------------------------------------------------------ *
   * Item sources. Both kinds expose the same interface:
   *   rows        items loaded so far (grows in place)
   *   exhausted   true once nothing more can be loaded
   *   totalItems  total reported by the site (API source only, may be null)
   *   load(target, progress)
   *               loads until rows.length >= target, nothing is left, or
   *               progress.stopped is set. Can be called again to load more.
   * ------------------------------------------------------------------ */

  /* Source 1 (preferred): the same Ajax endpoint the page's infinite scroll uses,
   * fetched page by page in small parallel waves.
   * Prices in the API are in Rials; the site displays Tomans (÷10). */
  function rowFromApi(p) {
    const v = p && p.default_variant;
    const pr = v && v.price;
    if (!pr || !(pr.selling_price > 0)) return null; // out of stock
    const price = pr.selling_price / 10;
    const old = pr.rrp_price > pr.selling_price ? pr.rrp_price / 10 : null;
    const offAmt = old != null ? old - price : null;
    let pct = pr.discount_percent > 0 ? pr.discount_percent : null;
    if (pct == null && offAmt != null) pct = Math.round((offAmt / old) * 100);
    const rt = p.rating;
    const score = rt && rt.count > 0 && rt.rate > 0 ? Math.round((rt.rate / 20) * 10) / 10 : null; // 0-100 -> 0-5
    const uri = p.url && typeof p.url.uri === 'string' && p.url.uri.startsWith('/') ? p.url.uri : '/product/dkp-' + p.id + '/';
    const im = p.images && p.images.main && Array.isArray(p.images.main.url) ? p.images.main.url[0] : '';
    const title = String(p.title_fa || p.title_en || '').trim();
    const sel = v.seller || {};
    const vp = v.properties || {};
    const prov = ((v.shipment_methods || {}).providers || []).map((x) => x && x.type);
    return {
      key: String(p.id),
      id: String(p.id),
      title,
      unit: unitPrice(title, price),
      seller: String(sel.title || '').trim() || null,
      sellerRate: sel.stars > 0 ? Math.round(sel.stars * 10) / 10 : null,
      ship: vp.in_digikala_warehouse ? 'dkw' : prov.includes('digikala') ? 'dk' : prov.includes('seller') || vp.is_ship_by_seller ? 'seller' : null,
      jet: !!((p.digiplus && p.digiplus.is_jet_eligible) || (p.properties && p.properties.is_jet_eligible) || prov.includes('jet')),
      // only reported when few are left
      stock: typeof pr.marketable_stock === 'number' ? pr.marketable_stock : null,
      url: location.origin + uri,
      img: im ? String(im) : '', // keep the site's own resize parameters (custom sizes are rejected by the CDN)
      score,
      price,
      old,
      pct,
      offAmt,
    };
  }

  function createApiSource(type) {
    const params = new URLSearchParams(location.search); // keep the page's own filters and sort order
    params.delete('page');
    const endpoint = type.apiUrl(type.m);
    const seen = new Set();
    const src = { rows: [], exhausted: false, totalItems: null };
    let totalPages = null;
    let nextPage = 1;
    let perPage = 20;
    let cardsMerged = false;

    const get = async (page) => {
      const q = new URLSearchParams(params);
      q.set('page', page);
      const res = await fetch(endpoint + '?' + q, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      const d = json && json.data;
      if (!d || !Array.isArray(d.products)) throw new Error('Unexpected API response');
      return d;
    };
    const getRetry = async (page) => {
      for (let attempt = 0; ; attempt++) {
        try { return await get(page); }
        catch (e) { if (attempt >= 2) throw e; await sleep(600 * (attempt + 1)); }
      }
    };

    src.load = async (target, progress) => {
      while (!src.exhausted && !progress.stopped && src.rows.length < target) {
        // The first request learns the page count; after that fetch up to 5 pages at once,
        // never more than needed to reach the target, and never past the last page (the API answers 400 there).
        let wave = [1];
        if (totalPages != null) {
          const need = Math.ceil((target - src.rows.length) / perPage);
          const n = Math.min(5, need, totalPages - nextPage + 1);
          wave = Array.from({ length: n }, (_, i) => nextPage + i);
        }
        let got = 0;
        const results = await Promise.all(
          wave.map(async (page) => {
            const d = await getRetry(page);
            got += d.products.length;
            progress.update(src.rows.length + got);
            return d;
          })
        );
        if (totalPages == null) {
          const pg = results[0].pager || {};
          totalPages = pg.total_pages || 1;
          src.totalItems = pg.total_items || null;
          perPage = results[0].products.length || perPage;
        }
        for (const d of results) { // in page order, so the table keeps the site's order
          for (const p of d.products) {
            const r = rowFromApi(p);
            if (r && r.title && !seen.has(r.id)) { seen.add(r.id); r.n = src.rows.length; src.rows.push(r); }
          }
        }
        nextPage = wave[wave.length - 1] + 1;
        if (nextPage > totalPages) src.exhausted = true;
        progress.update(src.rows.length);
      }

      if (type.mergeCards && !cardsMerged && src.rows.length) {
        cardsMerged = true;
        for (const a of document.querySelectorAll('a[href*="/product/dkp-"]')) {
          const r = parseCard(a);
          if (r && !seen.has(r.id)) { seen.add(r.id); r.n = src.rows.length; src.rows.push(r); }
        }
        progress.update(src.rows.length);
      }
    };
    return src;
  }

  /* Source 2 (fallback): scroll the page until no more items load. */
  function createScrollSource() {
    const done = new WeakSet();
    const seen = new Set();
    const src = { rows: [], exhausted: false, totalItems: null };

    const harvest = (progress) => {
      for (const a of document.querySelectorAll('a[href*="/product/dkp-"]')) {
        if (done.has(a)) continue;
        const row = parseCard(a);
        if (!row) continue;
        done.add(a);
        if (!seen.has(row.key)) { seen.add(row.key); row.n = src.rows.length; src.rows.push(row); }
      }
      progress.update(src.rows.length);
    };
    const signature = () => src.rows.length + '|' + document.documentElement.scrollHeight;

    src.load = async (target, progress) => {
      const startY = window.scrollY;
      harvest(progress);
      let fails = 0;
      while (!progress.stopped && src.rows.length < target && fails < 2) {
        const before = signature();
        window.scrollBy(0, -1200); // nudge, so the "near bottom" trigger fires again
        await sleep(120);
        window.scrollTo(0, document.documentElement.scrollHeight);

        let grew = false;
        for (let t = 0; t < 20 && !progress.stopped; t++) {
          await sleep(250);
          harvest(progress);
          if (signature() !== before) { grew = true; break; }
        }
        fails = grew ? 0 : fails + 1;
      }
      await sleep(300);
      harvest(progress);
      if (fails >= 2) src.exhausted = true;
      window.scrollTo(0, startY);
    };
    return src;
  }

  // Opens the right source and loads the first INITIAL_CAP items.
  async function openSource(progress) {
    const type = pageType();
    if (type) {
      const src = createApiSource(type);
      try {
        await src.load(INITIAL_CAP, progress);
        return src;
      } catch (err) {
        console.warn('[MAH Digikala Extensions] API collection failed:', err);
        if (src.rows.length) return src; // keep what was loaded; "load more" can retry
        console.warn('[MAH Digikala Extensions] falling back to scrolling');
      }
    }
    const fallback = createScrollSource();
    await fallback.load(INITIAL_CAP, progress);
    return fallback;
  }

  /* ------------------------------------------------------------------ *
   * UI: shadow-DOM host (isolated from the site's CSS)
   * Colors / font come from Digikala's own CSS variables when available.
   * ------------------------------------------------------------------ */
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    .modal, .prog {
      --p: var(--color-primary-700, #ef394e);
      --pill: #d32f2f;
      --bg: #fff; --hover: #fafafb; --tint: #fff8f8;
      --n700: var(--color-neutral-700, #3f4064);
      --n600: var(--color-neutral-600, #62666d);
      --n500: var(--color-neutral-500, #81858b);
      --n400: var(--color-neutral-400, #a1a3a8);
      --n300: var(--color-neutral-300, #c0c2c5);
      --n200: var(--color-neutral-200, #e0e0e2);
      --n100: var(--color-neutral-100, #f0f0f1);
      --pad: max(20px, calc((100% - 1440px) / 2));
      font-family: Digikala, Tahoma, "Segoe UI", sans-serif;
      font-size: 12px; line-height: 1.8; color: var(--n700); direction: rtl;
    }
    :host([data-mah-theme="dark"]) .modal, :host([data-mah-theme="dark"]) .prog {
      --bg: var(--color-neutral-000, #222732); --hover: #2b303c; --tint: #3a1f2a; color-scheme: dark;
    }
    button, input, select { font-family: inherit; font-size: 12px; color: inherit; }
    .ic { flex: none; }

    .modal { position: fixed; inset: 0; z-index: 2147483000; background: var(--bg); display: flex; flex-direction: column; }

    .top { display: flex; align-items: center; gap: 12px; height: 64px; padding: 0 var(--pad);
      border-bottom: 1px solid var(--n200); flex: none; }
    .ttl { display: flex; align-items: center; gap: 10px; font-size: 16px; font-weight: 700; }
    .badge { width: 36px; height: 36px; border-radius: 50%; background: var(--n100); display: grid; place-items: center; }
    .chip { background: var(--n100); color: var(--n600); border-radius: 999px; padding: 0 10px;
      font-size: 12px; font-weight: 400; line-height: 24px; }
    .sp { flex: 1; }

    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 40px; padding: 0 16px;
      border: 1px solid var(--n200); border-radius: 8px; background: var(--bg); color: var(--n700);
      font-weight: 700; cursor: pointer; white-space: nowrap; transition: background .15s; }
    .btn:hover { background: var(--n100); }
    .btn.ghost { width: 40px; padding: 0; border-color: transparent; border-radius: 50%; }

    .tools { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 12px var(--pad);
      border-bottom: 1px solid var(--n100); flex: none; }
    .search { position: relative; width: 340px; max-width: 100%; display: block; }
    .search .ic { position: absolute; inset-inline-start: 14px; top: 50%; transform: translateY(-50%);
      color: var(--n400); pointer-events: none; }
    .search input { width: 100%; height: 40px; border: 1px solid transparent; border-radius: 999px;
      background: var(--n100); padding-inline: 44px 16px; outline: none; }
    .search input:focus { background: var(--bg); border-color: var(--n300); }
    .search input::placeholder { color: var(--n500); }
    .field { display: inline-flex; align-items: center; gap: 8px; color: var(--n500); }
    .sel { position: relative; display: inline-block; }
    .sel select { height: 40px; border: 1px solid var(--n200); border-radius: 8px; background: var(--bg);
      padding-inline: 14px 38px; font-weight: 700; color: var(--n700); appearance: none; -webkit-appearance: none;
      cursor: pointer; outline: none; }
    .sel select:focus { border-color: var(--n300); }
    .sel .ic { position: absolute; inset-inline-end: 12px; top: 50%; transform: translateY(-50%);
      color: var(--n500); pointer-events: none; }

    /* range filters: one min/max pair per numeric column, all combined (AND) */
    .filters { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 24px; padding: 10px var(--pad);
      border-bottom: 1px solid var(--n100); flex: none; }
    .rng { display: inline-flex; align-items: center; gap: 6px; color: var(--n500); }
    .rng .rl { font-weight: 700; margin-inline-end: 2px; }
    .rng .to { color: var(--n300); }
    .rng input { width: 112px; height: 36px; border: 1px solid var(--n200); border-radius: 8px; background: var(--bg);
      padding: 0 10px; outline: none; direction: ltr; text-align: right; color: var(--n700); }
    .rng input::placeholder { color: var(--n400); direction: rtl; }
    .rng input:focus { border-color: var(--n300); }
    .rng input.on { border-color: var(--p); background: var(--tint); }
    .filters .btn { height: 36px; padding: 0 12px; color: var(--p); }
    .rngs { display: contents; }
    .tg { display: inline-flex; align-items: center; gap: 6px; color: var(--n600); cursor: pointer; }
    .tg input, .cp input { width: 15px; height: 15px; margin: 0; accent-color: var(--p); }
    .colpick { position: relative; }
    .cp { position: absolute; top: calc(100% + 6px); inset-inline-end: 0; z-index: 5; min-width: 220px; padding: 8px 12px;
      background: var(--bg); border: 1px solid var(--n200); border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.14);
      display: flex; flex-direction: column; gap: 2px; }
    .cp[hidden] { display: none; }
    .cp label { display: flex; align-items: center; gap: 8px; padding: 4px 0; cursor: pointer; white-space: nowrap; }
    td.nw { white-space: nowrap; }
    td small { color: var(--n500); }
    .low { color: #b26a00; font-weight: 700; }
    .jet { display: inline-block; padding: 0 8px; border-radius: 6px; background: var(--n100); font-weight: 700; line-height: 22px; }

    /* scroll container is LTR so the scrollbar stays on the right, like the site */
    .scroll { flex: 1; overflow: auto; padding: 0 var(--pad) 40px; direction: ltr; }
    table { width: 100%; border-collapse: separate; border-spacing: 0; direction: rtl; }
    th:nth-child(1), td.idx { width: 56px; }
    th:nth-child(n+3) { min-width: 110px; }
    th { position: sticky; top: 0; z-index: 2; background: var(--bg); color: var(--n500); font-weight: 700;
      text-align: start; padding: 0 12px; height: 48px; border-bottom: 1px solid var(--n200);
      white-space: nowrap; cursor: pointer; user-select: none; }
    th .h { display: inline-flex; align-items: center; gap: 4px; }
    th .si { display: inline-flex; align-items: center; gap: 2px; color: var(--n300); }
    th:hover { color: var(--n700); }
    th:hover .si { color: var(--n400); }
    th.on, th.on .si { color: var(--p); }
    th .ord { width: 14px; height: 14px; border-radius: 50%; background: var(--p); color: #fff;
      font-size: 9px; line-height: 14px; text-align: center; }
    th.nosort { cursor: default; }
    th.nosort:hover { color: var(--n500); }

    td { padding: 10px 12px; border-bottom: 1px solid var(--n100); vertical-align: middle; }
    td.idx { color: var(--n400); width: 56px; }
    td.num { white-space: nowrap; direction: ltr; text-align: right; }
    .nm { display: flex; align-items: center; gap: 12px; min-width: 340px; }
    .nm img, .nm i { display: block; width: 48px; height: 48px; flex: none; border-radius: 8px;
      object-fit: contain; background: var(--n100); }
    .nm a { color: var(--n700); font-weight: 700; text-decoration: none; line-height: 2;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .nm a:hover { color: var(--p); }
    .nm .star { flex: none; margin-inline-start: auto; width: 32px; height: 32px; border: 0; border-radius: 50%; background: none;
      color: var(--n400); font-size: 18px; line-height: 1; cursor: pointer; }
    .nm .star:hover { background: var(--n100); }
    .nm .star.on { color: #f9a825; }
    .price { font-weight: 700; font-size: 13px; }
    .old { color: var(--n300); text-decoration: line-through; }
    .pill { display: inline-block; min-width: 40px; padding: 0 8px; border-radius: 16px; background: var(--pill);
      color: #fff; font-weight: 700; text-align: center; line-height: 24px; direction: rtl; }
    .rate { display: inline-flex; align-items: center; gap: 4px; font-weight: 700; direction: rtl; }
    .rate .ic { color: #f9a825; }
    .dash { color: var(--n300); }
    tbody tr:not(.grp):hover td { background: var(--hover); }

    tr.grp td { background: var(--n100); cursor: pointer; padding: 10px 12px; border-bottom: 1px solid var(--n200); }
    .gh { display: flex; align-items: center; gap: 10px; }
    .gh .ic { color: var(--n600); transition: transform .15s; }
    tr.grp.closed .gh .ic { transform: rotate(90deg); }
    .gh b { font-size: 13px; }
    .gh .meta { color: var(--n500); }
    .empty { padding: 60px; text-align: center; color: var(--n500); }

    /* footer: load more / load all */
    .more { display: flex; align-items: center; gap: 12px; padding: 10px var(--pad);
      border-top: 1px solid var(--n200); background: var(--bg); flex: none; }
    .more .mi { color: var(--n600); }
    .more .btn { height: 36px; padding: 0 14px; }
    .btn[disabled] { opacity: .5; cursor: default; }
    .btn[disabled]:hover { background: var(--bg); }
    .mspin { width: 16px; height: 16px; border: 2px solid var(--n200); border-top-color: var(--p);
      border-radius: 50%; animation: sp .8s linear infinite; }

    .prog { position: fixed; top: 96px; left: 50%; transform: translateX(-50%); z-index: 2147483000;
      background: var(--bg); border: 1px solid var(--n200); border-radius: 12px; padding: 12px 18px;
      display: flex; align-items: center; gap: 14px; box-shadow: 0 4px 24px rgba(0,0,0,.14); font-size: 13px; }
    .prog b { font-size: 15px; }
    .prog .spin { width: 18px; height: 18px; border: 2px solid var(--n200); border-top-color: var(--p);
      border-radius: 50%; animation: sp .8s linear infinite; }
    .prog .link { border: 0; background: none; color: var(--p); font-weight: 700; cursor: pointer; padding: 0 4px; }
    @keyframes sp { to { transform: rotate(360deg); } }
  `;

  function getRoot() {
    let host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = HOST_ID;
      host.setAttribute(THEME_ATTR, currentMode());
      document.documentElement.appendChild(host);
      const root = host.attachShadow({ mode: 'open' });
      const st = document.createElement('style');
      st.textContent = CSS + DC_CSS + TOAST_CSS;
      root.appendChild(st);
    }
    return host.shadowRoot;
  }

  function showProgress() {
    const root = getRoot();
    const el = document.createElement('div');
    el.className = 'prog';
    el.innerHTML =
      '<div class="spin"></div><div>در حال دریافت کالاها… <b data-n>' + L(0) + '</b> کالا</div>' +
      '<button class="link" type="button">توقف و نمایش جدول</button>';
    root.appendChild(el);
    const ctl = {
      stopped: false,
      update(n) { el.querySelector('[data-n]').textContent = L(n); },
      close() { el.remove(); },
    };
    el.querySelector('button').addEventListener('click', () => { ctl.stopped = true; });
    return ctl;
  }

  /* ------------------------------------------------------------------ *
   * Grouping definitions
   * ------------------------------------------------------------------ */
  const bandBy = (key, edges, noneLabel) => (r) => {
    const v = r[key];
    if (v == null || v === 0) return [99, noneLabel];
    let i = edges.length - 1;
    while (i > 0 && v < edges[i]) i--;
    const lo = edges[i];
    const hi = edges[i + 1];
    return [i, i === 0 ? 'کمتر از ' + L(hi) : hi == null ? L(lo) + ' به بالا' : L(lo) + ' تا ' + L(hi)];
  };

  const GROUPERS = {
    score: {
      label: 'امتیاز',
      fn: (r) => {
        if (r.score == null) return [99, 'بدون امتیاز'];
        if (r.score >= 4.5) return [0, L(4.5) + ' تا ' + L(5)];
        if (r.score >= 4) return [1, L(4) + ' تا ' + L(4.4)];
        if (r.score >= 3) return [2, L(3) + ' تا ' + L(3.9)];
        return [3, 'زیر ' + L(3)];
      },
    },
    pct: {
      label: 'درصد تخفیف',
      fn: (r) => {
        if (!r.pct) return [99, 'بدون تخفیف'];
        const b = Math.min(9, Math.floor(r.pct / 10));
        return [b, (b === 9 ? L(90) + ' تا ' + L(100) : L(b * 10) + ' تا ' + L(b * 10 + 9)) + PCT];
      },
    },
    price: {
      label: 'محدوده قیمت',
      fn: bandBy('price', [0, 5e5, 1e6, 2e6, 5e6, 1e7, 2e7, 5e7], '—'),
    },
    offAmt: {
      label: 'مبلغ تخفیف',
      fn: bandBy('offAmt', [0, 1e5, 5e5, 1e6, 5e6, 1e7], 'بدون تخفیف'),
    },
  };

  // num: numeric, gets a min/max range filter automatically (the title is filtered with the search box)
  // opt: can be hidden with the column picker; on: shown by default
  const COLS = [
    { key: 'idx', label: '#', sortable: false },
    { key: 'title', label: 'نام کالا' },
    { key: 'score', label: 'امتیاز', num: true, opt: true, on: true },
    { key: 'price', label: 'قیمت (تومان)', num: true },
    { key: 'old', label: 'قیمت قبل از تخفیف (تومان)', num: true, opt: true, on: true },
    { key: 'pct', label: 'درصد تخفیف', num: true, opt: true, on: true },
    { key: 'offAmt', label: 'مبلغ تخفیف (تومان)', num: true, opt: true, on: true },
    { key: 'unit', label: 'قیمت واحد (تومان)', opt: true, on: true },
    { key: 'seller', label: 'فروشنده', opt: true },
    { key: 'sellerRate', label: 'امتیاز فروشنده', num: true, opt: true },
    { key: 'ship', label: 'ارسال', opt: true },
    { key: 'jet', label: 'جت', opt: true },
    { key: 'stock', label: 'موجودی کم', num: true, opt: true },
  ];
  const DC_COL = { key: 'dc', label: 'بررسی تخفیف', sortable: false, opt: true, on: true };
  const colOn = (c) => {
    if (!c.opt) return true;
    const v = settings().table.cols[c.key];
    return typeof v === 'boolean' ? v : !!c.on;
  };
  const SHIP_LABEL = { dkw: 'انبار دیجی‌کالا', dk: 'ارسال دیجی‌کالا', seller: 'ارسال فروشنده' };
  // quick filters (checkboxes next to the range filters)
  const TOGGLES = [
    { key: 'low', label: 'فقط موجودی کم', fn: (r) => r.stock != null },
    { key: 'dk', label: 'فقط ارسال دیجی‌کالا', fn: (r) => r.ship === 'dk' || r.ship === 'dkw' },
    { key: 'jet', label: 'فقط جت', fn: (r) => !!r.jet },
  ];

  /* ------------------------------------------------------------------ *
   * Table modal
   * ------------------------------------------------------------------ */
  function showTable(src) {
    const rows = src.rows; // grows in place when more items are loaded
    const root = getRoot();
    const hist = historyOn();
    const allCols = hist ? COLS.concat([DC_COL]) : COLS;
    let cols = allCols.filter(colOn);
    let fcols = cols.filter((c) => c.num);
    // st.f[key] = { min, max } (null = no limit on that side); st.t[key] = quick filter on
    const st = { sort: [], group: 'none', groupDesc: false, q: '', f: {}, t: {}, collapsed: new Set() };

    const prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';

    // Real min / max of every filterable column: shown as placeholders so you know what range makes sense.
    const bounds = {};
    function computeBounds() {
      for (const c of allCols.filter((x) => x.num)) {
        let lo = Infinity;
        let hi = -Infinity;
        for (const r of rows) {
          const v = r[c.key];
          if (v == null) continue;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        bounds[c.key] = lo <= hi ? { lo, hi } : null;
      }
    }
    computeBounds();
    const phText = (key, side) => {
      const b = bounds[key];
      if (!b) return '';
      const f = key === 'score' ? fmtScore : fmt;
      return side === 'min' ? 'از ' + f(b.lo) : 'تا ' + f(b.hi);
    };

    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.setAttribute('dir', 'rtl');
    wrap.innerHTML = `
      <div class="top">
        <div class="ttl">
          <span class="badge">${svg('list', 20)}</span>
          <span>جدول کالاها</span>
          <span class="chip" data-count></span>
        </div>
        <span class="sp"></span>
        ${hist ? '<button class="btn" type="button" data-act="dcheck" title="بررسی تخفیف کالاهای تخفیف‌دار فهرست فعلی (حداکثر ۱۰۰ کالا در هر بار)">بررسی تخفیف‌ها</button>' : ''}
        <button class="btn" type="button" data-act="csv">${svg('download', 18)}<span>خروجی CSV</span></button>
        <button class="btn ghost" type="button" data-act="close" title="بستن">${svg('close', 22)}</button>
      </div>
      <div class="tools">
        <label class="search">${svg('search', 20)}<input class="q" type="search" placeholder="جستجو در نام کالاها…"></label>
        <label class="field">گروه‌بندی بر اساس
          <span class="sel">
            <select data-grp>
              <option value="none">بدون گروه‌بندی</option>
              ${Object.entries(GROUPERS).map(([k, g]) => `<option value="${k}">${esc(g.label)}</option>`).join('')}
            </select>${svg('chevron', 16)}
          </span>
        </label>
        <button class="btn" type="button" data-act="gorder" hidden></button>
        <button class="btn" type="button" data-act="collapse" hidden>بستن همه گروه‌ها</button>
        <button class="btn" type="button" data-act="expand" hidden>باز کردن همه گروه‌ها</button>
        <span class="sp"></span>
        <div class="colpick">
          <button class="btn" type="button" data-act="cols" aria-expanded="false">ستون‌ها${svg('chevron', 16)}</button>
          <div class="cp" hidden>${allCols.filter((c) => c.opt).map((c) =>
            `<label><input type="checkbox" data-col="${c.key}"${colOn(c) ? ' checked' : ''}><span>${esc(c.label)}</span></label>`).join('')}</div>
        </div>
      </div>
      <div class="filters">
        <div class="rngs"></div>
        ${TOGGLES.map((t) => `<label class="tg"><input type="checkbox" data-tg="${t.key}"><span>${esc(t.label)}</span></label>`).join('')}
        <button class="btn" type="button" data-act="clear" hidden></button>
      </div>
      <div class="scroll">
        <table>
          <thead><tr></tr></thead>
          <tbody></tbody>
        </table>
      </div>
      <div class="more">
        <span class="mspin" data-spin hidden></span>
        <span class="mi" data-more-info></span>
        <span class="sp"></span>
        <button class="btn" type="button" data-act="more" title="${esc(L(LOAD_MORE_STEP) + ' کالای دیگر')}">بارگذاری بیشتر</button>
        <button class="btn" type="button" data-act="all" title="بارگذاری همه کالاهای باقی‌مانده (ممکن است زمان‌بر باشد)">بارگذاری همه</button>
        <button class="btn" type="button" data-act="stop" hidden>توقف</button>
      </div>`;
    root.appendChild(wrap);

    const $ = (s) => wrap.querySelector(s);
    const tbody = $('tbody');

    // (Re)builds the header and the range filters for the visible columns, keeping typed filter values.
    function applyCols() {
      cols = allCols.filter(colOn);
      fcols = cols.filter((c) => c.num);
      $('thead tr').innerHTML = cols.map((c) => `<th data-key="${c.key}"></th>`).join('');
      const keep = {};
      wrap.querySelectorAll('input[data-f]').forEach((inp) => { keep[inp.dataset.f + '|' + inp.dataset.b] = inp.value; });
      const inp = (c, side) => `<input type="text" inputmode="decimal" autocomplete="off" data-f="${c.key}" data-b="${side}" ` +
        `placeholder="${esc(phText(c.key, side))}" value="${esc(keep[c.key + '|' + side] || '')}">`;
      $('.rngs').innerHTML = fcols.map((c) =>
        `<div class="rng"><span class="rl">${esc(c.label)}</span>${inp(c, 'min')}<span class="to">—</span>${inp(c, 'max')}</div>`).join('');
      st.sort = st.sort.filter((x) => cols.some((c) => c.key === x.key));
      readFilters();
    }
    applyCols();

    /* ---- sorting ---- */
    const sortVal = (r, key) => (key === 'unit' ? (r.unit ? UNIT_RANK[r.unit.u] * 1e13 + r.unit.v : null) : r[key]);
    const cmp = (a, b) => {
      for (const { key, dir } of st.sort) {
        const x = sortVal(a, key);
        const y = sortVal(b, key);
        if (x == null && y == null) continue;
        if (x == null) return 1; // empty values always last
        if (y == null) return -1;
        const c = typeof x === 'string' ? x.localeCompare(y, 'fa') : x - y;
        if (c) return c * dir;
      }
      return a.n - b.n; // page order as the final tie-break
    };

    function toggleSort(key, multi) {
      const i = st.sort.findIndex((s) => s.key === key);
      const step = (s) => (s.dir === 1 ? { key, dir: -1 } : null); // asc -> desc -> off
      if (multi) {
        if (i === -1) st.sort.push({ key, dir: 1 });
        else {
          const n = step(st.sort[i]);
          if (n) st.sort[i] = n; else st.sort.splice(i, 1);
        }
      } else if (i !== -1 && st.sort.length === 1) {
        const n = step(st.sort[0]);
        st.sort = n ? [n] : [];
      } else {
        st.sort = [{ key, dir: 1 }];
      }
    }

    function renderHead() {
      wrap.querySelectorAll('th').forEach((th) => {
        const col = cols.find((c) => c.key === th.dataset.key);
        const i = st.sort.findIndex((s) => s.key === col.key);
        th.className = (i !== -1 ? 'on ' : '') + (col.sortable === false ? 'nosort' : '');
        let ind = '';
        if (col.sortable !== false) {
          ind =
            `<span class="si">${i === -1 ? svg('sort', 16) : svg(st.sort[i].dir === 1 ? 'up' : 'down', 16)}` +
            `${i !== -1 && st.sort.length > 1 ? `<span class="ord">${L(i + 1)}</span>` : ''}</span>`;
        }
        th.innerHTML = `<span class="h">${esc(col.label)}${ind}</span>`;
      });
    }

    /* ---- filtering (all active filters must match) ---- */
    const rangeActive = (r) => r && (r.min != null || r.max != null);

    // A row without a value in a filtered column (e.g. no discount, no rating) does not match that filter.
    function passesRanges(r) {
      for (const t of TOGGLES) if (st.t[t.key] && !t.fn(r)) return false;
      for (const key in st.f) {
        const rg = st.f[key];
        if (!rangeActive(rg)) continue;
        const v = r[key];
        if (v == null) return false;
        if (rg.min != null && v < rg.min) return false;
        if (rg.max != null && v > rg.max) return false;
      }
      return true;
    }

    const activeCount = () =>
      Object.values(st.f).filter(rangeActive).length + Object.values(st.t).filter(Boolean).length + (st.q.trim() ? 1 : 0);

    function readFilters() {
      const f = {};
      wrap.querySelectorAll('input[data-f]').forEach((inp) => {
        const k = inp.dataset.f;
        (f[k] = f[k] || { min: null, max: null })[inp.dataset.b] = num(inp.value);
      });
      st.f = f;
    }

    function syncFilterUi() {
      wrap.querySelectorAll('input[data-f]').forEach((inp) => {
        inp.classList.toggle('on', num(inp.value) != null);
      });
      const n = activeCount();
      const cb = $('[data-act=clear]');
      cb.hidden = n === 0;
      cb.textContent = 'پاک کردن فیلترها (' + L(n) + ')';
    }

    /* ---- view ---- */
    const dash = '<span class="dash">—</span>';
    const CELL = {
      idx: (r, i) => `<td class="idx">${L(i)}</td>`,
      title: (r) =>
        `<td><div class="nm">${r.img ? `<img src="${esc(r.img)}" alt="" loading="lazy" decoding="async">` : '<i></i>'}` +
        `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a>` +
        (hist ? `<button class="star${watched.has(r.id) ? ' on' : ''}" type="button" data-act="star" data-id="${esc(r.id)}" title="${watched.has(r.id) ? 'حذف از فهرست پیگیری' : 'افزودن به فهرست پیگیری'}">${watched.has(r.id) ? '★' : '☆'}</button>` : '') +
        '</div></td>',
      score: (r) => `<td class="num">${r.score == null ? dash : `<span class="rate">${svg('star', 14)}${fmtScore(r.score)}</span>`}</td>`,
      price: (r) => `<td class="num price">${fmt(r.price)}</td>`,
      old: (r) => `<td class="num old">${r.old == null ? dash : fmt(r.old)}</td>`,
      pct: (r) => `<td class="num">${r.pct ? `<span class="pill">${L(r.pct)}${PCT}</span>` : dash}</td>`,
      offAmt: (r) => `<td class="num">${r.offAmt == null ? dash : fmt(r.offAmt)}</td>`,
      unit: (r) => `<td class="nw">${r.unit ? `<b>${fmt(r.unit.v)}</b> <small>هر ${UNIT_LABEL[r.unit.u]}</small>` : dash}</td>`,
      seller: (r) => `<td>${r.seller ? esc(r.seller) : dash}</td>`,
      sellerRate: (r) => `<td class="num">${r.sellerRate == null ? dash : `<span class="rate">${svg('star', 14)}${fmtScore(r.sellerRate)}</span>`}</td>`,
      ship: (r) => `<td class="nw">${r.ship ? SHIP_LABEL[r.ship] : dash}</td>`,
      jet: (r) => `<td>${r.jet ? '<span class="jet">جت</span>' : dash}</td>`,
      stock: (r) => `<td class="nw">${r.stock == null ? dash : `<span class="low">تنها ${L(r.stock)} عدد</span>`}</td>`,
      dc: (r) => `<td><div class="dcb">${r.old && discountAcked() ? dcHtml(cachedCheck(r.id), true) : dash}</div></td>`,
    };
    const rowHtml = (r, i) => '<tr>' + cols.map((c) => CELL[c.key](r, i)).join('') + '</tr>';

    const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

    function currentList() {
      const q = st.q.trim().toLowerCase();
      const list = rows.filter((r) => (!q || r.title.toLowerCase().includes(q)) && passesRanges(r));
      list.sort(cmp);
      return list;
    }

    function groupsOf(list) {
      const g = GROUPERS[st.group];
      const map = new Map();
      for (const r of list) {
        const [order, label] = g.fn(r);
        if (!map.has(label)) map.set(label, { order, label, items: [] });
        map.get(label).items.push(r);
      }
      const all = [...map.values()].sort((a, b) => a.order - b.order);
      const main = all.filter((x) => x.order < 90);
      const rest = all.filter((x) => x.order >= 90);
      if (st.groupDesc) main.reverse();
      return [...main, ...rest];
    }

    let watched = new Set();
    function render() {
      watched = new Set(Object.keys(wlAll()));
      const list = currentList();
      $('[data-count]').textContent =
        (list.length !== rows.length ? L(list.length) + ' از ' + L(rows.length) : L(list.length)) + ' کالا';
      renderHead();
      syncFilterUi();

      if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="${cols.length}" class="empty">کالایی با این مشخصات پیدا نشد.</td></tr>`;
        return;
      }
      const out = [];
      if (st.group === 'none') {
        list.forEach((r, i) => out.push(rowHtml(r, i + 1)));
      } else {
        let i = 0;
        for (const g of groupsOf(list)) {
          const closed = st.collapsed.has(g.label);
          const ap = avg(g.items.map((r) => r.price));
          const ao = avg(g.items.filter((r) => r.pct).map((r) => r.pct));
          out.push(
            `<tr class="grp${closed ? ' closed' : ''}" data-g="${esc(g.label)}"><td colspan="${cols.length}"><div class="gh">` +
            `${svg('chevron', 18)}<b>${esc(g.label)}</b><span class="chip">${L(g.items.length)} کالا</span>` +
            `<span class="meta">میانگین قیمت ${fmt(ap)} تومان` +
            `${ao == null ? '' : ' · میانگین تخفیف ' + L(Math.round(ao)) + PCT}</span></div></td></tr>`
          );
          for (const r of g.items) { i++; if (!closed) out.push(rowHtml(r, i)); }
        }
      }
      tbody.innerHTML = out.join('');
    }

    /* ---- CSV (exports exactly what the table currently shows) ---- */
    function exportCsv() {
      const cell = (v) => {
        if (v == null) return '';
        const s = String(v);
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const list = currentList();
      const grouped = st.group !== 'none';
      const ccols = cols.filter((c) => c.key !== 'idx' && c.key !== 'dc');
      const CSV_VAL = {
        unit: (r) => (r.unit ? Math.round(r.unit.v) + ' / ' + UNIT_LABEL[r.unit.u] : null),
        ship: (r) => (r.ship ? SHIP_LABEL[r.ship] : null),
        jet: (r) => (r.jet ? 'جت' : null),
      };
      const head = ccols.map((c) => c.label).concat(['لینک']);
      if (grouped) head.push('گروه: ' + GROUPERS[st.group].label);
      const lines = [head.map(cell).join(',')];
      const push = (r, g) => {
        const row = ccols.map((c) => (CSV_VAL[c.key] ? CSV_VAL[c.key](r) : r[c.key])).concat([r.url]);
        if (grouped) row.push(g);
        lines.push(row.map(cell).join(','));
      };
      if (grouped) groupsOf(list).forEach((g) => g.items.forEach((r) => push(r, g.label)));
      else list.forEach((r) => push(r));
      const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'digikala-items-' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }

    /* ---- loading more items (the table opens with the first INITIAL_CAP items) ---- */
    let loading = false;
    let loadFailed = false;
    let closed = false;
    let stopCtl = null;

    function refreshBounds() {
      computeBounds();
      wrap.querySelectorAll('input[data-f]').forEach((inp) => {
        inp.placeholder = phText(inp.dataset.f, inp.dataset.b);
      });
    }

    // Looked up once: this runs after every fetched page, and the table can hold thousands of nodes.
    const mUi = {
      spin: $('[data-spin]'),
      more: $('[data-act=more]'),
      all: $('[data-act=all]'),
      stop: $('[data-act=stop]'),
      info: $('[data-more-info]'),
    };

    function syncMoreUi(liveCount) {
      const done = src.exhausted;
      mUi.spin.hidden = !loading;
      mUi.more.hidden = done;
      mUi.all.hidden = done;
      mUi.more.disabled = loading;
      mUi.all.disabled = loading;
      mUi.stop.hidden = !loading;
      let txt;
      if (loading) txt = 'در حال بارگذاری… ' + L(liveCount == null ? rows.length : liveCount) + ' کالا';
      else if (done) txt = 'همه کالاها بارگذاری شد · ' + L(rows.length) + ' کالا';
      else {
        txt = L(rows.length) + ' کالا بارگذاری شده';
        if (src.totalItems) txt += ' · حدود ' + L(src.totalItems) + ' کالا در این صفحه';
      }
      if (loadFailed && !loading) txt += ' · بارگذاری با خطا مواجه شد، دوباره تلاش کنید';
      mUi.info.textContent = txt;
    }

    async function loadMore(target) {
      if (loading || src.exhausted) return;
      loading = true;
      loadFailed = false;
      const ctl = { stopped: false, update: (n) => { if (!closed) syncMoreUi(n); }, close() {} };
      stopCtl = ctl;
      syncMoreUi();
      try {
        await src.load(target, ctl);
      } catch (err) {
        console.error('[MAH Digikala Extensions]', err);
        loadFailed = true;
      }
      loading = false;
      stopCtl = null;
      recordRows(rows);
      if (closed) return;
      refreshBounds();
      render();
      syncMoreUi();
    }

    /* ---- discount check for the rows on screen: up to DC_BATCH, one at a time ---- */
    const DC_BATCH = 100;
    let dcRun = null;
    async function checkDiscounts() {
      const btn = $('[data-act=dcheck]');
      if (dcRun) { dcRun.stopped = true; return; } // second press stops
      if (!(await ensureDiscountAck())) return;
      render();
      const todo = currentList().filter((r) => r.old && r.id && !cachedCheck(r.id)).slice(0, DC_BATCH);
      if (!todo.length) { btn.textContent = 'همه‌ی کالاهای تخفیف‌دار بررسی شده‌اند'; return; }
      const run = (dcRun = { stopped: false });
      for (let i = 0; i < todo.length && !run.stopped && !closed; i++) {
        btn.textContent = 'توقف بررسی (' + L(i + 1) + ' از ' + L(todo.length) + ')';
        try { await checkProduct(todo[i].id, obsFromRow(todo[i])); } catch (e) { /* skip this one */ }
        if (!closed) render();
        if (i < todo.length - 1) await sleep(1500);
      }
      dcRun = null;
      if (!closed) btn.textContent = 'بررسی تخفیف‌ها';
    }

    /* ---- events ---- */
    function close() {
      closed = true;
      if (stopCtl) stopCtl.stopped = true;
      if (dcRun) dcRun.stopped = true;
      document.removeEventListener('keydown', onKey, true);
      document.documentElement.style.overflow = prevOverflow;
      wrap.remove();
    }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
    document.addEventListener('keydown', onKey, true);

    const syncGroupUi = () => {
      const on = st.group !== 'none';
      wrap.querySelectorAll('[data-act=gorder],[data-act=collapse],[data-act=expand]').forEach((b) => (b.hidden = !on));
      $('[data-act=gorder]').textContent = 'ترتیب گروه‌ها: ' + (st.groupDesc ? 'نزولی' : 'صعودی');
    };

    wrap.addEventListener('click', (e) => {
      const th = e.target.closest('th[data-key]');
      if (th && !th.classList.contains('nosort')) { toggleSort(th.dataset.key, e.shiftKey); render(); return; }

      const gr = e.target.closest('tr.grp');
      if (gr) {
        const k = gr.dataset.g;
        st.collapsed.has(k) ? st.collapsed.delete(k) : st.collapsed.add(k);
        render();
        return;
      }
      const act = e.target.closest('[data-act]');
      const cp = $('.cp');
      if (!cp.hidden && !e.target.closest('.colpick')) { cp.hidden = true; $('[data-act=cols]').setAttribute('aria-expanded', 'false'); }
      if (!act) return;
      switch (act.dataset.act) {
        case 'cols':
          cp.hidden = !cp.hidden;
          act.setAttribute('aria-expanded', String(!cp.hidden));
          break;
        case 'close': close(); break;
        case 'csv': exportCsv(); break;
        case 'dcheck': checkDiscounts(); break;
        case 'star': {
          const r = rows.find((x) => x.id === act.dataset.id);
          if (!r) break;
          if (inWatchlist(r.id)) wlRemove(r.id);
          else wlAdd(r.id, { t: r.title, img: r.img, obs: obsFromRow(r) });
          render();
          break;
        }
        case 'gorder': st.groupDesc = !st.groupDesc; syncGroupUi(); render(); break;
        case 'collapse': groupsOf(currentList()).forEach((g) => st.collapsed.add(g.label)); render(); break;
        case 'expand': st.collapsed.clear(); render(); break;
        case 'more': loadMore(rows.length + LOAD_MORE_STEP); break;
        case 'all': loadMore(Infinity); break;
        case 'stop': if (stopCtl) stopCtl.stopped = true; break;
        case 'clear':
          wrap.querySelectorAll('input[data-f]').forEach((inp) => { inp.value = ''; });
          $('.q').value = '';
          wrap.querySelectorAll('input[data-tg]').forEach((inp) => { inp.checked = false; });
          st.q = '';
          st.f = {};
          st.t = {};
          st.collapsed.clear();
          render();
          break;
      }
    });

    $('[data-grp]').addEventListener('change', (e) => {
      st.group = e.target.value;
      st.collapsed.clear();
      syncGroupUi();
      render();
    });

    let t;
    $('.q').addEventListener('input', (e) => {
      clearTimeout(t);
      // Read the value now: inside the shadow DOM, e.target is retargeted to the
      // host once dispatch finishes, so it can't be read from the timeout callback.
      const input = e.currentTarget;
      t = setTimeout(() => { st.q = String(input.value || ''); render(); }, 150);
    });

    wrap.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.col) {
        updateSettings((s) => { s.table.cols[t.dataset.col] = t.checked; });
        applyCols();
        render();
      } else if (t.dataset.tg) {
        st.t[t.dataset.tg] = t.checked;
        st.collapsed.clear();
        render();
      }
    });

    // Range filters: Persian / Arabic / Latin digits and thousands separators are all accepted.
    let ft;
    wrap.addEventListener('input', (e) => {
      if (!e.target.matches || !e.target.matches('input[data-f]')) return;
      clearTimeout(ft);
      ft = setTimeout(() => { readFilters(); st.collapsed.clear(); render(); }, 150);
    });

    syncGroupUi();
    render();
    syncMoreUi();
  }

  /* ------------------------------------------------------------------ *
   * Theme: light / dark / system, for every page of the site
   *
   * Digikala's pages take their colours from CSS variables (--color-*) and the
   * site ships its own dark palette (--color-dark-*), so the dark theme maps the
   * light variables onto it. A few utility classes use white / black directly
   * and get their own override. The site's newer design-system components follow
   * its own data-dds-mode switch, which is set to "dark" as well.
   * ------------------------------------------------------------------ */
  const THEME_KEY = 'theme'; // saved choice: 'light' | 'dark' | 'system'
  const THEME_ATTR = 'data-mah-theme'; // set on <html> (and on the table's shadow host) to the resolved mode
  const THEME_STYLE_ID = 'mah-dk-theme-style';
  const THEME_BTN_ID = 'mah-dk-theme-btn';
  const THEME_ORDER = ['light', 'dark', 'system']; // what a click on the button cycles through
  const THEME_LABEL = { light: 'روشن', dark: 'تاریک', system: 'سیستم' };
  const THEME_ICON = { light: 'sun', dark: 'moon', system: 'monitor' };

  // Dark values for the site's light colour variables (mostly its own --color-dark-* palette).
  const DARK_TOKENS = {
    'neutral-000': '#222732', 'neutral-100': '#323641', 'neutral-200': '#424650', 'neutral-300': '#525660',
    'neutral-400': '#646770', 'neutral-500': '#767981', 'neutral-600': '#a3a5ab', 'neutral-650': '#d6d7db',
    'neutral-700': '#c2c3c7', 'neutral-800': '#ffffff', 'neutral-850': '#f1f1f2', 'neutral-900': '#ffffff',
    'app-background': '#0a101b', 'app-background-mid-dark': '#0d1421', 'app-background-dark': '#080d16',
    'hint-text-neutral': '#94969c', 'hint-text-error': '#ff6b7e', 'hint-text-success': '#7ccf80', 'hint-text-caution': '#ffb55a',
    'icon-black': '#e9eaee', 'icon-disable': '#424650', 'icon-high-emphasis': '#d6d7db',
    'button-disable': '#424650', 'button-black': '#e9eaee', 'button-text-black': '#0c0c0c', 'button-white': '#323641', 'button-text-white': '#ffffff',
    'primary-tonal': '#3a1f2a', 'background-caution': '#3a2a1c', 'background-success': '#1c3320', 'ai-background': '#25234a',
    'bg-expiring-points': '#3a2a1c', 'mission-background-active': '#3a331c', 'plus-50': '#35203a', 'plus-100': '#432a46',
    'plus-neutral': '#2a2840', 'mehr-50': '#17322d', 'secondary-100': '#1b2a3c', 'gradient-silver': '#2c303a', gray: '#3a3f4a',
    // gold / silver pages (/wealth/...) use another set of tokens
    'surface-1': '#222732', 'surface-2': '#1c212c', 'surface-3': '#2b303c', 'surface-4': '#323641', 'surface-canvas': '#151a24', 'surface-invert': '#3a3f4a',
    'content-1': '#f1f1f2', 'content-2': '#c4c5c9', 'content-3': '#9b9da3', 'content-4': '#7d8087', 'content-5': '#5a5d65',
    'border-1': '#323641', 'border-2': '#3d424e', 'border-3': '#525660',
    'primary-base': '#2da5a8', 'primary-tint': '#173a3a', 'primary-shade-1': '#5fc3c5', 'tertiary-base': '#e9eaee',
    'red-50': '#3a1f2a', 'green-50': '#1c3320', 'yellow-50': '#3a331c',
  };
  // Pages built with the design-system provider (accounts.digikala.com) set their colours in an inline style
  // (--dds_mode_*), so the dark values are forced with !important.
  const DDS_MODE_DARK = {
    border_1: '#323641', border_2: '#3d424e', border_3: '#525660',
    'brand_primary-tint': '#3a1f2a', 'brand_secondary-tint': '#1b2a3c',
    content_1: '#f1f1f2', content_2: '#c4c5c9', content_3: '#9b9da3', content_4: '#7d8087', content_invert: '#1f1f1f',
    hint_error_text: '#ff6b7e', hint_info_text: '#5fb4ee', hint_success_text: '#7ccf80', hint_warning_text: '#ffb55a',
    'states_border-focus': '#e9eaee', 'states_border-selected': '#e9eaee',
    'states_primary-plain-hover': '#3a1f2a', 'states_secondary-plain-hover': '#1b2a3c',
    'states_tertiary-plain-hover': 'rgba(255,255,255,0.06)', 'states_tonal-hover': 'rgba(255,255,255,0.06)', 'states_solid-hover': 'rgba(255,255,255,0.12)',
    surface_1: '#222732', surface_2: '#1c212c', surface_3: '#2b303c', surface_4: '#323641', surface_invert: '#3a4150',
    shadow_1: 'rgba(0,0,0,0.3)', shadow_2: 'rgba(0,0,0,0.45)', shadow_3: 'rgba(0,0,0,0.6)',
  };
  // The "-rgb" twins (used in rgba(...)) are only flipped for the light shades; the dark ones are used for dark overlays.
  const RGB_TWINS = new Set([
    'neutral-000', 'neutral-100', 'neutral-200', 'neutral-300', 'neutral-400', 'neutral-500',
    'app-background', 'app-background-mid-dark', 'app-background-dark',
  ]);

  function buildThemeCss() {
    const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ');
    let vars = 'color-scheme:dark;';
    for (const k of Object.keys(DARK_TOKENS)) {
      vars += '--color-' + k + ':' + DARK_TOKENS[k] + ';';
      if (RGB_TWINS.has(k)) vars += '--color-' + k + '-rgb:' + rgb(DARK_TOKENS[k]) + ';';
    }
    const D = 'html[' + THEME_ATTR + '="dark"]';
    // The design system re-declares its light tokens on elements carrying these attributes, so cover them as well.
    const scope = ['', ' [data-dds-style]', ' [data-dds-device]', ' [data-dds-theme]', ' [data-dds-mode]'].map((s) => D + s).join(',');
    const n0 = 'var(--color-neutral-000)';
    const n9 = 'var(--color-neutral-900)';
    return [
      scope + '{' + vars + '}',
      D + '{background-color:var(--color-app-background)}',
      // utilities that use white / black directly (they read --color-white / --color-black, which must stay as they are for text)
      D + ' .bg-white,' + D + ' .after\\:bg-white::after{background-color:' + n0 + '}',
      D + ' .\\!bg-white{background-color:' + n0 + '!important}',
      // Translucent white variants (e.g. sticky modal headers: bg-white/95)
      D + ' [class*="bg-white/"]{background-color:' + n0 + '!important}',
      '@media (min-width:1024px){' + D + ' .lg\\:bg-white{background-color:' + n0 + '}' +
        D + ' .lg\\:\\!bg-white{background-color:' + n0 + '!important}}',
      D + ' .before\\:to-white::before{--tw-gradient-to:' + n0 + '}',
      D + ' .text-black{color:' + n9 + '}',
      D + ' .\\!text-black{color:' + n9 + '!important}',
      D + ' .caret-black{caret-color:' + n9 + '}',
      D + ' .border-b-black{border-bottom-color:' + n9 + '}',
      // shades the site uses the other way round (light text on dark chips, dark chips with light text): keep their original colours
      D + ' .text-neutral-000{color:#fff}',
      D + ' .text-neutral-100{color:#f0f0f1}',
      D + ' .text-neutral-200{color:#e0e0e2}',
      D + ' .text-neutral-300{color:#c0c2c5}',
      D + ' .placeholder-neutral-100::placeholder,' + D + ' .placeholder-neutral-300::placeholder{color:var(--color-neutral-500)}',
      D + ' .bg-neutral-600{background-color:#62666d}',
      D + ' .bg-neutral-650{background-color:#424242}',
      D + ' .bg-neutral-700{background-color:#3f4064}',
      D + ' .bg-neutral-900{background-color:#0c0c0c}',
      // icons of the design system (<dds-icon>) painted with a "fixed" dark grey that ignores the theme
      ['neutral-70', 'neutral-80', 'neutral-90', 'black'].map((k) => D + ' dds-icon[color="fixed/' + k + '"]').join(',') + '{color:var(--color-icon-black)}',
      // sections whose tint comes from an inline (campaign) gradient
      D + ' [class*="__tinted"]{background:var(--color-neutral-100)!important}',
      // "review summary" pill on the product page: pale lavender with light text
      D + ' [class*="VariantInfo__summeryBage"]{background:rgba(99,102,241,.28)!important;color:#e6e7ff!important}',
      // brand logos are dark artwork: keep their cards light, like the product photos
      D + ' .bg-neutral-100.lg\\:\\!bg-white.p-1\\.5{background-color:#f1f2f4!important}',
      // fade-out over collapsed text (footer, category description)
      D + ' footer .seo::before,' + D + ' article [class*="__content"]::before{background-image:linear-gradient(rgba(34,39,50,0) 50%,' + n0 + ' 100%)}',
      // utilities with a hard-coded light colour (bg-[#f5f5f5] ...)
      ['f5f5f5', 'fafafa', 'f0f0f1'].map((h) => D + ' .bg-\\[\\#' + h + '\\]').join(',') + '{background-color:var(--color-neutral-100)}',
      ['fff', 'ffffff'].map((h) => D + ' .bg-\\[\\#' + h + '\\]').join(',') + '{background-color:' + n0 + '}',
      // login / sign-up pages (auth.digikala.com), which use their own hard-coded colours
      D + ' body{background-color:var(--color-app-background);color:var(--color-neutral-900)}',
      D + ' .dk-form-card{background-color:var(--color-neutral-000)!important;border-color:var(--color-neutral-200)!important}',
      D + ' .dk-form-card h1,' + D + ' .dk-form-card label,' + D + ' .dk-form-card legend{color:var(--color-neutral-900)!important}',
      D + ' .dk-form-card p,' + D + ' .dk-form-card .text-body-2,' + D + ' .dk-form-card .text-caption{color:var(--color-hint-text-neutral)!important}',
      D + ' .dk-form-card svg{fill:var(--color-icon-black);color:var(--color-icon-black)}',
      D + ' .dk-form-card input:not([type="submit"]):not([type="button"]),' + D + ' .dk-form-card select,' + D + ' .dk-form-card textarea{background-color:var(--color-neutral-000)!important;color:var(--color-neutral-900)!important;border-color:var(--color-neutral-300)!important}',
      D + ' .dk-form-card .dk-label{background-color:var(--color-neutral-000)!important}',
      D + ' .dk-form-card a{color:#4fc3dc!important}',
      // product page: buy box, mini buy box, seller rows (component styles with hard-coded white / light grey)
      D + ' [class*="__Marketable"]{background-color:' + n0 + '!important}',
      // sticky mini buy box (wide screens): the box itself only, not its parts (the colour swatch keeps its colour)
      // nor the V2 box, which uses the design-system colours. Its light gradient wash goes too.
      D + ' [class*="__MiniBuyBox"]:not([class*="MiniBuyBox__"]):not([class*="MiniBuyBoxV2"]){background-color:' + n0 + '!important;background-image:none!important}',
      D + ' [class*="MiniBuyBox__image"]{mix-blend-mode:normal!important}',
      D + ' [class*="InfoSection__buybox"]{background-image:none!important}',
      D + ' .bg-neutral-100[class*="MiniBuyBox"],' + D + ' [class*="SellerListItemDesktop__sellerListItem"]{background-color:var(--color-neutral-100)!important}',
      // dark tooltips (e.g. on "price chart"): white text on neutral-700, which the dark palette turns light grey.
      // Remapping the variables also recolours the border and the arrow; the white-background variant is fine as is.
      D + ' [class*="__Tooltip__tooltip"]:not([class*="--whiteBg"]){--color-neutral-700:#424650;--color-neutral-800:#646770}',
      // FAQ pages: header gradient and the contact box
      D + ' [class*="FqaHeaderLayout__wrapper"]{background-image:linear-gradient(var(--color-neutral-200),rgba(var(--color-neutral-000-rgb),0))!important}',
      D + ' main > .container-xl-w > .rounded-medium.border-complete{background-color:rgba(var(--color-neutral-100-rgb),.6)!important}',
      // seller landing page: a band that is deliberately inverted (black with white text) keeps its original colours
      D + ' [class*="__StatsBand"]{--color-neutral-900:#0c0c0c;--color-neutral-000:#fff;--color-neutral-000-rgb:255, 255, 255}',
      // contact page boxes (hard-coded #fafafa)
      D + ' [class*="ContactData"] .bg-neutral-100,' + D + ' [class*="__contactSection"]{background-color:var(--color-neutral-100)!important}',
      // images blended with "multiply" (made for a white card) would go almost black
      D + ' [class*="categoryCard__image"]{mix-blend-mode:normal!important}',
      // search suggestion chips (they use --color-white, which must stay white for text)
      D + ' [class*="__ChipWrapper"]{background-color:var(--color-neutral-100)}',
      D + ' [class*="__ChipWrapper"]:hover{background-color:var(--color-neutral-200)}',
      // gold / silver tabs (/wealth/...): gradient backgrounds with hard-coded white
      ...[
        ['unsel', '#2b303c', '#2b303c', 'conic-gradient(from 0deg,var(--color-border-2),var(--color-border-2),var(--color-border-2))'],
        ['gold-sel', '#2b303c', '#3a331c', 'conic-gradient(from 0deg,var(--color-secondary-base),var(--color-secondary-base),var(--color-secondary-base))'],
        ['silver-sel', '#2b303c', '#1f2a3c', 'conic-gradient(from 0deg,#7D93AA,#7D93AA,#7D93AA)'],
        ['gold-anim', '#2b303c', '#3a331c', 'conic-gradient(from var(--gold-angle),var(--color-secondary-base),var(--gold-mid),var(--color-secondary-base))'],
        ['silver-anim', '#2b303c', '#1f2a3c', 'conic-gradient(from var(--silver-angle),#7D93AA,var(--silver-mid),#7D93AA)'],
      ].map(([k, c1, c2, ring]) => D + ' .asbtn-' + k + '{background:linear-gradient(90deg,' + c1 + ' 0%,' + c2 + ' 100%) padding-box,' + ring + ' border-box!important}'),
      D + ' .asbtn-unsel:hover{background:linear-gradient(90deg,#323641 0%,#323641 100%) padding-box,conic-gradient(from 0deg,var(--color-border-2),var(--color-border-2),var(--color-border-2)) border-box!important}',
      // header search box: hover colour, keyboard-shortcut chip, hovered suggestions
      D + ' [class*="SearchInputDesktop"]:not([class*="isOpen"]):hover{background-color:var(--color-neutral-200)!important}',
      D + ' [class*="shortcutBox"]{background-color:var(--color-neutral-300)!important;color:var(--color-neutral-900)}',
      D + ' [class*="fallbackSearchItem"]:hover,' + D + ' [class*="searchResultItem"]:hover{background-color:rgba(255,255,255,.06)}',
      // search suggestions: hard-coded near-black text, light grey dividers, a dark-blue category hint,
      // and thumbnails blended with "darken" (made for a white list)
      D + ' [class*="__searchResultItem"] [class*="__contentSection"]{border-bottom-color:var(--color-neutral-200)!important}',
      D + ' [class*="__searchResultItem"] [class*="__title"]:not([class*="__titleHighlight"]),' + D + ' [class*="__fallbackSearchItemTitle"]{color:var(--color-neutral-900)!important}',
      D + ' [class*="__searchResultItem"] [class*="__titleHighlight"]{color:var(--color-neutral-600)!important}',
      D + ' [class*="__searchResultItem"] [class*="__subtitle"]{color:#5fb4ee!important}',
      D + ' [class*="__searchResultItem"] [class*="__image"]{mix-blend-mode:normal!important}',
      // Digikala Plus modal: selected plan (hard-coded #fffaff)
      D + ' [class*="plan--selected"]{background-color:var(--color-plus-50)!important}',
      // accounts.digikala.com: provider variables (inline) and the "fixed white" card background
      D + ' [style*="--dds_mode_"]{' + Object.keys(DDS_MODE_DARK).map((k) => '--dds_mode_' + k + ':' + DDS_MODE_DARK[k] + '!important').join(';') + '}',
      D + ' .text-\\[\\#934c0e\\]{color:#ffb55a}',
      D + ' .bg-dds-fixed-white{background-color:var(--dds_mode_surface_1)!important}',
      // category list of the mega menu (hard-coded light grey): darker than the active row
      D + ' [class*="MainMegaMenu__mainCategoriesSection"]:not([class*="SectionItem"]){background-color:#151a24!important}',
      // grey partner logos in the footer
      D + ' footer [class*="partnersSectionItem"] img{filter:brightness(0) invert(1);opacity:.75}',
    ].join('\n');
  }

  let themePref = null; // in-memory copy of the choice (keeps working when storage is blocked)

  function readTheme() {
    if (themePref) return themePref;
    const v = store.get(THEME_KEY);
    return THEME_ORDER.indexOf(v) !== -1 ? v : 'system';
  }
  const systemPrefersDark = () => !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  // With the theme feature turned off the site keeps its own (light) look.
  const currentMode = () => {
    if (!feature('theme')) return 'light';
    const pref = readTheme();
    return pref === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : pref;
  };

  let ddsOriginal; // the page's own data-dds-mode, remembered while dark is forced (undefined = not touched)

  function applyTheme() {
    const html = document.documentElement;
    if (!html) return;
    const mode = currentMode();

    if (!document.getElementById(THEME_STYLE_ID)) {
      const st = document.createElement('style');
      st.id = THEME_STYLE_ID;
      st.textContent = buildThemeCss();
      html.appendChild(st);
    }
    if (html.getAttribute(THEME_ATTR) !== mode) html.setAttribute(THEME_ATTR, mode);

    // The site's own design-system switch, for its newer components.
    const dds = html.getAttribute('data-dds-mode');
    if (mode === 'dark') {
      if (dds !== 'dark') {
        if (ddsOriginal === undefined) ddsOriginal = dds;
        html.setAttribute('data-dds-mode', 'dark');
      }
    } else if (ddsOriginal !== undefined) {
      if (ddsOriginal === null) html.removeAttribute('data-dds-mode');
      else html.setAttribute('data-dds-mode', ddsOriginal);
      ddsOriginal = undefined;
    }

    applyVTheme();

    // our shadow hosts (table and dialogs, product-page strip, chart section) follow the page
    for (const hid of [HOST_ID, STRIP_ID, MODAL_SEC_ID]) {
      const host = document.getElementById(hid);
      if (host && host.getAttribute(THEME_ATTR) !== mode) host.setAttribute(THEME_ATTR, mode);
    }
    syncThemeButton();
  }

  /* The hyper-market (/supermarket/...) has its own palette: utility classes such as bg-v3-achromatic-white or
     text-v2-object-high_em with fixed RGB values. Dark versions of them are generated from the loaded stylesheets. */
  const V_SEL = /^\.((?:[\w-]+\\:)*)(bg|text|border|divide|fill|stroke)-v[23]-(?:[^\s:\\]|\\.)+(?::[\w-]+)*(?: > :not\(\[hidden\]\) ~ :not\(\[hidden\]\))?$/;
  const V_PROP = { bg: 'background-color', text: 'color', border: 'border-color', divide: 'border-color', fill: 'fill', stroke: 'stroke' };
  const V_STYLE_ID = 'mah-dk-theme-v3';
  let vSheetCount = -1;

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn, sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, sat, l];
  }
  function hslToCss(h, s, l, a) {
    const f = (n) => {
      const k = (n + h / 30) % 12;
      return Math.round(255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return a < 1 ? 'rgba(' + f(0) + ',' + f(8) + ',' + f(4) + ',' + a + ')' : 'rgb(' + f(0) + ',' + f(8) + ',' + f(4) + ')';
  }
  // light colour -> dark counterpart (kind: bg | text | border ...); dark stays dark, brand colours stay as they are
  function darkColor(kind, value) {
    if (!value || /var\(|inherit|currentcolor|transparent/i.test(value)) return null;
    const n = value.match(/[\d.]+/g);
    if (!n || n.length < 3) return null;
    const a = n.length > 3 ? +n[3] : 1;
    if (a === 0) return null;
    let [h, s, l] = rgbToHsl(+n[0], +n[1], +n[2]);
    const grey = s < 0.15;
    if (kind === 'bg') {
      if (l < 0.5) return null;
      if (grey) { h = 222; s = 0.17; l = 0.17 + (1 - l) * 0.6; }
      else if (l > 0.8) { s *= 0.5; l = 0.2; }
      else return null;
    } else if (kind === 'border' || kind === 'divide') {
      if (l < 0.5) return null;
      if (grey) { h = 222; s = 0.12; l = 0.25 + (1 - l) * 0.8; }
      else if (l > 0.8) { s *= 0.5; l = 0.28; }
      else return null;
    } else { // text, fill, stroke
      if (grey) { if (l >= 0.8) return null; h = 222; s = 0.08; l = l < 0.55 ? 0.97 - l * 0.55 : Math.max(l, 0.62); }
      else if (l < 0.4) l = 0.72;
      else return null;
    }
    return hslToCss(h, s, l, a);
  }

  function buildVCss() {
    let css = '';
    const emit = (rule) => {
      const sel = rule.selectorText;
      if (!sel || sel.indexOf(',') !== -1) return '';
      const m = sel.match(V_SEL);
      if (!m) return '';
      const kind = m[2], prop = V_PROP[kind];
      const c = darkColor(kind, rule.style.getPropertyValue(prop));
      return c ? 'html[' + THEME_ATTR + '="dark"] ' + sel + '{' + prop + ':' + c + '}\n' : '';
    };
    const walk = (list) => {
      for (const rule of list) {
        if (rule.cssRules && !rule.selectorText) {
          if (rule.conditionText !== undefined) {
            let inner = '';
            for (const r of rule.cssRules) inner += r.selectorText ? emit(r) : '';
            if (inner) css += '@media ' + rule.conditionText + '{' + inner + '}\n';
          }
        } else css += emit(rule);
      }
    };
    for (const sh of document.styleSheets) {
      let rules;
      try { rules = sh.cssRules; } catch (e) { continue; } // cross-origin sheet
      if (rules) walk(rules);
    }
    return css;
  }

  function applyVTheme() {
    if (document.documentElement.getAttribute(THEME_ATTR) !== 'dark') return;
    const count = document.styleSheets.length;
    if (count === vSheetCount) return;
    vSheetCount = count;
    let st = document.getElementById(V_STYLE_ID);
    if (!st) {
      st = document.createElement('style');
      st.id = V_STYLE_ID;
      document.documentElement.appendChild(st);
    }
    st.textContent = buildVCss();
  }

  function cycleTheme() {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(readTheme()) + 1) % THEME_ORDER.length];
    themePref = next;
    store.set(THEME_KEY, next);
    applyTheme();
  }

  function syncThemeButton() {
    const btn = document.getElementById(THEME_BTN_ID);
    if (!btn) return;
    const pref = readTheme();
    if (btn.getAttribute('data-pref') === pref) return;
    btn.setAttribute('data-pref', pref);
    btn.innerHTML = svg(THEME_ICON[pref], 20);
    const label = 'حالت نمایش: ' + THEME_LABEL[pref];
    btn.title = label + ' (برای تغییر کلیک کنید)';
    btn.setAttribute('aria-label', label);
  }

  function initTheme() {
    applyTheme();
    const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    if (mq) {
      const onChange = () => { if (readTheme() === 'system') applyTheme(); };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
    // keep other open Digikala tabs (on any subdomain) in sync
    store.watch(THEME_KEY, () => { themePref = null; applyTheme(); });
  }

  /* ------------------------------------------------------------------ *
   * Price comparison (product pages): Torob / Emalls / BaSalam / foreign shops
   * Cross-origin requests go through GM_xmlhttpRequest (see @connect above).
   * ------------------------------------------------------------------ */
  const CMP_BTN_ID = 'mah-dk-cmp-btn';
  const USD_KEY = 'usdManual'; // the user's own dollar rate in Tomans (absent = use the automatic rate)
  const productId = () => (location.pathname.match(/^\/product\/dkp-(\d+)/) || [])[1] || null;

  const CMP_TABS = [
    { key: 'torob', label: 'Torob', logo: 'torob' },
    { key: 'emalls', label: 'Emalls', logo: 'emalls' },
    { key: 'basalam', label: 'BaSalam', logo: 'basalam' },
    { key: 'foreign', label: 'خارجی' },
  ];
  // the tabs the user has not turned off in the settings
  const cmpTabs = () => CMP_TABS.filter((t) => settings().shops[t.key] !== false);

  // Site icons (their own favicons, shrunk to ~18-24px) as data URLs, so nothing is loaded from those sites to draw the UI.
  const LOGOS = {
    torob: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAACVUlEQVR4AaSTsW7UQBCGf1+SIg0RVcodQRGFN4AU3ihS3oAGKPYKJDoKHsDrB6Cgo+LWEtDkDZCirIvAI0QpQLtlKhQailzO/LNnXRFBUuDztzOe+ef33p09wY1jGIaKPCIvyQfSj8wYtaa96sYYVkYUrZH7FLwjx0TjC8a9keeMWis91ZI11spZjMbCDiufySvkvI2u28S03cjT6ZqCtt3o+26z7afbRQOodmecXe3oHptvySFNNrLzVfYBOQYgpkJOCSEFCFB1maa5OwSgMzqLCR31+7YsHtBk0luHFCMSJxACTBzxHiKCxE9MAUDSb3PApFUPvdjlxVOarPfOsZ8gzqE+OYGpa8CYFU09gxULFwXiE3SmzAK7aqQ/5laOsUJKoBJm1rD/97M2DSQJEBPhDLBF5Z4aPWGyXhpMxDmut5/GuaVAzYB1XjyecHlAGHkHJkYs1ztOkVFQZjiLh7qMxf8LavSDFguIALxBThF3HiktJSIaF1y+q9FXJnNYCwi9PP/ajFuPrBpVCGeAOdNvanTK5NKIDGItnRJyaPHPY8peSrypAFYG6i7JqRqdMTni8zI33gMixQx9jyXcXk+6Dnl/HzlGgBITqDVGd3ME4GxSVZW66oNzTLNFHQPrguz8iGMknnVuBFZgQoBqKdQXuFEP3RGv8YvLG/KFgivjm0HvaJyFsSOaBw/j/aCaogV0RmdRjOh4zcY5eUbew+ACdf0bTXOFWXNd0FxrxlwUDaDa83F2acQGtEB+Mn9N9GXU+JG5/hnKJ+ZaKz3VEt0Ay8AfAAAA///a5EpFAAAABklEQVQDAF67D/Ue9BhSAAAAAElFTkSuQmCC',
    emalls: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAACeklEQVR4AcSUz0uUQRjHv8/MuvuuP0JMBfVgEHQJqltdhAgkVstD9K4RUSFKCFFIUFQUFkSHDnaJ0GAhSmktO1hu4SEEO+QfEAQFa3RKjAJ/re6+8zTvsslOuu/uS4Qv83nnnXeemc/MvO+MwH++tk7AzMTJpMVzc5UlwRzcbDE2zIBtO8x2W6sTPfJOXT0/ry50/SiJE0e/sN3e7g4sX2QIkmcPWooXzylCnIhboNiCUrI0nEZlWR14PmAVFOxYkLtI0BUdsE3jP0kRRKrWGLRRUIoOM1Dvv+dsC9YzXcH8vMqWcjdDIMDvmfGGdO4XBo2rleU4+vpSub6zmSHA3pYZCec0hZyoXxbLqDuwe/806Y+X7Tl3MwWzU/pXozqkAo1epNeoAUsySE8m5/5QPTLxk/r7jeVxHYZArVZ1MYlpRZjxQio5wwF6zZ2RnW4nXhgCqqo6xkCtblDmCSGo4/Y4wAEd55mEUcsiYJSLF2SxEENAq8ufijXIq09LRyTzyps+GgKsLd7RUbeYEIMXwBArdQY1TR90vGcyBPRs8psYTdyW8USP8GI00StfvI1jaCijvwW5FLIYgqWO1kbVGbmojrddV3bkmh8cO9LL9qGmv0WGwBLqFBh3IXADRDf9gXsoq+zhwUH3D1z3GALB/BlwZ6wV8AkjpIKhZoTDerNi/TIEqAhP6fV8pWs37Ej9rnjKHhPfjThTMDLxK53BZR0xBn3qaYQPHCwvzcJqLnzYEcDhl4mvcjRxMlNevk9U1/SgvuFSKYi67d2iQg5QNKo3uB5iLpkzyL10s9DjsY/0aDgmH8TulwI9HH5KsfEFt20+BQX5Qf/y/BsAAP//AJfJLgAAAAZJREFUAwAxr6dAu0uFSQAAAABJRU5ErkJggg==',
    basalam: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAACVUlEQVR4AXSTPWsUQRjHfzPhchCwFouwk0pL0UZIsWNai4CdFnH9Bn6EzTfwI5wW2gkWtsldEbBRLBWEmyVFSC0IlyM3/p+5vJj1HOaZeeb5v+zs7Kyn175v3701fRx2p3V4k2L4meowK6HcaoYZpyfjyiiDTzs8GA5mn9yCd87xjMwWjvUSyq1mmHGMa5pLQ2+JFbqamkX10cEjCTdUH2guuHIucqttFI64pjEtaoXY7XAfV70Fd4fAoGpaCIF+q5oGYrTyAONKU7SAt/fNi/Aa3G1gjSBijFRRIhVudNWWDynVNaQxrXn44fpsx2UeAnqKxpQ0WL+YY4QQrABprDlp1rTsA9Oah2fBU73/0sTAlOiaSDca2QrbgYUturYV1lh6HU4bkIfXl9gms3aN9DIZX+2oB5WltObhZbKpHflSXDWYUVVBCKtQijaz+X8D1GKEEJSgw1destWDl+OxdrX4B5a+nE1dL6EQlnN/zDplx7HPmSOZnfdxEnStDv3lFp1F27KyOc7Nw+P5oB3NV5JkxmWg12saqpGuQPxrd5m5efjZ2fAgO76Id8OsMpGCGCHqgrYtvGggJUhJ9NLnpjUPf+/oxy/n0yvIp4KWrxiUhViEVdNiQa31RHdsJMMkHMTNp6Y1D2+l6oBv5G5PZiegrYrYtQ3dfgvjUYluX+u2gZREEYd8oiPZK1pVipFD//2ECb7b1d/8WYTfwuYcjhd2wy04TPZl54YVjrjVpJuYVlwdk40KK4QDvs7mwyfZ81xf4j2OKZmzEsqtZphxjGsaSUv/AwAA//93EjW1AAAABklEQVQDAJmK9jdg07giAAAAAElFTkSuQmCC',
    amazon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAABz0lEQVR4AeyTvy8lcRTFPzPxF1BLdqtt2WQrzUpWa3ej2a2Wl6wCCZVK4kkoUCBBQfxsNCRoSVCoFI+OikRNVDQvxjmPN5OXIIapxMu9M/d7595zzr3zJuThF7VSF+VYlV/Io1e6e1eN9QBLiSBqo13RgZIt8mr5a829LcaSwP8GCUtsAVM6VMmzMmNNGzsUW59QndAtU6sytlfUmClsJVijCby3ynR2p2oTZAf3CNIHQeVSauug/ifUfIrzyYqa++FHd/wgdZBbgCb1N+fh71jcnhBsTUBDK/QX4Mv3uODFwf4iHO+C79dXcVtCcKPkiD6J80Po3YHhU/gjJR65VqPHLQpqtALnGv7d11iUlZ/swddfsDGgontLCHw2yXwbmOhEapp6oGsd8ppqLoKyj4jcuZxUe9rtcRiVOCtfUc/FmdFKXklQSulicBP1foZJK9JePbrzBRE6NlC+Hgbk+0tqklng+ZGCxB4nKD+3ksIGbGpkE3qyyd/geFvvzOss1z5xf57giaY06fdBcJlm5JS1l16R/vQp215evhNyy6Dqi/KsrUiRoTBY5JCITtBRl4zMgjuCZQpeEcECM5rkm8DX5G95J+5dM1Ywz6ywuAMAAP//G7Iq1gAAAAZJREFUAwCxiqZFAeVytwAAAABJRU5ErkJggg==',
    ebay: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAuElEQVR4AeyQsQ4BURREJ6+lF9FKdAqVH5Bo/YOvUEoo/IBGoVVJNPQalcI/iKjRYiY23pBXrUKzm3vy5s7s3tx9AemnQXtNLhnS8th+VmpAna9syYpUM6TlKaMVKzVgwnhIpuSaIT2iVsYjVmpAh/GcfNeChjIesTTgwdYps9e/uyd9oq9M+o0G0M9f4dhqw0H/AOe2DHDGmwqc3zfIv/zry2IDINT2OziYNeGUenc4g+4Zzv8v8QkAAP//33bv4gAAAAZJREFUAwAU60gRnr5xGAAAAABJRU5ErkJggg==',
  };
  const logoImg = (k) => (LOGOS[k] ? `<img class="lg" src="${LOGOS[k]}" alt="" width="16" height="16">` : '');

  const FOREIGN_STORES = [
    { key: 'amz-com', name: 'Amazon.com', origin: 'https://www.amazon.com', kind: 'amazon', cur: 'USD', logo: 'amazon' },
    { key: 'amz-ae', name: 'Amazon.ae (امارات)', origin: 'https://www.amazon.ae', kind: 'amazon', cur: 'AED', logo: 'amazon' },
    { key: 'amz-tr', name: 'Amazon.com.tr (ترکیه)', origin: 'https://www.amazon.com.tr', kind: 'amazon', cur: 'TRY', logo: 'amazon' },
    { key: 'amz-de', name: 'Amazon.de (آلمان)', origin: 'https://www.amazon.de', kind: 'amazon', cur: 'EUR', logo: 'amazon' },
    { key: 'ebay', name: 'eBay', origin: 'https://www.ebay.com', kind: 'ebay', cur: 'USD', logo: 'ebay' },
  ];

  /* ---------- network ---------- */
  function gmGet(url, timeout = 20000) {
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          timeout,
          headers: { Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.9,fa;q=0.8' },
          onload: (r) => (r.status >= 200 && r.status < 300 ? resolve(r.responseText) : reject(new Error('HTTP ' + r.status))),
          onerror: () => reject(new Error('خطای شبکه')),
          ontimeout: () => reject(new Error('پایان زمان انتظار')),
        });
      });
    }
    return fetch(url).then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });
  }
  const gmJson = (url) =>
    gmGet(url).then((t) => {
      try { return JSON.parse(t); } catch (e) { throw new Error('پاسخ نامعتبر'); }
    });
  const errText = (e) => String((e && e.message) || e || 'خطای ناشناخته');

  /* ---------- product name -> search queries + matcher ---------- */
  const FILLER = new Set(['مدل', 'کالا', 'برای', 'همراه', 'با', 'به', 'و', 'از', 'در', 'دارای', 'بدون', 'قابلیت', 'ظرفیت', 'رنگ', 'مناسب']);
  const CUT_WORDS = new Set(['بدون', 'با', 'دارای', 'مناسب', 'همراه']);
  const LATIN_STOP = new Set(['usb', 'type-c', 'type', 'with', 'and', 'for', 'the', 'ai-enhanced', 'calls']);
  const normFa = (s) => String(s || '').replace(/ي/g, 'ی').replace(/ك/g, 'ک');
  const keyOf = (s) => normFa(latin(s)).toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, '');
  // alphanumeric tokens of a name, as a Set (exact-token matching: "a3949" must not match "a39491")
  const tokenSet = (s) => {
    const t = new Set();
    String(s || '').replace(/[۰-۹٠-٩]/g, (d) => (FA.indexOf(d) >= 0 ? FA.indexOf(d) : AR.indexOf(d)))
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .forEach((x) => x && t.add(x));
    return t;
  };

  function analyzeName(fa, en) {
    const seg = String(fa || '').split(/[،,]/)[0].trim();
    const raw = ((en ? en + ' ' : '') + seg).match(/[A-Za-z0-9][A-Za-z0-9.+\-_/]*/g) || [];
    const toks = [];
    const seen = new Set();
    for (let t of raw) {
      t = t.replace(/[.\-_/+]+$/, '');
      if (!t || seen.has(t.toLowerCase())) continue;
      seen.add(t.toLowerCase());
      toks.push(t);
    }
    const isModel = (t) => /\d/.test(t) && /[A-Za-z]/.test(t) && t.length >= 2;
    const model = toks.filter(isModel);
    const latinWords = toks.filter((t) => isModel(t) || (/^[A-Za-z]{2,}$/.test(t) && !LATIN_STOP.has(t.toLowerCase())));
    const latinQuery = latinWords.slice(0, 6).join(' ');

    const words = seg.split(/\s+/).filter(Boolean);
    const cut = words.findIndex((w, i) => i > 1 && CUT_WORDS.has(w));
    const persianQuery = (cut > 0 ? words.slice(0, cut) : words).slice(0, 9).join(' ');
    const sig = words.filter((w) => /[؀-ۿ]/.test(w) && w.length >= 3 && !FILLER.has(w)).slice(0, 6).map(keyOf);

    const iranQueries = [];
    if (model.length && latinQuery) iranQueries.push(latinQuery);
    if (persianQuery && !iranQueries.includes(persianQuery)) iranQueries.push(persianQuery);
    if (!iranQueries.length && latinQuery) iranQueries.push(latinQuery);
    return { seg, model: model.map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, '')), latinWords: latinWords.map((t) => t.toLowerCase()), words: sig, latinQuery, persianQuery, iranQueries };
  }

  // 0..1: share of the model tokens (e.g. "r50i", "a3949") found in a foreign listing title.
  // Marketplace titles are often cut off or translated, so a partial hit is kept as an approximate match.
  function foreignScore(info, name) {
    const ts = tokenSet(name);
    if (info.model.length) return info.model.filter((m) => ts.has(m)).length / info.model.length;
    const lw = info.latinWords.slice(0, 3).map((w) => w.replace(/[^a-z0-9]/g, ''));
    return lw.length && lw.every((w) => ts.has(w)) ? 1 : 0;
  }

  function makeMatcher(info, foreign) {
    return (name) => {
      const ts = tokenSet(name);
      if (info.model.length) return info.model.every((m) => ts.has(m));
      if (foreign) {
        const lw = info.latinWords.slice(0, 3).map((w) => w.replace(/[^a-z0-9]/g, ''));
        return lw.length > 0 && lw.every((w) => ts.has(w));
      }
      if (!info.words.length) return false;
      const k = keyOf(name);
      return info.words.filter((w) => k.includes(w)).length / info.words.length >= 0.7;
    };
  }

  /* ---------- prices ---------- */
  const rangeText = (lo, hi) => (Math.round(lo) === Math.round(hi) ? fmt(lo) + ' تومان' : 'از ' + fmt(lo) + ' تا ' + fmt(hi) + ' تومان');

  function normNumber(s) {
    const hasDot = s.includes('.');
    const hasCom = s.includes(',');
    if (hasDot && hasCom) {
      return s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    }
    if (hasCom) return /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    if (hasDot) return /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : s;
    return s;
  }
  const CUR_SYMBOLS = [[/€/, 'EUR'], [/£/, 'GBP'], [/₺/, 'TRY'], [/د\.إ/, 'AED'], [/\$/, 'USD']];
  function parsePrice(text, dflt) {
    const t = String(text || '').replace(/ /g, ' ');
    const m = t.match(/\d[\d.,]*/);
    if (!m) return null;
    const amount = parseFloat(normNumber(m[0].replace(/[.,]+$/, '')));
    if (!(amount > 0)) return null;
    let cur = (t.match(/\b(USD|EUR|AED|TRY|GBP|CAD|AUD|SAR)\b/) || [])[1];
    if (!cur && /\bTL\b/.test(t)) cur = 'TRY';
    if (!cur) for (const [re, c] of CUR_SYMBOLS) if (re.test(t)) { cur = c; break; }
    return { amount, cur: cur || dflt };
  }

  let ratesP = null;
  function getRates() {
    if (!ratesP) {
      ratesP = gmJson('https://open.er-api.com/v6/latest/USD').then((j) => j.rates || null).catch(() => { ratesP = null; return null; });
    }
    return ratesP;
  }
  function manualRate() {
    const v = parseFloat(store.get(USD_KEY));
    return v > 0 ? v : null;
  }
  function setManualRate(value) {
    const v = parseFloat(latin(value));
    if (v > 0) store.set(USD_KEY, v);
    else store.del(USD_KEY);
  }
  const usdToman = (s) => manualRate() || (s.rates && s.rates.IRR ? s.rates.IRR / 10 : null);
  function toToman(s, amount, cur) {
    const rate = usdToman(s);
    if (!rate) return null;
    let usd = amount;
    if (cur !== 'USD') {
      const r = s.rates && s.rates[cur];
      if (!r) return null;
      usd = amount / r;
    }
    return usd * rate;
  }

  /* ---------- runners: each returns { items, searchUrl } ---------- */
  const uniqBy = (arr, f) => { const s = new Set(); return arr.filter((x) => { const k = f(x); if (s.has(k)) return false; s.add(k); return true; }); };

  async function runTorob(s) {
    for (const q of s.info.iranQueries) {
      const j = await gmJson('https://api.torob.com/v4/base-product/search/?q=' + encodeURIComponent(q) + '&page=0&size=24');
      const hits = uniqBy(
        (j.results || []).filter((r) => (r.name1 || r.name2) && (s.match(r.name1) || s.match(r.name2))),
        (r) => r.web_client_absolute_url || r.more_info_url
      ).slice(0, 3);
      if (!hits.length) continue;
      const items = await Promise.all(hits.map(async (r) => {
        let lo = r.price;
        let hi = r.price;
        let shops = r.shop_text || '';
        try {
          const d = await gmJson(r.more_info_url);
          if (d.min_price > 0) lo = d.min_price;
          if (d.max_price > 0) hi = d.max_price;
          const n = d.products_info && d.products_info.result && d.products_info.result.length;
          if (n) shops = 'در ' + L(n) + ' فروشگاه';
        } catch (e) { /* keep the price from the search result */ }
        return { title: r.name1 || r.name2, lo, hi: Math.max(lo, hi), meta: shops, url: 'https://torob.com' + (r.web_client_absolute_url || '') };
      }));
      return { items: items.filter((i) => i.lo > 0), searchUrl: 'https://torob.com/search/?query=' + encodeURIComponent(q) };
    }
    return { items: [], searchUrl: 'https://torob.com/search/?query=' + encodeURIComponent(s.info.iranQueries[0] || '') };
  }

  const listingItems = (rows, searchUrl, what) => {
    rows.sort((a, b) => a.price - b.price);
    if (!rows.length) return [];
    const lo = rows[0].price;
    const hi = rows[rows.length - 1].price;
    return [{ head: true, title: 'محدوده‌ی قیمت در ' + L(rows.length) + ' ' + what, lo, hi, url: '' }].concat(
      rows.slice(0, 5).map((r) => ({ title: r.title, lo: r.price, hi: r.price, meta: r.seller, url: r.url }))
    );
  };

  async function runEmalls(s) {
    let searchUrl = '';
    for (const q of s.info.iranQueries) {
      searchUrl = 'https://emalls.ir/' + encodeURIComponent('لیست-قیمت') + '~skey~' + encodeURIComponent(q);
      const doc = new DOMParser().parseFromString(await gmGet(searchUrl), 'text/html');
      const rows = [];
      doc.querySelectorAll('.product-block').forEach((e) => {
        const title = ((e.querySelector('.prd-name') || {}).textContent || '').trim();
        const price = num((e.querySelector('.prd-price') || {}).textContent);
        if (!title || !(price > 0) || !s.match(title)) return;
        const txt = e.textContent.replace(/\s+/g, ' ').trim();
        const sm = txt.match(/خرید[‌\s]*از\s+(.+)$/);
        const cm = txt.match(/فروشندگان\s*\(([^)]+)\)/);
        // product pages are plain links; store listings keep their (reversed) target in data-esrever, which the site's own JS opens on click
        const tok = (e.querySelector('[data-esrever]') || { getAttribute: () => '' }).getAttribute('data-esrever');
        const href = (e.querySelector('a[href]') || { getAttribute: () => '' }).getAttribute('href') || (tok ? [...tok].reverse().join('') : '');
        let url = '';
        try { url = href ? new URL(href, 'https://emalls.ir').href : ''; } catch (err) { url = ''; }
        rows.push({ title, price, seller: sm ? sm[1].trim() : cm ? cm[1].trim() + ' فروشنده' : '', url });
      });
      if (rows.length) return { items: listingItems(rows, searchUrl, 'آگهی'), searchUrl };
    }
    return { items: [], searchUrl };
  }

  async function runBasalam(s) {
    let searchUrl = '';
    for (const q of s.info.iranQueries) {
      searchUrl = 'https://basalam.com/search?q=' + encodeURIComponent(q);
      const j = await gmJson('https://search.basalam.com/ai-engine/api/v2.0/product/search?q=' + encodeURIComponent(q) + '&from=0&size=24');
      const rows = [];
      for (const p of j.products || []) {
        const price = p.price / 10; // Rials -> Tomans
        if (!p.name || !(price > 0) || !s.match(p.name)) continue;
        const v = p.vendor || {};
        rows.push({
          title: String(p.name).trim(),
          price,
          seller: v.name || v.title || '',
          url: v.identifier ? 'https://basalam.com/' + v.identifier + '/product/' + p.id : 'https://basalam.com/p/' + p.id,
        });
      }
      if (rows.length) return { items: listingItems(rows, searchUrl, 'کالا'), searchUrl };
    }
    return { items: [], searchUrl };
  }

  // Google snippet fallback: "IRR 34,286,000 to IRR 260,000,000" (Rials -> Tomans)
  async function googleRange(s, site) {
    const q = (s.info.latinQuery || s.info.persianQuery) + ' ' + site;
    const url = 'https://www.google.com/search?hl=en&q=' + encodeURIComponent(q);
    const html = await gmGet(url);
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    const re = /IRR\s*([\d,]{5,})\s*(?:to|-|–)\s*IRR\s*([\d,]{5,})/gi;
    let m;
    while ((m = re.exec(text))) {
      const ctx = tokenSet(text.slice(Math.max(0, m.index - 500), m.index));
      if (s.info.model.length && !s.info.model.every((t) => ctx.has(t))) continue;
      const lo = parseInt(m[1].replace(/,/g, ''), 10) / 10;
      const hi = parseInt(m[2].replace(/,/g, ''), 10) / 10;
      if (lo > 0 && hi >= lo) return { items: [{ title: 'محدوده‌ی قیمت (از نتیجه‌ی جستجوی گوگل)', head: true, lo, hi, url }], searchUrl: url, via: 'google' };
    }
    return null;
  }

  const SITE_WORD = { torob: 'torob', emalls: 'emalls' };

  /* ---------- foreign shops ---------- */
  function parseAmazon(doc, store) {
    const rows = [];
    doc.querySelectorAll('[data-component-type="s-search-result"]').forEach((e) => {
      const h2 = e.querySelector('h2');
      const img = e.querySelector('img.s-image');
      const title = [((h2 && (h2.getAttribute('aria-label') || h2.textContent)) || '').trim(), ((img && img.alt) || '').trim()].filter(Boolean).join(' ');
      const p = parsePrice((e.querySelector('.a-price .a-offscreen') || {}).textContent, store.cur);
      if (!title || !p) return;
      const asin = e.getAttribute('data-asin');
      rows.push({ title: (img && img.alt) || title, match: title, amount: p.amount, cur: p.cur, url: asin ? store.origin + '/dp/' + asin : store.origin });
    });
    return rows;
  }
  function parseEbay(doc, store) {
    const rows = [];
    doc.querySelectorAll('li.s-card, li.s-item').forEach((e) => {
      let title = ((e.querySelector('.s-card__title, .s-item__title') || {}).textContent || '').replace(/Opens in a new window or tab|^New Listing/gi, '').trim();
      if (!title || /^shop on ebay$/i.test(title)) return;
      const p = parsePrice((e.querySelector('.s-card__price, .s-item__price') || {}).textContent, store.cur);
      if (!p) return;
      const a = e.querySelector('a[href*="/itm/"]');
      rows.push({ title, match: title, amount: p.amount, cur: p.cur, url: a ? a.getAttribute('href').split('?')[0] : store.origin });
    });
    return rows;
  }

  // Amazon's own search is weak: find the product through Google ("amazon.com <name>"), then read the product page.
  const ASIN_RE = /\/(?:dp|clp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?#]|$)/;
  async function amazonViaGoogle(s, store) {
    const host = new URL(store.origin).host.replace(/^www\./, '');
    const gdoc = new DOMParser().parseFromString(
      await gmGet('https://www.google.com/search?hl=en&q=' + encodeURIComponent(host + ' ' + s.fq)), 'text/html');
    const found = new Map();
    gdoc.querySelectorAll('a[href]').forEach((a) => {
      try {
        let href = a.getAttribute('href') || '';
        const u = new URL(href, 'https://www.google.com');
        if (u.pathname === '/url') href = u.searchParams.get('q') || u.searchParams.get('url') || '';
        const r = new URL(href);
        if (r.host.replace(/^www\./, '') !== host) return;
        const m = (r.pathname + '/').match(ASIN_RE) || r.pathname.match(ASIN_RE);
        if (!m || found.has(m[1])) return;
        const h3 = a.querySelector('h3');
        found.set(m[1], ((h3 || a).textContent || '').trim());
      } catch (e) { /* not a usable link */ }
    });
    const cands = [...found].map(([asin, title]) => ({ asin, title, sc: foreignScore(s.info, title) }));
    cands.sort((a, b) => b.sc - a.sc);
    const rows = [];
    await Promise.all(cands.slice(0, 3).map(async (c) => {
      try {
        const html = await gmGet(store.origin + '/dp/' + c.asin);
        if (/Enter the characters you see below|api-services-support@amazon|captchacharacters/i.test(html)) return;
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const title = ((doc.querySelector('#productTitle') || {}).textContent || doc.title || '').trim();
        const price = [...doc.querySelectorAll('.a-price .a-offscreen')].map((e) => parsePrice(e.textContent, store.cur)).find(Boolean);
        const score = Math.max(foreignScore(s.info, title), c.sc);
        if (price && score > 0) rows.push({ title: title || c.title, amount: price.amount, cur: price.cur, url: store.origin + '/dp/' + c.asin, score });
      } catch (e) { /* skip this candidate */ }
    }));
    return rows;
  }

  const storeSearchUrl = (store, q) =>
    store.kind === 'ebay' ? store.origin + '/sch/i.html?_nkw=' + encodeURIComponent(q) : store.origin + '/s?k=' + encodeURIComponent(q);

  async function runStore(s, store) {
    const st = (s.stores[store.key] = { status: 'loading' });
    cmpRender(s, 'foreign');
    try {
      const q = s.fq;
      const url = storeSearchUrl(store, q);
      const html = await gmGet(url);
      if (/Enter the characters you see below|api-services-support@amazon|captchacharacters/i.test(html)) throw new Error('فروشگاه درخواست کپچا داده است');
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const all = (store.kind === 'ebay' ? parseEbay(doc, store) : parseAmazon(doc, store)).map((r) => Object.assign(r, { score: foreignScore(s.info, r.match) }));
      const pick = (list) => {
        const full = list.filter((r) => r.score === 1);
        return full.length ? { rows: full, approx: false } : { rows: list.filter((r) => r.score > 0), approx: true };
      };
      let { rows, approx } = pick(all);
      if (!rows.length && store.kind === 'amazon') {
        try {
          ({ rows, approx } = pick(await amazonViaGoogle(s, store)));
          if (rows.length) st.via = 'google';
        } catch (e) { st.gerr = errText(e); }
      }
      if (!rows.length) { st.status = 'empty'; } else {
        rows.sort((a, b) => a.amount - b.amount);
        st.status = 'done';
        st.rows = rows;
        st.approx = approx;
        st.searchUrl = url;
      }
    } catch (e) {
      st.status = 'error';
      st.err = errText(e);
    }
    cmpRender(s, 'foreign');
  }

  async function runForeign(s) {
    if (s.fq == null) s.fq = s.info.latinQuery || '';
    s.stores = {};
    if (!s.fq.trim()) { cmpRender(s, 'foreign'); return; }
    cmpRender(s, 'foreign');
    s.rates = await getRates();
    await Promise.all(FOREIGN_STORES.map((st) => runStore(s, st)));
  }

  /* ---------- session + state machine ---------- */
  const sessions = {};
  let cmpUi = null; // { wrap, sid, active, onKey }

  function getSession(id) {
    return sessions[id] || (sessions[id] = { id, info: null, ready: null, tabs: {}, stores: {}, fq: null, rates: null, started: false });
  }

  async function loadInfo(s) {
    let p = null;
    try {
      const r = await fetch('https://api.digikala.com/v2/product/' + s.id + '/');
      if (r.ok) p = ((await r.json()).data || {}).product || null;
    } catch (e) { /* fall back to the page title */ }
    const fa = (p && p.title_fa) || document.title.replace(/^قیمت و خرید\s*/, '');
    const en = (p && p.title_en) || '';
    const sp = p && p.default_variant && p.default_variant.price && p.default_variant.price.selling_price;
    s.info = analyzeName(fa, en);
    s.info.dkPrice = sp > 0 ? sp / 10 : null;
    s.info.title = String(fa).split(/[،,]/)[0].trim();
    s.match = makeMatcher(s.info, false);
    s.matchF = makeMatcher(s.info, true);
  }

  const RUNNERS = { torob: runTorob, emalls: runEmalls, basalam: runBasalam };

  async function runTab(s, key) {
    if (key === 'foreign') return runForeign(s);
    s.tabs[key] = { status: 'loading' };
    cmpRender(s, key);
    let res = null;
    let err = null;
    try { res = await RUNNERS[key](s); } catch (e) { err = errText(e); }
    if (SITE_WORD[key] && (!res || !res.items.length)) {
      try {
        const g = await googleRange(s, SITE_WORD[key] || key);
        if (g) { res = g; err = null; }
      } catch (e) { /* Google not reachable: keep the original outcome */ }
    }
    if (res && res.items.length) s.tabs[key] = { status: 'done', items: res.items, searchUrl: res.searchUrl, via: res.via };
    else if (err) s.tabs[key] = { status: 'error', err };
    else s.tabs[key] = { status: 'empty', searchUrl: res && res.searchUrl };
    cmpRender(s, key);
  }

  // Starts every enabled tab that has not run yet in this session (a shop can be turned on later).
  function startAll(s) {
    s.started = true;
    s.ran = s.ran || new Set();
    for (const t of cmpTabs()) {
      if (s.ran.has(t.key)) continue;
      s.ran.add(t.key);
      runTab(s, t.key);
    }
  }

  function ensureInfo(s) {
    if (!s.ready) {
      s.ready = loadInfo(s).catch((e) => { s.ready = null; throw e; });
    }
    return s.ready;
  }

  /* ---------- rendering ---------- */
  const googleUrl = (s, key) =>
    'https://www.google.com/search?q=' + encodeURIComponent((s.info.latinQuery || s.info.persianQuery) + ' ' + (SITE_WORD[key] || ''));

  function foreignStatus(s) {
    const v = FOREIGN_STORES.map((x) => (s.stores[x.key] || {}).status).filter(Boolean);
    if (!s.fq || !String(s.fq).trim()) return 'empty';
    if (!v.length || v.includes('loading')) return 'loading';
    if (v.includes('done')) return 'done';
    return v.every((x) => x === 'error') ? 'error' : 'empty';
  }
  const tabStatus = (s, key) => (key === 'foreign' ? foreignStatus(s) : (s.tabs[key] || {}).status || 'loading');

  // Results come from automatic searches by product name, so they can belong to a different product.
  const CMP_WARN =
    '<b>توجه:</b> نتیجه‌ها با جستجوی خودکار نام کالا پیدا می‌شوند و گاهی مربوط به کالای دیگری (مدل، رنگ یا ظرفیت متفاوت) هستند. ' +
    'پیش از تصمیم‌گیری، کالا و قیمت را در خود سایت بررسی کنید.';
  const FOREIGN_WARN =
    '<b>توجه:</b> در فروشگاه‌های خارجی احتمال نمایش کالای نامرتبط بیشتر است؛ نام، مدل و قیمت را حتماً در سایت فروشگاه بررسی کنید. ' +
    'قیمت‌های تومانی تقریبی‌اند و هزینه‌ی ارسال، گمرک و مالیات را در بر نمی‌گیرند.';

  const SPIN = '<span class="cspin"></span>';
  const money = (amount, cur) => amount.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' ' + cur;

  function renderItems(items) {
    return items
      .map((i) =>
        (i.url ? `<a class="it${i.head ? ' head' : ''}" href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">` : `<div class="it${i.head ? ' head' : ''}">`) +
        `<span class="it-t">${esc(i.title)}</span>` +
        `<span class="it-p">${esc(rangeText(i.lo, i.hi))}</span>` +
        (i.meta ? `<span class="it-m">${esc(i.meta)}</span>` : '') +
        (i.url ? '</a>' : '</div>')
      )
      .join('');
  }

  function renderGeneric(s, key) {
    const t = s.tabs[key] || { status: 'loading' };
    const label = CMP_TABS.find((x) => x.key === key).label;
    const g = `<a class="btn sm" href="${esc(googleUrl(s, key))}" target="_blank" rel="noopener noreferrer">جستجو در گوگل</a>`;
    if (t.status === 'loading') return `<div class="msg">${SPIN}<span>در حال جستجو در ${label}…</span></div>`;
    if (t.status === 'error') {
      return `<div class="msg err"><b>دریافت اطلاعات از ${label} انجام نشد.</b><span>${esc(t.err)}</span>` +
        `<div class="acts"><button class="btn sm pri" type="button" data-act="retry" data-key="${key}">تلاش دوباره</button>${g}</div></div>`;
    }
    if (t.status === 'empty') {
      return `<div class="msg"><b>این کالا در ${label} پیدا نشد.</b>` +
        `<div class="acts"><button class="btn sm" type="button" data-act="retry" data-key="${key}">جستجوی دوباره</button>${g}` +
        (t.searchUrl ? `<a class="btn sm" href="${esc(t.searchUrl)}" target="_blank" rel="noopener noreferrer">باز کردن جستجو در ${label}</a>` : '') +
        `</div></div>`;
    }
    return `<div class="list">${renderItems(t.items)}</div>` +
      `<div class="foot">${t.via === 'google' ? 'این محدوده از نتیجه‌ی جستجوی گوگل خوانده شد. ' : ''}` +
      (t.searchUrl ? `<a href="${esc(t.searchUrl)}" target="_blank" rel="noopener noreferrer">مشاهده‌ی همه‌ی نتایج</a>` : '') + `</div>`;
  }

  function renderForeign(s) {
    const rate = usdToman(s);
    const manual = manualRate();
    let h = `<div class="cmp-warn in" role="note">${FOREIGN_WARN}</div>` +
      `<div class="fq"><input type="text" dir="ltr" data-fq placeholder="نام لاتین کالا، مثلاً: Anker Soundcore R50i A3949" value="${esc(s.fq || '')}">` +
      `<button class="btn sm pri" type="button" data-act="fsearch">جستجو</button></div>`;
    h += `<div class="fq rate"><label>نرخ هر دلار (تومان)` +
      `<input type="number" min="0" data-rate placeholder="${rate ? Math.round(rate) : '—'}" value="${manual || ''}"></label>` +
      `<button class="btn sm" type="button" data-act="rate">اعمال</button>` +
      `<span class="note">${rate ? 'نرخ استفاده‌شده: ' + fmt(rate) + ' تومان (' + (manual ? 'دستی' : 'خودکار؛ ممکن است با نرخ بازار تفاوت داشته باشد') + ')' : 'نرخ ارز در دسترس نیست؛ قیمت‌ها فقط با ارز اصلی نشان داده می‌شوند.'}</span></div>`;
    if (!s.fq || !String(s.fq).trim()) {
      return h + '<div class="msg"><b>نام لاتین کالا در عنوان دیجی‌کالا پیدا نشد.</b><span>نام کالا را به انگلیسی بالا وارد کنید.</span></div>';
    }
    const rows = FOREIGN_STORES.map((store) => {
      const st = s.stores[store.key] || { status: 'loading' };
      let body;
      if (st.status === 'loading') body = `<span class="cell-m">${SPIN} در حال جستجو…</span>`;
      else if (st.status === 'error') body = `<span class="cell-m err">${esc(st.err)} <button class="btn sm" type="button" data-act="rstore" data-key="${store.key}">تلاش دوباره</button> ` +
        `<a href="${esc(storeSearchUrl(store, s.fq))}" target="_blank" rel="noopener noreferrer">باز کردن جستجو در سایت</a></span>`;
      else if (st.status === 'empty') {
        const gl = store.kind === 'amazon'
          ? ` · <a href="${esc('https://www.google.com/search?q=' + encodeURIComponent(new URL(store.origin).host.replace(/^www\./, '') + ' ' + s.fq))}" target="_blank" rel="noopener noreferrer">جستجو در گوگل</a>`
          : '';
        body = `<span class="cell-m">پیدا نشد${gl}</span>`;
      }
      else {
        const lo = st.rows[0];
        const hi = st.rows[st.rows.length - 1];
        const same = hi.cur === lo.cur;
        const big = same && hi.amount !== lo.amount ? money(lo.amount, lo.cur) + ' – ' + money(hi.amount, hi.cur) : money(lo.amount, lo.cur);
        const tl = toToman(s, lo.amount, lo.cur);
        const th = same ? toToman(s, hi.amount, hi.cur) : tl;
        body = `<a class="cell-l" href="${esc(lo.url)}" target="_blank" rel="noopener noreferrer">` +
          `<span class="big" dir="ltr">${esc(big)}</span>` +
          (tl ? `<span class="sub">≈ ${esc(rangeText(tl, th))}</span>` : '') +
          `<span class="it-m"><span dir="ltr">${esc(lo.title)}</span> · ${L(st.rows.length)} نتیجه${st.approx ? ' · <b class="apx">تطابق تقریبی (مدل دقیقاً یکسان نیست)</b>' : ''}${st.via === 'google' ? ' · از طریق گوگل' : ''}</span></a>`;
      }
      return `<div class="frow"><span class="fname">${logoImg(store.logo)}<span>${esc(store.name)}</span></span>${body}</div>`;
    }).join('');
    return h + `<div class="list f">${rows}</div>`;
  }

  const STATUS_MARK = { loading: '<span class="cspin xs"></span>', done: '<i class="mk ok">✓</i>', error: '<i class="mk bad">!</i>', empty: '<i class="mk">–</i>' };

  function cmpRender(s, key) {
    if (!cmpUi || cmpUi.sid !== s.id) return;
    const { wrap } = cmpUi;
    const tb = wrap.querySelector(`[data-tab="${key}"] .mk-slot`);
    if (tb) tb.innerHTML = STATUS_MARK[tabStatus(s, key)] || '';
    const pane = wrap.querySelector(`[data-pane="${key}"]`);
    if (!pane) return;
    // keep what the user is typing when only the results change
    const fq = pane.querySelector('[data-fq]');
    const focus = fq && pane.getRootNode().activeElement === fq ? [fq.selectionStart, fq.selectionEnd] : null;
    pane.innerHTML = key === 'foreign' ? renderForeign(s) : renderGeneric(s, key);
    if (focus) { const f = pane.querySelector('[data-fq]'); f.focus(); try { f.setSelectionRange(focus[0], focus[1]); } catch (e) { /* ignore */ } }
  }

  const CMP_CSS = `
    .cmpw { position: fixed; inset: 0; z-index: 2147483000; background: rgba(0,0,0,.5); display: flex;
      align-items: center; justify-content: center; padding: 16px; }
    .cmp { --p: var(--color-primary-700, #ef394e); --bg: #fff; --hover: #fafafb;
      --n700: var(--color-neutral-700, #3f4064); --n600: var(--color-neutral-600, #62666d); --n500: var(--color-neutral-500, #81858b);
      --n200: var(--color-neutral-200, #e0e0e2); --n100: var(--color-neutral-100, #f0f0f1);
      width: min(760px, 100%); max-height: min(720px, 100%); display: flex; flex-direction: column; background: var(--bg);
      border-radius: 16px; overflow: hidden; box-shadow: 0 12px 40px rgba(0,0,0,.35);
      font-family: Digikala, Tahoma, "Segoe UI", sans-serif; font-size: 12px; line-height: 1.8; color: var(--n700); direction: rtl; }
    :host([data-mah-theme="dark"]) .cmp { --bg: var(--color-neutral-000, #222732); --hover: #2b303c; color-scheme: dark; }
    .cmp .top { height: 56px; padding: 0 16px; }
    .cmp-prod { padding: 10px 16px; border-bottom: 1px solid var(--n200); background: var(--n100); display: flex; flex-wrap: wrap; gap: 4px 16px; }
    .cmp-prod b { font-size: 13px; }
    .cmp-tabs { display: flex; gap: 4px; padding: 8px 12px 0; border-bottom: 1px solid var(--n200); flex: none; overflow-x: auto; }
    .cmp-tabs button { display: inline-flex; align-items: center; gap: 6px; height: 38px; padding: 0 14px; border: 0; background: none;
      border-bottom: 2px solid transparent; color: var(--n600); font-weight: 700; cursor: pointer; white-space: nowrap; }
    .cmp-tabs button[aria-selected="true"] { color: var(--p); border-bottom-color: var(--p); }
    .cmp-warn { flex: none; padding: 8px 16px; border-bottom: 1px solid var(--n200); background: rgba(249,168,37,.14);
      color: var(--n700); font-size: 11px; line-height: 1.9; }
    .cmp-warn.in { margin-bottom: 10px; border: 1px solid rgba(249,168,37,.45); border-radius: 10px; padding: 8px 12px; }
    .cmp-body { padding: 16px; overflow: auto; flex: 1; min-height: 220px; }
    .mk { font-style: normal; font-size: 11px; width: 16px; height: 16px; border-radius: 50%; display: inline-grid; place-items: center;
      background: var(--n200); color: var(--n700); }
    .mk.ok { background: #2e9d57; color: #fff; } .mk.bad { background: var(--p); color: #fff; }
    .cspin { width: 18px; height: 18px; border: 2px solid var(--n200); border-top-color: var(--p); border-radius: 50%;
      animation: sp .8s linear infinite; flex: none; display: inline-block; }
    .cspin.xs { width: 12px; height: 12px; }
    .msg { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; min-height: 160px; text-align: center; color: var(--n600); }
    .msg b { color: var(--n700); font-size: 14px; } .msg .err, .msg.err b { color: var(--p); }
    .acts { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 4px; }
    .btn.sm { height: 32px; padding: 0 12px; text-decoration: none; }
    .btn.pri { background: var(--p); border-color: var(--p); color: #fff; }
    .list { display: flex; flex-direction: column; gap: 8px; }
    .it { display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; padding: 10px 12px; border: 1px solid var(--n200);
      border-radius: 10px; text-decoration: none; color: inherit; }
    .it:hover { background: var(--hover); }
    .it.head { border-color: var(--p); }
    .it-t { grid-column: 1; font-weight: 700; } .it-p { grid-column: 2; grid-row: 1; font-weight: 700; color: var(--p); white-space: nowrap; }
    .it-m { grid-column: 1 / -1; color: var(--n500); font-size: 11px; }
    .foot { margin-top: 12px; color: var(--n500); font-size: 11px; } .foot a { color: var(--p); }
    .fq { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 10px; }
    .fq input { flex: 1; min-width: 160px; height: 32px; padding: 0 10px; border: 1px solid var(--n200); border-radius: 8px;
      background: var(--bg); color: inherit; }
    .fq.rate label { display: inline-flex; align-items: center; gap: 8px; } .fq.rate input { flex: none; width: 130px; }
    .note { color: var(--n500); font-size: 11px; }
    .frow { display: grid; grid-template-columns: 170px 1fr; gap: 12px; align-items: center; padding: 10px 12px;
      border: 1px solid var(--n200); border-radius: 10px; }
    .lg { width: 16px; height: 16px; border-radius: 3px; flex: none; object-fit: contain; }
    .fname { font-weight: 700; display: inline-flex; align-items: center; gap: 8px; }
    .big { font-size: 18px; font-weight: 700; line-height: 1.5; color: var(--n700); }
    .sub { font-size: 11px; color: var(--n500); }
    .apx { color: var(--p); font-weight: 700; } .cell-l { display: flex; flex-direction: column; text-decoration: none; color: inherit; }
    .cell-m { color: var(--n500); display: inline-flex; align-items: center; gap: 8px; } .cell-m.err { color: var(--p); flex-wrap: wrap; }
    @media (max-width: 560px) { .frow { grid-template-columns: 1fr; gap: 4px; } .it { grid-template-columns: 1fr; } .it-p { grid-column: 1; grid-row: auto; } }
  `;

  function showCompare() {
    const id = productId();
    if (!id) return;
    const root = getRoot();
    if (root.querySelector('.cmpw')) return;
    if (!root.querySelector('style[data-cmp]')) {
      const st = document.createElement('style');
      st.setAttribute('data-cmp', '');
      st.textContent = CMP_CSS;
      root.appendChild(st);
    }
    const s = getSession(id);
    const wrap = document.createElement('div');
    wrap.className = 'cmpw';
    wrap.setAttribute('dir', 'rtl');
    wrap.innerHTML =
      `<div class="cmp" role="dialog" aria-modal="true" aria-label="مقایسه قیمت">` +
      `<div class="top"><div class="ttl"><span class="badge">${svg('tag', 20)}</span><span>مقایسه قیمت</span></div><span class="sp"></span>` +
      `<button class="btn ghost" type="button" data-act="close" title="بستن">${svg('close', 22)}</button></div>` +
      `<div class="cmp-prod" data-prod><span>در حال بررسی کالا…</span></div>` +
      `<div class="cmp-tabs" role="tablist">` +
      cmpTabs().map((t, i) => `<button type="button" role="tab" data-tab="${t.key}" aria-selected="${i === 0}">${logoImg(t.logo)}<span>${t.label}</span><span class="mk-slot"></span></button>`).join('') +
      `</div><div class="cmp-warn" role="note">${CMP_WARN}</div><div class="cmp-body">` +
      cmpTabs().map((t, i) => `<div data-pane="${t.key}" role="tabpanel"${i ? ' hidden' : ''}><div class="msg">${SPIN}<span>در حال آماده‌سازی…</span></div></div>`).join('') +
      `</div></div>`;
    root.appendChild(wrap);
    const prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';

    const close = () => {
      wrap.remove();
      document.removeEventListener('keydown', onKey, true);
      document.documentElement.style.overflow = prevOverflow;
      cmpUi = null;
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey, true);
    cmpUi = { wrap, sid: id };

    const selectTab = (key) => {
      wrap.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === key)));
      wrap.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== key; });
    };

    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) return close();
      const tab = e.target.closest('[data-tab]');
      if (tab) return selectTab(tab.dataset.tab);
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'close') close();
      else if (act === 'retry') runTab(s, b.dataset.key);
      else if (act === 'rstore') runStore(s, FOREIGN_STORES.find((x) => x.key === b.dataset.key));
      else if (act === 'fsearch') {
        s.fq = (wrap.querySelector('[data-fq]').value || '').trim();
        runForeign(s);
      } else if (act === 'rate') {
        setManualRate(wrap.querySelector('[data-rate]').value);
        cmpRender(s, 'foreign');
      }
    });
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('[data-fq]')) { s.fq = e.target.value.trim(); runForeign(s); }
    });

    const showProd = () => {
      const i = s.info;
      wrap.querySelector('[data-prod]').innerHTML = `<b>${esc(i.title)}</b>` + (i.dkPrice ? `<span>قیمت در دیجی‌کالا: <b>${fmt(i.dkPrice)} تومان</b></span>` : '');
    };
    const fail = (err) => {
      for (const t of cmpTabs()) {
        s.tabs[t.key] = { status: 'error', err: 'نام کالا خوانده نشد: ' + errText(err) };
        cmpRender(s, t.key);
      }
    };

    if (s.started) {
      showProd();
      startAll(s);
      for (const t of cmpTabs()) cmpRender(s, t.key);
    } else {
      ensureInfo(s).then(() => { showProd(); startAll(s); }, fail);
    }
  }

  function makeCmpButton() {
    const btn = document.createElement('button');
    btn.id = CMP_BTN_ID;
    btn.type = 'button';
    btn.title = 'مقایسه‌ی قیمت این کالا در ترب، ایمالز، باسلام و فروشگاه‌های خارجی';
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = 'مقایسه قیمت';
    const ico = document.createElement('span');
    ico.className = 'ico';
    ico.innerHTML = svg('tag', 20);
    btn.append(ico, lbl);
    btn.addEventListener('click', showCompare);
    return btn;
  }

  /* ------------------------------------------------------------------ *
   * Price history: the script's own records
   * Kept per product under "h:<id>" as { t: title, r: runs }, where each run is
   * [from, to, price, rrp, avail]: times in ms, prices in Tomans, rrp 0 when
   * there is no reference ("before discount") price, avail 1 / 0. A run is
   * extended while the values stay the same and observations are at most
   * RUN_GAP apart, so gaps in observation stay visible.
   * Dollar rates are kept per day under "fx": { "2026-11-01": [auto, manual] }.
   * The method is described in DISCLAIMER.md: keep the two in step.
   * ------------------------------------------------------------------ */
  const DAY = 864e5;
  const KEEP_MS = 365 * DAY;
  const RUN_GAP = 1.5 * DAY;
  const HKEY = (id) => 'h:' + id;
  const pad2 = (n) => String(n).padStart(2, '0');
  const dayKey = (ts) => { const d = new Date(ts); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
  const addDays = (key, n) => new Date(Date.parse(key + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
  const DATE_LOCALE = LOCALE === 'fa-IR' ? 'fa-IR' : 'fa-IR-u-nu-latn'; // Persian calendar either way
  const fmtDate = (ts, opts) => new Date(ts).toLocaleDateString(DATE_LOCALE, opts || { year: 'numeric', month: 'long', day: 'numeric' });

  const historyOn = () => feature('history');
  const autoRecord = () => historyOn() && settings().history.freq !== 'manual';

  // Adds one observation to a product's runs; false when nothing changed (same values already recorded today).
  function addObservation(h, ts, price, rrp, avail) {
    const runs = h.r;
    const last = runs[runs.length - 1];
    if (last && ts < last[1]) return false; // older than what is already there
    if (last && last[2] === price && last[3] === rrp && last[4] === avail && ts - last[1] <= RUN_GAP) {
      if (dayKey(last[1]) === dayKey(ts)) return false;
      last[1] = ts;
      return true;
    }
    runs.push([ts, ts, price, rrp, avail]);
    return true;
  }

  // Writes are queued and flushed in small batches: a table can add thousands of products at once.
  const histPending = new Map();
  let histFlushTimer = null;
  function getHist(id) {
    return histPending.get(id) || store.get(HKEY(id)) || { t: '', r: [] };
  }
  function flushHist() {
    histFlushTimer = null;
    let n = 0;
    for (const [id, h] of histPending) {
      store.set(HKEY(id), h);
      histPending.delete(id);
      if (++n >= 50) { histFlushTimer = setTimeout(flushHist, 50); return; }
    }
  }
  // obs = { price, rrp, avail } (Tomans); force = record even in manual mode (the "record price" button)
  function recordPrice(id, obs, title, force) {
    if (!id || !obs || !(force ? historyOn() : autoRecord())) return false;
    const h = getHist(id);
    if (title) h.t = String(title).slice(0, 200);
    if (!addObservation(h, Date.now(), Math.round(obs.price || 0), Math.round(obs.rrp || 0), obs.avail ? 1 : 0)) return false;
    histPending.set(id, h);
    if (!histFlushTimer) histFlushTimer = setTimeout(flushHist, 0);
    noteFxToday();
    return true;
  }
  const obsFromRow = (r) => ({ price: r.price, rrp: r.old || 0, avail: 1 }); // table rows are in stock
  function recordRows(rows) {
    if (!autoRecord()) return;
    const wl = wlAll();
    for (const r of rows) {
      if (r.recorded || !r.id) continue;
      r.recorded = true;
      recordPrice(r.id, obsFromRow(r), r.title);
      if (wl[r.id]) wlObserve(r.id, obsFromRow(r), r.title, r.img);
    }
  }

  // The day's dollar rates, saved alongside the price records.
  let fxNoted = null;
  async function noteFxToday() {
    const today = dayKey(Date.now());
    const manual = manualRate();
    if (fxNoted === today + ':' + manual) return;
    fxNoted = today + ':' + manual;
    const rates = await getRates();
    const auto = rates && rates.IRR ? Math.round(rates.IRR / 10) : null;
    const fx = store.get('fx', {});
    const prev = fx[today] || [null, null];
    fx[today] = [auto || prev[0], manual || prev[1]];
    store.set('fx', fx);
  }

  // Drops runs older than a year (and empty products); runs at most once a day.
  function pruneHistory() {
    const now = Date.now();
    if (now - store.get('hPruned', 0) < DAY) return;
    store.set('hPruned', now);
    for (const k of store.keys()) {
      if (k.indexOf('h:') !== 0) continue;
      const h = store.get(k);
      const runs = h && Array.isArray(h.r) ? h.r.filter((x) => x[1] >= now - KEEP_MS) : [];
      if (!runs.length) store.del(k);
      else if (runs.length !== h.r.length) { h.r = runs; store.set(k, h); }
    }
    const cut = dayKey(now - KEEP_MS);
    const fx = store.get('fx', {});
    for (const d of Object.keys(fx)) if (d < cut) delete fx[d];
    store.set('fx', fx);
    const dc = store.get('dc', {});
    for (const id of Object.keys(dc)) if (now - dc[id].ts > 7 * DAY) delete dc[id];
    store.set('dc', dc);
  }

  function deleteHistory() {
    histPending.clear();
    for (const k of store.keys()) if (k.indexOf('h:') === 0) store.del(k);
    store.del('fx');
    store.del('dc');
  }
  const historyCount = () => store.keys().filter((k) => k.indexOf('h:') === 0).length;

  /* ------------------------------------------------------------------ *
   * Digikala's own price chart: daily selling / reference price and
   * availability, as shown in its "نمودار قیمت" window. Days are dates of
   * the Persian calendar ("1404-08-10"); prices are in Rials.
   * ------------------------------------------------------------------ */
  function jalaliToGregorian(jy, jm, jd) {
    jy += 1595;
    let days = -355668 + 365 * jy + Math.floor(jy / 33) * 8 + Math.floor(((jy % 33) + 3) / 4) + jd +
      (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
    let gy = 400 * Math.floor(days / 146097);
    days %= 146097;
    if (days > 36524) {
      gy += 100 * Math.floor(--days / 36524);
      days %= 36524;
      if (days >= 365) days++;
    }
    gy += 4 * Math.floor(days / 1461);
    days %= 1461;
    if (days > 365) {
      gy += Math.floor((days - 1) / 365);
      days = (days - 1) % 365;
    }
    let gd = days + 1;
    const ml = [0, 31, (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let gm = 1;
    for (; gm <= 12 && gd > ml[gm]; gm++) gd -= ml[gm];
    return [gy, gm, gd];
  }
  // "1404-08-10" or "1404/08/10" (Persian) or "2025-11-01" (Gregorian) -> "2025-11-01"
  function dkDayKey(s) {
    const [y, m, d] = String(s || '').split(/[-/]/).map((x) => parseInt(latin(x), 10));
    if (!y || !m || !d) return null;
    const g = y < 1700 ? jalaliToGregorian(y, m, d) : [y, m, d];
    return g[0] + '-' + pad2(g[1]) + '-' + pad2(g[2]);
  }

  // -> [{ title, days: Map(dayKey -> { price, rrp, avail }) }]  (empty when Digikala has no chart)
  const dkChartCache = new Map();
  function fetchDkChart(id) {
    const hit = dkChartCache.get(id);
    if (hit && Date.now() - hit.at < 10 * 60e3) return hit.p;
    const p = fetch('https://api.digikala.com/v1/product/' + id + '/price-chart/', { credentials: 'include', headers: { Accept: 'application/json' } })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((j) => {
        const list = (j && j.data && j.data.price_chart) || [];
        return (Array.isArray(list) ? list : []).map((s) => {
          const days = new Map();
          for (const pt of s.history || []) {
            const k = dkDayKey(pt.day);
            if (!k || !(pt.selling_price > 0)) continue;
            days.set(k, { price: pt.selling_price / 10, rrp: pt.rrp_price > 0 ? pt.rrp_price / 10 : 0, avail: pt.is_marketable ? 1 : 0 });
          }
          return { title: String(s.title || ''), days };
        }).filter((s) => s.days.size);
      });
    p.catch(() => dkChartCache.delete(id));
    dkChartCache.set(id, { at: Date.now(), p });
    return p;
  }

  // The series that matches what the page shows now (the default variant), else the first one.
  function pickDkSeries(series, cur) {
    if (!series.length) return null;
    if (cur && cur.price) {
      for (const s of series) {
        const last = [...s.days.keys()].sort().pop();
        const v = s.days.get(last);
        if (v && Math.abs(v.price - cur.price) <= 0.01 * cur.price) return s;
      }
    }
    return series[0];
  }

  // Day -> { price, rrp, avail, src }: Digikala's days first, the script's own records fill the rest.
  function mergedDays(dkSeries, runs) {
    const days = new Map();
    if (dkSeries) for (const [k, v] of dkSeries.days) days.set(k, Object.assign({ src: 'dk' }, v));
    for (const [from, to, price, rrp, avail] of runs || []) {
      for (let k = dayKey(from), end = dayKey(to); k <= end; k = addDays(k, 1)) {
        if (!days.has(k)) days.set(k, { price, rrp, avail, src: 'own' });
      }
    }
    return days;
  }

  /* Discount check (see DISCLAIMER.md, section 4.3). Runs only when a discount is shown (rrp > price).
   *  - discount start: first day of the unbroken run of discounted days that ends today
   *    (days without data are tolerated up to 3 in a row; out-of-stock days are skipped)
   *  - window: the 30 days before the discount start; only in-stock days with data count
   *  - fewer than 7 usable days -> 'insufficient'
   *  - below: current price lower than the window's lowest price; refSeen: the reference
   *    price was the selling price on at least one day. Differences under 1% count as equal. */
  const MIN_DAYS = 7;
  const WINDOW_DAYS = 30;
  const near = (a, b) => Math.abs(a - b) <= 0.01 * Math.max(a, b);
  function discountCheck(cur, days, today) {
    if (!cur || !cur.avail || !(cur.rrp > cur.price)) return { status: 'none' };
    let start = today;
    let gap = 0;
    for (let k = addDays(today, -1), i = 0; i < 400; i++, k = addDays(k, -1)) {
      const v = days.get(k);
      if (!v) { if (++gap > 3) break; continue; }
      gap = 0;
      if (!v.avail) continue;
      if (!(v.rrp > v.price)) break;
      start = k;
    }
    const usable = [];
    for (let i = 1; i <= WINDOW_DAYS; i++) {
      const v = days.get(addDays(start, -i));
      if (v && v.avail && v.price > 0) usable.push(v);
    }
    if (usable.length < MIN_DAYS) return { status: 'insufficient', start, usable: usable.length };
    const low = Math.min(...usable.map((v) => v.price));
    return {
      status: 'ok',
      start,
      usable: usable.length,
      low,
      below: cur.price < low && !near(cur.price, low),
      refSeen: usable.some((v) => near(v.price, cur.rrp)),
    };
  }

  // Runs the check for one product and keeps the result for a day (used by the table).
  async function checkProduct(id, cur) {
    let dk = null;
    try { dk = pickDkSeries(await fetchDkChart(id), cur); } catch (e) { /* Digikala's data unavailable: own records only */ }
    const res = discountCheck(cur, mergedDays(dk, getHist(id).r), dayKey(Date.now()));
    const dc = store.get('dc', {});
    dc[id] = Object.assign({ ts: Date.now() }, res);
    store.set('dc', dc);
    return { res, dk };
  }
  function cachedCheck(id) {
    const c = store.get('dc', {})[id];
    return c && Date.now() - c.ts < DAY ? c : null;
  }

  /* ---------- one-time notice before the first result ---------- */
  const ACK_KEY = 'discountAck';
  const discountAcked = () => !!store.get(ACK_KEY);
  function ensureDiscountAck() {
    if (discountAcked()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const dlg = openDialog({
        title: 'پیش از دیدن نتیجه‌ی بررسی تخفیف',
        icon: 'tag',
        body:
          '<div class="notice"><p>«بررسی تخفیف» قیمت فعلی یک کالا را با قیمت‌های ۳۰ روز پیش از شروع تخفیف مقایسه می‌کند. لطفاً پیش از استفاده بدانید:</p><ul>' +
          '<li>نتیجه فقط یک مقایسه‌ی خودکار با داده‌هایی است که اسکریپت در اختیار دارد (سابقه‌ی قیمت خود دیجی‌کالا و سوابق ثبت‌شده در مرورگر شما).</li>' +
          '<li>این نتیجه <b>ادعا یا اتهامی</b> درباره‌ی دیجی‌کالا، فروشنده یا هیچ کالایی نیست و نمی‌گوید تخفیفی واقعی یا غیرواقعی است.</li>' +
          '<li>داده‌ها ممکن است ناقص یا نادرست باشند (تنوع‌ها و فروشندگان مختلف، روزهای بدون داده، تغییرات سایت). همیشه خودتان در سایت بررسی کنید.</li>' +
          '</ul><p>روش دقیق محاسبه و محدودیت‌ها در ' +
          `<a href="${DISCLAIMER_URL}" target="_blank" rel="noopener noreferrer">سلب مسئولیت و روش کار</a> آمده است.</p></div>`,
        actions: [{ act: 'ok', label: 'متوجه شدم', primary: true }, { act: 'cancel', label: 'انصراف' }],
        onAct: (act) => {
          if (act === 'ok') store.set(ACK_KEY, Date.now());
          dlg.close();
          resolve(act === 'ok');
          if (act === 'ok') renderStrip();
        },
        onClose: () => resolve(discountAcked()),
      });
    });
  }

  /* ---------- result display (neutral wording and colours) ---------- */
  const DC_CSS = `
    .dcb { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .dcc { display: inline-flex; align-items: center; padding: 0 8px; border-radius: 6px; line-height: 22px; font-size: 11px;
      font-weight: 700; background: var(--dc-grey-bg, #f0f0f1); color: var(--dc-grey, #62666d); white-space: nowrap; }
    .dcc.blue { background: var(--dc-blue-bg, #e8f0fe); color: var(--dc-blue, #1a56b4); }
    .dcl { color: var(--n500, #81858b); font-size: 11px; }
    :host([data-mah-theme="dark"]) .dcc { --dc-grey-bg: #323641; --dc-grey: #c2c3c7; --dc-blue-bg: #1d2f4f; --dc-blue: #9cc0f9; }
  `;
  const DC_TEXT = {
    none: 'بدون تخفیف',
    insufficient: 'داده‌ی کافی وجود ندارد',
    below: 'کمتر از کمترین قیمت ۳۰ روز گذشته',
    notBelow: 'کمتر از کمترین قیمت ۳۰ روز گذشته نیست',
    refSeen: 'قیمت مرجع در ۳۰ روز گذشته قیمت فروش بوده',
    refNotSeen: 'قیمت مرجع در ۳۰ روز گذشته قیمت فروش نبوده',
  };
  const DC_SHORT = { insufficient: 'داده‌ی کافی نیست', below: 'کمتر از کمینه‌ی ۳۰ روز', notBelow: 'کمتر از کمینه‌ی ۳۰ روز نیست', refNotSeen: 'قیمت مرجع دیده نشده' };

  // full: the product page / chart window; short: a table cell
  function dcHtml(res, short) {
    const T = short ? Object.assign({}, DC_TEXT, DC_SHORT) : DC_TEXT;
    if (!res || res.status === 'none') return short ? '<span class="dash">—</span>' : '';
    if (res.status === 'insufficient') return `<span class="dcc">${T.insufficient}</span>`;
    let h = `<span class="dcc${res.below ? ' blue' : ''}">${res.below ? T.below : T.notBelow}</span>`;
    if (!short || !res.refSeen) h += `<span class="dcc">${res.refSeen ? T.refSeen : T.refNotSeen}</span>`;
    if (!short) h += `<span class="dcl">کمترین قیمت در ۳۰ روزِ پیش از شروع تخفیف (${fmtDate(Date.parse(res.start + 'T12:00:00Z'), { month: 'long', day: 'numeric' })}): ${fmt(res.low)} تومان</span>`;
    return h;
  }

  /* ------------------------------------------------------------------ *
   * Price chart (SVG): Digikala's line is drawn above the script's own.
   * ------------------------------------------------------------------ */
  const CHART_CSS = `
    .chart { position: relative; }
    .chart svg { display: block; width: 100%; height: auto; overflow: visible; font-family: inherit; }
    .chart .ax { fill: var(--n500, #81858b); font-size: 10px; }
    .chart .grid { stroke: var(--n200, #e0e0e2); stroke-width: 1; }
    .chart .cur { stroke: var(--n500, #81858b); stroke-width: 1; stroke-dasharray: 3 3; }
    .chart .tip { position: absolute; top: 0; pointer-events: none; background: var(--bg, #fff); border: 1px solid var(--n200, #e0e0e2);
      border-radius: 8px; padding: 6px 10px; font-size: 11px; line-height: 1.8; box-shadow: 0 4px 16px rgba(0,0,0,.12); white-space: nowrap; }
    .chart .tip i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-inline-end: 6px; }
    .legend { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 8px 0 0; color: var(--n600, #62666d); font-size: 11px; }
    .legend span { display: inline-flex; align-items: center; gap: 6px; }
    .legend i { width: 18px; height: 0; border-top: 2px solid; }
    .legend i.dash { border-top-style: dashed; }
    .ranges { display: flex; gap: 6px; margin-bottom: 8px; }
    .ranges button { height: 28px; padding: 0 10px; border: 1px solid var(--n200, #e0e0e2); border-radius: 999px; background: none;
      color: var(--n600, #62666d); font-weight: 700; cursor: pointer; }
    .ranges button[aria-pressed="true"] { border-color: var(--p, #ef394e); color: var(--p, #ef394e); }
  `;
  const LINE = {
    dk: { color: '#0fabc6', label: 'قیمت فروش (نمودار دیجی‌کالا)' },
    dkRrp: { color: '#a1a3a8', dash: true, label: 'قیمت مرجع (نمودار دیجی‌کالا)' },
    own: { color: '#f57c00', label: 'قیمت فروش (سوابق شما)' },
  };

  // Series for the chart: [{ key, pts: [[ts, price] | null(gap)] }], bottom layer first.
  function chartSeries(dk, runs) {
    const out = [];
    if (runs && runs.length) {
      const pts = [];
      let prevTo = null;
      for (const [from, to, price, , avail] of runs) {
        if (prevTo != null && from - prevTo > RUN_GAP) pts.push(null);
        if (avail) pts.push([from, price], [to, price]);
        else pts.push(null);
        prevTo = to;
      }
      out.push({ key: 'own', pts });
    }
    if (dk) {
      const keys = [...dk.days.keys()].sort();
      const sel = [];
      const rrp = [];
      let prev = null;
      for (const k of keys) {
        const v = dk.days.get(k);
        const ts = Date.parse(k + 'T12:00:00Z');
        if (prev && Date.parse(k) - Date.parse(prev) > DAY * 1.5) { sel.push(null); rrp.push(null); }
        if (v.avail) { sel.push([ts, v.price]); rrp.push(v.rrp > v.price ? [ts, v.rrp] : null); }
        else { sel.push(null); rrp.push(null); }
        prev = k;
      }
      out.push({ key: 'dkRrp', pts: rrp }, { key: 'dk', pts: sel });
    }
    return out;
  }

  // Returns { html, attach(el) }: attach wires the hover tooltip once the html is in the page.
  function drawChart(series, fromTs, toTs) {
    const W = 640, H = 240, pl = 8, pr = 64, pt = 10, pb = 26;
    const vis = series.map((s) => ({ key: s.key, pts: s.pts.map((p) => (p && p[0] >= fromTs && p[0] <= toTs ? p : null)) }));
    const all = vis.flatMap((s) => s.pts.filter(Boolean));
    if (!all.length) return { html: '<div class="msg"><span>در این بازه داده‌ای وجود ندارد.</span></div>', attach() {} };
    let lo = Math.min(...all.map((p) => p[1]));
    let hi = Math.max(...all.map((p) => p[1]));
    if (hi === lo) { hi *= 1.05; lo *= 0.95; }
    const padV = (hi - lo) * 0.08;
    lo = Math.max(0, lo - padV);
    hi += padV;
    const x0 = Math.min(fromTs, ...all.map((p) => p[0]));
    const x1 = Math.max(toTs, x0 + DAY);
    // RTL page, but time runs left to right like Digikala's own chart
    const X = (t) => pl + ((t - x0) / (x1 - x0)) * (W - pl - pr);
    const Y = (v) => pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb);
    let g = '';
    for (let i = 0; i <= 3; i++) {
      const v = lo + ((hi - lo) * i) / 3;
      g += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${W - pr + 6}" y="${Y(v) + 3}">${fmt(v)}</text>`;
    }
    for (let i = 0; i <= 4; i++) {
      const t = x0 + ((x1 - x0) * i) / 4;
      const anchor = i === 0 ? 'start' : i === 4 ? 'end' : 'middle';
      g += `<text class="ax" x="${X(t)}" y="${H - 6}" text-anchor="${anchor}">${fmtDate(t, { month: 'short', day: 'numeric' })}</text>`;
    }
    for (const s of vis) {
      const st = LINE[s.key];
      let d = '';
      let pen = false;
      for (const p of s.pts) {
        if (!p) { pen = false; continue; }
        d += (pen ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1);
        pen = true;
      }
      if (d) g += `<path d="${d}" fill="none" stroke="${st.color}" stroke-width="${s.key === 'dk' ? 2.2 : 2}"${st.dash ? ' stroke-dasharray="5 4"' : ''} stroke-linejoin="round"/>`;
    }
    const html = `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="نمودار قیمت">${g}` +
      `<line class="cur" y1="${pt}" y2="${H - pb}" x1="-10" x2="-10"/><rect x="${pl}" y="${pt}" width="${W - pl - pr}" height="${H - pt - pb}" fill="transparent"/></svg>` +
      '<div class="tip" hidden></div></div>';
    const attach = (el) => {
      const svgEl = el.querySelector('svg');
      const tip = el.querySelector('.tip');
      const cur = el.querySelector('.cur');
      if (!svgEl) return;
      svgEl.addEventListener('mousemove', (e) => {
        const box = svgEl.getBoundingClientRect();
        const t = x0 + (((e.clientX - box.left) / box.width) * W - pl) / (W - pl - pr) * (x1 - x0);
        const rows = [];
        for (const s of vis.slice().reverse()) {
          let best = null;
          for (const p of s.pts) if (p && (!best || Math.abs(p[0] - t) < Math.abs(best[0] - t))) best = p;
          if (best && Math.abs(best[0] - t) < 2 * DAY) rows.push(`<div><i style="background:${LINE[s.key].color}"></i>${fmt(best[1])} تومان</div>`);
        }
        if (!rows.length) { tip.hidden = true; cur.setAttribute('x1', -10); cur.setAttribute('x2', -10); return; }
        const xs = X(t).toFixed(1);
        cur.setAttribute('x1', xs);
        cur.setAttribute('x2', xs);
        tip.innerHTML = `<b>${fmtDate(t)}</b>` + rows.join('');
        tip.hidden = false;
        const px = ((e.clientX - box.left) / box.width) * el.clientWidth;
        tip.style.left = Math.min(Math.max(0, px + 12), el.clientWidth - tip.offsetWidth) + 'px';
      });
      svgEl.addEventListener('mouseleave', () => { tip.hidden = true; cur.setAttribute('x1', -10); cur.setAttribute('x2', -10); });
    };
    return { html, attach };
  }

  const legendHtml = (series) =>
    '<div class="legend">' + series.slice().reverse().filter((s) => s.pts.some(Boolean))
      .map((s) => `<span><i class="${LINE[s.key].dash ? 'dash' : ''}" style="border-color:${LINE[s.key].color}"></i>${LINE[s.key].label}</span>`).join('') + '</div>';

  /* ------------------------------------------------------------------ *
   * Dialogs (notice, chart): same look as the settings panel
   * ------------------------------------------------------------------ */
  function ensurePanelCss(root) {
    if (root.querySelector('style[data-pn]')) return;
    const st = document.createElement('style');
    st.setAttribute('data-pn', '');
    st.textContent = PANEL_CSS + DC_CSS + CHART_CSS;
    root.appendChild(st);
  }
  // opts: { title, icon, body, actions: [{ act, label, primary }], onAct(act, wrap), onClose() } -> { wrap, body, close }
  function openDialog(opts) {
    const root = getRoot();
    ensurePanelCss(root);
    const wrap = document.createElement('div');
    wrap.className = 'pnw';
    wrap.setAttribute('dir', 'rtl');
    wrap.innerHTML =
      `<div class="pn" role="dialog" aria-modal="true" aria-label="${esc(opts.title)}">` +
      `<div class="top"><div class="ttl"><span class="badge">${svg(opts.icon || 'gear', 20)}</span><span>${esc(opts.title)}</span></div><span class="sp"></span>` +
      `<button class="btn ghost" type="button" data-act="close" title="بستن">${svg('close', 22)}</button></div>` +
      `<div class="pn-body">${opts.body || ''}</div>` +
      (opts.actions ? '<div class="pn-foot">' + opts.actions.map((a) =>
        `<button class="btn sm${a.primary ? ' pri' : ''}" type="button" data-act="${a.act}">${a.label}</button>`).join('') + '</div>' : '') +
      '</div>';
    root.appendChild(wrap);
    let open = true;
    const close = () => {
      if (!open) return;
      open = false;
      wrap.remove();
      window.removeEventListener('keydown', onKey, true);
      if (opts.onClose) opts.onClose();
    };
    // on window, so Escape closes only this dialog and not the table underneath
    const onKey = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } };
    window.addEventListener('keydown', onKey, true);
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) return close();
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'close') close();
      else if (opts.onAct) opts.onAct(b.dataset.act, wrap, b);
    });
    return { wrap, body: wrap.querySelector('.pn-body'), close };
  }

  // The chart window: Digikala's history and the script's records, with the discount check.
  async function openChartDialog(id, cur, title) {
    const dlg = openDialog({ title: 'نمودار قیمت (MAH)', icon: 'tag', body: `<div class="msg">${'<span class="cspin"></span>'}<span>در حال دریافت سابقه‌ی قیمت…</span></div>` });
    let dkAll = [];
    let dkErr = null;
    try { dkAll = await fetchDkChart(id); } catch (e) { dkErr = e; }
    const dk = pickDkSeries(dkAll, cur);
    const runs = getHist(id).r;
    const series = chartSeries(dk, runs);
    const res = discountCheck(cur, mergedDays(dk, runs), dayKey(Date.now()));
    let range = 90;
    const render = () => {
      const now = Date.now();
      const c = drawChart(series, range ? now - range * DAY : 0, now);
      let h = title ? `<p class="ptitle">${esc(title)}</p>` : '';
      if (cur && cur.avail && cur.rrp > cur.price) {
        h += `<div class="dcbox"><b>بررسی تخفیف</b>${discountAcked() ? `<div class="dcb">${dcHtml(res)}</div>`
          : '<button class="btn sm" type="button" data-act="ack">نمایش نتیجه</button>'}</div>`;
      }
      h += '<div class="ranges">' + [[30, '۳۰ روز'], [90, '۳ ماه'], [365, '۱ سال']]
        .map(([d, t]) => `<button type="button" data-act="range" data-d="${d}" aria-pressed="${range === d}">${t}</button>`).join('') + '</div>';
      h += c.html + legendHtml(series);
      if (dkErr) h += '<p class="note">نمودار دیجی‌کالا دریافت نشد؛ فقط سوابق خود شما نشان داده می‌شود.</p>';
      else if (!dk) h += '<p class="note">دیجی‌کالا برای این کالا نمودار قیمتی ندارد؛ فقط سوابق خود شما نشان داده می‌شود.</p>';
      h += `<p class="note">قیمت‌ها به تومان. روش محاسبه: <a href="${DISCLAIMER_URL}" target="_blank" rel="noopener noreferrer">سلب مسئولیت و روش کار</a></p>`;
      dlg.body.innerHTML = h;
      c.attach(dlg.body.querySelector('.chart') || dlg.body);
    };
    dlg.wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'range') { range = +b.dataset.d; render(); }
      else if (b.dataset.act === 'ack') ensureDiscountAck().then((ok) => { if (ok) render(); });
    });
    render();
  }

  /* ------------------------------------------------------------------ *
   * Product page: records the price and shows a strip in the buy box with the
   * discount check, the chart button and (manual mode) a "record price" button.
   * A section is also added to Digikala's own price-chart window.
   * ------------------------------------------------------------------ */
  const STRIP_ID = 'mah-dk-strip';
  const MODAL_SEC_ID = 'mah-dk-chart-sec';
  const STRIP_CSS = `
    :host { all: initial; display: block; margin: 0 0 12px; }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    .st { --p: var(--color-primary-700, #ef394e); --bg: #fff;
      --n700: var(--color-neutral-700, #3f4064); --n600: var(--color-neutral-600, #62666d); --n500: var(--color-neutral-500, #81858b);
      --n200: var(--color-neutral-200, #e0e0e2); --n100: var(--color-neutral-100, #f0f0f1);
      display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 10px; border: 1px dashed var(--n200); border-radius: 8px;
      font-family: Digikala, Tahoma, "Segoe UI", sans-serif; font-size: 12px; line-height: 1.8; color: var(--n700); direction: rtl; }
    :host([data-mah-theme="dark"]) .st { --bg: var(--color-neutral-000, #222732); }
    .tag { font-weight: 700; color: var(--n500); font-size: 11px; }
    .sp { flex: 1; }
    button { font-family: inherit; font-size: 11px; height: 28px; padding: 0 10px; border: 1px solid var(--n200); border-radius: 6px;
      background: var(--bg); color: var(--n700); font-weight: 700; cursor: pointer; white-space: nowrap; }
    button:hover { background: var(--n100); }
    button[aria-pressed="true"] { border-color: #f9a825; color: #b26a00; }
    :host([data-mah-theme="dark"]) button[aria-pressed="true"] { color: #ffca6b; }
    .ok { color: #2e7d32; font-size: 11px; }
  ` + DC_CSS;

  let pageProd = null; // { id, cur, title, res, state: 'loading' | 'ready' | 'error', recorded }
  const productCache = new Map();
  // fresh = skip the 5-minute cache (scheduled checks)
  function fetchProduct(id, fresh) {
    const hit = productCache.get(id);
    if (!fresh && hit && Date.now() - hit.at < 5 * 60e3) return hit.p;
    const p = fetch('https://api.digikala.com/v2/product/' + id + '/', { headers: { Accept: 'application/json' } })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((j) => { const pr = j && j.data && j.data.product; if (!pr || pr.is_inactive) throw new Error('not found'); return pr; });
    p.catch(() => productCache.delete(id));
    productCache.set(id, { at: Date.now(), p });
    return p;
  }
  function obsFromProduct(p) {
    const v = p && p.default_variant;
    const pr = v && !Array.isArray(v) ? v.price : null;
    const avail = !!(p && p.status === 'marketable' && pr && pr.selling_price > 0);
    return {
      price: avail ? pr.selling_price / 10 : 0,
      rrp: avail && pr.rrp_price > pr.selling_price ? pr.rrp_price / 10 : 0,
      avail: avail ? 1 : 0,
    };
  }

  async function loadProductPage(pp) {
    try {
      const p = await fetchProduct(pp.id);
      pp.cur = obsFromProduct(p);
      pp.title = String(p.title_fa || p.title_en || '').trim();
      pp.img = p.images && p.images.main && Array.isArray(p.images.main.url) ? String(p.images.main.url[0] || '') : '';
      pp.recorded = autoRecord() ? observe(pp.id, pp.cur, pp.title, pp.img) : false;
      pp.res = (await checkProduct(pp.id, pp.cur)).res;
      pp.state = 'ready';
    } catch (e) {
      console.warn('[MAH Digikala Extensions] product data:', e);
      pp.state = 'error';
    }
    if (pageProd === pp) renderStrip();
  }

  function renderStrip() {
    const host = document.getElementById(STRIP_ID);
    const pp = pageProd;
    if (!host || !pp) return;
    const manual = settings().history.freq === 'manual';
    let mid = '';
    if (pp.state === 'loading') mid = '<span class="dcl">در حال بررسی سابقه‌ی قیمت…</span>';
    else if (pp.state === 'error') mid = '<span class="dcl">اطلاعات قیمت این کالا دریافت نشد.</span>';
    else if (pp.res && pp.res.status !== 'none') {
      mid = discountAcked() ? `<div class="dcb">${dcHtml(pp.res)}</div>` : '<button type="button" data-act="ack">نمایش نتیجه‌ی بررسی تخفیف</button>';
    }
    host.shadowRoot.querySelector('.body').innerHTML =
      `<span class="tag">MAH · بررسی تخفیف</span>${mid}<span class="sp"></span>` +
      (manual && pp.state === 'ready' ? (pp.recorded ? '<span class="ok">قیمت امروز ثبت شد</span>' : '<button type="button" data-act="record">ثبت قیمت</button>') : '') +
      (pp.state === 'ready' ? `<button type="button" data-act="watch" aria-pressed="${inWatchlist(pp.id)}">${inWatchlist(pp.id) ? '★ در فهرست پیگیری' : '☆ پیگیری قیمت'}</button>` : '') +
      '<button type="button" data-act="chart">نمودار قیمت</button>';
  }

  function ensureStrip() {
    // the buy box, else right after the product title
    const anchor = document.querySelector('[class*="InfoSection__buybox"]') || null;
    const title = anchor ? null : document.querySelector('main h1');
    if (!anchor && !title) return;
    let host = document.getElementById(STRIP_ID);
    if (host && (anchor ? host.parentElement === anchor : host.previousElementSibling === title)) return;
    if (!host) {
      host = document.createElement('div');
      host.id = STRIP_ID;
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${STRIP_CSS}</style><div class="st body"></div>`;
      root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]');
        const pp = pageProd;
        if (!b || !pp) return;
        if (b.dataset.act === 'chart') openChartDialog(pp.id, pp.cur, pp.title);
        else if (b.dataset.act === 'ack') ensureDiscountAck();
        else if (b.dataset.act === 'watch') {
          if (inWatchlist(pp.id)) wlRemove(pp.id);
          else wlAdd(pp.id, { t: pp.title, img: pp.img, obs: pp.cur });
          renderStrip();
        } else if (b.dataset.act === 'record' && pp.cur) {
          pp.recorded = observe(pp.id, pp.cur, pp.title, pp.img, true) || true;
          checkProduct(pp.id, pp.cur).then((r) => { pp.res = r.res; renderStrip(); });
          renderStrip();
        }
      });
    }
    host.setAttribute(THEME_ATTR, currentMode());
    if (anchor) anchor.prepend(host);
    else title.insertAdjacentElement('afterend', host);
    renderStrip();
  }

  // A section at the bottom of Digikala's own "نمودار قیمت" window: the discount check and the script's records.
  function ensureModalSection() {
    const pp = pageProd;
    const legend = document.querySelector('[class*="MainProductPriceChartModalColorInfo"]');
    if (!legend || !pp || pp.state !== 'ready') return;
    let box = legend.parentElement;
    while (box && box !== document.body && !box.querySelector('canvas')) box = box.parentElement;
    if (!box || box === document.body || box.querySelector('#' + MODAL_SEC_ID)) return;
    const host = document.createElement('div');
    host.id = MODAL_SEC_ID;
    host.setAttribute(THEME_ATTR, currentMode());
    const root = host.attachShadow({ mode: 'open' });
    const runs = getHist(pp.id).r;
    const series = chartSeries(null, runs);
    const now = Date.now();
    const c = series.length ? drawChart(series, now - 90 * DAY, now) : null;
    const showRes = pp.res && pp.res.status !== 'none';
    root.innerHTML = `<style>${STRIP_CSS}${CHART_CSS} .st{display:block;margin-top:16px} h4{margin:0 0 6px;font-size:13px} .note{color:var(--n500);font-size:11px;margin:6px 0 0}</style>` +
      '<div class="st"><h4>افزونه‌ی MAH</h4>' +
      (showRes ? `<div class="dcb">${discountAcked() ? dcHtml(pp.res) : '<button type="button" data-act="ack">نمایش نتیجه‌ی بررسی تخفیف</button>'}</div>` : '') +
      (c ? '<p class="note">سوابق قیمتی که این مرورگر ثبت کرده (۳ ماه اخیر):</p>' + c.html + legendHtml(series)
        : '<p class="note">هنوز سابقه‌ی قیمتی برای این کالا در این مرورگر ثبت نشده است.</p>') +
      `<p class="note"><a href="${DISCLAIMER_URL}" target="_blank" rel="noopener noreferrer">روش محاسبه و سلب مسئولیت</a></p></div>`;
    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="ack"]')) ensureDiscountAck().then((ok) => { if (ok) { host.remove(); ensureModalSection(); } });
    });
    box.appendChild(host);
    if (c) c.attach(root.querySelector('.chart'));
  }

  // Called on every page change / re-render.
  function ensureProductPage() {
    const id = productId();
    if (!historyOn() || !id || location.hostname !== 'www.digikala.com') {
      pageProd = null;
      const s = document.getElementById(STRIP_ID);
      if (s) s.remove();
      return;
    }
    if (!pageProd || pageProd.id !== id) {
      pageProd = { id, state: 'loading' };
      loadProductPage(pageProd);
    }
    ensureStrip();
    ensureModalSection();
  }

  /* ------------------------------------------------------------------ *
   * Watchlist: products the user follows. Stored under "wl" as
   *   { [id]: { t, img, added, target, last: { price, rrp, avail, ts }, err } }.
   * Every fresh price the script sees for one of them goes through wlObserve,
   * which raises the alerts (price drop, target price, back in stock).
   * ------------------------------------------------------------------ */
  const WL_KEY = 'wl';
  const wlAll = () => store.get(WL_KEY, {});
  const inWatchlist = (id) => !!wlAll()[id];
  const wlListeners = [];
  const wlChanged = () => wlListeners.forEach((fn) => fn());
  store.watch(WL_KEY, wlChanged);

  function wlAdd(id, info) {
    const wl = wlAll();
    if (wl[id]) return false;
    const o = info.obs;
    wl[id] = {
      t: String(info.t || '').slice(0, 200),
      img: info.img || '',
      added: Date.now(),
      target: null,
      last: o ? { price: o.price, rrp: o.rrp, avail: o.avail ? 1 : 0, ts: Date.now() } : null,
    };
    store.set(WL_KEY, wl);
    if (o) recordPrice(id, o, info.t);
    wlChanged();
    return true;
  }
  function wlRemove(id) {
    const wl = wlAll();
    delete wl[id];
    store.set(WL_KEY, wl);
    wlChanged();
  }
  function wlSetTarget(id, v) {
    const wl = wlAll();
    if (!wl[id]) return;
    const n = num(v);
    wl[id].target = n > 0 ? n : null;
    store.set(WL_KEY, wl);
    wlChanged();
  }

  // A fresh price for a product: updates its watchlist entry (if any) and raises alerts against the previous price.
  function wlObserve(id, obs, title, img) {
    const wl = wlAll();
    const w = wl[id];
    if (!w || !obs) return;
    const prev = w.last;
    const now = Date.now();
    w.last = { price: obs.price, rrp: obs.rrp, avail: obs.avail ? 1 : 0, ts: now };
    if (title) w.t = String(title).slice(0, 200);
    if (img) w.img = img;
    delete w.err;
    const al = settings().alerts;
    const out = [];
    if (prev && al.drop && prev.avail && obs.avail && obs.price < prev.price) out.push({ kind: 'drop' });
    if (prev && al.stock && !prev.avail && obs.avail) out.push({ kind: 'stock' });
    if (w.target && obs.avail && obs.price <= w.target && !(prev && prev.avail && prev.price <= w.target)) out.push({ kind: 'target', target: w.target });
    store.set(WL_KEY, wl);
    wlChanged();
    if (out.length) raiseAlerts(out.map((a) => Object.assign(a, { id, t: w.t, price: obs.price, prev: prev ? prev.price : null, ts: now })));
  }

  // One price observation from any source: saved in the history and passed to the watchlist.
  function observe(id, obs, title, img, force) {
    const rec = recordPrice(id, obs, title, force);
    wlObserve(id, obs, title, img);
    return rec;
  }

  /* ---------- alerts ---------- */
  const ALERTS_KEY = 'alerts'; // newest first: [{ id, kind, t, price, prev, target, ts, seen }]
  const unseenAlerts = () => store.get(ALERTS_KEY, []).filter((a) => !a.seen).length;
  const productUrl = (id) => 'https://www.digikala.com/product/dkp-' + id + '/';
  function alertText(a) {
    const t = '«' + (a.t || 'کالا') + '»';
    if (a.kind === 'drop') return `قیمت ${t} از ${fmt(a.prev)} به ${fmt(a.price)} تومان کاهش یافت.`;
    if (a.kind === 'target') return `قیمت ${t} به ${fmt(a.price)} تومان رسید (قیمت هدف شما: ${fmt(a.target)} تومان).`;
    return `${t} دوباره موجود شد (${fmt(a.price)} تومان).`;
  }
  function raiseAlerts(list) {
    const all = store.get(ALERTS_KEY, []);
    store.set(ALERTS_KEY, list.concat(all).slice(0, 50));
    showToasts(list);
    if (settings().alerts.desktop) {
      for (const a of list) {
        try {
          GM_notification({ title: 'افزونه‌های MAH دیجی‌کالا', text: alertText(a), onclick: () => window.open(productUrl(a.id), '_blank') });
        } catch (e) { /* notifications not available */ }
      }
    }
    ensureMenuItem();
  }
  function markAlertsSeen() {
    const all = store.get(ALERTS_KEY, []);
    if (!all.some((a) => !a.seen)) return;
    store.set(ALERTS_KEY, all.map((a) => Object.assign(a, { seen: true })));
    ensureMenuItem();
  }

  const TOAST_CSS = `
    .toasts { position: fixed; bottom: 16px; left: 16px; z-index: 2147483001; display: flex; flex-direction: column; gap: 8px;
      width: min(380px, calc(100vw - 32px)); font-family: Digikala, Tahoma, "Segoe UI", sans-serif; font-size: 12px; line-height: 1.8; direction: rtl; }
    .toast { --bg: #fff; --n700: var(--color-neutral-700, #3f4064); --n200: var(--color-neutral-200, #e0e0e2); --p: var(--color-primary-700, #ef394e);
      background: var(--bg); color: var(--n700); border: 1px solid var(--n200); border-inline-start: 4px solid #1a56b4; border-radius: 10px;
      padding: 10px 12px; box-shadow: 0 6px 24px rgba(0,0,0,.18); display: flex; gap: 8px; align-items: flex-start; }
    :host([data-mah-theme="dark"]) .toast { --bg: var(--color-neutral-000, #222732); }
    .toast p { margin: 0; flex: 1; }
    .toast a { color: var(--p); font-weight: 700; text-decoration: none; }
    .toast button { border: 0; background: none; color: inherit; cursor: pointer; padding: 0; line-height: 1; }
  `;
  function showToasts(list) {
    const root = getRoot();
    let box = root.querySelector('.toasts');
    if (!box) {
      box = document.createElement('div');
      box.className = 'toasts';
      root.appendChild(box);
    }
    for (const a of list) {
      const el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('role', 'status');
      el.innerHTML = `<p>${esc(alertText(a))} <a href="${productUrl(a.id)}" target="_blank" rel="noopener">مشاهده</a></p>` +
        `<button type="button" title="بستن">${svg('close', 16)}</button>`;
      el.querySelector('button').addEventListener('click', () => el.remove());
      box.appendChild(el);
      setTimeout(() => el.remove(), 15000);
    }
  }

  /* ---------- scheduled checks ----------
   * In the timed modes the whole watchlist is checked once per interval, one product
   * at a time, about 1.5 s apart. The queue is kept in storage, so a run that stops
   * (tab closed) continues in the next Digikala tab; a lock with a heartbeat makes sure
   * only one tab works on it at a time. */
  const FREQ_MS = { '6h': 6 * 3600e3, '12h': 12 * 3600e3, daily: DAY, weekly: 7 * DAY };
  const RUN_KEY = 'wlRun'; // { queue: [ids], total, started, forced } while a run is in progress
  const LAST_KEY = 'wlLast'; // when the last complete run finished
  const LOCK_KEY = 'wlLock'; // { tab, ts }
  const LOCK_STALE = 20e3;
  const CHECK_GAP = 1500;
  const TAB_ID = Math.random().toString(36).slice(2);
  let runningHere = false;

  const wlInterval = () => (historyOn() ? FREQ_MS[settings().history.freq] || 0 : 0);
  const wlNextRun = () => { const ms = wlInterval(); return ms ? store.get(LAST_KEY, 0) + ms : null; };
  const wlRunState = () => store.get(RUN_KEY) || null;

  function takeLock() {
    const l = store.get(LOCK_KEY);
    if (l && l.tab !== TAB_ID && Date.now() - l.ts < LOCK_STALE) return false;
    store.set(LOCK_KEY, { tab: TAB_ID, ts: Date.now() });
    return true;
  }

  // forced = "check now" (records even in manual mode)
  function startRun(forced, ids) {
    if (wlRunState()) return pumpRun();
    const queue = ids || Object.keys(wlAll());
    if (!queue.length) return;
    store.set(RUN_KEY, { queue, total: queue.length, started: Date.now(), forced: !!forced });
    wlChanged();
    pumpRun();
  }
  function stopRun() {
    store.del(RUN_KEY);
    wlChanged();
  }

  async function checkWatched(id, force) {
    try {
      const p = await fetchProduct(id, true);
      const im = p.images && p.images.main && Array.isArray(p.images.main.url) ? String(p.images.main.url[0] || '') : '';
      observe(id, obsFromProduct(p), String(p.title_fa || p.title_en || '').trim(), im, force);
    } catch (e) {
      const wl = wlAll();
      if (wl[id]) { wl[id].err = /not found/.test(errText(e)) ? 'gone' : 'error'; store.set(WL_KEY, wl); }
    }
  }

  async function pumpRun() {
    if (runningHere || location.hostname !== 'www.digikala.com') return;
    runningHere = true;
    try {
      for (;;) {
        const run = wlRunState();
        if (!run) break;
        if (!run.queue.length) { store.del(RUN_KEY); store.set(LAST_KEY, Date.now()); break; }
        if (!takeLock()) break; // another tab is on it
        const id = run.queue[0];
        await checkWatched(id, run.forced);
        const now = wlRunState();
        if (!now) break; // stopped meanwhile
        now.queue = now.queue.filter((x) => x !== id);
        store.set(RUN_KEY, now);
        wlChanged();
        if (now.queue.length) await sleep(CHECK_GAP);
      }
    } finally {
      runningHere = false;
      const l = store.get(LOCK_KEY);
      if (l && l.tab === TAB_ID) store.del(LOCK_KEY);
      wlChanged();
    }
  }

  function schedTick() {
    if (location.hostname !== 'www.digikala.com') return;
    if (wlRunState()) { pumpRun(); return; }
    const next = wlNextRun();
    if (next != null && Date.now() >= next && Object.keys(wlAll()).length) startRun(false);
  }

  /* ---------- importing Digikala's favourites (on its favourites page) ---------- */
  const FAV_BAR_ID = 'mah-dk-fav-bar';
  const isFavoritesPage = () => /^\/profile\/favorites\/?/.test(location.pathname);

  // All favourite products, through the same endpoint the favourites page uses (needs the user's session).
  async function fetchFavorites(progress) {
    const out = [];
    for (let page = 1; page <= 200; page++) {
      const r = await fetch('https://api.digikala.com/v1/profile/favorite-products/?page=' + page, { credentials: 'include', headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = ((await r.json()) || {}).data || {};
      for (const p of d.products || []) {
        const im = p.images && p.images.main && Array.isArray(p.images.main.url) ? String(p.images.main.url[0] || '') : '';
        out.push({ id: String(p.id), t: String(p.title_fa || p.title_en || '').trim(), img: im, obs: obsFromProduct(p) });
      }
      progress(out.length);
      if (page >= ((d.pager && d.pager.total_pages) || 1)) break;
    }
    return out;
  }

  async function importFavorites(bar) {
    const msg = bar.shadowRoot.querySelector('.msgx');
    const btn = bar.shadowRoot.querySelector('button');
    btn.disabled = true;
    let items;
    try {
      items = await fetchFavorites((n) => { msg.textContent = 'در حال دریافت علاقه‌مندی‌ها… ' + L(n); });
    } catch (e) {
      // not reachable that way: read the cards on this page instead (scrolls to load them all)
      console.warn('[MAH Digikala Extensions] favourites API:', e);
      msg.textContent = 'در حال خواندن کالاهای این صفحه…';
      const src = createScrollSource();
      await src.load(Infinity, { stopped: false, update: (n) => { msg.textContent = 'در حال خواندن کالاهای این صفحه… ' + L(n); } });
      items = src.rows.map((r) => ({ id: r.id, t: r.title, img: r.img, obs: obsFromRow(r) }));
    }
    let added = 0;
    for (const it of items) if (wlAdd(it.id, it)) added++;
    msg.textContent = items.length
      ? `${L(added)} کالا به فهرست پیگیری افزوده شد` + (items.length - added ? ` و ${L(items.length - added)} کالا از قبل در فهرست بود.` : '.')
      : 'کالایی در علاقه‌مندی‌ها پیدا نشد.';
    btn.disabled = false;
  }

  function ensureFavoritesBar() {
    const want = isFavoritesPage() && historyOn() && location.hostname === 'www.digikala.com';
    let bar = document.getElementById(FAV_BAR_ID);
    if (!want) { if (bar) bar.remove(); return; }
    const main = document.querySelector('main');
    if (!main) return;
    if (bar && main.contains(bar)) return;
    if (!bar) {
      bar = document.createElement('div');
      bar.id = FAV_BAR_ID;
      const root = bar.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${STRIP_CSS} :host{margin:12px 0} .msgx{color:var(--n500);font-size:11px}</style>` +
        '<div class="st"><span class="tag">MAH</span><span>علاقه‌مندی‌ها را به فهرست پیگیری افزونه اضافه کنید تا قیمتشان خودکار بررسی شود.</span>' +
        '<span class="sp"></span><span class="msgx"></span><button type="button">افزودن همه به فهرست پیگیری</button></div>';
      root.querySelector('button').addEventListener('click', () => importFavorites(bar));
    }
    bar.setAttribute(THEME_ATTR, currentMode());
    main.prepend(bar);
  }

  /* ---------- small trend line for the watchlist ---------- */
  function sparkline(runs) {
    const now = Date.now();
    const pts = [];
    for (const [from, to, price, , avail] of runs || []) {
      if (!avail || to < now - 90 * DAY) continue;
      pts.push([Math.max(from, now - 90 * DAY), price], [to, price]);
    }
    if (pts.length < 2) return '<span class="dash">—</span>';
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs, x0 + 1);
    const lo = Math.min(...ys), hi = Math.max(...ys, lo + 1);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + (((p[0] - x0) / (x1 - x0)) * 96 + 2).toFixed(1) + ' ' + ((1 - (p[1] - lo) / (hi - lo)) * 20 + 2).toFixed(1)).join('');
    return `<svg class="spark" viewBox="0 0 100 24" width="100" height="24" aria-hidden="true"><path d="${d}" fill="none" stroke="#f57c00" stroke-width="1.6"/></svg>`;
  }

  if (window.__MAH_TEST__) Object.assign(window.__MAH_TEST__, { discountCheck, jalaliToGregorian, dkDayKey, addObservation, mergedDays, chartSeries, drawChart, wlObserve, wlAdd, startRun, schedTick });

  /* ------------------------------------------------------------------ *
   * Panel: settings and about. Opened from the entry in the profile menu
   * or from the userscript manager's menu (works when logged out too).
   * ------------------------------------------------------------------ */
  const REPO_URL = 'https://github.com/H-MAli/mah-digikala-extensions';
  const DONATE_URL = 'https://www.coffeete.ir/hmali';
  const DISCLAIMER_URL = REPO_URL + '/blob/main/DISCLAIMER.fa.md';
  const BACKUP_APP = 'mah-digikala-extensions'; // marks our backup files
  const scriptVersion = () => { try { return GM_info.script.version; } catch (e) { return ''; } };

  const PANEL_TABS = [
    { key: 'watch', label: 'فهرست پیگیری' },
    { key: 'settings', label: 'تنظیمات' },
    { key: 'about', label: 'درباره' },
  ];
  const FEATURE_ROWS = [
    { key: 'table', label: 'جدول کالاها', hint: 'دکمه‌ی «جدول کالاها» در شگفت‌انگیزها و صفحه‌های دسته‌بندی، جستجو، برند و فروشنده' },
    { key: 'theme', label: 'حالت نمایش', hint: 'دکمه‌ی روشن / تاریک / سیستم کنار زنگ اعلان؛ اگر خاموش باشد سایت روشن نمایش داده می‌شود' },
    { key: 'compare', label: 'مقایسه‌ی قیمت', hint: 'دکمه‌ی «مقایسه قیمت» در صفحه‌ی کالا' },
    { key: 'history', label: 'سابقه‌ی قیمت و بررسی تخفیف', hint: 'ثبت قیمت‌ها در همین مرورگر، نمودار قیمت و بررسی تخفیف در صفحه‌ی کالا و جدول' },
  ];
  const FREQ_OPTIONS = [
    ['manual', 'دستی: فقط با دکمه‌ی «ثبت قیمت» در صفحه‌ی کالا'],
    ['visit', 'هنگام بازدید: هر بار که صفحه‌ی کالا یا جدول کالاها را باز می‌کنید'],
    ['6h', 'هر ۶ ساعت'],
    ['12h', 'هر ۱۲ ساعت'],
    ['daily', 'روزی یک بار'],
    ['weekly', 'هفته‌ای یک بار'],
  ];
  const SHOP_LABELS = { torob: 'ترب', emalls: 'ایمالز', basalam: 'باسلام', foreign: 'فروشگاه‌های خارجی (آمازون و ای‌بی)' };

  function exportData() {
    const data = {};
    for (const k of store.keys()) data[k] = store.get(k);
    const json = JSON.stringify({ app: BACKUP_APP, version: scriptVersion(), exported: new Date().toISOString(), data }, null, 2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = 'mah-digikala-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // Replaces everything stored with the backup's contents, then reloads the page.
  async function importData(file) {
    let j = null;
    try { j = JSON.parse(await file.text()); } catch (e) { /* handled below */ }
    if (!j || j.app !== BACKUP_APP || !j.data || typeof j.data !== 'object') {
      alert('این فایل، پشتیبان افزونه‌های MAH دیجی‌کالا نیست.');
      return;
    }
    if (!confirm('همه‌ی داده‌ها و تنظیمات فعلی افزونه با محتوای این فایل جایگزین می‌شود. ادامه می‌دهید؟')) return;
    for (const k of store.keys()) store.del(k);
    for (const k of Object.keys(j.data)) store.set(k, j.data[k]);
    location.reload();
  }

  const checkbox = (attrs, checked, disabled) =>
    `<input type="checkbox" ${attrs}${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}>`;

  function renderSettings() {
    const st = settings();
    const usd = manualRate();
    let h = '<section><h3>قابلیت‌ها</h3>';
    for (const f of FEATURE_ROWS) {
      h += `<label class="row">${checkbox(`data-feature="${f.key}"`, st.features[f.key] !== false)}` +
        `<span><b>${f.label}</b><small>${f.hint}</small></span></label>`;
    }
    h += '</section><section><h3>مقایسه‌ی قیمت</h3><div class="shops">';
    const shopsOn = CMP_TABS.filter((t) => st.shops[t.key] !== false).length;
    for (const t of CMP_TABS) {
      const on = st.shops[t.key] !== false;
      // the last shop left on cannot be turned off (turn off the whole feature instead)
      h += `<label class="row sm">${checkbox(`data-shop="${t.key}"`, on, !feature('compare') || (on && shopsOn === 1))}` +
        `<span>${logoImg(t.logo)}${SHOP_LABELS[t.key]}</span></label>`;
    }
    h += '</div><label class="field-row"><span>نرخ هر دلار (تومان)</span>' +
      `<input type="text" inputmode="numeric" dir="ltr" data-usd value="${usd ? usd : ''}" placeholder="خودکار">` +
      '<small>برای تبدیل قیمت فروشگاه‌های خارجی. خالی بگذارید تا نرخ خودکار (open.er-api.com) استفاده شود.</small></label></section>';
    h += '<section><h3>سابقه‌ی قیمت</h3>' +
      '<label class="field-row"><span>ثبت قیمت‌ها</span><select data-freq' + (feature('history') ? '' : ' disabled') + '>' +
      FREQ_OPTIONS.map(([v, t]) => `<option value="${v}"${st.history.freq === v ? ' selected' : ''}>${t}</option>`).join('') + '</select>' +
      '<small>در گزینه‌های زمان‌دار، قیمت کالاهای فهرست پیگیری با همین فاصله خودکار بررسی می‌شود؛ ' +
      'صفحه‌های کالا و جدول کالاها هم هنگام باز شدن ثبت می‌شوند. سوابق تا یک سال نگه داشته می‌شوند.</small></label>' +
      `<p class="note">سابقه‌ی ${L(historyCount())} کالا در این مرورگر ثبت شده است. ` +
      `<a href="${DISCLAIMER_URL}" target="_blank" rel="noopener noreferrer">روش کار بررسی تخفیف</a></p>` +
      '<div class="acts"><button class="btn sm" type="button" data-act="delhist">حذف همه‌ی سوابق قیمت</button></div></section>';
    h += '<section><h3>هشدارهای فهرست پیگیری</h3>' +
      `<label class="row sm">${checkbox('data-alert="drop"', st.alerts.drop, !feature('history'))}<span>کاهش قیمت</span></label>` +
      `<label class="row sm">${checkbox('data-alert="stock"', st.alerts.stock, !feature('history'))}<span>موجود شدن دوباره</span></label>` +
      `<label class="row sm">${checkbox('data-alert="desktop"', st.alerts.desktop, !feature('history'))}<span>نمایش هشدارها به‌صورت اعلان دسکتاپ هم</span></label>` +
      '<p class="note">هشدار رسیدن به قیمت هدف همیشه فعال است؛ قیمت هدف هر کالا را در فهرست پیگیری وارد کنید. ' +
      'هشدارها فقط وقتی صادر می‌شوند که زبانه‌ای از دیجی‌کالا باز باشد.</p></section>';
    h += '<section><h3>نمایش اعداد</h3><div class="shops">' +
      `<label class="row sm"><input type="radio" name="digits" value="fa"${st.digits !== 'en' ? ' checked' : ''}><span>فارسی (۱۲۳)</span></label>` +
      `<label class="row sm"><input type="radio" name="digits" value="en"${st.digits === 'en' ? ' checked' : ''}><span>لاتین (123)</span></label>` +
      '</div><div class="note" data-reload hidden>برای اعمال این تغییر، صفحه را دوباره بارگذاری کنید. ' +
      '<button class="link" type="button" data-act="reload">بارگذاری دوباره</button></div></section>';
    h += '<section><h3>پشتیبان‌گیری</h3>' +
      '<p class="note">همه‌ی داده‌های افزونه فقط در همین مرورگر نگه داشته می‌شوند. برای انتقال به مرورگر دیگر یا نگه‌داری نسخه‌ی پشتیبان، از آن‌ها خروجی بگیرید.</p>' +
      `<div class="acts"><button class="btn sm" type="button" data-act="export">${svg('download', 18)}<span>خروجی گرفتن</span></button>` +
      '<button class="btn sm" type="button" data-act="import"><span>بازگردانی از فایل…</span></button>' +
      '<input type="file" accept="application/json,.json" data-file hidden></div></section>';
    return h;
  }

  function renderWatch() {
    if (!historyOn()) {
      return '<div class="msg"><span>فهرست پیگیری بخشی از قابلیت «سابقه‌ی قیمت و بررسی تخفیف» است که در تنظیمات خاموش است.</span></div>';
    }
    const wl = wlAll();
    const ids = Object.keys(wl).sort((a, b) => (wl[b].added || 0) - (wl[a].added || 0));
    const run = wlRunState();
    const last = store.get(LAST_KEY, 0);
    const next = wlNextRun();
    let h = '<section class="wl-head"><div class="wl-sum">' +
      `<b>${L(ids.length)} کالا</b>` +
      `<small>آخرین بررسی کامل: ${last ? fmtDate(last, { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}` +
      ' · بررسی بعدی: ' + (next ? (next <= Date.now() ? 'به‌زودی' : fmtDate(next, { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })) : 'فقط دستی') + '</small></div>';
    if (run) {
      h += `<span class="wl-prog"><span class="cspin"></span>در حال بررسی ${L(Math.min(run.total, run.total - run.queue.length + 1))} از ${L(run.total)}</span>` +
        '<button class="btn sm" type="button" data-act="wlstop">توقف</button>';
    } else if (ids.length) {
      h += '<button class="btn sm pri" type="button" data-act="wlcheck">بررسی همین حالا</button>';
    }
    h += '</section>';

    const alerts = store.get(ALERTS_KEY, []).slice(0, 10);
    if (alerts.length) {
      h += '<section><h3>هشدارهای اخیر</h3><ul class="wl-alerts">' + alerts.map((a) =>
        `<li class="${a.seen ? '' : 'new'}"><span>${esc(alertText(a))}</span> <a href="${productUrl(a.id)}" target="_blank" rel="noopener">مشاهده</a>` +
        `<small>${fmtDate(a.ts, { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small></li>`).join('') +
        '</ul><button class="link" type="button" data-act="clearalerts">پاک کردن هشدارها</button></section>';
    }

    if (!ids.length) {
      return h + '<div class="msg col"><b>فهرست پیگیری خالی است.</b>' +
        '<span>با دکمه‌ی «☆ پیگیری قیمت» در صفحه‌ی کالا یا ستاره‌ی کنار نام کالا در جدول کالاها، کالا اضافه کنید.</span>' +
        '<span>کالاهای <a href="https://www.digikala.com/profile/favorites/" target="_blank" rel="noopener">علاقه‌مندی‌های دیجی‌کالا</a> را هم می‌توانید یک‌جا از همان صفحه اضافه کنید.</span></div>';
    }
    h += '<div class="wl-list">';
    for (const id of ids) {
      const w = wl[id];
      const lp = w.last;
      let price = '<span class="dash">—</span>';
      if (lp) price = lp.avail ? `<b>${fmt(lp.price)}</b> تومان` + (lp.rrp > lp.price ? ` <s>${fmt(lp.rrp)}</s>` : '') : '<span class="oos">ناموجود</span>';
      const err = w.err === 'gone' ? '<small class="err">این کالا در دیجی‌کالا پیدا نشد.</small>' : w.err ? '<small class="err">آخرین بررسی ناموفق بود.</small>' : '';
      h += `<div class="wl-row" data-id="${esc(id)}">` +
        (w.img ? `<img src="${esc(w.img)}" alt="" loading="lazy">` : '<i class="ph"></i>') +
        `<div class="wl-main"><a href="${productUrl(id)}" target="_blank" rel="noopener">${esc(w.t || 'کالای ' + id)}</a>` +
        `<div class="wl-meta">${price}${lp ? `<small>بررسی: ${fmtDate(lp.ts, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small>` : ''}${err}</div></div>` +
        sparkline(getHist(id).r) +
        `<label class="wl-target"><small>قیمت هدف</small><input type="text" inputmode="numeric" dir="ltr" data-target="${esc(id)}" value="${w.target ? w.target : ''}" placeholder="—"></label>` +
        '<div class="wl-acts">' +
        `<button class="btn sm" type="button" data-act="wlchart" data-id="${esc(id)}" title="نمودار قیمت">نمودار</button>` +
        `<button class="btn sm" type="button" data-act="wlone" data-id="${esc(id)}" title="بررسی قیمت همین کالا">بررسی</button>` +
        `<button class="btn ghost sm" type="button" data-act="wldel" data-id="${esc(id)}" title="حذف از فهرست پیگیری">${svg('close', 16)}</button>` +
        '</div></div>';
    }
    return h + '</div>';
  }

  function renderAbout() {
    const link = (url, text) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    return '<div class="about">' +
      `<div class="name"><b>افزونه‌های MAH دیجی‌کالا</b><span class="chip" dir="ltr">v${esc(scriptVersion())}</span></div>` +
      '<p>ساخته‌ی محمدعلی حق‌شناس. این افزونه پروژه‌ای مستقل، غیررسمی، رایگان و متن‌باز است و هیچ ارتباطی با دیجی‌کالا ندارد. ' +
      'هر آنچه نشان می‌دهد اطلاعاتی است که به‌طور خودکار و فقط برای استفاده‌ی شخصی شما تولید می‌شود؛ پیش از هر تصمیمی، آن را در خود سایت بررسی کنید.</p>' +
      '<ul class="links">' +
      `<li>${link(DISCLAIMER_URL, 'سلب مسئولیت و روش کار')}</li>` +
      `<li>${link(REPO_URL, 'صفحه‌ی پروژه در گیت‌هاب')}</li>` +
      `<li>${link(REPO_URL + '/issues', 'گزارش اشکال یا پیشنهاد')}</li>` +
      `<li>${link(DONATE_URL, 'حمایت از پروژه در کافیته')}</li>` +
      `<li>مجوز: ${link(REPO_URL + '/blob/main/LICENSE', 'Apache 2.0')}</li>` +
      '</ul></div>';
  }

  const PANEL_CSS = `
    .pnw { position: fixed; inset: 0; z-index: 2147483000; background: rgba(0,0,0,.5); display: flex;
      align-items: center; justify-content: center; padding: 16px; }
    .pn { --p: var(--color-primary-700, #ef394e); --bg: #fff; --hover: #fafafb;
      --n700: var(--color-neutral-700, #3f4064); --n600: var(--color-neutral-600, #62666d); --n500: var(--color-neutral-500, #81858b);
      --n200: var(--color-neutral-200, #e0e0e2); --n100: var(--color-neutral-100, #f0f0f1);
      width: min(640px, 100%); max-height: min(760px, 100%); display: flex; flex-direction: column; background: var(--bg);
      border-radius: 16px; overflow: hidden; box-shadow: 0 12px 40px rgba(0,0,0,.35);
      font-family: Digikala, Tahoma, "Segoe UI", sans-serif; font-size: 12px; line-height: 1.8; color: var(--n700); direction: rtl; }
    :host([data-mah-theme="dark"]) .pn { --bg: var(--color-neutral-000, #222732); --hover: #2b303c; color-scheme: dark; }
    .pn .top { height: 56px; padding: 0 16px; }
    .pn-tabs { display: flex; gap: 4px; padding: 0 12px; border-bottom: 1px solid var(--n200); flex: none; overflow-x: auto; }
    .pn-tabs button { height: 42px; padding: 0 14px; border: 0; background: none; border-bottom: 2px solid transparent;
      color: var(--n600); font-weight: 700; cursor: pointer; white-space: nowrap; }
    .pn-tabs button[aria-selected="true"] { color: var(--p); border-bottom-color: var(--p); }
    .pn-body { padding: 8px 20px 20px; overflow: auto; flex: 1; }
    .pn section { padding: 14px 0; border-bottom: 1px solid var(--n100); }
    .pn section:last-child { border-bottom: 0; }
    .pn h3 { margin: 0 0 8px; font-size: 13px; }
    .pn .row { display: flex; align-items: flex-start; gap: 10px; padding: 6px 0; cursor: pointer; }
    .pn .row.sm { align-items: center; padding: 2px 0; }
    .pn .row span { display: inline-flex; flex-direction: column; }
    .pn .row.sm span { flex-direction: row; align-items: center; gap: 6px; }
    .pn .row small, .pn .field-row small { color: var(--n500); font-size: 11px; }
    .pn input[type="checkbox"], .pn input[type="radio"] { width: 16px; height: 16px; margin: 3px 0 0; accent-color: var(--p); flex: none; }
    .pn .row.sm input { margin: 0; }
    .pn input:disabled + span { opacity: .5; }
    .pn .shops { display: flex; flex-wrap: wrap; gap: 4px 20px; }
    .pn .field-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin-top: 10px; }
    .pn .field-row small { flex-basis: 100%; }
    .pn .field-row input { width: 140px; height: 32px; padding: 0 10px; border: 1px solid var(--n200); border-radius: 8px;
      background: var(--bg); color: inherit; }
    .pn .note { color: var(--n500); font-size: 11px; margin: 6px 0 0; }
    .pn .link { border: 0; background: none; color: var(--p); font-weight: 700; cursor: pointer; padding: 0 4px; }
    .pn .acts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .pn .btn.sm { height: 32px; padding: 0 12px; text-decoration: none; }
    .pn .lg { width: 16px; height: 16px; border-radius: 3px; object-fit: contain; }
    .pn .about { padding: 14px 0; }
    .pn .about .name { display: flex; align-items: center; gap: 10px; font-size: 15px; }
    .pn .about p { margin: 12px 0; color: var(--n600); }
    .pn .links { margin: 0; padding: 0 18px 0 0; }
    .pn .links li { padding: 3px 0; }
    .pn .links a { color: var(--p); text-decoration: none; font-weight: 700; }
    .pn .links a:hover { text-decoration: underline; }
    .pn .btn.pri { background: var(--p); border-color: var(--p); color: #fff; }
    .pn-foot { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 20px; border-top: 1px solid var(--n200); flex: none; }
    .pn .msg { display: flex; align-items: center; justify-content: center; gap: 10px; min-height: 160px; color: var(--n600); }
    .pn .cspin { width: 18px; height: 18px; border: 2px solid var(--n200); border-top-color: var(--p); border-radius: 50%;
      animation: sp .8s linear infinite; flex: none; display: inline-block; }
    .pn .ptitle { margin: 12px 0 8px; font-weight: 700; font-size: 13px; }
    .pn .dcbox { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 12px; margin: 8px 0 12px;
      border: 1px solid var(--n200); border-radius: 10px; }
    .pn .notice ul { margin: 8px 0; padding: 0 18px 0 0; }
    .pn .notice li { padding: 3px 0; }
    .pn .notice a, .pn .note a { color: var(--p); }
    .pn .wl-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
    .pn .wl-sum { display: flex; flex-direction: column; flex: 1; }
    .pn .wl-sum small { color: var(--n500); font-size: 11px; }
    .pn .wl-prog { display: inline-flex; align-items: center; gap: 8px; color: var(--n600); }
    .pn .wl-prog .cspin { width: 14px; height: 14px; }
    .pn .wl-alerts { margin: 0; padding: 0; list-style: none; }
    .pn .wl-alerts li { padding: 4px 0; border-bottom: 1px dashed var(--n100); }
    .pn .wl-alerts li.new span { font-weight: 700; }
    .pn .wl-alerts small { display: block; color: var(--n500); font-size: 10px; }
    .pn .wl-alerts a, .pn .wl-main a, .pn .msg a { color: var(--p); text-decoration: none; }
    .pn .msg.col { flex-direction: column; text-align: center; }
    .pn .wl-list { display: flex; flex-direction: column; }
    .pn .wl-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 10px 0; border-bottom: 1px solid var(--n100); }
    .pn .wl-row img, .pn .wl-row .ph { width: 44px; height: 44px; border-radius: 8px; object-fit: contain; background: var(--n100); flex: none; }
    .pn .wl-main { flex: 1; min-width: 180px; display: flex; flex-direction: column; }
    .pn .wl-main a { color: var(--n700); font-weight: 700; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .pn .wl-meta { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
    .pn .wl-meta s { color: var(--n500); font-size: 11px; }
    .pn .wl-meta small { color: var(--n500); font-size: 10px; }
    .pn .wl-meta .err { color: var(--p); }
    .pn .oos { color: var(--n500); }
    .pn .wl-target { display: flex; flex-direction: column; }
    .pn .wl-target small { color: var(--n500); font-size: 10px; }
    .pn .wl-target input { width: 110px; height: 30px; padding: 0 8px; border: 1px solid var(--n200); border-radius: 8px; background: var(--bg); color: inherit; }
    .pn .wl-acts { display: flex; gap: 4px; }
    .pn .wl-acts .btn.sm { height: 30px; padding: 0 10px; }
    .pn .wl-acts .btn.ghost { width: 30px; padding: 0; }
    .pn .dash { color: var(--n500); }
    .pn select { height: 32px; padding: 0 10px; border: 1px solid var(--n200); border-radius: 8px; background: var(--bg); color: inherit; }
  `;

  let panelUi = null; // { wrap, close }

  function showPanel(tabKey) {
    const root = getRoot();
    if (panelUi) { panelUi.select(tabKey); return; }
    ensurePanelCss(root);
    const wrap = document.createElement('div');
    wrap.className = 'pnw';
    wrap.setAttribute('dir', 'rtl');
    wrap.innerHTML =
      `<div class="pn" role="dialog" aria-modal="true" aria-label="افزونه‌های MAH دیجی‌کالا">` +
      `<div class="top"><div class="ttl"><span class="badge">${svg('gear', 20)}</span><span>افزونه‌های MAH دیجی‌کالا</span></div><span class="sp"></span>` +
      `<button class="btn ghost" type="button" data-act="close" title="بستن">${svg('close', 22)}</button></div>` +
      '<div class="pn-tabs" role="tablist">' +
      PANEL_TABS.map((t) => `<button type="button" role="tab" data-tab="${t.key}">${t.label}</button>`).join('') +
      '</div><div class="pn-body"></div></div>';
    root.appendChild(wrap);
    const body = wrap.querySelector('.pn-body');
    let current = null;

    const render = () => {
      body.innerHTML = current === 'about' ? renderAbout() : current === 'watch' ? renderWatch() : renderSettings();
      if (current === 'watch') markAlertsSeen();
    };
    const select = (key) => {
      current = PANEL_TABS.some((t) => t.key === key) ? key : PANEL_TABS[0].key;
      wrap.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === current)));
      render();
    };
    // another tab changed the settings: show the new values (unless the user is typing in a field here)
    const onChange = () => { if (current === 'settings' && !body.contains(root.activeElement)) render(); };
    settingsListeners.push(onChange);
    // watchlist changes (prices, run progress) refresh the watchlist tab
    const onWl = () => { if (current === 'watch' && !body.contains(root.activeElement)) render(); };
    wlListeners.push(onWl);

    const close = () => {
      wrap.remove();
      document.removeEventListener('keydown', onKey, true);
      settingsListeners.splice(settingsListeners.indexOf(onChange), 1);
      wlListeners.splice(wlListeners.indexOf(onWl), 1);
      panelUi = null;
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey, true);

    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) return close();
      const tab = e.target.closest('[data-tab]');
      if (tab) return select(tab.dataset.tab);
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'close') close();
      else if (act === 'reload') location.reload();
      else if (act === 'wlcheck') startRun(true);
      else if (act === 'wlstop') stopRun();
      else if (act === 'wlone') { b.disabled = true; checkWatched(b.dataset.id, true).then(render); }
      else if (act === 'wldel') wlRemove(b.dataset.id);
      else if (act === 'clearalerts') { store.del(ALERTS_KEY); syncMenuBadge(); render(); }
      else if (act === 'wlchart') {
        const w = wlAll()[b.dataset.id];
        if (w) openChartDialog(b.dataset.id, w.last, w.t);
      }
      else if (act === 'export') exportData();
      else if (act === 'import') body.querySelector('[data-file]').click();
      else if (act === 'delhist') {
        if (confirm('همه‌ی سوابق قیمتی که این مرورگر ثبت کرده (و نرخ‌های ارز روزانه) حذف می‌شوند. این کار برگشت‌پذیر نیست. ادامه می‌دهید؟')) {
          deleteHistory();
          render();
        }
      }
    });
    wrap.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.feature) {
        updateSettings((s) => { s.features[t.dataset.feature] = t.checked; });
        render();
      } else if (t.dataset.shop) {
        updateSettings((s) => { s.shops[t.dataset.shop] = t.checked; });
        render();
      } else if (t.name === 'digits') {
        updateSettings((s) => { s.digits = t.value; });
        render();
        body.querySelector('[data-reload]').hidden = (t.value === 'en') === (LOCALE === 'en-US');
      } else if (t.matches('[data-freq]')) {
        updateSettings((s) => { s.history.freq = t.value; });
      } else if (t.dataset.alert) {
        updateSettings((s) => { s.alerts[t.dataset.alert] = t.checked; });
      } else if (t.dataset.target) {
        wlSetTarget(t.dataset.target, t.value);
      } else if (t.matches('[data-usd]')) {
        setManualRate(t.value);
        t.value = manualRate() || '';
      } else if (t.matches('[data-file]') && t.files && t.files[0]) {
        importData(t.files[0]);
        t.value = '';
      }
    });

    panelUi = { wrap, close, select };
    select(tabKey);
  }

  /* ------------------------------------------------------------------ *
   * Header button
   * ------------------------------------------------------------------ */
  let busy = false;

  async function onClick() {
    if (busy) return;
    busy = true;
    const btn = document.getElementById(BTN_ID);
    const label = btn && btn.querySelector('.lbl');
    if (btn) btn.classList.add('busy');
    if (label) label.textContent = 'در حال دریافت…';
    const progress = showProgress();
    try {
      const src = await openSource(progress);
      progress.close();
      recordRows(src.rows);
      if (!src.rows.length) {
        alert('افزونه MAH دیجی‌کالا: کالایی در این صفحه پیدا نشد.');
      } else {
        showTable(src);
      }
    } catch (err) {
      console.error('[MAH Digikala Extensions]', err);
      progress.close();
      alert('افزونه MAH دیجی‌کالا: مشکلی پیش آمد. جزئیات در کنسول مرورگر موجود است.');
    } finally {
      busy = false;
      if (btn) btn.classList.remove('busy');
      if (label) label.textContent = 'جدول کالاها';
    }
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      #${BTN_ID}{display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 12px;margin:0 0 0 8px;
        border:1px solid var(--color-neutral-200,#e0e0e2);border-radius:8px;background:var(--color-neutral-000,#fff);
        color:var(--color-neutral-700,#3f4064);font-family:Digikala,sans-serif;font-size:12px;font-weight:700;line-height:1;
        cursor:pointer;white-space:nowrap;flex-shrink:0;transition:background .15s}
      #${BTN_ID}:hover{background:var(--color-neutral-100,#f0f0f1)}
      #${BTN_ID} .ico{display:inline-flex;align-items:center}
      #${BTN_ID}.busy{cursor:progress}
      #${BTN_ID}.busy .ico{display:none}
      #${BTN_ID}.busy::before{content:"";width:16px;height:16px;border:2px solid var(--color-neutral-200,#e0e0e2);
        border-top-color:var(--color-primary-700,#ef394e);border-radius:50%;animation:mah-sp .8s linear infinite}
      #${CMP_BTN_ID}{display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 12px;margin:0 0 0 8px;
        border:1px solid var(--color-neutral-200,#e0e0e2);border-radius:8px;background:var(--color-neutral-000,#fff);
        color:var(--color-neutral-700,#3f4064);font-family:Digikala,sans-serif;font-size:12px;font-weight:700;line-height:1;
        cursor:pointer;white-space:nowrap;flex-shrink:0;transition:background .15s}
      #${CMP_BTN_ID}:hover{background:var(--color-neutral-100,#f0f0f1)}
      #${CMP_BTN_ID} .ico{display:inline-flex;align-items:center}
      #${THEME_BTN_ID}{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;padding:0;margin:0 0 0 8px;
        border:1px solid var(--color-neutral-200,#e0e0e2);border-radius:8px;background:var(--color-neutral-000,#fff);
        color:var(--color-neutral-700,#3f4064);cursor:pointer;flex-shrink:0;transition:background .15s}
      #${THEME_BTN_ID}:hover{background:var(--color-neutral-100,#f0f0f1)}
      #${THEME_BTN_ID} svg{display:block}
      @keyframes mah-sp{to{transform:rotate(360deg)}}`;
    document.head.appendChild(s);
  }

  // Digikala's own icon component when available, inline SVG otherwise.
  function makeIcon() {
    const ico = document.createElement('span');
    ico.className = 'ico';
    if (window.customElements && customElements.get('dds-icon')) {
      const i = document.createElement('dds-icon');
      i.setAttribute('name', 'nav-list');
      i.setAttribute('size', '2xs');
      i.setAttribute('color', 'fixed/neutral-80');
      ico.appendChild(i);
    } else {
      ico.innerHTML = svg('list', 20);
    }
    return ico;
  }

  function makeTableButton() {
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.title = 'دریافت کالاهای این صفحه و نمایش در جدول';
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = 'جدول کالاها';
    btn.append(makeIcon(), lbl);
    btn.addEventListener('click', onClick);
    return btn;
  }

  function makeThemeButton() {
    const btn = document.createElement('button');
    btn.id = THEME_BTN_ID;
    btn.type = 'button';
    btn.addEventListener('click', cycleTheme);
    return btn;
  }

  // Entry in the profile mini-menu (logged-in users), right before the logout item. Copies the look of its neighbour.
  const MENU_ITEM_ID = 'mah-dk-menu-item';
  function ensureMenuItem() {
    const logout = document.querySelector('[class*="MiniProfileMenu"] li[data-cro-id="header-logout"]');
    if (!logout) return;
    let item = document.getElementById(MENU_ITEM_ID);
    if (item) syncMenuBadge(item);
    if (item && item.nextElementSibling === logout) return;
    if (!item) {
      const model = logout.previousElementSibling;
      item = document.createElement('li');
      item.id = MENU_ITEM_ID;
      item.className = model ? model.className : logout.className;
      item.innerHTML =
        '<a class="flex items-center text-neutral-700 w-full" href="#">' +
        `<div class="w-12 pr-1 pl-5">${svg('gear', 20)}</div>` +
        '<div class="flex-1 flex justify-between py-2 items-center grow border-complete-b">' +
        '<span class="text-subtitle-strong" dir="ltr" style="direction:ltr;unicode-bidi:isolate">MAH Digikala Ext.</span>' +
        '<span data-badge hidden style="min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:var(--color-primary-700,#ef394e);' +
        'color:#fff;font-size:11px;line-height:20px;text-align:center;font-weight:700"></span></div></a>';
      item.querySelector('a').addEventListener('click', (e) => { e.preventDefault(); showPanel('watch'); });
      syncMenuBadge(item);
    }
    logout.insertAdjacentElement('beforebegin', item);
  }
  // the number of unseen watchlist alerts, on the profile-menu entry
  function syncMenuBadge(item) {
    const host = item || document.getElementById(MENU_ITEM_ID);
    const el = host && host.querySelector('[data-badge]');
    if (!el) return;
    const n = historyOn() ? unseenAlerts() : 0;
    el.hidden = !n;
    el.textContent = n ? L(n) : '';
    el.title = n ? L(n) + ' هشدار تازه‌ی قیمت' : '';
  }

  // Header buttons, in DOM order: [table button | price comparison] [theme button] [bell].
  // In the RTL header an element before the bell sits visually to its right.
  // Each button is shown only while its feature is turned on in the settings.
  function ensureButtons() {
    ensureMenuItem();
    ensureProductPage();
    ensureFavoritesBar();
    const wantTable = feature('table') && !!pageType();
    const wantCmp = feature('compare') && !!productId() && cmpTabs().length > 0;
    let tableBtn = document.getElementById(BTN_ID);
    if (tableBtn && !wantTable) { tableBtn.remove(); tableBtn = null; }
    let cmpBtn = document.getElementById(CMP_BTN_ID);
    if (cmpBtn && !wantCmp) { cmpBtn.remove(); cmpBtn = null; }
    let themeBtn = document.getElementById(THEME_BTN_ID);
    if (themeBtn && !feature('theme')) { themeBtn.remove(); themeBtn = null; }

    const bell = document.querySelector('header a[href="/profile/notification/"]');
    if (!bell) {
      // Pages without the standard header (e.g. the login page): a small floating toggle in the corner.
      // (on www the header renders late, so wait until the page has loaded before giving up on it)
      if (!feature('theme')) return;
      if (!document.body || (location.hostname === 'www.digikala.com' && document.readyState !== 'complete')) return;
      ensureStyle();
      if (!themeBtn) themeBtn = makeThemeButton();
      if (themeBtn.parentElement !== document.body) document.body.appendChild(themeBtn);
      themeBtn.style.cssText = 'position:fixed;bottom:16px;left:16px;z-index:2147483000;margin:0';
      syncThemeButton();
      return;
    }
    ensureStyle();

    if (feature('theme')) {
      if (!themeBtn) themeBtn = makeThemeButton();
      if (themeBtn.style.cssText) themeBtn.style.cssText = '';
      if (themeBtn.nextElementSibling !== bell) bell.insertAdjacentElement('beforebegin', themeBtn);
      syncThemeButton();
    }
    const anchor = themeBtn || bell; // the other buttons go right before it

    if (wantTable) {
      if (!tableBtn) tableBtn = makeTableButton();
      if (tableBtn.nextElementSibling !== anchor) anchor.insertAdjacentElement('beforebegin', tableBtn);
    }
    if (wantCmp) {
      if (!cmpBtn) cmpBtn = makeCmpButton();
      if (cmpBtn.nextElementSibling !== anchor) anchor.insertAdjacentElement('beforebegin', cmpBtn);
    }
  }

  function init() {
    initTheme();
    // a change in the settings (here or in another tab) applies right away
    settingsListeners.push(() => { applyTheme(); ensureButtons(); });
    if (window.top === window) {
      try { GM_registerMenuCommand('تنظیمات و درباره‌ی افزونه', () => showPanel('settings')); } catch (e) { /* not supported */ }
    }
    // The site is a SPA and re-renders its header, so keep the buttons (and the theme) in place.
    let timer = null;
    new MutationObserver(() => {
      if (timer) return;
      timer = setTimeout(() => { timer = null; applyTheme(); ensureButtons(); }, 300);
    }).observe(document.documentElement, { childList: true, subtree: true });
    ensureButtons();
    window.addEventListener('load', () => setTimeout(ensureButtons, 500));
    setTimeout(pruneHistory, 15000);
    // scheduled watchlist checks (and resuming a run another tab left unfinished)
    setTimeout(schedTick, 5000);
    setInterval(schedTick, 60e3);
  }

  // Runs at document-start so the theme is applied before the page paints.
  if (document.documentElement) {
    init();
  } else {
    const waitForRoot = new MutationObserver(() => {
      if (document.documentElement) { waitForRoot.disconnect(); init(); }
    });
    waitForRoot.observe(document, { childList: true });
  }
})();