// BI Dashboard — v2
// Changes: sources/channels pagination, full-skeleton refresh, sparklines removed

// ── State ──────────────────────────────────────────────────────
let bitrixDomain = null;
let isInBitrix   = false;
let currentManagers    = [];
let currentManagerSort = 'revenue';

let kpiPeriod      = 'day';
let funnelPeriod   = 'day';
let funnelCategory = 'all';
let sourcesPeriod  = 'day';
let mgrPeriod      = 'day';
let chnPeriod      = 'day';
let pageMgrPeriod  = 'day';
let pageLeadsPeriod = 'day';
let pageLeadsStatus = 'all';

let dashMgrPage = 1;
const dashMgrPerPage = 5;

let funnelPage = 1;
const funnelPerPage = 5;
let lastFunnelData = {};
let funnelsList = [];

// Deals in progress (independent)
let dealsInProgressData = {
    deals: [], total: 0, totalAmount: 0,
    categories: { fresh: 0, normal: 0, warning: 0, critical: 0 }
};
let currentDealFilter = 'all';
let currentDealPage   = 1;
const dealsPerPage    = 5;

// Sources pagination
let sourcesPage = 1;
const sourcesPerPage = 5;
let allSourcesEntries = []; // [{name, count, color}]

// Channels pagination
let channelsPage = 1;
const channelsPerPage = 5;
let allChannelsSorted = []; // [[name, count], ...]

// ── URL helpers ────────────────────────────────────────────────
function buildUrl(path, params) {
    params = params || {};
    const all = Object.assign({}, params);
    if (bitrixDomain) all.domain = bitrixDomain;
    const qs = Object.keys(all)
        .map(function(k) { return encodeURIComponent(k) + '=' + encodeURIComponent(all[k]); })
        .join('&');
    return qs ? path + '?' + qs : path;
}

function periodDates(period) {
    const today = new Date(), from = new Date();
    if (period === 'day')        from.setDate(today.getDate() - 1);
    else if (period === 'week')  from.setDate(today.getDate() - 7);
    else                         from.setMonth(today.getMonth() - 1);
    return {
        from: from.toISOString().split('T')[0],
        to:   today.toISOString().split('T')[0]
    };
}

// ── Init ───────────────────────────────────────────────────────
function detectBitrixContext() {
    const p = new URLSearchParams(window.location.search);
    if (p.get('inBitrix') === 'true' || p.has('DOMAIN') || p.has('domain')) {
        isInBitrix   = true;
        bitrixDomain = p.get('DOMAIN') || p.get('domain');
    }
    return isInBitrix;
}

function initBitrix24() {
    if (detectBitrixContext()) document.body.classList.add('bitrix-mode');
    if (typeof window.BX24 !== 'undefined' && window.BX24) {
        try {
            window.BX24.init(function() {
                isInBitrix = true;
                const auth = window.BX24.getAuth();
                if (auth && auth.domain) { bitrixDomain = auth.domain; initAll(); }
                document.body.classList.add('bitrix-mode');
                try { setupAutoResize(); } catch(e) {}
            });
        } catch(e) {}
    }
}

function setupAutoResize() {
    if (typeof window.BX24 === 'undefined') return;
    new ResizeObserver(function() { try { window.BX24.fitWindow(); } catch(e){} }).observe(document.body);
    setTimeout(function() { try { window.BX24.fitWindow(); } catch(e){} }, 500);
}

document.addEventListener('DOMContentLoaded', function() {
    showAllSkeletons();
    initNavButtons();
    initFunnelSelect();
    initSourcesControls();
    initManagersSort();
    initRefreshButton();
    initTabs();
    initHelpTooltips();
    updateDateRangeDisplay(kpiPeriod);
    if (typeof checkAutoStart === 'function') {
        window.scrollTo({ top: 0, behavior: 'instant' });
        checkAutoStart();
    }
    initBitrix24();
    initAll();
});

function initAll() {
    loadFunnels();
    fetchKPI(kpiPeriod);
    fetchFunnel(funnelPeriod, funnelCategory);
    fetchSources(sourcesPeriod);
    fetchManagers(mgrPeriod);
    fetchChannels(chnPeriod);
    fetchDealsInProgress();
}

// ── Skeleton helpers ───────────────────────────────────────────
function showAllSkeletons() {
    // KPI cards — revenue, leads, conversion + deals
    ['revenue','leads','conversion','deals'].forEach(function(cls) {
        const v = document.querySelector('.kpi-card.' + cls + ' .kpi-value');
        const c = document.querySelector('.kpi-card.' + cls + ' .kpi-change span');
        if (v) v.classList.add('skeleton');
        if (c) c.classList.add('skeleton');
    });

    // Funnel
    const fc = document.querySelector('.funnel-container');
    if (fc) fc.innerHTML = Array(4).fill(
        '<div class="funnel-stage stage-1" style="opacity:0.4;">' +
        '<div class="funnel-bar" style="--width:80%;background:var(--bg-tertiary);">&nbsp;</div>' +
        '<div class="funnel-info"><span class="skeleton" style="display:inline-block;width:100px;height:13px;border-radius:4px;"></span></div>' +
        '</div>').join('');

    // Sources
    const legend = document.getElementById('sources-legend');
    if (legend) legend.innerHTML = Array(4).fill(
        '<div class="source-item">' +
        '<div class="skeleton" style="width:12px;height:12px;border-radius:3px;flex-shrink:0;"></div>' +
        '<div style="flex:1;display:flex;flex-direction:column;gap:4px;">' +
        '<div class="skeleton" style="height:12px;width:80px;border-radius:4px;"></div>' +
        '<div class="skeleton" style="height:10px;width:50px;border-radius:4px;"></div>' +
        '</div>' +
        '<div class="skeleton" style="height:6px;width:80px;border-radius:3px;"></div>' +
        '</div>').join('');
    const dt = document.getElementById('donut-total');
    if (dt) dt.textContent = '';
    const donutSvg = document.getElementById('donut-svg');
    if (donutSvg) {
        donutSvg.querySelectorAll('.dyn-seg').forEach(function(s) { s.remove(); });
        // Add a full grey placeholder circle
        if (!donutSvg.querySelector('.skeleton-ring')) {
            const skRing = document.createElementNS('http://www.w3.org/2000/svg','circle');
            skRing.setAttribute('class','skeleton-ring dyn-seg');
            skRing.setAttribute('cx','60'); skRing.setAttribute('cy','60'); skRing.setAttribute('r','45');
            skRing.setAttribute('fill','none'); skRing.setAttribute('stroke-width','20');
            skRing.setAttribute('stroke','var(--bg-tertiary,#ebeef2)');
            skRing.setAttribute('stroke-dasharray','283'); skRing.setAttribute('stroke-dashoffset','0');
            const hole = donutSvg.querySelector('.donut-hole');
            if (hole) donutSvg.insertBefore(skRing, hole); else donutSvg.appendChild(skRing);
        }
    }

    // Managers
    const mgrList = document.querySelector('.managers-card .managers-list');
    if (mgrList) mgrList.innerHTML = Array(4).fill(
        '<div style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--bg-tertiary);border-radius:var(--radius-md);">' +
        '<div class="skeleton" style="width:28px;height:28px;border-radius:50%;flex-shrink:0;"></div>' +
        '<div class="skeleton" style="width:40px;height:40px;border-radius:50%;flex-shrink:0;"></div>' +
        '<div style="flex:1;">' +
        '<div class="skeleton" style="height:14px;border-radius:4px;margin-bottom:6px;"></div>' +
        '<div class="skeleton" style="height:11px;width:70px;border-radius:4px;"></div>' +
        '</div>' +
        '<div class="skeleton" style="width:100px;height:8px;border-radius:4px;"></div>' +
        '<div class="skeleton" style="width:90px;height:14px;border-radius:4px;"></div>' +
        '</div>').join('');

    // Channels
    const chnContainer = document.getElementById('channels-container');
    if (chnContainer) chnContainer.innerHTML =
        '<div style="display:flex;flex-direction:column;gap:16px;padding:8px 0;">' +
        Array(5).fill(
            '<div style="display:grid;grid-template-columns:280px 1fr;gap:24px;align-items:center;">' +
            '<div class="skeleton" style="height:44px;border-radius:8px;"></div>' +
            '<div class="skeleton" style="height:32px;border-radius:8px;"></div>' +
            '</div>').join('') +
        '</div>';

    // Deals table
    showDealsSkeleton();
}

