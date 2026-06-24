// BI Dashboard Express Server — Refactored
// Each widget has its own endpoint. No shared monolith.
const express = require('express');
const path = require('path');
const storage = require('./storage');
const BitrixClient = require('./bitrix-client');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

function sanitizeLogValue(value) {
    if (value === undefined || value === null) return '';
    return String(value).slice(0, 120).replace(/[\r\n]/g, '');
}

function sanitizeQueryForLog(query) {
    const allowed = ['domain', 'period', 'from', 'to', 'categoryId', 'page', 'pageSize', 'durationFilter', 'status', 'forceRefresh'];
    const safe = {};
    allowed.forEach(key => {
        if (query[key] !== undefined) safe[key] = sanitizeLogValue(query[key]);
    });
    return safe;
}

app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();

    const started = process.hrtime.bigint();
    res.locals.cacheStatus = 'none';

    res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
        const domain = sanitizeLogValue(req.query.domain || req.headers['x-bitrix-domain']);
        const query = sanitizeQueryForLog(req.query);
        console.log(
            `[api] ${req.method} ${req.path} status=${res.statusCode} ` +
            `duration=${durationMs.toFixed(0)}ms cache=${res.locals.cacheStatus || 'none'} ` +
            `domain=${domain || '-'} query=${JSON.stringify(query)}`
        );
    });

    next();
});
app.use(express.static(__dirname));

// ── Stage constants ────────────────────────────────────────────
const SUCCESS_STAGES = [
    "Заявки на рассылку", "Квалифицирован", "NPS собран",
    "Экскурсия проведена", "День рождения проведен",
    "Отправили информацию", "Назначен просмотр"
];
const FAIL_STAGES = [
    "Выбрали что-то другое", "Не подошли условия",
    "Не отвечает более 3х раз", "Запрос в техподдержку закрыт", "Спам",
    "Потребность исчезла",
    "СПАМ", "Не отвечает более 3х суток", "Отложили"
];

// ── Shared helpers ─────────────────────────────────────────────

/** Paginated fetch with hard cap at 5000 items */
async function getAll(client, method, params = {}) {
    let allItems = [];
    let start = 0;
    const maxItems = 5000;
    let total = null;
    while (true) {
        const response = await client.call(method, { ...params, start });
        const items = response.result || [];
        allItems.push(...items);
        total = response.total;
        if (!response.next && (total === undefined || allItems.length >= total)) break;
        if (allItems.length >= maxItems) break;
        start = response.next || allItems.length;
        if (total !== undefined && start >= total) break;
    }
    return { result: allItems, total: total || allItems.length };
}

// ── Manager roster cache (TTL = 30 min per domain) ────────────
// Caches the list of manager IDs + user details (name/photo).
// Avoids re-fetching 30 days of deals just to know who exists.
const _rosterCache = {};          // domain → { managers: [{id,name,photo}], expiresAt }
const ROSTER_TTL   = 30 * 60 * 1000;

async function getRoster(client, domain) {
    const cached = _rosterCache[domain];
    if (cached && Date.now() < cached.expiresAt) return cached.managers;

    // Fetch all deals from last 30 days to build the roster
    const rosterFrom = new Date();
    rosterFrom.setMonth(rosterFrom.getMonth() - 1);
    const rosterFromStr = rosterFrom.toISOString().split('T')[0];
    const todayStr      = new Date().toISOString().split('T')[0];

    const rosterDeals = await getAll(client, 'crm.deal.list', {
        filter: { '>=DATE_CREATE': rosterFromStr, '<=DATE_CREATE': todayStr },
        select: ['ID', 'ASSIGNED_BY_ID']
    });

    const ids = [...new Set(
        rosterDeals.result.map(d => String(d.ASSIGNED_BY_ID)).filter(id => id && id !== 'undefined')
    )];

    let managers = [];
    if (ids.length > 0) {
        try {
            const usersRes = await client.call('user.get', {
                ID: ids, select: ['ID', 'NAME', 'LAST_NAME', 'PERSONAL_PHOTO']
            });
            managers = ids.map(id => {
                const u = usersRes.result.find(u => String(u.ID) === id);
                return {
                    id,
                    name:  u ? `${u.NAME} ${u.LAST_NAME}`.trim() : `Менеджер ${id}`,
                    photo: u ? (u.PERSONAL_PHOTO || null) : null
                };
            });
        } catch(e) {
            managers = ids.map(id => ({ id, name: `Менеджер ${id}`, photo: null }));
        }
    }

    _rosterCache[domain] = { managers, expiresAt: Date.now() + ROSTER_TTL };
    console.log(`[roster] cached ${managers.length} managers for ${domain}`);
    return managers;
}

