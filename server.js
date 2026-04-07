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
app.use(express.static(__dirname));

// ── Stage constants ────────────────────────────────────────────
const SUCCESS_STAGES = [
    "Заявки на рассылку", "Квалифицирован", "NPS собран",
    "Экскурсия проведена", "День рождения проведен",
    "Отправили информацию", "Назначен просмотр",
];
const FAIL_STAGES = [
    "Выбрали что-то другое", "Не подошли условия",
    "Не отвечает более 3х раз", "Запрос в техподдержку закрыт", "Спам",
    "Потребность исчезла",
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

/** Build STAGE_ID → stage name map across all funnels */
async function buildStageMap(client) {
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
    return stageMap;
}

/** Get all STAGE_IDs whose name is in SUCCESS_STAGES */
async function getSuccessStageIds(client) {
    const stageMap = await buildStageMap(client);
    return Object.keys(stageMap).filter(id => SUCCESS_STAGES.includes(stageMap[id]));
}

/** Compute date range from period string.
 *  day   = from 00:00 today (current day only)
 *  week  = last 7 days
 *  month = last 30 days
 */
function parsePeriod(period) {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const todayEnd = todayStr + 'T23:59:59';  // <-- добавить конец дня

    if (period === 'day') {
        return { from: todayStr, to: todayEnd };
    }
    const from = new Date();
    if (period === 'week') from.setDate(today.getDate() - 7);
    else from.setMonth(today.getMonth() - 1);
    return {
        from: from.toISOString().split('T')[0],
        to:   todayEnd   // <-- тоже исправить для недели/месяца
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
        const { from, to } = parsePeriod(period);
        const prev = prevPeriod(from, to);

        const catFilter = categoryId && categoryId !== 'all' ? { CATEGORY_ID: categoryId } : {};
        const successStageIds = await getSuccessStageIds(client);

        const [successDeals, allDeals, prevSuccessDeals, prevAllDeals] = await Promise.all([
            // Current: deals CREATED in period that are currently in a success stage
            // NOTE: using DATE_CREATE (not DATE_MODIFY) to avoid counting old deals
            // that were merely opened/commented and happen to be in a success stage.
            successStageIds.length > 0
                ? getAll(client, 'crm.deal.list', {
                    filter: { STAGE_ID: successStageIds, '>=DATE_CREATE': from, '<=DATE_CREATE': to, ...catFilter },
                    select: ['OPPORTUNITY', 'ASSIGNED_BY_ID']
                  })
                : Promise.resolve({ result: [], total: 0 }),

            // Current: all deals created in period (= new leads)
            getAll(client, 'crm.deal.list', {
                filter: { '>=DATE_CREATE': from, '<=DATE_CREATE': to, ...catFilter },
                select: ['ID']
            }),

            // Previous: success deals (same DATE_CREATE logic)
            successStageIds.length > 0
                ? getAll(client, 'crm.deal.list', {
                    filter: { STAGE_ID: successStageIds, '>=DATE_CREATE': prev.from, '<=DATE_CREATE': prev.to, ...catFilter },
                    select: ['OPPORTUNITY']
                  })
                : Promise.resolve({ result: [], total: 0 }),

            // Previous: all deals
            getAll(client, 'crm.deal.list', {
                filter: { '>=DATE_CREATE': prev.from, '<=DATE_CREATE': prev.to, ...catFilter },
                select: ['ID']
            })
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

// ── Endpoint 2: Deals In Progress (always independent of period) ──
// Shows deals created in last 30 days that are NOT in success/fail stages
app.get('/api/deals/in-progress', async (req, res) => {
    try {
        const client = getClient(req);
        const stageMap = await buildStageMap(client);

        const monthAgo = new Date();
        monthAgo.setMonth(monthAgo.getMonth() - 1);

        const allDeals = await getAll(client, 'crm.deal.list', {
            filter: { '>=DATE_CREATE': monthAgo.toISOString().split('T')[0] },
            select: ['ID', 'TITLE', 'OPPORTUNITY', 'ASSIGNED_BY_ID', 'DATE_CREATE', 'STAGE_ID', 'CATEGORY_ID', 'SEMANTIC']
        });

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
                DATE_CREATE: deal.DATE_CREATE,
                STAGE_ID: deal.STAGE_ID,
                stageName,
                daysInProgress: days,
                durationCategory: cat
            });
        }

        res.json({
            deals: dealsInProgress,
            total: dealsInProgress.length,
            totalAmount,
            categories: categoryCounts
        });
    } catch (e) {
        console.error('[Deals In Progress Error]', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ── Endpoint 3: Funnel ─────────────────────────────────────────
app.get('/api/funnel', async (req, res) => {
    try {
        const client = getClient(req);
        const { period = 'month', categoryId } = req.query;
        const { from, to } = parsePeriod(period);

        const catFilter   = categoryId && categoryId !== 'all' ? { CATEGORY_ID: categoryId } : {};
        const stageListId = categoryId && categoryId !== 'all' ? parseInt(categoryId) : 0;

        const [allDeals, stages, categories] = await Promise.all([
            getAll(client, 'crm.deal.list', {
                filter: { '>=DATE_CREATE': from, '<=DATE_CREATE': to, ...catFilter },
                select: ['ID', 'STAGE_ID']
            }),
            client.call('crm.dealcategory.stage.list', { id: stageListId }),
            client.call('crm.dealcategory.list')
        ]);

        const stageMap = {};
        if (stages.result) stages.result.forEach(s => { stageMap[s.STATUS_ID] = s.NAME; });
        if (categories.result) {
            for (const cat of categories.result) {
                try {
                    const cs = await client.call('crm.dealcategory.stage.list', { id: cat.ID });
                    if (cs.result) cs.result.forEach(s => { stageMap[s.STATUS_ID] = s.NAME; });
                } catch (e) {}
            }
        }

        // Pre-populate ALL stages with 0 so empty stages still appear
        // Preserve pipeline order from stageMap (insertion order = Bitrix sort order)
        const funnelData = {};
        Object.values(stageMap).forEach(name => { funnelData[name] = 0; });
        allDeals.result.forEach(deal => {
            const name = stageMap[deal.STAGE_ID] || deal.STAGE_ID;
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
        const { from, to } = parsePeriod(period);

        const [deals, sourceStatuses] = await Promise.all([
            getAll(client, 'crm.deal.list', {
                filter: { '>=DATE_CREATE': from, '<=DATE_CREATE': to },
                select: ['ID', 'SOURCE_ID']
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
        const { from, to } = parsePeriod(period);
        const catFilter = categoryId && categoryId !== 'all' ? { CATEGORY_ID: categoryId } : {};

        // Roster window: always last 30 days regardless of selected period
        const rosterFrom = new Date();
        rosterFrom.setMonth(rosterFrom.getMonth() - 1);
        const rosterFromStr = rosterFrom.toISOString().split('T')[0];
        const todayStr      = new Date().toISOString().split('T')[0];

        const successStageIds = await getSuccessStageIds(client);

        const [rosterDeals, successDeals] = await Promise.all([
            // Roster: all deals from last 30 days → gives us the full set of manager IDs
            getAll(client, 'crm.deal.list', {
                filter: { '>=DATE_CREATE': rosterFromStr, '<=DATE_CREATE': todayStr, ...catFilter },
                select: ['ID', 'ASSIGNED_BY_ID']
            }),
            // Stats: success deals in the SELECTED period only
            successStageIds.length > 0
                ? getAll(client, 'crm.deal.list', {
                    filter: { STAGE_ID: successStageIds, '>=DATE_CREATE': from, '<=DATE_CREATE': to, ...catFilter },
                    select: ['OPPORTUNITY', 'ASSIGNED_BY_ID']
                  })
                : Promise.resolve({ result: [] })
        ]);

        // Revenue/count stats for selected period
        const managerStats = {};
        successDeals.result.forEach(deal => {
            const id = String(deal.ASSIGNED_BY_ID || 'unknown');
            if (!managerStats[id]) managerStats[id] = { count: 0, revenue: 0 };
            managerStats[id].count++;
            managerStats[id].revenue += parseFloat(deal.OPPORTUNITY || 0);
        });

        // Build full ID set from 30-day roster (guarantees managers always appear)
        const allIds = new Set();
        rosterDeals.result.forEach(d => { if (d.ASSIGNED_BY_ID) allIds.add(String(d.ASSIGNED_BY_ID)); });
        Object.keys(managerStats).forEach(id => allIds.add(id));

        const managerIds = Array.from(allIds).filter(id => id !== 'unknown');
        let managers = [];

        if (managerIds.length > 0) {
            try {
                const usersRes = await client.call('user.get', {
                    ID: managerIds,
                    select: ['ID', 'NAME', 'LAST_NAME', 'PERSONAL_PHOTO']
                });
                managers = managerIds.map(id => {
                    const user  = usersRes.result.find(u => String(u.ID) === id);
                    const stats = managerStats[id] || { count: 0, revenue: 0 };
                    return {
                        id,
                        name:   user ? `${user.NAME} ${user.LAST_NAME}`.trim() : `Менеджер ${id}`,
                        photo:  user ? (user.PERSONAL_PHOTO || null) : null,
                        deals:  stats.count,
                        revenue: stats.revenue
                    };
                }).sort((a, b) => {
                    // Non-zero revenue first (desc), then zero entries alphabetically
                    if (b.revenue !== a.revenue) return b.revenue - a.revenue;
                    return a.name.localeCompare(b.name, 'ru');
                });
            } catch (e) {
                managers = managerIds.map(id => ({
                    id, name: `Менеджер ${id}`, photo: null,
                    deals: managerStats[id]?.count || 0,
                    revenue: managerStats[id]?.revenue || 0
                }));
            }
        }

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
        const { from, to } = parsePeriod(period);

        const successStageIds = await getSuccessStageIds(client);

        const [deals, wonDeals, sourceStatuses] = await Promise.all([
            // All deals in period — total count per source
            getAll(client, 'crm.deal.list', {
                filter: { '>=DATE_CREATE': from, '<=DATE_CREATE': to },
                select: ['ID', 'SOURCE_ID']
            }),
            // Won deals in period — used for conversion per source
            successStageIds.length > 0
                ? getAll(client, 'crm.deal.list', {
                    filter: { STAGE_ID: successStageIds, '>=DATE_CREATE': from, '<=DATE_CREATE': to },
                    select: ['ID', 'SOURCE_ID']
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
        const stageMap = await buildStageMap(client);
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

        const { from, to } = parsePeriod(period);
        const successStageIds = await getSuccessStageIds(client);
        const stageMap = await buildStageMap(client);

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

        const { from, to } = parsePeriod(period);
        const stageMap = await buildStageMap(client);

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
});