// ── 1. KPI ─────────────────────────────────────────────────────
async function fetchKPI(period) {
    kpiPeriod = period;
    updateDateRangeDisplay(period);
    try {
        const res = await fetch(buildUrl('/api/kpi', { period: period }));
        const d   = await res.json();
        if (d.error) return;
        setKPI('.kpi-card.revenue .kpi-value',   d.revenue,        '', ' ₽');
        setKPI('.kpi-card.leads .kpi-value',      d.leadsCount);
        setKPI('.kpi-card.conversion .kpi-value', d.conversionRate, '', '%');
        if (d.changes) {
            setKPIChange('.kpi-card.revenue',    d.changes.revenue);
            setKPIChange('.kpi-card.leads',      d.changes.leadsCount);
            setKPIChange('.kpi-card.conversion', d.changes.conversionRate);
        }
    } catch(e) { console.error('fetchKPI', e); }
}

// ── 2. Deals In Progress (always independent) ──────────────────
async function fetchDealsInProgress() {
    try {
        const res  = await fetch(buildUrl('/api/deals/in-progress'));
        const data = await res.json();
        if (data.error) { console.error('Deals error:', data.error); return; }
        dealsInProgressData = data;
        updateDealsWidget();
    } catch(e) { console.error('fetchDealsInProgress', e); }
}

function updateDealsWidget() {
    const kpiValue = document.querySelector('.kpi-card.deals .kpi-value');
    if (kpiValue) { kpiValue.classList.remove('skeleton'); kpiValue.textContent = fmt(dealsInProgressData.total); }
    const kpiChange = document.querySelector('.kpi-card.deals .kpi-change');
    if (kpiChange) { kpiChange.innerHTML = '<span>— текущие</span>'; kpiChange.className = 'kpi-change neutral'; }

    const inds = document.querySelectorAll('.indicator-item span:last-child');
    if (inds.length >= 3) {
        inds[0].textContent = dealsInProgressData.categories.fresh + ' горячих';
        inds[1].textContent = (dealsInProgressData.categories.normal + dealsInProgressData.categories.warning) + ' в процессе';
        inds[2].textContent = dealsInProgressData.categories.critical + ' стагнирующих';
    }
    currentDealPage = 1;
    renderDealsTable();

    const sv = document.querySelectorAll('.deals-summary .summary-value');
    if (sv.length >= 3) {
        sv[0].textContent = dealsInProgressData.total;
        sv[1].textContent = (Math.round(dealsInProgressData.totalAmount / 1000000 * 10) / 10) + ' M';
        const avgDays = dealsInProgressData.total > 0
            ? Math.round(dealsInProgressData.deals.reduce(function(s,d) { return s + d.daysInProgress; }, 0) / dealsInProgressData.total)
            : 0;
        sv[2].textContent = avgDays;
    }
}

function filterDealsByDuration(filter) {
    currentDealFilter = filter;
    document.querySelectorAll('.duration-badge').forEach(function(b) {
        b.style.opacity = b.dataset.filter === filter ? '1' : '0.5';
        b.classList.toggle('active', b.dataset.filter === filter);
    });
    currentDealPage = 1;
    renderDealsTable();
}