// ── StageMap cache (TTL = 10 min per domain) ──────────────────
// buildStageMap makes 16+ sequential Bitrix API calls.
// Caching cuts that to 0 on all repeated requests within the TTL window.
const _stageMapCache = {};   // domain → { map, expiresAt }
const STAGE_MAP_TTL  = 10 * 60 * 1000; // 10 minutes in ms
const _dealsInProgressCache = {}; // domain → { payload, updatedAt, expiresAt }
const DEALS_IN_PROGRESS_TTL = 2 * 60 * 1000;
const _dealListCache = {}; // key → { data, updatedAt, expiresAt }
const _dealListInflight = {}; // key → Promise
const DEAL_LIST_TTL = 2 * 60 * 1000;
const HISTORICAL_DEAL_LIST_TTL = 30 * 60 * 1000;
const DEAL_LIST_CACHE_LIMIT = 100;
const ANALYTICS_DEAL_SELECT = [
    'ID', 'TITLE', 'OPPORTUNITY', 'ASSIGNED_BY_ID', 'DATE_CREATE',
    'STAGE_ID', 'SEMANTIC', 'SOURCE_ID', 'CATEGORY_ID'
];
const WARMUP_DEFAULT_DOMAIN = 'robotcorporation.bitrix24.ru';
const WARMUP_ENABLED = process.env.CACHE_WARMUP_ENABLED !== 'false';
const WARMUP_INTERVAL_MS = parsePositiveInt(process.env.CACHE_WARMUP_INTERVAL_MS, 110 * 1000);
const WARMUP_INITIAL_DELAY_MS = parsePositiveInt(process.env.CACHE_WARMUP_INITIAL_DELAY_MS, 15 * 1000);
const WARMUP_PERIODS = (process.env.CACHE_WARMUP_PERIODS || 'day,month')
    .split(',')
    .map(period => period.trim())
    .filter(Boolean);
let _warmupRunning = false;
let _warmupTimer = null;

function parsePositiveInt(value, fallback) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function withCacheMeta(payload, status, entry) {
    return {
        ...payload,
        cache: {
            status,
            updatedAt: entry.updatedAt,
            expiresAt: new Date(entry.expiresAt).toISOString()
        }
    };
}

function stableStringify(value) {
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    if (value && typeof value === 'object') {
        return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
    }
    return JSON.stringify(value);
}

function markCacheStatus(res, status) {
    if (!res || !res.locals) return;
    if (!res.locals.cacheStatus || res.locals.cacheStatus === 'none') {
        res.locals.cacheStatus = status;
    } else if (!res.locals.cacheStatus.split(',').includes(status)) {
        res.locals.cacheStatus += ',' + status;
    }
}

function pruneCache(cache, limit) {
    const keys = Object.keys(cache);
    if (keys.length <= limit) return;
    keys
        .sort((a, b) => cache[a].expiresAt - cache[b].expiresAt)
        .slice(0, keys.length - limit)
        .forEach(key => delete cache[key]);
}

async function getDealListCached(req, res, client, params = {}, ttl = DEAL_LIST_TTL) {
    const domain = client.domain || req.query.domain || 'default';
    const forceRefresh = req.query.forceRefresh === 'true';
    const key = domain + ':crm.deal.list:' + stableStringify(params);
    const cached = _dealListCache[key];

    if (!forceRefresh && cached && Date.now() < cached.expiresAt) {
        markCacheStatus(res, 'deal-list-hit');
        return cached.data;
    }

    if (_dealListInflight[key]) {
        markCacheStatus(res, forceRefresh ? 'deal-list-force-inflight' : 'deal-list-inflight');
        return _dealListInflight[key];
    }

    markCacheStatus(res, forceRefresh ? 'deal-list-bypass' : 'deal-list-miss');
    const pending = getAll(client, 'crm.deal.list', params).then(data => {
        _dealListCache[key] = {
            data,
            updatedAt: new Date().toISOString(),
            expiresAt: Date.now() + ttl
        };
        pruneCache(_dealListCache, DEAL_LIST_CACHE_LIMIT);
        return data;
    }).finally(() => {
        if (_dealListInflight[key] === pending) delete _dealListInflight[key];
    });
    _dealListInflight[key] = pending;
    return pending;
}

function createInternalCacheContext(domain, forceRefresh) {
    return {
        req: { query: { domain, forceRefresh: forceRefresh ? 'true' : undefined }, headers: {} },
        res: { locals: { cacheStatus: 'none' } }
    };
}

async function warmDealListCache(client, domain, label, params, ttl = DEAL_LIST_TTL, forceRefresh = true) {
    const started = Date.now();
    const { req, res } = createInternalCacheContext(domain, forceRefresh);
    const data = await getDealListCached(req, res, client, params, ttl);
    console.log(
        `[warmup] deal-list ${label} ok duration=${Date.now() - started}ms ` +
        `cache=${res.locals.cacheStatus || 'none'} total=${data.total || data.result.length}`
    );
    return data;
}

async function buildStageMap(client, domainKey) {
    const domain = domainKey || client.domain || client._domain || 'default';
    const cached = _stageMapCache[domain];
    if (cached && Date.now() < cached.expiresAt) {
        return cached.map;
    }

    // Cache miss — fetch from Bitrix
    const stageMap = {};
    const commonStages = await client.call('crm.dealcategory.stage.list', { id: 0 });
    if (commonStages.result) commonStages.result.forEach(s => { stageMap[s.STATUS_ID] = s.NAME; });
    const categories = await client.call('crm.dealcategory.list');
    if (categories.result) {
        for (const cat of categories.result) {
            try {
                const catStages = await client.call('crm.dealcategory.stage.list', { id: cat.ID });
                if (catStages.result) catStages.result.forEach(s => { stageMap[s.STATUS_ID] = s.NAME; });
            } catch (e) { /* ignore individual category errors */ }
        }
    }

    _stageMapCache[domain] = { map: stageMap, expiresAt: Date.now() + STAGE_MAP_TTL };
    console.log(`[stageMap] cached for ${domain}, ${Object.keys(stageMap).length} stages`);
    return stageMap;
}

/** Get all STAGE_IDs whose name is in SUCCESS_STAGES.
 *  Accepts an already-built stageMap to avoid double buildStageMap calls. */
