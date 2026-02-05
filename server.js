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
    const domain = req.query.domain || req.headers['x-bitrix-domain'];
    if (!domain) throw new Error('Domain required');
    return new BitrixClient(domain);
};

// API Endpoints for Dashboard Data
app.get('/api/stats/dashboard', async (req, res) => {
    try {
        const client = getClient(req);
        const { dateFrom, dateTo } = req.query;

        // Date Filter Logic
        const dateFilter = {};
        if (dateFrom || dateTo) {
            if (dateFrom) dateFilter['>=DATE_CREATE'] = dateFrom;
            if (dateTo) dateFilter['<=DATE_CREATE'] = dateTo;
        }

        // Parallel fetch for efficiency
        const [dealsWon, leads, dealsInProgress] = await Promise.all([
            // Revenue: Deals WON
            client.call('crm.deal.list', {
                filter: { STAGE_ID: 'WON', ...dateFilter },
                select: ['OPPORTUNITY', 'CURRENCY_ID']
            }),
            // Leads: All Leads (simplified)
            client.call('crm.lead.list', {
                filter: { ...dateFilter },
                select: ['ID', 'SOURCE_ID']
            }),
            // Deals In Progress: Not WON and Not LOSE
            client.call('crm.deal.list', {
                filter: { '!STAGE_ID': ['WON', 'LOSE'], ...dateFilter },
                select: ['ID', 'TITLE', 'OPPORTUNITY', 'ASSIGNED_BY_ID', 'DATE_CREATE', 'STAGE_ID']
            })
        ]);

        // Calculate Revenue
        const revenue = dealsWon.result.reduce((sum, deal) => sum + parseFloat(deal.OPPORTUNITY || 0), 0);

        // Calculate Sources
        const sources = {};
        leads.result.forEach(lead => {
            const src = lead.SOURCE_ID || 'OTHER';
            sources[src] = (sources[src] || 0) + 1;
        });

        // Response
        res.json({
            revenue: revenue,
            leadsCount: leads.total, // .total only if detailed count requested, else .result.length (pagination limits apply)
            dealsInProgressCount: dealsInProgress.total,
            dealsInProgress: dealsInProgress.result.slice(0, 5), // Top 5
            sources: sources
        });

    } catch (e) {
        console.error('[API Error]', e.message);
        res.status(500).json({ error: e.message, isDemo: true });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`BI Dashboard server running on http://localhost:${PORT}`);
});