function renderDealsTable() {
    const tbody = document.querySelector('.deals-table tbody');
    if (!tbody) return;

    let filtered = dealsInProgressData.deals.slice();
    if (currentDealFilter !== 'all') {
        filtered = filtered.filter(function(d) { return d.durationCategory === currentDealFilter; });
    }

    const totalPages = Math.ceil(filtered.length / dealsPerPage);
    const start = (currentDealPage - 1) * dealsPerPage;
    const page  = filtered.slice(start, start + dealsPerPage);

    if (page.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;">Нет сделок в процессе</td></tr>';
    } else {
        tbody.innerHTML = page.map(function(deal) {
            const days = deal.daysInProgress;
            const dc   = days > 30 ? 'critical' : days > 14 ? 'warning' : days < 7 ? 'fresh' : 'normal';
            const mgr  = currentManagers.find(function(m) { return String(m.id) === String(deal.ASSIGNED_BY_ID); });
            const mgrPhoto = mgr && mgr.photo
                ? 'background-image:url(\'' + mgr.photo + '\');background-size:cover;background-position:center;' : '';
            const mgrName = mgr ? mgr.name.split(' ')[0] : 'ID' + (deal.ASSIGNED_BY_ID || '?');
            const mgrInit = mgr
                ? mgr.name.split(' ').map(function(n) { return n[0]; }).join('').slice(0,2)
                : (deal.ASSIGNED_BY_ID || '?');
            return '<tr style="cursor:pointer;" onclick="window.open(\'https://robotcorporation.bitrix24.ru/crm/deal/details/' + deal.ID + '/\',\'_blank\')">' +
                '<td class="deal-name"><span class="deal-id">#' + deal.ID + '</span>' + escapeHtml(deal.TITLE) + '</td>' +
                '<td style="font-size:0.8125rem;color:var(--text-secondary);">' + escapeHtml(deal.stageName || deal.STAGE_ID) + '</td>' +
                '<td><div style="display:flex;align-items:center;gap:6px;">' +
                '<div class="cell-avatar" style="' + mgrPhoto + '">' + (mgrPhoto ? '' : mgrInit) + '</div>' +
                '<span>' + escapeHtml(mgrName) + '</span></div></td>' +
                '<td><span class="stage-badge">' + escapeHtml(deal.stageName || deal.STAGE_ID) + '</span></td>' +
                '<td class="deal-amount">' + fmtMoney(deal.OPPORTUNITY) + '</td>' +
                '<td><span class="duration ' + dc + '">' + days + ' дн.</span></td>' +
                '</tr>';
        }).join('');
    }

    let pg = document.querySelector('.deals-pagination');
    if (!pg) {
        pg = document.createElement('div');
        pg.className = 'deals-pagination';
        pg.style.cssText = 'display:flex;justify-content:center;align-items:center;gap:8px;padding:12px;border-top:1px solid var(--border-color);';
        const sm = document.querySelector('.deals-summary');
        if (sm) sm.parentNode.insertBefore(pg, sm);
    }
    pg.innerHTML = pgHTML(currentDealPage, totalPages, 'changeDealPage');
}

function changeDealPage(dir) {
    let count = dealsInProgressData.deals.length;
    if (currentDealFilter !== 'all') {
        count = dealsInProgressData.deals.filter(function(d) { return d.durationCategory === currentDealFilter; }).length;
    }
    const total = Math.ceil(count / dealsPerPage);
    currentDealPage = Math.max(1, Math.min(currentDealPage + dir, total));
    renderDealsTable();
}

// ── 3. Funnel ──────────────────────────────────────────────────
async function fetchFunnel(period, category) {
    if (category === undefined) category = funnelCategory;
    funnelPeriod   = period;
    funnelCategory = category;
    setBtnActive('.funnel-period-btn', period);
    const params = { period: period };
    if (category && category !== 'all') params.categoryId = category;
    try {
        const res = await fetch(buildUrl('/api/funnel', params));
        const d   = await res.json();
        if (d.funnel) renderFunnelChart(d.funnel);
    } catch(e) { console.error('fetchFunnel', e); }
}

function renderFunnelChart(funnel) {
    // Keep pipeline order from server (Bitrix stage sort order), don't re-sort by count
    lastFunnelData = funnel;
    funnelPage = 1;
    drawFunnel();
}

function drawFunnel() {
    const container = document.querySelector('.funnel-container');
    if (!container) return;
    const all = Object.entries(lastFunnelData);
    const totalPages = Math.ceil(all.length / funnelPerPage);
    const stages = all.slice((funnelPage-1)*funnelPerPage, funnelPage*funnelPerPage);
    const maxCount = Math.max.apply(null, all.map(function(e) { return e[1]; }).concat([1]));
    const cls = ['stage-1','stage-2','stage-3','stage-4','stage-1'];

    container.innerHTML = stages.map(function(entry, i) {
        const name = entry[0], count = entry[1];
        const pct  = Math.round(count / maxCount * 100);
        const conn = i < stages.length - 1
            ? '<div class="funnel-connector"><span class="conversion-rate">→ ' + pct + '%</span></div>' : '';
        return '<div class="funnel-stage ' + cls[i%cls.length] + '">' +
            '<div class="funnel-bar" style="--width:' + pct + '%"><span class="funnel-value">' + count + '</span></div>' +
            '<div class="funnel-info"><span class="stage-name">' + name + '</span><span class="stage-percent">' + pct + '%</span></div>' +
            '</div>' + conn;
    }).join('');

    let pg = document.querySelector('.funnel-pagination');
    if (!pg) {
        pg = document.createElement('div');
        pg.className = 'funnel-pagination';
        pg.style.cssText = 'display:flex;justify-content:center;align-items:center;gap:8px;padding:12px;border-top:1px solid var(--border-color);margin-top:8px;';
        container.parentNode.appendChild(pg);
    }
    pg.innerHTML = pgHTML(funnelPage, totalPages, 'changeFunnelPage');
}

function changeFunnelPage(dir) {
    funnelPage = Math.max(1, Math.min(funnelPage + dir, Math.ceil(Object.keys(lastFunnelData).length / funnelPerPage)));
    drawFunnel();
}

// ── 4. Sources (paginated legend 5/page) ──────────────────────
async function fetchSources(period) {
    sourcesPeriod = period;
    setBtnActive('.sources-period-btn', period);
    try {
        const res = await fetch(buildUrl('/api/sources', { period: period }));
        const d   = await res.json();
        if (d.sources) renderDonut(d.sources);
    } catch(e) { console.error('fetchSources', e); }
}

