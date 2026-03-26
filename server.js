// BI Dashboard Express Server for Bitrix24 Integration
const express = require('express');
const path = require('path');
const storage = require('./storage');
const BitrixClient = require('./bitrix-client');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(__dirname));

// Функция для получения всех записей с пагинацией
async function getAll(client, method, params = {}) {
    let allItems = [];
    let start = 0;
    let total = null;
    const maxItems = 5000; // защита от бесконечного цикла
    
    while (true) {
        const response = await client.call(method, { ...params, start });
        const items = response.result || [];
        allItems.push(...items);
        total = response.total;
        
        // Если нет следующей страницы или достигли конца
        if (!response.next && (total === undefined || allItems.length >= total)) break;
        if (allItems.length >= maxItems) break;
        
        // Переход к следующей странице
        start = response.next || allItems.length;
        if (start >= total) break;
    }
    return { result: allItems, total: total || allItems.length };
}

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
    console.log('[Bitrix24 Install]', { domain: DOMAIN, hasAuth: !!AUTH_ID });
    if (DOMAIN && AUTH_ID && REFRESH_ID) {
        storage.saveTokens(DOMAIN, { AUTH_ID, REFRESH_ID, member_id, installedAt: new Date().toISOString() });
    }
    if (DOMAIN) return res.redirect(`/?domain=${encodeURIComponent(DOMAIN)}&inBitrix=true`);
    res.redirect('/?inBitrix=true');
});

const getClient = (req) => {
    let domain = req.query.domain || req.headers['x-bitrix-domain'];
    if (!domain) {
        const tokens = storage.getAll();
        if (tokens && Object.keys(tokens).length > 0) {
            domain = Object.keys(tokens)[0];
        }
    }
    if (!domain && process.env.DEFAULT_DOMAIN) domain = process.env.DEFAULT_DOMAIN;
    if (!domain) throw new Error('Domain required');
    return new BitrixClient(domain);
};

