// BI Dashboard Express Server for Bitrix24 Integration
const express = require('express');
const path = require('path');
const storage = require('./storage');
const BitrixClient = require('./bitrix-client');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Static files
app.use(express.static(__dirname));

// Serve index.html for both GET and POST (Bitrix24 may use POST)
const serveIndex = (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
};

app.get('/', serveIndex);
app.post('/', serveIndex);

// OAuth Install Handler for Bitrix24
app.post('/api/bitrix24/install', async (req, res) => {
    let { DOMAIN, AUTH_ID, REFRESH_ID, member_id, PLACEMENT_OPTIONS } = req.body;

    // Fallback: Extract DOMAIN from query or referer
    if (!DOMAIN && req.query.DOMAIN) DOMAIN = req.query.DOMAIN;

    // Attempt to extract from REFERER if still missing
    if (!DOMAIN && req.headers.referer) {
        try {
            const refererUrl = new URL(req.headers.referer);
            // Verify it looks like a bitrix24 domain
            if (refererUrl.hostname.includes('.bitrix24.') || refererUrl.hostname.includes('.bitrix24.ru')) {
                DOMAIN = refererUrl.hostname;
            }
        } catch (e) { /* ignore */ }
    }

    console.log('[Bitrix24 Install]', {
        domain: DOMAIN,
        hasAuth: !!AUTH_ID,
        hasRefresh: !!REFRESH_ID,
        memberId: member_id
    });

    if (DOMAIN && AUTH_ID && REFRESH_ID) {
        // Save tokens
        storage.saveTokens(DOMAIN, {
            AUTH_ID,
            REFRESH_ID,
            member_id,
            installedAt: new Date().toISOString()
        });
    }

    // Redirect to the dashboard
    if (DOMAIN) {
        const redirectUrl = `/?domain=${encodeURIComponent(DOMAIN)}&inBitrix=true`;
        return res.redirect(redirectUrl);
    }

    res.redirect('/?inBitrix=true');
});

// Helper to get client for request
const getClient = (req) => {
    let domain = req.query.domain || req.headers['x-bitrix-domain'];

    // Fallback 1: use first available domain from storage
    if (!domain) {
        const tokens = storage.getAll();
        if (tokens && Object.keys(tokens).length > 0) {
            domain = Object.keys(tokens)[0];
            console.log('[API] Using fallback domain from storage:', domain);
        }
    }

    // Fallback 2: use DEFAULT_DOMAIN from .env
    if (!domain && process.env.DEFAULT_DOMAIN) {
        domain = process.env.DEFAULT_DOMAIN;
        console.log('[API] Using fallback domain from .env:', domain);
    }

    if (!domain) throw new Error('Domain required');
    return new BitrixClient(domain);
};