function renderDonut(sources) {
    const total = Object.values(sources).reduce(function(a,b) { return a+b; }, 0);

    // Always update donut total (0 is valid)
    const elTotal = document.getElementById('donut-total');
    if (elTotal) elTotal.textContent = fmt(total);

    if (!total) {
        // Grey ring + empty legend rows with 0
        const svg = document.getElementById('donut-svg');
        if (svg) {
            svg.querySelectorAll('.dyn-seg').forEach(function(s) { s.remove(); });
            const ring = document.createElementNS('http://www.w3.org/2000/svg','circle');
            ring.setAttribute('class','dyn-seg');
            ring.setAttribute('cx','60'); ring.setAttribute('cy','60'); ring.setAttribute('r','45');
            ring.setAttribute('fill','none'); ring.setAttribute('stroke-width','20');
            ring.setAttribute('stroke','var(--bg-tertiary,#ebeef2)');
            ring.setAttribute('stroke-dasharray','283'); ring.setAttribute('stroke-dashoffset','0');
            const hole = svg.querySelector('.donut-hole');
            if (hole) svg.insertBefore(ring, hole); else svg.appendChild(ring);
        }
        const legend = document.getElementById('sources-legend');
        if (legend && Object.keys(sources).length) {
            legend.innerHTML = Object.keys(sources).slice(0,5).map(function(name, i) {
                const colors = ['#6366f1','#2fc6f6','#ffa900','#9dcf00','#ec4899'];
                const color = colors[i % colors.length];
                return '<div class="source-item">'
                    + '<div style="width:12px;height:12px;border-radius:3px;background:' + color + ';flex-shrink:0;opacity:0.3;"></div>'
                    + '<div class="source-info"><span class="source-name">' + name + '</span>'
                    + '<span class="source-stat" style="color:var(--text-tertiary)">0 (0%)</span></div>'
                    + '<div class="source-bar"><div class="source-fill" style="width:0%;background:' + color + '"></div></div>'
                    + '</div>';
            }).join('');
        }
        return;
    }

    const colors  = ['#6366f1','#2fc6f6','#ffa900','#9dcf00','#ec4899','#14b8a6','#ff5752','#ab7fe6'];
    const entries = Object.entries(sources);

    // Store all entries with colour for pagination
    allSourcesEntries = entries.map(function(e, i) {
        return { name: e[0], count: e[1], color: colors[i % colors.length] };
    });
    sourcesPage = 1;

    // Update donut total
    // donut-total already set above

    // Draw full donut SVG (all segments)
    const circ = 2 * Math.PI * 45;
    const svg  = document.getElementById('donut-svg');
    if (svg) {
        svg.querySelectorAll('.dyn-seg').forEach(function(s) { s.remove(); });
        let offset = 0;
        entries.forEach(function(e, i) {
            const count   = e[1];
            const dashLen = (count / total) * circ;
            const c = document.createElementNS('http://www.w3.org/2000/svg','circle');
            c.setAttribute('class','donut-segment dyn-seg');
            c.setAttribute('cx','60'); c.setAttribute('cy','60'); c.setAttribute('r','45');
            c.setAttribute('stroke', colors[i % colors.length]);
            c.setAttribute('stroke-dasharray', dashLen + ' ' + (circ - dashLen));
            c.setAttribute('stroke-dashoffset', '-' + offset);
            c.setAttribute('fill','none'); c.setAttribute('stroke-width','20');
            const hole = svg.querySelector('.donut-hole');
            if (hole) svg.insertBefore(c, hole); else svg.appendChild(c);
            offset += dashLen;
        });
    }

    _renderSourcesLegendPage(total);
}

function _renderSourcesLegendPage(total) {
    if (!total) total = allSourcesEntries.reduce(function(s,e) { return s + e.count; }, 0);
    const legend     = document.getElementById('sources-legend');
    if (!legend) return;
    const totalPages = Math.ceil(allSourcesEntries.length / sourcesPerPage);
    const start      = (sourcesPage - 1) * sourcesPerPage;
    const pageItems  = allSourcesEntries.slice(start, start + sourcesPerPage);

    legend.innerHTML = pageItems.map(function(item) {
        const pct = ((item.count / total) * 100).toFixed(0);
        return '<div class="source-item">' +
            '<div style="width:12px;height:12px;border-radius:3px;background:' + item.color + ';flex-shrink:0;"></div>' +
            '<div class="source-info">' +
            '<span class="source-name">' + item.name + '</span>' +
            '<span class="source-stat">' + item.count + ' (' + pct + '%)</span>' +
            '</div>' +
            '<div class="source-bar">' +
            '<div class="source-fill" style="width:' + pct + '%;background:' + item.color + '"></div>' +
            '</div>' +
            '</div>';
    }).join('');

    if (totalPages > 1) {
        legend.innerHTML += '<div style="display:flex;justify-content:center;align-items:center;gap:8px;padding-top:10px;border-top:1px solid var(--border-color);margin-top:8px;">' +
            pgHTML(sourcesPage, totalPages, 'changeSourcesPage') +
            '</div>';
    }
}

function changeSourcesPage(dir) {
    const total = Math.ceil(allSourcesEntries.length / sourcesPerPage);
    sourcesPage = Math.max(1, Math.min(sourcesPage + dir, total));
    _renderSourcesLegendPage(0);
}

// ── 5. Managers ────────────────────────────────────────────────
async function fetchManagers(period) {
    mgrPeriod = period;
    setBtnActive('.mgr-period-btn', period);
    const container = document.querySelector('.managers-card .managers-list');
    if (container) container.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-secondary);">Загрузка...</div>';
    try {
        const res = await fetch(buildUrl('/api/managers', { period: period }));
        const d   = await res.json();
        if (d.managers) {
            currentManagers = d.managers;
            dashMgrPage = 1;
            renderManagersWidget(sortMgr(d.managers, currentManagerSort));
            renderDealsTable();
        }
    } catch(e) { console.error('fetchManagers', e); }
}

function renderManagersWidget(managers) {
    const container = document.querySelector('.managers-card .managers-list');
    if (!container) return;
    const maxRev   = Math.max.apply(null, managers.map(function(m) { return m.revenue; }).concat([1]));
    const medals   = ['gold','silver','bronze'];
    const totalPgs = Math.ceil(managers.length / dashMgrPerPage);
    const start    = (dashMgrPage - 1) * dashMgrPerPage;
    const page     = managers.slice(start, start + dashMgrPerPage);

    container.innerHTML = page.map(function(m, i) {
        const gi  = start + i;
        const pct = m.revenue / maxRev * 100;
        const rc  = medals[gi] || '';
        const ini = m.name.split(' ').map(function(n) { return n[0]; }).join('').slice(0,2);
        const photoStyle = m.photo ? 'style="background-image:url(\'' + m.photo + '\');background-size:cover;background-position:center;"' : '';
        return '<div class="manager-item" style="cursor:pointer;" onclick="window.open(\'https://robotcorporation.bitrix24.ru/company/personal/user/' + m.id + '/\',\'_blank\')">' +
            '<div class="manager-rank ' + rc + '">' + (gi+1) + '</div>' +
            '<div class="manager-avatar" ' + photoStyle + '>' + (m.photo ? '' : ini) + '</div>' +
            '<div class="manager-info">' +
            '<span class="manager-name">' + m.name + '</span>' +
            '<span class="manager-deals">' + m.deals + ' сделок</span>' +
            '</div>' +
            '<div class="manager-stats"><div class="manager-bar"><div class="bar-fill" style="width:' + pct + '%"></div></div></div>' +
            '<div class="manager-revenue">' + fmtMoney(m.revenue) + '</div>' +
            '</div>';
    }).join('');

    let pg = container.parentNode.querySelector('.dash-mgr-pg');
    if (!pg) { pg = document.createElement('div'); pg.className = 'dash-mgr-pg'; container.parentNode.appendChild(pg); }
    pg.style.cssText = 'display:flex;justify-content:center;align-items:center;gap:8px;padding:12px;border-top:1px solid var(--border-color);';
    pg.innerHTML = pgHTML(dashMgrPage, totalPgs, 'changeDashMgrPage');
}