async function getSuccessStageIds(client, existingStageMap) {
    const stageMap = existingStageMap || await buildStageMap(client);
    return Object.keys(stageMap).filter(id => SUCCESS_STAGES.includes(stageMap[id]));
}

/** Invalidate stageMap cache for a domain (call after funnel/stage changes) */
app.post('/api/cache/clear', (req, res) => {
    const domain = req.query.domain || 'default';
    delete _stageMapCache[domain];
    delete _dealsInProgressCache[domain];
    Object.keys(_dealListCache).forEach(key => {
        if (key.startsWith(domain + ':')) delete _dealListCache[key];
    });
    Object.keys(_dealListInflight).forEach(key => {
        if (key.startsWith(domain + ':')) delete _dealListInflight[key];
    });
    res.json({ cleared: domain });
});

/** Compute date range from period string.
 *  day    = from 00:00 today (current day only)
 *  week   = last 7 days
 *  month  = last 30 days
 *  custom = uses fromDate/toDate override params directly
 */
function parsePeriod(period, fromDate, toDate) {
    // Custom range: client passes explicit from/to dates
    if (fromDate && toDate) {
        return { from: fromDate, to: toDate + 'T23:59:59' };
    }
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const todayEnd = todayStr + 'T23:59:59';
    if (period === 'day') {
        return { from: todayStr, to: todayEnd };
    }
    const from = new Date();
    if (period === 'week') from.setDate(today.getDate() - 7);
    else from.setMonth(today.getMonth() - 1);
    return {
        from: from.toISOString().split('T')[0],
        to:   todayEnd
    };
}

/** Compute previous period range for delta comparison */
function prevPeriod(from, to) {
    const days = Math.ceil((new Date(to) - new Date(from)) / (1000 * 60 * 60 * 24));
    const prevTo = new Date(from);
    prevTo.setDate(prevTo.getDate() - 1);
    const prevFrom = new Date(prevTo);
    prevFrom.setDate(prevFrom.getDate() - days);
    return {
        from: prevFrom.toISOString().split('T')[0],
        to:   prevTo.toISOString().split('T')[0]
    };
}

function calcChange(cur, prev) {
    if (prev === 0) return null;
    return parseFloat(((cur - prev) / prev * 100).toFixed(1));
}

const getClient = (req) => {
    let domain = req.query.domain || req.headers['x-bitrix-domain'];
    if (!domain) {
        const tokens = storage.getAll();
        if (tokens && Object.keys(tokens).length > 0) domain = Object.keys(tokens)[0];
    }
    if (!domain && process.env.DEFAULT_DOMAIN) domain = process.env.DEFAULT_DOMAIN;
    if (!domain) throw new Error('Domain required');
    return new BitrixClient(domain);
};

function getWarmupDomains() {
    const envDomains = (process.env.CACHE_WARMUP_DOMAINS || process.env.DEFAULT_DOMAIN || '')
        .split(',')
        .map(domain => domain.trim())
        .filter(Boolean);
    if (envDomains.length > 0) return [...new Set(envDomains)];

    const tokens = storage.getAll();
    const tokenDomains = tokens ? Object.keys(tokens).filter(Boolean) : [];
    if (tokenDomains.length > 0) {
        if (tokenDomains.includes(WARMUP_DEFAULT_DOMAIN)) return [WARMUP_DEFAULT_DOMAIN];
        return [tokenDomains[0]];
    }

    return [WARMUP_DEFAULT_DOMAIN];
}

function periodDealParams(from, to, extraFilter) {
    return {
        filter: { '>=DATE_CREATE': from, '<=DATE_CREATE': to, ...(extraFilter || {}) },
        select: ANALYTICS_DEAL_SELECT
    };
}

async function warmPeriodDealCaches(client, domain, period, successStageIds) {
    const { from, to } = parsePeriod(period);
    const prev = prevPeriod(from, to);
    const tasks = [
        warmDealListCache(client, domain, `${period}:all`, periodDealParams(from, to)),
        warmDealListCache(
            client,
            domain,
            `${period}:prev-all`,
            periodDealParams(prev.from, prev.to),
            HISTORICAL_DEAL_LIST_TTL,
            false
        )
    ];

    if (successStageIds.length > 0) {
        tasks.push(
            warmDealListCache(
                client,
                domain,
                `${period}:success`,
                periodDealParams(from, to, { STAGE_ID: successStageIds })
            ),
            warmDealListCache(
                client,
                domain,
                `${period}:prev-success`,
                periodDealParams(prev.from, prev.to, { STAGE_ID: successStageIds }),
                HISTORICAL_DEAL_LIST_TTL,
                false
            )
        );
    }

    await Promise.all(tasks);
}

async function warmDealsInProgress(client, domain) {
    const started = Date.now();
    const { req, res } = createInternalCacheContext(domain, true);
    const { payload } = await refreshDealsInProgressCache(client, domain, req, res);
    console.log(
        `[warmup] deals-in-progress ok duration=${Date.now() - started}ms ` +
        `cache=${res.locals.cacheStatus || 'none'} total=${payload.total}`
    );
}