// API Endpoints for Dashboard Data
app.get('/api/stats/dashboard', async (req, res) => {
    try {
        const client = getClient(req);
        const { dateFrom, dateTo, categoryId } = req.query;

        // Date Filter Logic
        const dateFilter = {};
        if (dateFrom || dateTo) {
            if (dateFrom) dateFilter['>=DATE_CREATE'] = dateFrom;
            if (dateTo) dateFilter['<=DATE_CREATE'] = dateTo;
        }

        // Предыдущий период (такой же интервал, сдвинутый назад)
        const periodDays = dateFrom && dateTo
            ? Math.ceil((new Date(dateTo) - new Date(dateFrom)) / (1000 * 60 * 60 * 24))
            : 7;

        const prevDateTo = new Date(dateFrom || dateTo);
        prevDateTo.setDate(prevDateTo.getDate() - 1);
        const prevDateFrom = new Date(prevDateTo);
        prevDateFrom.setDate(prevDateFrom.getDate() - periodDays);

        const prevDateFilter = {
            '>=DATE_CREATE': prevDateFrom.toISOString().split('T')[0],
            '<=DATE_CREATE': prevDateTo.toISOString().split('T')[0]
        };

        // Category Filter (funnel filter)
        const categoryFilter = {};
        if (categoryId !== undefined && categoryId !== 'all') {
            categoryFilter.CATEGORY_ID = categoryId;
        }

        // Determine which stage list to fetch
        const stageListId = categoryId !== undefined && categoryId !== 'all' ? parseInt(categoryId) : 0;

        // Parallel fetch for efficiency
        const [dealsWon, leads, dealsInProgress, allDeals, stages, sourceStatuses, dealCategories, prevDealsWon, prevLeads] = await Promise.all([
            // Revenue: Deals WON (filtered by category if specified)
            client.call('crm.deal.list', {
                filter: { 
                    SEMANTIC: 'S', 
                    ...categoryFilter,
                },
                select: ['OPPORTUNITY', 'CURRENCY_ID', 'ASSIGNED_BY_ID']
            }),
            // Leads: All Leads (not filtered by category - leads don't have categories)
            client.call('crm.lead.list', {
                filter: { ...dateFilter },
                select: ['ID', 'SOURCE_ID']
            }),
            // Deals In Progress: Not WON and Not LOSE (filtered by category)
            client.call('crm.deal.list', {
                filter: {
                    '!SEMANTIC': ['S', 'F'],
                    ...dateFilter,
                    ...categoryFilter
                },
                select: ['ID', 'TITLE', 'OPPORTUNITY', 'ASSIGNED_BY_ID', 'DATE_CREATE', 'STAGE_ID', 'CATEGORY_ID']
            }),
            // All Deals for funnel (filtered by category)
            client.call('crm.deal.list', {
                filter: { ...dateFilter, ...categoryFilter },
                select: ['ID', 'STAGE_ID', 'ASSIGNED_BY_ID', 'OPPORTUNITY', 'CATEGORY_ID']
            }),
            // Deal stages for the selected category
            client.call('crm.dealcategory.stage.list', { id: stageListId }),
            // Source names mapping
            client.call('crm.status.list', { filter: { ENTITY_ID: 'SOURCE' } }),
            // All deal categories
            client.call('crm.dealcategory.list'),
            // Предыдущий период: выигранные сделки
            client.call('crm.deal.list', {
                filter: { SEMANTIC: 'S', ...prevDateFilter, ...categoryFilter },
                select: ['OPPORTUNITY']
            }),
            // Предыдущий период: лиды
            client.call('crm.lead.list', {
                filter: { ...prevDateFilter },
                select: ['ID']
            })
            ]);  // ← закрываем Promise.all

        // Build source names map
        const sourceNames = {};
        if (sourceStatuses.result) {
            sourceStatuses.result.forEach(s => {
                sourceNames[s.STATUS_ID] = s.NAME;
            });
        }

        // Calculate Revenue
        const revenue = dealsWon.result.reduce((sum, deal) => sum + parseFloat(deal.OPPORTUNITY || 0), 0);

        // Calculate Sources with readable names
        const sources = {};
        leads.result.forEach(lead => {
            const srcId = lead.SOURCE_ID || 'OTHER';
            const srcName = sourceNames[srcId] || srcId;
            sources[srcName] = (sources[srcName] || 0) + 1;
        });

        // Build Funnel Data - fetch stages from all categories
        const stageMap = {};
        // Add default category stages
        if (stages.result) {
            stages.result.forEach(stage => {
                stageMap[stage.STATUS_ID] = stage.NAME;
            });
        }
        // Fetch stages from all other categories
        if (dealCategories.result && dealCategories.result.length > 0) {
            const categoryIds = dealCategories.result.map(c => c.ID);
            for (const catId of categoryIds) {
                try {
                    const catStages = await client.call('crm.dealcategory.stage.list', { id: catId });
                    if (catStages.result) {
                        catStages.result.forEach(stage => {
                            stageMap[stage.STATUS_ID] = stage.NAME;
                        });
                    }
                } catch (e) {
                    console.log(`[API] Could not fetch stages for category ${catId}`);
                }
            }
        }

        const funnelData = {};
        allDeals.result.forEach(deal => {
            const stageName = stageMap[deal.STAGE_ID] || deal.STAGE_ID;
            funnelData[stageName] = (funnelData[stageName] || 0) + 1;
        });

        // Build Manager Stats
        const managerStats = {};
        dealsWon.result.forEach(deal => {
            const mgrId = deal.ASSIGNED_BY_ID || 'unknown';
            if (!managerStats[mgrId]) {
                managerStats[mgrId] = { count: 0, revenue: 0 };
            }
            managerStats[mgrId].count++;
            managerStats[mgrId].revenue += parseFloat(deal.OPPORTUNITY || 0);
        });

        // Get manager names
        const managerIds = Object.keys(managerStats).filter(id => id !== 'unknown');
        let managers = [];
        if (managerIds.length > 0) {
            try {
                const usersRes = await client.call('user.get', {
                    ID: managerIds,
                    select: ['ID', 'NAME', 'LAST_NAME', 'PERSONAL_PHOTO'],
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
                console.log('[API] Could not fetch user names:', e.message);
                managers = managerIds.map(id => ({
                    id,
                    name: `Менеджер ${id}`,
                    deals: managerStats[id].count,
                    revenue: managerStats[id].revenue
                }));
            }
        }

        // Calculate deal duration (days in progress)
        const dealsWithDuration = dealsInProgress.result.slice(0, 10).map(deal => {
            const created = new Date(deal.DATE_CREATE);
            const now = new Date();
            const daysInProgress = Math.floor((now - created) / (1000 * 60 * 60 * 24));
            return {
                ...deal,
                daysInProgress,
                stageName: stageMap[deal.STAGE_ID] || deal.STAGE_ID
            };
        });

        // Calculate conversion rate
        const totalDeals = allDeals.total || allDeals.result.length;
        const wonDeals = dealsWon.total || dealsWon.result.length;
        const conversionRate = totalDeals > 0 ? ((wonDeals / totalDeals) * 100).toFixed(1) : 0;

        // Расчёт % изменений
        const prevRevenue = prevDealsWon.result.reduce((sum, d) => sum + parseFloat(d.OPPORTUNITY || 0), 0);
        const prevLeadsCount = prevLeads.total || prevLeads.result.length;
        const prevTotalDeals = prevDealsWon.result.length;

        const calcChange = (current, previous) => {
            if (previous === 0) return null;
            return parseFloat(((current - previous) / previous * 100).toFixed(1));
        };

        const changes = {
            revenue: calcChange(revenue, prevRevenue),
            leadsCount: calcChange(leads.total || leads.result.length, prevLeadsCount),
            conversionRate: calcChange(parseFloat(conversionRate), prevTotalDeals > 0 ? parseFloat(((prevDealsWon.result.length / prevTotalDeals) * 100).toFixed(1)) : 0),
        };

        // Response
        res.json({
            revenue,
            leadsCount: leads.total || leads.result.length,
            dealsInProgressCount: dealsInProgress.total || dealsInProgress.result.length,
            dealsInProgress: dealsWithDuration,
            sources,
            funnel: funnelData,
            managers: managers,
            conversionRate: parseFloat(conversionRate),
            totalDeals,
            wonDeals,
            changes,
        });

    } catch (e) {
    console.error('[API Error]', e.message);
    console.log('[API] Falling back to mock data');
    const mockData = require('./mock-data');
    const data = mockData.generateDashboardData(req.query.categoryId);
    res.json({ ...data, isDemo: true });
}
});

// Get all funnels (deal categories)
app.get('/api/funnels', async (req, res) => {
    try {
        const client = getClient(req);

        // Get all deal categories (funnels)
        const categories = await client.call('crm.dealcategory.list');

        // Add default category (ID=0, "Общая")
        const funnels = [
            { ID: '0', NAME: 'Общая' }
        ];

        if (categories.result) {
            categories.result.forEach(cat => {
                funnels.push({
                    ID: cat.ID,
                    NAME: cat.NAME
                });
            });
        }

        console.log('[API] Funnels loaded:', funnels.length);
        res.json({ funnels });

    } catch (e) {
        console.error('[API Funnels Error]', e.message);
        console.log('[API] Falling back to mock funnels');
        const mockData = require('./mock-data');
        res.json(mockData.getFunnels());
    }
});

// Leads endpoint with status filter
app.get('/api/leads', async (req, res) => {
    try {
        const client = getClient(req);
        const { dateFrom, dateTo, status } = req.query;

        const dateFilter = {};
        if (dateFrom) dateFilter['>=DATE_CREATE'] = dateFrom;
        if (dateTo) dateFilter['<=DATE_CREATE'] = dateTo;

        // Принятые = STATUS_ID: 'IN_PROCESS' или 'CONVERTED'
        // Непринятые = STATUS_ID: 'JUNK' или 'NEW' без обработки
        const statusFilter = {};
        if (status === 'accepted') {
            statusFilter.STATUS_ID = ['IN_PROCESS', 'CONVERTED'];
        } else if (status === 'rejected') {
            statusFilter.STATUS_ID = ['JUNK'];
        }

        const leads = await client.call('crm.lead.list', {
            filter: { ...dateFilter, ...statusFilter },
            select: ['ID', 'TITLE', 'NAME', 'LAST_NAME', 'SOURCE_ID', 'STATUS_ID', 'DATE_CREATE', 'ASSIGNED_BY_ID', 'PHONE', 'EMAIL']
        });

        // Получить имена менеджеров
        const assignedIds = [...new Set(leads.result.map(l => l.ASSIGNED_BY_ID).filter(Boolean))];
        let userNames = {};
        if (assignedIds.length > 0) {
            try {
                const users = await client.call('user.get', { ID: assignedIds });
                users.result.forEach(u => {
                    userNames[u.ID] = `${u.NAME} ${u.LAST_NAME}`.trim();
                });
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

        res.json({ leads: result, total: leads.total || result.length });

    } catch (e) {
        console.error('[API Leads Error]', e.message);
        // Mock fallback
        const mockLeads = Array.from({ length: 20 }, (_, i) => ({
            id: String(2000 + i),
            title: `Обращение #${2000 + i}`,
            source: ['Сайт', 'Реклама', 'Звонки', 'Рекомендации'][i % 4],
            status: i % 5 === 0 ? 'JUNK' : i % 3 === 0 ? 'CONVERTED' : 'IN_PROCESS',
            dateCreate: new Date(Date.now() - i * 86400000).toISOString(),
            assignedName: ['Алексей Петров', 'Мария Козлова', 'Дмитрий Волков'][i % 3],
            assignedId: String(i % 3 + 1)
        }));
        res.json({ leads: mockLeads, total: mockLeads.length, isDemo: true });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`BI Dashboard server running on http://localhost:${PORT}`);
});