function changeDashMgrPage(dir) {
    dashMgrPage = Math.max(1, Math.min(dashMgrPage + dir, Math.ceil(currentManagers.length / dashMgrPerPage)));
    renderManagersWidget(sortMgr(currentManagers, currentManagerSort));
}

function sortMgr(managers, by) {
    return managers.slice().sort(function(a,b) {
        if (by === 'revenue') return b.revenue - a.revenue;
        if (by === 'deals')   return b.deals - a.deals;
        return (b.revenue / (b.deals||1)) - (a.revenue / (a.deals||1));
    });
}

// ── 6. Channels (paginated, absolute count) ───────────────────
async function fetchChannels(period) {
    chnPeriod = period;
    setBtnActive('.chn-period-btn', period);
    const chnContainer = document.getElementById('channels-container');
    if (chnContainer) chnContainer.innerHTML =
        '<div style="display:flex;flex-direction:column;gap:16px;padding:8px 0;">' +
        Array(5).fill('<div style="display:grid;grid-template-columns:280px 1fr;gap:24px;align-items:center;">' +
            '<div class="skeleton" style="height:44px;border-radius:8px;"></div>' +
            '<div class="skeleton" style="height:32px;border-radius:8px;"></div>' +
            '</div>').join('') + '</div>';
    try {
        const res = await fetch(buildUrl('/api/channels', { period: period }));
        const d   = await res.json();
        if (d.sources) {
            window._channelSources = d.sources;
            renderChannels(d.sources);
        }
    } catch(e) { console.error('fetchChannels', e); }
}

const CHN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
const CHN_COLORS = ['#2fc6f6','#ffa900','#9dcf00','#ff5752','#ab7fe6','#ec4899','#14b8a6','#6366f1'];

function renderChannels(sources) {
    // Sort: non-zero first (by count desc), then zero entries alphabetically
    const nonZero = Object.entries(sources).filter(function(e){ return e[1] > 0; }).sort(function(a,b){ return b[1]-a[1]; });
    const zero    = Object.entries(sources).filter(function(e){ return e[1] === 0; }).sort(function(a,b){ return a[0].localeCompare(b[0]); });
    allChannelsSorted = nonZero.concat(zero);
    channelsPage = 1;
    _renderChannelsPage();
}

function _renderChannelsPage() {
    const container = document.getElementById('channels-container');
    if (!container) return;
    if (!allChannelsSorted.length) {
        container.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-secondary);font-size:0.8125rem;">Нет данных за выбранный период</div>';
        return;
    }

    const maxCount = Math.max(allChannelsSorted[0][1], 1); // avoid div/0 when all are 0
    const totalPgs = Math.ceil(allChannelsSorted.length / channelsPerPage);
    const start    = (channelsPage - 1) * channelsPerPage;
    const page     = allChannelsSorted.slice(start, start + channelsPerPage);

    container.innerHTML = page.map(function(entry, i) {
        const gi    = start + i;
        const name  = entry[0], count = entry[1];
        const color = CHN_COLORS[gi % CHN_COLORS.length];
        const barW  = ((count / maxCount) * 100).toFixed(0);
        return '<div class="channel-row">' +
            '<div class="channel-info">' +
            '<div class="channel-icon" style="background:' + color + '20;color:' + color + ';">' + CHN_ICON + '</div>' +
            '<div class="channel-name"><span>' + name + '</span><span class="channel-leads">' + count + ' лидов</span></div>' +
            '</div>' +
            '<div class="channel-bar-container">' +
            '<div class="channel-bar" style="width:' + barW + '%;background:' + color + ';"></div>' +
            '<span class="channel-value">' + count + '</span>' +
            '</div>' +
            '</div>';
    }).join('');

    if (totalPgs > 1) {
        container.innerHTML += '<div style="display:flex;justify-content:center;align-items:center;gap:8px;padding-top:12px;border-top:1px solid var(--border-color);margin-top:8px;">' +
            pgHTML(channelsPage, totalPgs, 'changeChannelsPage') +
            '</div>';
    }
}

function changeChannelsPage(dir) {
    const total = Math.ceil(allChannelsSorted.length / channelsPerPage);
    channelsPage = Math.max(1, Math.min(channelsPage + dir, total));
    _renderChannelsPage();
}

// ── Funnel dropdown ────────────────────────────────────────────
async function loadFunnels() {
    try {
        const res = await fetch(buildUrl('/api/funnels'));
        const d   = await res.json();
        if (d.funnels && d.funnels.length > 0) {
            funnelsList = d.funnels;
            const sel = document.getElementById('funnel-select');
            if (sel) {
                sel.innerHTML = '';
                d.funnels.filter(function(f) { return f.NAME !== 'Общая'; }).forEach(function(f) {
                    const o = document.createElement('option');
                    o.value = f.ID; o.textContent = f.NAME;
                    sel.appendChild(o);
                });
            }
        }
    } catch(e) {}
}

function initFunnelSelect() {
    const sel = document.getElementById('funnel-select');
    if (sel && !sel.dataset.init) {
        sel.addEventListener('change', function(e) { fetchFunnel(funnelPeriod, e.target.value); });
        sel.dataset.init = '1';
    }
    document.querySelectorAll('.funnel-period-btn').forEach(function(btn) {
        btn.addEventListener('click', function() { fetchFunnel(btn.dataset.period, funnelCategory); });
    });
}

function initSourcesControls() {
    document.querySelectorAll('.sources-period-btn').forEach(function(btn) {
        btn.addEventListener('click', function() { fetchSources(btn.dataset.period); });
    });
}