async function runCacheWarmup() {
    if (!WARMUP_ENABLED) return;
    if (_warmupRunning) {
        console.log('[warmup] skipped: previous run still active');
        return;
    }

    _warmupRunning = true;
    const started = Date.now();
    const domains = getWarmupDomains();
    console.log(`[warmup] started domains=${domains.join(',')} periods=${WARMUP_PERIODS.join(',')}`);

    try {
        for (const domain of domains) {
            const client = new BitrixClient(domain);
            const stageMap = await buildStageMap(client, domain);
            const successStageIds = await getSuccessStageIds(client, stageMap);
            await getRoster(client, domain);

            for (const period of WARMUP_PERIODS) {
                await warmPeriodDealCaches(client, domain, period, successStageIds);
            }

            await warmDealsInProgress(client, domain);
        }

        console.log(`[warmup] success duration=${Date.now() - started}ms`);
    } catch (e) {
        console.error(`[warmup] failed duration=${Date.now() - started}ms error=${e.message}`);
    } finally {
        _warmupRunning = false;
    }
}

function scheduleCacheWarmup(delayMs) {
    if (!WARMUP_ENABLED) {
        console.log('[warmup] disabled');
        return;
    }

    if (_warmupTimer) clearTimeout(_warmupTimer);
    _warmupTimer = setTimeout(async () => {
        _warmupTimer = null;
        await runCacheWarmup();
        scheduleCacheWarmup(WARMUP_INTERVAL_MS);
    }, delayMs);

    if (_warmupTimer.unref) _warmupTimer.unref();
}

// ── Static routes ──────────────────────────────────────────────
const serveIndex = (req, res) => res.sendFile(path.join(__dirname, 'index.html'));
app.get('/', serveIndex);
app.post('/', serveIndex);

app.post('/api/bitrix24/install', async (req, res) => {
    let { DOMAIN, AUTH_ID, REFRESH_ID, member_id } = req.body;
    if (!DOMAIN && req.query.DOMAIN) DOMAIN = req.query.DOMAIN;
    if (!DOMAIN && req.headers.referer) {
        try {
            const refererUrl = new URL(req.headers.referer);
            if (refererUrl.hostname.includes('.bitrix24.')) DOMAIN = refererUrl.hostname;
        } catch (e) {}
    }
    if (DOMAIN && AUTH_ID && REFRESH_ID) {
        storage.saveTokens(DOMAIN, { AUTH_ID, REFRESH_ID, member_id, installedAt: new Date().toISOString() });
    }
    if (DOMAIN) return res.redirect(`/?domain=${encodeURIComponent(DOMAIN)}&inBitrix=true`);
    res.redirect('/?inBitrix=true');
});

// ── Endpoint 1: KPI (Revenue, Leads, Conversion) ──────────────
// Revenue = sum of OPPORTUNITY for deals moved to SUCCESS_STAGES in period
// Leads   = count of all deals created in period
// Conversion = successDeals / leads * 100
app.get('/api/kpi', async (req, res) => {
    try {
        const client = getClient(req);
        const { period = 'month', categoryId } = req.query;
        const { from, to } = parsePeriod(period, req.query.from, req.query.to);
        const isCustomRange = !!(req.query.from && req.query.to);
        const prev = isCustomRange ? null : prevPeriod(from, to);

        const catFilter = categoryId && categoryId !== 'all' ? { CATEGORY_ID: categoryId } : {};
        const successStageIds = await getSuccessStageIds(client);

        const [successDeals, allDeals, prevSuccessDeals, prevAllDeals] = await Promise.all([
            // Current: deals CREATED in period that are currently in a success stage
            successStageIds.length > 0
                ? getDealListCached(req, res, client, {
                    filter: { STAGE_ID: successStageIds, '>=DATE_CREATE': from, '<=DATE_CREATE': to, ...catFilter },
                    select: ANALYTICS_DEAL_SELECT
                  })
                : Promise.resolve({ result: [], total: 0 }),

            // Current: all deals created in period (= new leads)
            getDealListCached(req, res, client, {
                filter: { '>=DATE_CREATE': from, '<=DATE_CREATE': to, ...catFilter },
                select: ANALYTICS_DEAL_SELECT
            }),

            // Previous: skip when custom range — no meaningful comparison period
            (!isCustomRange && successStageIds.length > 0)
                ? getDealListCached(req, res, client, {
                    filter: { STAGE_ID: successStageIds, '>=DATE_CREATE': prev.from, '<=DATE_CREATE': prev.to, ...catFilter },
                    select: ANALYTICS_DEAL_SELECT
                  })
                : Promise.resolve({ result: [], total: 0 }),

            (!isCustomRange)
                ? getDealListCached(req, res, client, {
                    filter: { '>=DATE_CREATE': prev.from, '<=DATE_CREATE': prev.to, ...catFilter },
                    select: ANALYTICS_DEAL_SELECT
                  })
                : Promise.resolve({ result: [], total: 0 })
        ]);

        const revenue     = successDeals.result.reduce((s, d) => s + parseFloat(d.OPPORTUNITY || 0), 0);
        const leadsCount  = allDeals.total;
        const wonDeals    = successDeals.result.length;
        const conversion  = leadsCount > 0 ? parseFloat((wonDeals / leadsCount * 100).toFixed(1)) : 0;

        const prevRevenue    = prevSuccessDeals.result.reduce((s, d) => s + parseFloat(d.OPPORTUNITY || 0), 0);
        const prevLeads      = prevAllDeals.total;
        const prevWon        = prevSuccessDeals.result.length;
        const prevConversion = prevLeads > 0 ? prevWon / prevLeads * 100 : 0;

        res.json({
            revenue, leadsCount, wonDeals, conversionRate: conversion,
            changes: {
                revenue:        calcChange(revenue, prevRevenue),
                leadsCount:     calcChange(leadsCount, prevLeads),
                conversionRate: calcChange(conversion, prevConversion)
            }
        });
    } catch (e) {
        console.error('[KPI Error]', e.message);
        res.status(500).json({ error: e.message });
    }
});