app.get('/api/stats/dashboard', async (req, res) => {
    try {
        const client = getClient(req);
        const { dateFrom, dateTo, categoryId } = req.query;

        const dateFilter = {};
        if (dateFrom) dateFilter['>=DATE_CREATE'] = dateFrom;
        if (dateTo) dateFilter['<=DATE_CREATE'] = dateTo;

        // Фильтр по дате для выигранных сделок (CLOSEDATE)
        const wonDateFilter = {};
        if (dateFrom) wonDateFilter['>=CLOSEDATE'] = dateFrom;
        if (dateTo) wonDateFilter['<=CLOSEDATE'] = dateTo;

        const periodDays = dateFrom && dateTo
            ? Math.ceil((new Date(dateTo) - new Date(dateFrom)) / (1000 * 60 * 60 * 24))
            : 7;

        const prevDateTo = new Date(dateFrom || dateTo || new Date());
        prevDateTo.setDate(prevDateTo.getDate() - 1);
        const prevDateFrom = new Date(prevDateTo);
        prevDateFrom.setDate(prevDateFrom.getDate() - periodDays);

        const prevDateFilter = {
            '>=DATE_CREATE': prevDateFrom.toISOString().split('T')[0],
            '<=DATE_CREATE': prevDateTo.toISOString().split('T')[0]
        };

        const prevWonDateFilter = {
            '>=CLOSEDATE': prevDateFrom.toISOString().split('T')[0],
            '<=CLOSEDATE': prevDateTo.toISOString().split('T')[0]
        };

        const categoryFilter = {};
        if (categoryId !== undefined && categoryId !== 'all') {
            categoryFilter.CATEGORY_ID = categoryId;
        }

        const stageListId = categoryId !== undefined && categoryId !== 'all' ? parseInt(categoryId) : 0;

        const [dealsWon, leads, dealsInProgress, allDeals, stages, sourceStatuses, dealCategories, prevDealsWon, prevLeads] = await Promise.all([
            // Выручка: выигранные сделки с пагинацией
            getAll(client, 'crm.deal.list', {
                filter: { SEMANTIC: 'S', ...wonDateFilter, ...categoryFilter },
                select: ['OPPORTUNITY', 'CURRENCY_ID', 'ASSIGNED_BY_ID']
            }),
            getAll(client, 'crm.lead.list', {
                filter: { ...dateFilter },
                select: ['ID', 'SOURCE_ID']
            }),
            getAll(client, 'crm.deal.list', {
                filter: { '!SEMANTIC': ['S', 'F'], ...dateFilter, ...categoryFilter },
                select: ['ID', 'TITLE', 'OPPORTUNITY', 'ASSIGNED_BY_ID', 'DATE_CREATE', 'STAGE_ID', 'CATEGORY_ID']
            }),
            getAll(client, 'crm.deal.list', {
                filter: { ...dateFilter, ...categoryFilter },
                select: ['ID', 'STAGE_ID', 'ASSIGNED_BY_ID', 'OPPORTUNITY', 'CATEGORY_ID']
            }),
            client.call('crm.dealcategory.stage.list', { id: stageListId }),
            client.call('crm.status.list', { filter: { ENTITY_ID: 'SOURCE' } }),
            client.call('crm.dealcategory.list'),
            getAll(client, 'crm.deal.list', {
                filter: { SEMANTIC: 'S', ...prevWonDateFilter, ...categoryFilter },
                select: ['OPPORTUNITY']
            }),
            getAll(client, 'crm.lead.list', {
                filter: { ...prevDateFilter },
                select: ['ID']
            })
        ]);

        const sourceNames = {};
        if (sourceStatuses.result) {
            sourceStatuses.result.forEach(s => { sourceNames[s.STATUS_ID] = s.NAME; });
        }

        const revenue = dealsWon.result.reduce((sum, deal) => sum + parseFloat(deal.OPPORTUNITY || 0), 0);

        const sources = {};
        leads.result.forEach(lead => {
            const srcId = lead.SOURCE_ID || 'OTHER';
            const srcName = sourceNames[srcId] || srcId;
            sources[srcName] = (sources[srcName] || 0) + 1;
        });

        const stageMap = {};
        if (stages.result) {
            stages.result.forEach(stage => { stageMap[stage.STATUS_ID] = stage.NAME; });
        }
        if (dealCategories.result && dealCategories.result.length > 0) {
            const categoryIds = dealCategories.result.map(c => c.ID);
            for (const catId of categoryIds) {
                try {
                    const catStages = await client.call('crm.dealcategory.stage.list', { id: catId });
                    if (catStages.result) {
                        catStages.result.forEach(stage => { stageMap[stage.STATUS_ID] = stage.NAME; });
                    }
                } catch (e) {}
            }
        }

        const funnelData = {};
        allDeals.result.forEach(deal => {
            const stageName = stageMap[deal.STAGE_ID] || deal.STAGE_ID;
            funnelData[stageName] = (funnelData[stageName] || 0) + 1;
        });

        const managerStats = {};
        dealsWon.result.forEach(deal => {
            const mgrId = deal.ASSIGNED_BY_ID || 'unknown';
            if (!managerStats[mgrId]) managerStats[mgrId] = { count: 0, revenue: 0 };
            managerStats[mgrId].count++;
            managerStats[mgrId].revenue += parseFloat(deal.OPPORTUNITY || 0);
        });

        const managerIds = Object.keys(managerStats).filter(id => id !== 'unknown');
        let managers = [];
        if (managerIds.length > 0) {
            try {
                const usersRes = await client.call('user.get', {
                    ID: managerIds,
                    select: ['ID', 'NAME', 'LAST_NAME', 'PERSONAL_PHOTO']
                });
                managers = managerIds.map(id => {
                    const user = usersRes.result.find(u => String(u.ID) === String(id));
                    return {
                        id,
                        name: user ? `${user.NAME} ${user.LAST_NAME}`.trim() : `Менеджер ${id}`,
                        photo: user ? (user.PERSONAL_PHOTO || null) : null,
                        deals: managerStats[id].count,
                        revenue: managerStats[id].revenue
                    };
                }).sort((a, b) => b.revenue - a.revenue);
            } catch (e) {
                managers = managerIds.map(id => ({
                    id, name: `Менеджер ${id}`,
                    deals: managerStats[id].count,
                    revenue: managerStats[id].revenue
                }));
            }
        }

        const dealsWithDuration = dealsInProgress.result.slice(0, 50).map(deal => {
            const created = new Date(deal.DATE_CREATE);
            const now = new Date();
            const daysInProgress = Math.floor((now - created) / (1000 * 60 * 60 * 24));
            return { ...deal, daysInProgress, stageName: stageMap[deal.STAGE_ID] || deal.STAGE_ID };
        });

        const totalDeals = allDeals.total;
        const wonDeals = dealsWon.result.length;
        const conversionRate = totalDeals > 0 ? ((wonDeals / totalDeals) * 100).toFixed(1) : 0;

        const prevRevenue = prevDealsWon.result.reduce((sum, d) => sum + parseFloat(d.OPPORTUNITY || 0), 0);
        const prevLeadsCount = prevLeads.total;

        const calcChange = (current, previous) => {
            if (previous === 0) return null;
            return parseFloat(((current - previous) / previous * 100).toFixed(1));
        };

        const changes = {
            revenue: calcChange(revenue, prevRevenue),
            leadsCount: calcChange(leads.total, prevLeadsCount),
            conversionRate: null
        };

        res.json({
            revenue,
            leadsCount: leads.total,
            dealsInProgressCount: dealsInProgress.total,
            dealsInProgress: dealsWithDuration,
            sources,
            funnel: funnelData,
            managers,
            conversionRate: parseFloat(conversionRate),
            totalDeals,
            wonDeals,
            changes
        });

    } catch (e) {
        console.error('[API Error]', e.message);
        console.error('[API Error Stack]', e.stack);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/funnels', async (req, res) => {
    try {
        const client = getClient(req);
        const categories = await client.call('crm.dealcategory.list');
        const funnels = [{ ID: '0', NAME: 'Общая' }];
        if (categories.result) {
            categories.result.forEach(cat => funnels.push({ ID: cat.ID, NAME: cat.NAME }));
        }
        res.json({ funnels });
    } catch (e) {
        console.error('[API Funnels Error]', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/leads', async (req, res) => {
    try {
        const client = getClient(req);
        const { dateFrom, dateTo, status } = req.query;
        const dateFilter = {};
        if (dateFrom) dateFilter['>=DATE_CREATE'] = dateFrom;
        if (dateTo) dateFilter['<=DATE_CREATE'] = dateTo;
        const statusFilter = {};
        if (status === 'accepted') statusFilter.STATUS_ID = ['IN_PROCESS', 'CONVERTED'];
        else if (status === 'rejected') statusFilter.STATUS_ID = ['JUNK'];

        const leads = await getAll(client, 'crm.lead.list', {
            filter: { ...dateFilter, ...statusFilter },
            select: ['ID', 'TITLE', 'NAME', 'LAST_NAME', 'SOURCE_ID', 'STATUS_ID', 'DATE_CREATE', 'ASSIGNED_BY_ID']
        });

        const assignedIds = [...new Set(leads.result.map(l => l.ASSIGNED_BY_ID).filter(Boolean))];
        let userNames = {};
        if (assignedIds.length > 0) {
            try {
                const users = await client.call('user.get', { ID: assignedIds });
                users.result.forEach(u => { userNames[u.ID] = `${u.NAME} ${u.LAST_NAME}`.trim(); });
            } catch (e) {}
        }

        const result = leads.result.map(lead => ({
            id: lead.ID,
            title: lead.TITLE || `${lead.NAME || ''} ${lead.LAST_NAME || ''}`.trim() || 'Без названия',
            source: lead.SOURCE_ID || 'Другой',
            status: lead.STATUS_ID,
            dateCreate: lead.DATE_CREATE,
            assignedName: userNames[lead.ASSIGNED_BY_ID] || `Менеджер ${lead.ASSIGNED_BY_ID}`,
            assignedId: lead.ASSIGNED_BY_ID
        }));

        res.json({ leads: result, total: leads.total });
    } catch (e) {
        console.error('[API Leads Error]', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`BI Dashboard server running on http://localhost:${PORT}`);
});