// ── Nav buttons ────────────────────────────────────────────────
function initNavButtons() {
    document.querySelectorAll('.main-kpi-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.main-kpi-btn').forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            ['revenue','leads','conversion'].forEach(function(cls) {
                const v = document.querySelector('.kpi-card.' + cls + ' .kpi-value');
                if (v) v.classList.add('skeleton');
            });
            fetchKPI(btn.dataset.period);
        });
    });
    document.querySelectorAll('.page-mgr-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.page-mgr-btn').forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            pageMgrPeriod = btn.dataset.period;
            loadPageManagers(pageMgrPeriod);
        });
    });
    document.querySelectorAll('.page-leads-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.page-leads-btn').forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            pageLeadsPeriod = btn.dataset.period;
            loadPageLeads(pageLeadsStatus, pageLeadsPeriod);
        });
    });
    document.querySelectorAll('.mgr-period-btn').forEach(function(btn) {
        btn.addEventListener('click', function() { fetchManagers(btn.dataset.period); });
    });
    document.querySelectorAll('.chn-period-btn').forEach(function(btn) {
        btn.addEventListener('click', function() { fetchChannels(btn.dataset.period); });
    });
}

function initManagersSort() {
    const sel = document.querySelector('.managers-sort-select');
    if (!sel) return;
    sel.addEventListener('change', function(e) {
        const m = {'По выручке':'revenue','По сделкам':'deals','По конверсии':'conversion'};
        currentManagerSort = m[e.target.value] || 'revenue';
        if (currentManagers.length) { dashMgrPage = 1; renderManagersWidget(sortMgr(currentManagers, currentManagerSort)); }
    });
}

// ── Refresh: skeletons on ALL widgets ─────────────────────────
function initRefreshButton() {
    const btn = document.querySelector('.refresh-btn');
    if (!btn) return;
    let cd = false;
    btn.addEventListener('click', async function() {
        if (cd) return;
        cd = true; btn.disabled = true;

        showAllSkeletons(); // cover everything before fetching

        const svg = btn.querySelector('svg');
        svg.style.transition = 'transform 0.8s linear';
        svg.style.transform  = 'rotate(360deg)';

        await Promise.all([
            fetchKPI(kpiPeriod),
            fetchFunnel(funnelPeriod, funnelCategory),
            fetchSources(sourcesPeriod),
            fetchManagers(mgrPeriod),
            fetchChannels(chnPeriod),
            fetchDealsInProgress()
        ]);

        setTimeout(function() { svg.style.transition = 'none'; svg.style.transform = 'rotate(0deg)'; }, 800);
        setTimeout(function() { cd = false; btn.disabled = false; }, 3000);
    });
}

// ── KPI helpers ────────────────────────────────────────────────
function setKPI(sel, val, pre, suf) {
    pre = pre || ''; suf = suf || '';
    const el = document.querySelector(sel);
    if (el) { el.classList.remove('skeleton'); el.textContent = pre + fmt(val) + suf; }
}

function setKPIChange(cardSel, val) {
    const card = document.querySelector(cardSel);
    if (!card) return;
    const el = card.querySelector('.kpi-change');
    if (!el) return;
    el.classList.remove('skeleton');
    if (val === null || val === undefined) {
        el.textContent = '— нет данных';
        el.className   = 'kpi-change neutral';
        return;
    }
    el.textContent = (val >= 0 ? '↑' : '↓') + ' ' + (val >= 0 ? '+' : '') + val + '% к прошлому периоду';
    el.className   = 'kpi-change ' + (val >= 0 ? 'positive' : 'negative');
}

function showDealsSkeleton() {
    const tbody = document.querySelector('.deals-table tbody');
    if (tbody) tbody.innerHTML = Array(5).fill(
        '<tr>' + ['140','60','40','80','70','50'].map(function(w) {
            return '<td><div class="skeleton" style="height:14px;width:' + w + 'px;border-radius:4px;"></div></td>';
        }).join('') + '</tr>').join('');
}

// ── Page: Managers ─────────────────────────────────────────────
let pageMgrPageNum = 1;
const pageMgrPerPage = 5;

async function loadPageManagers(period) {
    period = period || pageMgrPeriod;
    pageMgrPeriod = period;
    const container = document.getElementById('managers-page-content');
    if (!container) return;
    container.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-secondary);">Загрузка...</div>';
    try {
        const res = await fetch(buildUrl('/api/managers', { period: period }));
        const d   = await res.json();
        if (d.managers) currentManagers = d.managers;
        renderPageManagers(currentManagers);
    } catch(e) { renderPageManagers(currentManagers); }
}