async function refreshDealsInProgressCache(client, domain, cacheReq, cacheRes) {
    const stageMap = await buildStageMap(client, domain);

    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    const allDeals = await getDealListCached(cacheReq, cacheRes, client, {
        filter: { '>=DATE_CREATE': monthAgo.toISOString().split('T')[0] },
        select: ['ID', 'TITLE', 'OPPORTUNITY', 'ASSIGNED_BY_ID', 'DATE_CREATE',
                 'STAGE_ID', 'CATEGORY_ID', 'SEMANTIC', 'CONTACT_ID', 'COMPANY_ID']
    }, DEALS_IN_PROGRESS_TTL);

    const now = new Date();
    const dealsInProgress = [];
    let totalAmount = 0;
    const categoryCounts = { fresh: 0, normal: 0, warning: 0, critical: 0 };

    for (const deal of allDeals.result) {
        const stageName = stageMap[deal.STAGE_ID] || deal.STAGE_ID;
        let isSuccess = SUCCESS_STAGES.includes(stageName);
        let isFail    = FAIL_STAGES.includes(stageName);
        if (!isSuccess && !isFail && deal.SEMANTIC) {
            isSuccess = deal.SEMANTIC === 'S';
            isFail    = deal.SEMANTIC === 'F';
        }
        if (isSuccess || isFail) continue;

        const created = new Date(deal.DATE_CREATE);
        const days = Math.floor((now - created) / (1000 * 60 * 60 * 24));
        let cat;
        if      (days < 7)  { cat = 'fresh';    categoryCounts.fresh++; }
        else if (days < 14) { cat = 'normal';   categoryCounts.normal++; }
        else if (days < 30) { cat = 'warning';  categoryCounts.warning++; }
        else                { cat = 'critical'; categoryCounts.critical++; }

        totalAmount += parseFloat(deal.OPPORTUNITY) || 0;
        dealsInProgress.push({
            ID: deal.ID,
            TITLE: deal.TITLE || 'Без названия',
            OPPORTUNITY: parseFloat(deal.OPPORTUNITY) || 0,
            ASSIGNED_BY_ID: deal.ASSIGNED_BY_ID,
            CONTACT_ID: deal.CONTACT_ID || null,
            COMPANY_ID: deal.COMPANY_ID || null,
            DATE_CREATE: deal.DATE_CREATE,
            STAGE_ID: deal.STAGE_ID,
            stageName,
            daysInProgress: days,
            durationCategory: cat
        });
    }

    const contactIds = [...new Set(
        dealsInProgress.map(d => d.CONTACT_ID).filter(Boolean)
    )];
    const contactMap = {};
    if (contactIds.length > 0) {
        try {
            const contacts = await getAll(client, 'crm.contact.list', {
                filter: { ID: contactIds },
                select: ['ID', 'NAME', 'LAST_NAME']
            });
            contacts.result.forEach(c => {
                contactMap[String(c.ID)] = [c.NAME, c.LAST_NAME].filter(Boolean).join(' ').trim();
            });
        } catch(e) { /* non-critical */ }
    }

    dealsInProgress.forEach(d => {
        if (d.CONTACT_ID && contactMap[String(d.CONTACT_ID)]) {
            d.clientName = contactMap[String(d.CONTACT_ID)];
        } else {
            d.clientName = '';
        }
    });

    const payload = {
        deals: dealsInProgress,
        total: dealsInProgress.length,
        totalAmount,
        categories: categoryCounts
    };
    const entry = {
        payload,
        updatedAt: new Date().toISOString(),
        expiresAt: Date.now() + DEALS_IN_PROGRESS_TTL
    };
    _dealsInProgressCache[domain] = entry;
    return { payload, entry };
}