function renderPageManagers(managers) {
    const container = document.getElementById('managers-page-content');
    if (!container) return;
    if (!managers.length) {
        container.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-secondary);">Нет данных за выбранный период</div>';
        return;
    }
    const medals   = ['gold','silver','bronze'];
    const maxRev   = Math.max.apply(null, managers.map(function(m) { return m.revenue; }).concat([1]));
    const totalPgs = Math.ceil(managers.length / pageMgrPerPage);
    const start    = (pageMgrPageNum - 1) * pageMgrPerPage;
    const page     = managers.slice(start, start + pageMgrPerPage);
    const totalRev = managers.reduce(function(s,m) { return s + m.revenue; }, 0);
    const totalDls = managers.reduce(function(s,m) { return s + m.deals; }, 0);

    const rows = page.map(function(m, i) {
        const gi  = start + i;
        const pct = m.revenue / maxRev * 100;
        const rc  = medals[gi] || '';
        const ini = m.name.split(' ').map(function(n) { return n[0]; }).join('').slice(0,2);
        const photoStyle = m.photo ? 'style="background-image:url(\'' + m.photo + '\');background-size:cover;background-position:center;"' : '';
        return '<div class="manager-item" style="cursor:pointer;" onclick="window.open(\'https://robotcorporation.bitrix24.ru/company/personal/user/' + m.id + '/\',\'_blank\')">' +
            '<div class="manager-rank ' + rc + '">' + (gi+1) + '</div>' +
            '<div class="manager-avatar" ' + photoStyle + '>' + (m.photo ? '' : ini) + '</div>' +
            '<div class="manager-info"><span class="manager-name">' + m.name + '</span><span class="manager-deals">' + m.deals + ' сделок</span></div>' +
            '<div class="manager-stats"><div class="manager-bar"><div class="bar-fill" style="width:' + pct + '%"></div></div></div>' +
            '<div class="manager-revenue">' + fmtMoney(m.revenue) + '</div>' +
            '</div>';
    }).join('');

    container.innerHTML =
        '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px;">' +
        '<div class="chart-card" style="text-align:center;padding:24px;"><div style="font-size:2rem;font-weight:800;color:var(--accent-primary)">' + managers.length + '</div><div style="color:var(--text-secondary);margin-top:4px;">Всего менеджеров</div></div>' +
        '<div class="chart-card" style="text-align:center;padding:24px;"><div style="font-size:2rem;font-weight:800;color:var(--success)">' + fmtMoney(totalRev) + '</div><div style="color:var(--text-secondary);margin-top:4px;">Общая выручка</div></div>' +
        '<div class="chart-card" style="text-align:center;padding:24px;"><div style="font-size:2rem;font-weight:800;color:var(--warning)">' + totalDls + '</div><div style="color:var(--text-secondary);margin-top:4px;">Всего сделок</div></div>' +
        '</div>' +
        '<div class="chart-card">' +
        '<div class="chart-header"><h3>Рейтинг менеджеров</h3>' +
        '<select class="chart-select" onchange="var m={\'По выручке\':\'revenue\',\'По сделкам\':\'deals\',\'По конверсии\':\'conversion\'};currentManagerSort=m[this.value]||\'revenue\';pageMgrPageNum=1;renderPageManagers(sortMgr(currentManagers,currentManagerSort));">' +
        '<option>По конверсии</option><option>По выручке</option><option>По сделкам</option>' +
        '</select></div>' +
        '<div class="managers-list">' + rows + '</div>' +
        '<div style="display:flex;justify-content:center;align-items:center;gap:8px;padding:12px;border-top:1px solid var(--border-color);">' +
        pgHTML(pageMgrPageNum, totalPgs, 'changePageMgrPage') +
        '</div></div>';
}

function changePageMgrPage(dir) {
    pageMgrPageNum = Math.max(1, Math.min(pageMgrPageNum + dir, Math.ceil(currentManagers.length / pageMgrPerPage)));
    renderPageManagers(currentManagers);
}

// ── Page: Leads ────────────────────────────────────────────────
let leadsPage = 1;
const leadsPerPage = 5;
let currentLeads = [];

function setLeadsStatus(status, btn) {
    pageLeadsStatus = status;
    document.querySelectorAll('#page-leads .widget-filter-btn').forEach(function(b) { b.classList.remove('active'); });
    if (btn) btn.classList.add('active');
    loadPageLeads(status, pageLeadsPeriod);
}

async function loadPageLeads(status, period) {
    status = status || pageLeadsStatus;
    period = period || pageLeadsPeriod;
    pageLeadsStatus = status;
    pageLeadsPeriod = period;
    const container = document.getElementById('leads-table-container');
    if (!container) return;
    container.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-secondary);">Загрузка...</div>';
    try {
        const res = await fetch(buildUrl('/api/deals/in-progress'));
        const d   = await res.json();
        let leads = (d.deals || []).map(function(deal) {
            return {
                id: deal.ID, title: deal.TITLE || 'Без названия',
                source: deal.stageName || '—', status: deal.STAGE_ID,
                dateCreate: deal.DATE_CREATE,
                assignedName: 'Менеджер ' + deal.ASSIGNED_BY_ID
            };
        });
        if (status === 'accepted') leads = leads.filter(function(l) { return !l.status.includes('LOSE') && !l.status.includes('JUNK'); });
        else if (status === 'rejected') leads = leads.filter(function(l) { return l.status.includes('LOSE') || l.status.includes('JUNK'); });
        currentLeads = leads; leadsPage = 1; renderLeadsPage();
    } catch(e) {
        container.innerHTML = '<div style="padding:32px;color:var(--danger);">Ошибка загрузки</div>';
    }
}

function renderLeadsPage() {
    const container = document.getElementById('leads-table-container');
    if (!container) return;
    if (!currentLeads.length) { container.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-secondary);">Нет обращений</div>'; return; }
    const totalPgs = Math.ceil(currentLeads.length / leadsPerPage);
    const page = currentLeads.slice((leadsPage-1)*leadsPerPage, leadsPage*leadsPerPage);
    container.innerHTML =
        '<div style="padding:16px;border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;">' +
        '<span style="font-weight:600;">Всего: ' + currentLeads.length + '</span>' +
        '<span style="font-size:0.8125rem;color:var(--text-secondary);">' + leadsPage + ' / ' + totalPgs + '</span></div>' +
        '<div class="deals-table-wrapper"><table class="deals-table">' +
        '<thead><tr><th>Обращение</th><th>Источник</th><th>Менеджер</th><th>Статус</th><th>Дата</th></tr></thead>' +
        '<tbody>' + page.map(function(l) {
            return '<tr><td class="deal-name"><span class="deal-id">#' + l.id + '</span>' + l.title + '</td>' +
                '<td>' + (l.source||'—') + '</td>' +
                '<td><div style="display:flex;align-items:center;gap:8px;"><div class="cell-avatar">' + (l.assignedName||'М').charAt(0) + '</div><span style="font-size:0.8125rem;">' + l.assignedName + '</span></div></td>' +
                '<td><span style="padding:4px 10px;border-radius:4px;font-size:0.6875rem;font-weight:600;background:var(--bg-tertiary);color:var(--text-secondary);">' + (l.status||'—') + '</span></td>' +
                '<td style="font-size:0.8125rem;color:var(--text-secondary);">' + new Date(l.dateCreate).toLocaleDateString('ru-RU') + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div style="display:flex;justify-content:center;align-items:center;gap:8px;padding:12px;border-top:1px solid var(--border-color);">' + pgHTML(leadsPage, totalPgs, 'changeLeadsPage') + '</div>';
}

function changeLeadsPage(dir) {
    leadsPage = Math.max(1, Math.min(leadsPage + dir, Math.ceil(currentLeads.length / leadsPerPage)));
    renderLeadsPage();
}

// ── Navigation ─────────────────────────────────────────────────
function initTabs() {
    document.querySelectorAll('.nav-item').forEach(function(item) {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
            item.classList.add('active');
            if (item.dataset.page) navigateTo(item.dataset.page);
        });
    });
}

function navigateTo(page) {
    ['#section-kpi','#section-charts','#section-bottom','#section-channels'].forEach(function(sel) {
        const el = document.querySelector(sel);
        if (el) el.style.display = page === 'dashboard' ? '' : 'none';
    });
    document.querySelectorAll('.page-section').forEach(function(s) { s.style.display = 'none'; });
    if (page !== 'dashboard') { const sec = document.getElementById('page-' + page); if (sec) sec.style.display = 'block'; }

    document.getElementById('dashboard-nav-controls').style.display = page === 'dashboard' ? 'flex' : 'none';
    document.getElementById('managers-nav-controls').style.display  = page === 'managers'  ? 'flex' : 'none';
    document.getElementById('leads-nav-controls').style.display     = page === 'leads'     ? 'flex' : 'none';

    const titles = {
        dashboard: ['Аналитический дашборд','Ключевые показатели эффективности в реальном времени'],
        managers:  ['Менеджеры','Детальная статистика по каждому менеджеру'],
        leads:     ['Обращения','Все лиды и обращения из CRM'],
        knowledge: ['База знаний','Документация и справочные материалы'],
        settings:  ['Настройки','Конфигурация дашборда']
    };
    const t = titles[page] || ['',''];
    const te = document.getElementById('top-nav-title'), se = document.getElementById('top-nav-subtitle');
    if (te) te.textContent = t[0]; if (se) se.textContent = t[1];

    if (page === 'managers') loadPageManagers(pageMgrPeriod);
    if (page === 'leads')    loadPageLeads(pageLeadsStatus, pageLeadsPeriod);
    if (page === 'knowledge') loadKnowledgePage();
}

function restartOnboarding() {
    localStorage.removeItem('onboarding_completed');
    window.scrollTo({ top: 0, behavior: 'instant' });
    navigateTo('dashboard');
    document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
    const dn = document.querySelector('.nav-item[data-page="dashboard"]');
    if (dn) dn.classList.add('active');
    setTimeout(function() { if (typeof startOnboarding === 'function') startOnboarding(); }, 400);
}

function loadKnowledgePage() {
    const c = document.getElementById('knowledge-content');
    if (!c) return;
    const arts = [
        {cat:'📖 Начало работы', items:['Как подключить Bitrix24','Первоначальная настройка','Системные требования']},
        {cat:'📊 Дашборд', items:['Как читать KPI-карточки','Воронка продаж','Конверсия','Фильтрация по периодам']},
        {cat:'👥 Менеджеры', items:['Рейтинг эффективности','Расчёт конверсии','Планирование KPI']},
        {cat:'📈 Аналитика', items:['Источники обращений','Эффективность каналов','Анализ трендов']},
        {cat:'⚙️ Администрирование', items:['Управление доступом','Настройка воронок','Решение проблем']},
        {cat:'❓ FAQ', items:['Частые вопросы','Глоссарий терминов']}
    ];
    c.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;">' +
        arts.map(function(s) {
            return '<div class="chart-card"><h3 style="margin-bottom:16px;">' + s.cat + '</h3>' +
                '<div style="display:flex;flex-direction:column;gap:8px;">' +
                s.items.map(function(item) {
                    return '<div style="padding:10px 14px;background:var(--bg-tertiary);border-radius:var(--radius-md);cursor:pointer;font-size:0.875rem;"' +
                        'onmouseover="this.style.background=\'var(--bg-card-hover)\'" onmouseout="this.style.background=\'var(--bg-tertiary)\'">📄 ' + item + '</div>';
                }).join('') + '</div></div>';
        }).join('') + '</div>';
}

function bxNavClick(btn, page) {
    document.querySelectorAll('.bx-nav-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    if (page === 'onboarding') {
        restartOnboarding();
        setTimeout(function() {
            document.querySelectorAll('.bx-nav-btn').forEach(function(b) { b.classList.toggle('active', b.dataset.page === 'dashboard'); });
        }, 100);
        return;
    }
    document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.toggle('active', n.dataset.page === page); });
    navigateTo(page);
}

// ── Helpers ────────────────────────────────────────────────────
function setBtnActive(selector, period) {
    document.querySelectorAll(selector).forEach(function(b) { b.classList.toggle('active', b.dataset.period === period); });
}

function pgHTML(page, total, fn) {
    const disL = page === 1 ? 'disabled' : '';
    const disR = page >= total ? 'disabled' : '';
    const btnStyle = 'padding:4px 12px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:var(--bg-tertiary);cursor:pointer;';
    return '<button onclick="' + fn + '(-1)" style="' + btnStyle + '" ' + disL + '>←</button>' +
        '<span style="font-size:0.8125rem;color:var(--text-secondary);">' + page + ' / ' + (total || 1) + '</span>' +
        '<button onclick="' + fn + '(1)" style="' + btnStyle + '" ' + disR + '>→</button>';
}

function fmt(num) { return Math.round(parseFloat(num) || 0).toLocaleString('ru-RU'); }

function fmtMoney(num) {
    return (parseFloat(num) || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' руб.';
}

function fmtDate(date) {
    const m = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
    return date.getDate() + ' ' + m[date.getMonth()] + ' ' + date.getFullYear();
}

function updateDateRangeDisplay(period) {
    const el = document.getElementById('date-range-text');
    if (!el) return;
    const today = new Date();
    if (period === 'day') {
        el.textContent = 'Сегодня, ' + fmtDate(today);
    } else if (period === 'week') {
        const f = new Date(today); f.setDate(today.getDate() - 7);
        el.textContent = fmtDate(f) + ' — ' + fmtDate(today);
    } else {
        const f = new Date(today); f.setMonth(today.getMonth() - 1);
        el.textContent = fmtDate(f) + ' — ' + fmtDate(today);
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, function(m) {
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m];
    });
}

// Stubs
function initAnimations() {}
function animateCounters() {}
function animateDataRefresh() {}
function loadSources() {}
function updateDashboardUI() {}
function fetchDashboardData(p) { return fetchKPI(p || kpiPeriod); }
function updateChannelsChart(s) { renderChannels(s); }
function updateChannelsChartLeads(s) { renderChannels(s); }

const _obs = new IntersectionObserver(function(entries) {
    entries.forEach(function(e) { if (e.isIntersecting) { e.target.classList.add('visible'); _obs.unobserve(e.target); } });
}, { threshold: 0.1 });
document.querySelectorAll('.chart-card').forEach(function(c) { _obs.observe(c); });