// ── Endpoint 2: Deals In Progress (always independent of period) ──
// Shows deals created in last 30 days that are NOT in success/fail stages
app.get('/api/deals/in-progress', async (req, res) => {
    try {
        const client = getClient(req);
        const domain = client.domain || req.query.domain || 'default';
        const forceRefresh = req.query.forceRefresh === 'true';
        const cached = _dealsInProgressCache[domain];

        if (!forceRefresh && cached && Date.now() < cached.expiresAt) {
            res.locals.cacheStatus = 'hit';
            return res.json(withCacheMeta(cached.payload, 'hit', cached));
        }

        res.locals.cacheStatus = forceRefresh ? 'bypass' : 'miss';

        const { payload, entry } = await refreshDealsInProgressCache(client, domain, req, res);

        res.json(withCacheMeta(payload, res.locals.cacheStatus, entry));
    } catch (e) {
        console.error('[Deals In Progress Error]', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ── Endpoint: Deals for Leads page ───────────────────────────
// Returns ALL deals from last 30 days INCLUDING failed ones.
// Client filters: "accepted" = in-progress, "rejected" = FAIL_STAGES, "all" = both.
app.get('/api/deals/leads', async (req, res) => {
    try {
        const client = getClient(req);
        const { period = 'month' } = req.query;
        const { from, to } = parsePeriod(period, req.query.from, req.query.to);
        const stageMap = await buildStageMap(client, req.query.domain || 'default');

        const allDeals = await getDealListCached(req, res, client, {
            filter: { '>=DATE_CREATE': from, '<=DATE_CREATE': to },
            select: ANALYTICS_DEAL_SELECT
        });

        const deals = allDeals.result.map(deal => {
            const stageName = stageMap[deal.STAGE_ID] || deal.STAGE_ID;
            const isFail    = FAIL_STAGES.includes(stageName) || deal.SEMANTIC === 'F';
            const isSuccess = SUCCESS_STAGES.includes(stageName) || deal.SEMANTIC === 'S';
            return {
                ID:             deal.ID,
                TITLE:          deal.TITLE || 'Без названия',
                ASSIGNED_BY_ID: deal.ASSIGNED_BY_ID,
                DATE_CREATE:    deal.DATE_CREATE,
                STAGE_ID:       deal.STAGE_ID,
                stageName,
                isFail,
                isSuccess
            };
        });
        // Include ALL deals: success + in-progress + failed
        // Client filters by isFail / isSuccess

        res.json({ deals, total: deals.length });
    } catch (e) {
        console.error('[Deals Leads Error]', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ── Endpoint 3: Funnel ─────────────────────────────────────────
app.get('/api/funnel', async (req, res) => {
    try {
        const client = getClient(req);
        const { period = 'month', categoryId } = req.query;
        const { from, to } = parsePeriod(period, req.query.from, req.query.to);

        const catFilter   = categoryId && categoryId !== 'all' ? { CATEGORY_ID: categoryId } : {};
        const stageListId = categoryId && categoryId !== 'all' ? parseInt(categoryId) : 0;

        const specificCategory = catFilter.CATEGORY_ID;
        const domain = req.query.domain || client.domain || 'default';

        // Fetch deals WITH date filter so funnel reflects the selected period.
        // Also fetch stages for selected funnel only (or all if 'all' mode).
        let allDeals;
        let stageMap = {};

        if (specificCategory) {
            const [deals, stages] = await Promise.all([
                getDealListCached(req, res, client, {
                    filter: { '>=DATE_CREATE': from, '<=DATE_CREATE': to, ...catFilter },
                    select: ANALYTICS_DEAL_SELECT
                }),
                client.call('crm.dealcategory.stage.list', { id: stageListId })
            ]);
            allDeals = deals;
            if (stages.result) stages.result.forEach(s => { stageMap[s.STATUS_ID] = s.NAME; });
        } else {
            const [deals, cachedStageMap] = await Promise.all([
                getDealListCached(req, res, client, {
                    filter: { '>=DATE_CREATE': from, '<=DATE_CREATE': to },
                    select: ANALYTICS_DEAL_SELECT
                }),
                buildStageMap(client, domain)
            ]);
            allDeals = deals;
            stageMap = cachedStageMap;
        }
        // When specific funnel is selected: stageMap already contains ONLY that
        // funnel's stages from the crm.dealcategory.stage.list call above.

        // Pre-populate with 0 (insertion order = Bitrix pipeline order).
        const funnelData = {};
        Object.values(stageMap).forEach(name => { funnelData[name] = 0; });

        allDeals.result.forEach(deal => {
            // Skip deals whose STAGE_ID is not in stageMap for this funnel
            if (!stageMap[deal.STAGE_ID]) return;
            const name = stageMap[deal.STAGE_ID];
            funnelData[name] = (funnelData[name] || 0) + 1;
        });

        res.json({ funnel: funnelData, total: allDeals.total });
    } catch (e) {
        console.error('[Funnel Error]', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ── Endpoint 4: Sources ──────────────────────────────────────
// Queries crm.deal.list (not lead.list — leads not used here).
// Always returns ALL known source types, even with 0 count.
app.get('/api/sources', async (req, res) => {
    try {
        const client = getClient(req);
        const { period = 'day' } = req.query;
        const { from, to } = parsePeriod(period, req.query.from, req.query.to);

        const [deals, sourceStatuses] = await Promise.all([
            getDealListCached(req, res, client, {
                filter: { '>=DATE_CREATE': from, '<=DATE_CREATE': to },
                select: ANALYTICS_DEAL_SELECT
            }),
            client.call('crm.status.list', { filter: { ENTITY_ID: 'SOURCE' } })
        ]);

        // Build name map
        const sourceNames = {};
        if (sourceStatuses.result) {
            sourceStatuses.result.forEach(s => { sourceNames[s.STATUS_ID] = s.NAME; });
        }

        // Pre-populate ALL known sources with 0
        const sources = {};
        Object.values(sourceNames).forEach(name => { sources[name] = 0; });

        // Count actual deal sources
        deals.result.forEach(deal => {
            const key  = deal.SOURCE_ID || 'OTHER';
            const name = sourceNames[key] || key;
            sources[name] = (sources[name] || 0) + 1;
        });

        res.json({ sources, total: deals.total });
    } catch (e) {
        console.error('[Sources Error]', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ── Endpoint 5: Managers ──────────────────────────────────────
// Revenue/deals stats for the SELECTED period.
// Roster (who exists) is always built from last 30 days so that
// managers with 0 activity today are still shown (alphabetically, revenue=0).
app.get('/api/managers', async (req, res) => {
    try {
        const client = getClient(req);
        const { period = 'day', categoryId } = req.query;
        const { from, to } = parsePeriod(period, req.query.from, req.query.to);
        const catFilter = categoryId && categoryId !== 'all' ? { CATEGORY_ID: categoryId } : {};

        // Build stageMap once — pass it to getSuccessStageIds to avoid double call
        const stageMap       = await buildStageMap(client);
        const successStageIds = await getSuccessStageIds(client, stageMap);

        // "Новая заявка" stage names across all funnels
        const NEW_STAGE_NAMES = new Set(['Новая заявка', 'Новая']);

        const domain = req.query.domain || 'default';

        // Parallel: roster from cache + period stats + success deals
        // Roster cache avoids re-fetching 30 days of deals on every request
        const [rosterManagers, allPeriodDeals, successDeals] = await Promise.all([
            getRoster(client, domain),
            // Period stats: all deals in selected period
            getDealListCached(req, res, client, {
                filter: { '>=DATE_CREATE': from, '<=DATE_CREATE': to, ...catFilter },
                select: ANALYTICS_DEAL_SELECT
            }),
            // Success deals: for revenue
            successStageIds.length > 0
                ? getDealListCached(req, res, client, {
                    filter: { STAGE_ID: successStageIds, '>=DATE_CREATE': from, '<=DATE_CREATE': to, ...catFilter },
                    select: ANALYTICS_DEAL_SELECT
                  })
                : Promise.resolve({ result: [] })
        ]);

        // Build per-manager stats from period deals
        const managerStats = {};

        allPeriodDeals.result.forEach(deal => {
            const id = String(deal.ASSIGNED_BY_ID || 'unknown');
            if (id === 'unknown') return;
            if (!managerStats[id]) managerStats[id] = { total: 0, converted: 0, count: 0, revenue: 0 };
            const stageName = stageMap[deal.STAGE_ID] || deal.STAGE_ID;
            const isFail = FAIL_STAGES.includes(stageName) || deal.SEMANTIC === 'F';
            const isNew  = NEW_STAGE_NAMES.has(stageName);
            managerStats[id].total++;
            if (!isFail && !isNew) managerStats[id].converted++;
        });

        // Revenue from success deals
        successDeals.result.forEach(deal => {
            const id = String(deal.ASSIGNED_BY_ID || 'unknown');
            if (!managerStats[id]) managerStats[id] = { total: 0, converted: 0, count: 0, revenue: 0 };
            managerStats[id].count++;
            managerStats[id].revenue += parseFloat(deal.OPPORTUNITY || 0);
        });

        // Merge roster (cached) with period stats
        const managers = rosterManagers.map(u => {
            const stats = managerStats[u.id] || { total: 0, converted: 0, count: 0, revenue: 0 };
            const convRate = stats.total > 0
                ? parseFloat((stats.converted / stats.total * 100).toFixed(1)) : 0;
            return {
                id:             u.id,
                name:           u.name,
                photo:          u.photo,
                deals:          stats.count,
                revenue:        stats.revenue,
                total:          stats.total,
                converted:      stats.converted,
                conversionRate: convRate
            };
        }).sort((a, b) => {
            if (b.revenue !== a.revenue) return b.revenue - a.revenue;
            return a.name.localeCompare(b.name, 'ru');
        });

        res.json({ managers });
    } catch (e) {
        console.error('[Managers Error]', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ── Endpoint 6: Channels ─────────────────────────────────────
// Returns sources (total deals per source) + wonBySource (won deals per source).
// Always includes ALL known source types, even with 0.
app.get('/api/channels', async (req, res) => {
    try {
        const client = getClient(req);
        const { period = 'day' } = req.query;
        const { from, to } = parsePeriod(period, req.query.from, req.query.to);

        const successStageIds = await getSuccessStageIds(client);

        const [deals, wonDeals, sourceStatuses] = await Promise.all([
            // All deals in period — total count per source
            getDealListCached(req, res, client, {
                filter: { '>=DATE_CREATE': from, '<=DATE_CREATE': to },
                select: ANALYTICS_DEAL_SELECT
            }),
            // Won deals in period — used for conversion per source
            successStageIds.length > 0
                ? getDealListCached(req, res, client, {
                    filter: { STAGE_ID: successStageIds, '>=DATE_CREATE': from, '<=DATE_CREATE': to },
                    select: ANALYTICS_DEAL_SELECT
                  })
                : Promise.resolve({ result: [] }),
            client.call('crm.status.list', { filter: { ENTITY_ID: 'SOURCE' } })
        ]);

        const sourceNames = {};
        if (sourceStatuses.result) {
            sourceStatuses.result.forEach(s => { sourceNames[s.STATUS_ID] = s.NAME; });
        }

        // Pre-populate ALL known sources with 0
        const sources    = {};
        const wonBySource = {};
        Object.values(sourceNames).forEach(name => { sources[name] = 0; wonBySource[name] = 0; });

        deals.result.forEach(deal => {
            const key  = deal.SOURCE_ID || 'OTHER';
            const name = sourceNames[key] || key;
            sources[name]    = (sources[name]    || 0) + 1;
            wonBySource[name] = wonBySource[name] || 0;
        });

        wonDeals.result.forEach(deal => {
            const key  = deal.SOURCE_ID || 'OTHER';
            const name = sourceNames[key] || key;
            wonBySource[name] = (wonBySource[name] || 0) + 1;
        });

        const totalDeals = deals.result.length;
        const totalWon   = wonDeals.result.length;
        const conversionRate = totalDeals > 0 ? parseFloat((totalWon / totalDeals * 100).toFixed(1)) : 0;

        res.json({ sources, wonBySource, total: totalDeals, totalWon, conversionRate });
    } catch (e) {
        console.error('[Channels Error]', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ── Endpoint 7: Funnels list ───────────────────────────────────
app.get('/api/funnels', async (req, res) => {
    try {
        const client = getClient(req);
        const categories = await client.call('crm.dealcategory.list');
        const funnels = [{ ID: '0', NAME: 'Общая' }];
        if (categories.result) categories.result.forEach(cat => funnels.push({ ID: cat.ID, NAME: cat.NAME }));
        res.json({ funnels });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── Health ─────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── DEBUG: что система считает успешными стадиями ──────────────
// GET /api/debug/stages?domain=...
// Показывает полную карту STAGE_ID → название для всех воронок
// и отмечает какие из них попали в SUCCESS_STAGES
app.get('/api/debug/stages', async (req, res) => {
    try {
        const client = getClient(req);
        const stageMap = await buildStageMap(client, req.query.domain || 'default');
        const successIds = Object.keys(stageMap).filter(id => SUCCESS_STAGES.includes(stageMap[id]));

        const allStages = Object.entries(stageMap).map(([id, name]) => ({
            STAGE_ID: id,
            NAME: name,
            isSuccess: SUCCESS_STAGES.includes(name),
            isFail:    FAIL_STAGES.includes(name)
        }));

        res.json({
            successStageIds: successIds,
            successStageNames: SUCCESS_STAGES,
            failStageNames:    FAIL_STAGES,
            allStages,
            totalStages: allStages.length
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── DEBUG: выручка конкретного менеджера — что именно считается ─
// GET /api/debug/manager-revenue?managerId=123&period=month&domain=...
// Показывает список конкретных сделок, вошедших в выручку менеджера
app.get('/api/debug/manager-revenue', async (req, res) => {
    try {
        const client = getClient(req);
        const { managerId, period = 'month' } = req.query;
        if (!managerId) return res.status(400).json({ error: 'managerId required' });

        const { from, to } = parsePeriod(period, req.query.from, req.query.to);
        const successStageIds = await getSuccessStageIds(client);
        const stageMap = await buildStageMap(client, req.query.domain || 'default');

        const filter = {
            STAGE_ID:          successStageIds,
            ASSIGNED_BY_ID:    managerId,
            '>=DATE_CREATE':   from,
            '<=DATE_CREATE':   to
        };

        const deals = await getAll(client, 'crm.deal.list', {
            filter,
            select: ['ID', 'TITLE', 'OPPORTUNITY', 'STAGE_ID', 'DATE_CREATE', 'DATE_MODIFY', 'CATEGORY_ID']
        });

        const enriched = deals.result.map(d => ({
            id:           d.ID,
            title:        d.TITLE,
            opportunity:  parseFloat(d.OPPORTUNITY || 0),
            stageId:      d.STAGE_ID,
            stageName:    stageMap[d.STAGE_ID] || d.STAGE_ID,
            dateCreate:   d.DATE_CREATE,
            dateModify:   d.DATE_MODIFY,
            categoryId:   d.CATEGORY_ID
        }));

        const totalRevenue = enriched.reduce((s, d) => s + d.opportunity, 0);

        res.json({
            managerId,
            period: { from, to },
            totalRevenue,
            dealCount: enriched.length,
            deals: enriched,
            // Extra: what DATE_MODIFY filter would have returned (for comparison)
            note: 'Deals filtered by DATE_CREATE. To compare with old (broken) behavior, check deals where DATE_MODIFY falls in period but DATE_CREATE is outside.'
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── DEBUG: все сделки менеджера за период (не только успешные) ─
// GET /api/debug/manager-all?managerId=123&period=month&domain=...
app.get('/api/debug/manager-all', async (req, res) => {
    try {
        const client = getClient(req);
        const { managerId, period = 'month' } = req.query;
        if (!managerId) return res.status(400).json({ error: 'managerId required' });

        const { from, to } = parsePeriod(period, req.query.from, req.query.to);
        const stageMap = await buildStageMap(client, req.query.domain || 'default');

        const deals = await getAll(client, 'crm.deal.list', {
            filter: {
                ASSIGNED_BY_ID:  managerId,
                '>=DATE_CREATE': from,
                '<=DATE_CREATE': to
            },
            select: ['ID', 'TITLE', 'OPPORTUNITY', 'STAGE_ID', 'DATE_CREATE', 'DATE_MODIFY', 'SEMANTIC']
        });

        const enriched = deals.result.map(d => {
            const stageName = stageMap[d.STAGE_ID] || d.STAGE_ID;
            return {
                id:          d.ID,
                title:       d.TITLE,
                opportunity: parseFloat(d.OPPORTUNITY || 0),
                stageId:     d.STAGE_ID,
                stageName,
                semantic:    d.SEMANTIC,
                isSuccess:   SUCCESS_STAGES.includes(stageName) || d.SEMANTIC === 'S',
                isFail:      FAIL_STAGES.includes(stageName)    || d.SEMANTIC === 'F',
                dateCreate:  d.DATE_CREATE,
                dateModify:  d.DATE_MODIFY
            };
        });

        const successDeals = enriched.filter(d => d.isSuccess);
        const inProgress   = enriched.filter(d => !d.isSuccess && !d.isFail);

        res.json({
            managerId,
            period: { from, to },
            summary: {
                total:         enriched.length,
                success:       successDeals.length,
                inProgress:    inProgress.length,
                fail:          enriched.filter(d => d.isFail).length,
                totalRevenue:  successDeals.reduce((s, d) => s + d.opportunity, 0)
            },
            deals: enriched
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`BI Dashboard server running on http://localhost:${PORT}`);
    scheduleCacheWarmup(WARMUP_INITIAL_DELAY_MS);
});
