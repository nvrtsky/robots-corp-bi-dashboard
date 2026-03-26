// BI Dashboard Interactive JavaScript

let currentDeals = [];
let currentDealFilter = 'all';
let isInBitrix = false;
let bitrixDomain = null;
let currentPeriod = 'month';
let currentCategory = 'all';
let funnelsList = [];
let currentManagers = [];
let currentManagerSort = 'revenue';
let currentPage = 1;
const dealsPerPage = 5;

let dashMgrPeriod = 'month';
let channelsPeriod = 'month';
let pageManagersPeriod = 'month';
let currentLeadsPeriod = 'month';

let _allSourcesData = null;
let _allDealsData = null;

function detectBitrixContext() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('inBitrix') === 'true' || urlParams.has('DOMAIN') || urlParams.has('domain')) {
        isInBitrix = true;
        bitrixDomain = urlParams.get('DOMAIN') || urlParams.get('domain');
    }
    return isInBitrix;
}

function initBitrix24() {
    if (detectBitrixContext()) document.body.classList.add('bitrix-mode');
    if (typeof window.BX24 !== 'undefined' && window.BX24) {
        try {
            window.BX24.init(() => {
                isInBitrix = true;
                const auth = window.BX24.getAuth();
                if (auth && auth.domain) { bitrixDomain = auth.domain; }
                if (!bitrixDomain) bitrixDomain = 'robotcorporation.bitrix24.ru';
                document.body.classList.add('bitrix-mode');
                try { setupAutoResize(); } catch(e) {}
                loadFunnels();
                fetchMainData();
                updateManagersWidget(dashMgrPeriod);
                updateChannelsWidget(channelsPeriod);
            });
        } catch(e) {}
    }
}

function setupAutoResize() {
    if (typeof window.BX24 === 'undefined') return;
    const ro = new ResizeObserver(() => { try { window.BX24.fitWindow(); } catch(e){} });
    ro.observe(document.body);
    setTimeout(() => { try { window.BX24.fitWindow(); } catch(e){} }, 500);
}

function restartOnboarding() {
    localStorage.removeItem('onboarding_completed');
    navigateTo('dashboard');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector('.nav-item[data-page="dashboard"]')?.classList.add('active');
    setTimeout(() => { if (typeof startOnboarding === 'function') startOnboarding(); }, 400);
}

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.kpi-value').forEach(el => el.classList.add('skeleton'));
    document.querySelectorAll('.kpi-change span').forEach(el => el.classList.add('skeleton'));
    showSourcesSkeleton();

    const tbody = document.querySelector('.deals-table tbody');
    if (tbody) {
        tbody.innerHTML = Array(5).fill(`<tr>${['140','60','40','80','70','50'].map(w=>`<td><div class="skeleton" style="height:14px;width:${w}px;border-radius:4px;"></div></td>`).join('')}</tr>`).join('');
    }

    initBitrix24();
    initFilters();
    initTabs();
    initAnimations();
    initRefreshButton();
    initManagerSort();
    initSourcesTabs();
    initChannelsMetric();
    initHelpTooltips();
    checkAutoStart();
    updateDateRangeDisplay('month');

    if (typeof window.BX24 === 'undefined' || !window.BX24) {
        loadFunnels();
        fetchMainData();
        updateManagersWidget(dashMgrPeriod);
        updateChannelsWidget(channelsPeriod);
    }
});

function showSourcesSkeleton() {
    const legend = document.getElementById('sources-legend');
    if (legend) {
        legend.innerHTML = Array(4).fill(`
            <div class="source-item">
                <div class="skeleton" style="width:12px;height:12px;border-radius:3px;flex-shrink:0;"></div>
                <div style="flex:1;display:flex;flex-direction:column;gap:4px;">
                    <div class="skeleton" style="height:12px;width:80px;border-radius:4px;"></div>
                    <div class="skeleton" style="height:10px;width:50px;border-radius:4px;"></div>
                </div>
                <div class="skeleton" style="height:6px;width:100px;border-radius:3px;"></div>
            </div>`).join('');
    }
    const dt = document.getElementById('donut-total');
    if (dt) dt.textContent = '-';
}

async function loadFunnels() {
    try {
        let url = '/api/funnels';
        if (bitrixDomain) url += `?domain=${encodeURIComponent(bitrixDomain)}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.funnels && data.funnels.length > 0) { funnelsList = data.funnels; renderFunnelTabs(); }
    } catch(e) {}
}

function renderFunnelTabs() {
    const select = document.getElementById('funnel-select');
    if (!select) return;
    select.innerHTML = '';
    funnelsList.filter(f => f.NAME !== 'Общая').forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.ID;
        opt.textContent = f.NAME;
        if (currentCategory === f.ID) opt.selected = true;
        select.appendChild(opt);
    });
    if (!select.dataset.initialized) {
        select.addEventListener('change', e => switchFunnel(e.target.value));
        select.dataset.initialized = 'true';
    }
}

function switchFunnel(categoryId) {
    currentCategory = categoryId;
    showSourcesSkeleton();
    fetchMainData();
}

async function fetchMainData(period = currentPeriod) {
    currentPeriod = period;
    const { dateFromStr, dateToStr } = getPeriodDates(period);
    let url = `/api/stats/dashboard?dateFrom=${dateFromStr}&dateTo=${dateToStr}`;
    if (bitrixDomain) url += `&domain=${encodeURIComponent(bitrixDomain)}`;
    if (currentCategory && currentCategory !== 'all') url += `&categoryId=${encodeURIComponent(currentCategory)}`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        if (!data.error) updateMainUI(data);
    } catch(e) { console.error('fetchMainData failed:', e); }
}

async function fetchDashboardData(period) { await fetchMainData(period); }

async function updateManagersWidget(period) {
    dashMgrPeriod = period;
    document.querySelectorAll('.managers-card .mgr-filter-btn').forEach(b => b.classList.toggle('active', b.dataset.period === period));
    const { dateFromStr, dateToStr } = getPeriodDates(period);
    let url = `/api/stats/dashboard?dateFrom=${dateFromStr}&dateTo=${dateToStr}`;
    if (bitrixDomain) url += `&domain=${encodeURIComponent(bitrixDomain)}`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        if (data.managers && data.managers.length > 0) {
            currentManagers = data.managers;
            dashManagerPage = 1;
            updateManagersChart(sortManagers(data.managers, currentManagerSort));
        }
    } catch(e) {}
}

async function updateChannelsWidget(period) {
    channelsPeriod = period;
    document.querySelectorAll('.channels-card .chn-filter-btn').forEach(b => b.classList.toggle('active', b.dataset.period === period));
    const { dateFromStr, dateToStr } = getPeriodDates(period);
    let url = `/api/stats/dashboard?dateFrom=${dateFromStr}&dateTo=${dateToStr}`;
    if (bitrixDomain) url += `&domain=${encodeURIComponent(bitrixDomain)}`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        if (data.sources) { window._lastChannelSources = data.sources; renderChannelsChart(data.sources); }
    } catch(e) {}
}

function renderChannelsChart(sources) {
    const sel = document.getElementById('channels-metric-select');
    const metric = sel ? sel.value : 'leads';
    if (metric === 'leads') updateChannelsChartLeads(sources);
    else updateChannelsChartConversion(sources);
}

function initChannelsMetric() {
    const sel = document.getElementById('channels-metric-select');
    if (sel) sel.addEventListener('change', () => { const src = window._lastChannelSources; if (src) renderChannelsChart(src); });
}

function updateMainUI(data) {
    updateKPI('.kpi-card.revenue .kpi-value', data.revenue, '₽ ');
    updateKPI('.kpi-card.leads .kpi-value', data.leadsCount);
    updateKPI('.kpi-card.deals .kpi-value', data.dealsInProgressCount);
    if (data.conversionRate !== undefined) updateKPI('.kpi-card.conversion .kpi-value', data.conversionRate, '', '%');
    if (data.changes) {
        updateKPIChange('.kpi-card.revenue', data.changes.revenue);
        updateKPIChange('.kpi-card.leads', data.changes.leadsCount);
        updateKPIChange('.kpi-card.conversion', data.changes.conversionRate);
        updateKPIChange('.kpi-card.deals', data.changes.dealsInProgress);
    }

    if (data.sources) {
        _allSourcesData = data.sources;
        _allDealsData = data.dealsInProgress || [];
        const activeTab = document.querySelector('.sources-card .tab-btn.active');
        const tabType = activeTab?.dataset.sources || 'all';
        if (tabType === 'rejected') updateSourcesRejected(_allDealsData);
        else updateDonutChart(data.sources);
        updateRejectedCount(_allDealsData, data.dealsInProgressCount);
    }

    if (data.dealsInProgress) {
        const hot = data.dealsInProgress.filter(d => d.daysInProgress < 7).length;
        const warm = data.dealsInProgress.filter(d => d.daysInProgress >= 7 && d.daysInProgress <= 30).length;
        const cold = data.dealsInProgress.filter(d => d.daysInProgress > 30).length;
        const inds = document.querySelectorAll('.indicator-item span:last-child');
        if (inds[0]) inds[0].textContent = `${hot} горячих`;
        if (inds[1]) inds[1].textContent = `${warm} в процессе`;
        if (inds[2]) inds[2].textContent = `${cold} стагнирующих`;
    }

    if (data.dealsInProgress && data.dealsInProgress.length > 0) {
        currentDeals = data.dealsInProgress;
        currentPage = 1;
        updateDealsTable(filterDeals(data.dealsInProgress, currentDealFilter));
    }

    if (data.funnel) updateFunnelChart(data.funnel);
}

function updateDashboardUI(data) { updateMainUI(data); }

function updateRejectedCount(deals, totalCount) {
    const rejected = (deals||[]).filter(d => d.stageName==='Спам'||d.stageName==='Потребность исчезла'||(d.STAGE_ID&&(d.STAGE_ID==='LOSE'||d.STAGE_ID.includes('JUNK')))).length;
    const el = document.getElementById('rejected-count');
    const pct = document.getElementById('rejected-percent');
    if (el) el.textContent = rejected;
    if (pct && totalCount > 0) pct.textContent = ((rejected/totalCount)*100).toFixed(1)+'%';
}

function initSourcesTabs() {
    document.querySelectorAll('.sources-card .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.sources-card .tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const type = btn.dataset.sources;
            if (type === 'rejected') updateSourcesRejected(_allDealsData||[]);
            else { if (_allSourcesData) updateDonutChart(_allSourcesData); else showSourcesSkeleton(); }
        });
    });
}

function updateSourcesRejected(deals) {
    const rejected = (deals||[]).filter(d => d.stageName==='Спам'||d.stageName==='Потребность исчезла'||(d.STAGE_ID&&(d.STAGE_ID==='LOSE'||d.STAGE_ID.includes('JUNK'))));
    const sources = {};
    rejected.forEach(d => { const k = d.stageName||'Другое'; sources[k] = (sources[k]||0)+1; });
    updateDonutChart(Object.keys(sources).length > 0 ? sources : {'Нет данных':1});
}

function updateDonutChart(sources) {
    const total = Object.values(sources).reduce((a,b)=>a+b,0);
    if (total === 0) return;
    const el = document.getElementById('donut-total');
    if (el) el.textContent = formatNumber(total);

    const colors = ['#6366f1','#2fc6f6','#ffa900','#9dcf00','#ec4899','#14b8a6','#ff5752','#ab7fe6'];
    const entries = Object.entries(sources);
    const circumference = 2 * Math.PI * 45;

    const svg = document.getElementById('donut-svg');
    if (svg) {
        svg.querySelectorAll('.dyn-segment').forEach(s => s.remove());
        let offset = 0;
        entries.forEach(([name, count], idx) => {
            const pct = count / total;
            const dashLen = pct * circumference;
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('class', 'donut-segment dyn-segment');
            circle.setAttribute('cx', '60'); circle.setAttribute('cy', '60'); circle.setAttribute('r', '45');
            circle.setAttribute('stroke', colors[idx % colors.length]);
            circle.setAttribute('stroke-dasharray', `${dashLen} ${circumference - dashLen}`);
            circle.setAttribute('stroke-dashoffset', `-${offset}`);
            circle.setAttribute('fill', 'none'); circle.setAttribute('stroke-width', '20');
            const hole = svg.querySelector('.donut-hole');
            if (hole) svg.insertBefore(circle, hole); else svg.appendChild(circle);
            offset += dashLen;
        });
    }

    const legend = document.getElementById('sources-legend');
    if (legend) {
        legend.innerHTML = entries.map(([name, count], idx) => {
            const color = colors[idx % colors.length];
            const pct = ((count/total)*100).toFixed(0);
            return `<div class="source-item">
                <div style="width:12px;height:12px;border-radius:3px;background:${color};flex-shrink:0;"></div>
                <div class="source-info"><span class="source-name">${name}</span><span class="source-stat">${count} (${pct}%)</span></div>
                <div class="source-bar"><div class="source-fill" style="width:${pct}%;background:${color}"></div></div>
            </div>`;
        }).join('');
    }
}

function filterDeals(deals, filter) {
    if (filter === 'all') return deals;
    return deals.filter(d => {
        const days = d.daysInProgress||0;
        if (filter==='fresh') return days<7;
        if (filter==='normal') return days>=7&&days<=14;
        if (filter==='warning') return days>14&&days<=30;
        if (filter==='critical') return days>30;
        return true;
    });
}

function filterDealsByDuration(filter) {
    currentDealFilter = filter;
    document.querySelectorAll('.duration-badge').forEach(b => b.style.opacity = b.dataset.filter===filter?'1':'0.5');
    if (currentDeals.length > 0) updateDealsTable(filterDeals(currentDeals, filter));
}

function updateDealsTable(deals) {
    const tbody = document.querySelector('.deals-table tbody');
    if (!tbody) return;
    const totalPages = Math.ceil(deals.length/dealsPerPage);
    const start = (currentPage-1)*dealsPerPage;
    const paginated = deals.slice(start, start+dealsPerPage);

    tbody.innerHTML = paginated.map(deal => {
        const days = deal.daysInProgress||0;
        const dc = days>30?'critical':days>14?'warning':days<7?'fresh':'normal';
        // Match manager from cache
        const mgr = currentManagers.find(m => String(m.id) === String(deal.ASSIGNED_BY_ID));
        const mgrInitials = mgr ? mgr.name.split(' ').map(n=>n[0]).join('').slice(0,2) : `${deal.ASSIGNED_BY_ID||'?'}`;
        const mgrPhotoStyle = mgr && mgr.photo ? `background-image:url('${mgr.photo}');background-size:cover;background-position:center;` : '';
        const mgrName = mgr ? mgr.name.split(' ')[0] : `ID${deal.ASSIGNED_BY_ID}`;
        // Client = deal title (first meaningful part)
        const clientText = deal.TITLE || '—';
        return `<tr style="cursor:pointer;" onclick="window.open('https://robotcorporation.bitrix24.ru/crm/deal/details/${deal.ID}/','_blank')">
            <td class="deal-name"><span class="deal-id">#${deal.ID}</span>${deal.TITLE||'Без названия'}</td>
            <td style="font-size:0.8125rem;color:var(--text-secondary);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${clientText}">${clientText}</td>
            <td><div style="display:flex;align-items:center;gap:6px;"><div class="cell-avatar" style="${mgrPhotoStyle}">${mgrPhotoStyle?'':mgrInitials}</div><span style="font-size:0.75rem;color:var(--text-secondary);">${mgrName}</span></div></td>
            <td><span class="stage-badge">${deal.stageName||deal.STAGE_ID}</span></td>
            <td class="deal-amount">₽ ${formatNumber(parseFloat(deal.OPPORTUNITY)||0)}</td>
            <td><span class="duration ${dc}">${days} дн.</span></td>
        </tr>`;
    }).join('');

    let pg = document.querySelector('.deals-pagination');
    if (!pg) { pg = document.createElement('div'); pg.className = 'deals-pagination'; const sm = document.querySelector('.deals-summary'); if (sm) sm.parentNode.insertBefore(pg, sm); }
    pg.style.cssText = 'display:flex;justify-content:center;align-items:center;gap:8px;padding:12px;border-top:1px solid var(--border-color);';
    pg.innerHTML = `<button onclick="changePage(-1)" style="padding:4px 12px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:var(--bg-tertiary);cursor:pointer;" ${currentPage===1?'disabled':''}>←</button>
        <span style="font-size:0.8125rem;color:var(--text-secondary);">${currentPage} / ${totalPages||1}</span>
        <button onclick="changePage(1)" style="padding:4px 12px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:var(--bg-tertiary);cursor:pointer;" ${currentPage>=totalPages?'disabled':''}>→</button>`;

    const sv = document.querySelectorAll('.deals-summary .summary-value');
    if (sv.length >= 3) {
        const sum = currentDeals.reduce((s,d)=>s+parseFloat(d.OPPORTUNITY||0),0);
        const avg = currentDeals.length>0?Math.round(currentDeals.reduce((s,d)=>s+(d.daysInProgress||0),0)/currentDeals.length):0;
        sv[0].textContent = currentDeals.length;
        sv[1].textContent = '₽ '+formatNumber(Math.round(sum/1000000*10)/10)+'M';
        sv[2].textContent = avg;
    }
}

function changePage(dir) {
    currentPage = Math.max(1, Math.min(currentPage+dir, Math.ceil(currentDeals.length/dealsPerPage)));
    updateDealsTable(filterDeals(currentDeals, currentDealFilter));
}

const CHANNEL_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
const CHANNEL_COLORS = ['#2fc6f6','#ffa900','#9dcf00','#ff5752','#ab7fe6','#ec4899','#14b8a6','#6366f1'];

function updateChannelsChartLeads(sources) {
    const container = document.getElementById('channels-container');
    if (!container) return;
    const sorted = Object.entries(sources).sort((a,b)=>b[1]-a[1]).slice(0,8);
    if (!sorted.length) return;
    const maxCount = sorted[0][1];
    container.innerHTML = sorted.map(([name, count], i) => {
        const bw = ((count/maxCount)*100).toFixed(0);
        const color = CHANNEL_COLORS[i%CHANNEL_COLORS.length];
        return `<div class="channel-row">
            <div class="channel-info"><div class="channel-icon" style="background:${color}20;color:${color};">${CHANNEL_ICON}</div>
            <div class="channel-name"><span>${name}</span><span class="channel-leads">${count} лидов</span></div></div>
            <div class="channel-bar-container"><div class="channel-bar" style="width:${bw}%;background:${color};"></div><span class="channel-value">${count}</span></div>
        </div>`;
    }).join('');
}

function updateChannelsChartConversion(sources) {
    const container = document.getElementById('channels-container');
    if (!container) return;
    const total = Object.values(sources).reduce((a,b)=>a+b,0);
    if (total === 0) return;
    const sorted = Object.entries(sources).sort((a,b)=>b[1]-a[1]).slice(0,8);
    const maxPct = (sorted[0][1]/total)*100;
    container.innerHTML = sorted.map(([name, count], i) => {
        const pct = ((count/total)*100).toFixed(1);
        const bw = (((count/total)*100)/maxPct*100).toFixed(0);
        const color = CHANNEL_COLORS[i%CHANNEL_COLORS.length];
        return `<div class="channel-row">
            <div class="channel-info"><div class="channel-icon" style="background:${color}20;color:${color};">${CHANNEL_ICON}</div>
            <div class="channel-name"><span>${name}</span><span class="channel-leads">${count} лидов</span></div></div>
            <div class="channel-bar-container"><div class="channel-bar" style="width:${bw}%;background:${color};"></div><span class="channel-value">${pct}%</span></div>
        </div>`;
    }).join('');
}

function updateChannelsChart(s) { updateChannelsChartConversion(s); }
function animateChannelBars() {}

let dashManagerPage = 1;
const dashManagersPerPage = 5;

function updateManagersChart(managers) {
    const container = document.querySelector('.managers-card .managers-list');
    if (!container) return;
    const maxRevenue = Math.max(...managers.map(m=>m.revenue), 1);
    const medals = ['gold','silver','bronze'];
    const totalPages = Math.ceil(managers.length/dashManagersPerPage);
    const start = (dashManagerPage-1)*dashManagersPerPage;
    const paginated = managers.slice(start, start+dashManagersPerPage);

    container.innerHTML = paginated.map((m, idx) => {
        const gi = start+idx;
        const pct = m.revenue/maxRevenue*100;
        const rc = medals[gi]||'';
        const initials = m.name.split(' ').map(n=>n[0]).join('').slice(0,2);
        return `<div class="manager-item" style="cursor:pointer;" onclick="window.open('https://robotcorporation.bitrix24.ru/company/personal/user/${m.id}/','_blank')">
            <div class="manager-rank ${rc}">${gi+1}</div>
            <div class="manager-avatar" ${m.photo?`style="background-image:url('${m.photo}');background-size:cover;background-position:center;"`:''}>
                ${m.photo?'':initials}</div>
            <div class="manager-info"><span class="manager-name">${m.name}</span><span class="manager-deals">${m.deals} сделок</span></div>
            <div class="manager-stats"><div class="manager-bar"><div class="bar-fill" style="width:${pct}%"></div></div>
            <span class="manager-value">₽ ${formatNumber(Math.round(m.revenue/1000))}K</span></div>
            <div class="manager-revenue">₽ ${formatNumber(m.revenue)}</div>
        </div>`;
    }).join('');

    let pg = container.parentNode.querySelector('.dash-mgr-pagination');
    if (!pg) { pg = document.createElement('div'); pg.className = 'dash-mgr-pagination'; container.parentNode.appendChild(pg); }
    pg.style.cssText = 'display:flex;justify-content:center;align-items:center;gap:8px;padding:12px;border-top:1px solid var(--border-color);';
    pg.innerHTML = `<button onclick="changeDashManagerPage(-1)" style="padding:4px 12px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:var(--bg-tertiary);cursor:pointer;" ${dashManagerPage===1?'disabled':''}>←</button>
        <span style="font-size:0.8125rem;color:var(--text-secondary);">${dashManagerPage} / ${totalPages||1}</span>
        <button onclick="changeDashManagerPage(1)" style="padding:4px 12px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:var(--bg-tertiary);cursor:pointer;" ${dashManagerPage>=totalPages?'disabled':''}>→</button>`;
}

function changeDashManagerPage(dir) {
    dashManagerPage = Math.max(1, Math.min(dashManagerPage+dir, Math.ceil(currentManagers.length/dashManagersPerPage)));
    updateManagersChart(sortManagers(currentManagers, currentManagerSort));
}

let funnelPage = 1;
const funnelPerPage = 5;
let lastFunnelData = {};

function updateFunnelChart(funnel) {
    lastFunnelData = Object.fromEntries(Object.entries(funnel).sort((a,b)=>b[1]-a[1]));
    funnelPage = 1;
    renderFunnelChart();
}

function renderFunnelChart() {
    const container = document.querySelector('.funnel-container');
    if (!container) return;
    const all = Object.entries(lastFunnelData);
    const totalPages = Math.ceil(all.length/funnelPerPage);
    const start = (funnelPage-1)*funnelPerPage;
    const stages = all.slice(start, start+funnelPerPage);
    const maxCount = Math.max(...all.map(([,c])=>c), 1);
    const cls = ['stage-1','stage-2','stage-3','stage-4','stage-1'];

    container.innerHTML = stages.map(([name, count], idx) => {
        const pct = Math.round(count/maxCount*100);
        const conn = idx < stages.length-1 ? `<div class="funnel-connector"><span class="conversion-rate">→ ${pct}%</span></div>` : '';
        return `<div class="funnel-stage ${cls[idx%cls.length]}">
            <div class="funnel-bar" style="--width:${pct}%"><span class="funnel-value">${count}</span></div>
            <div class="funnel-info"><span class="stage-name">${name}</span><span class="stage-percent">${pct}%</span></div>
        </div>${conn}`;
    }).join('');

    let pg = document.querySelector('.funnel-pagination');
    if (!pg) { pg = document.createElement('div'); pg.className = 'funnel-pagination'; pg.style.cssText = 'display:flex;justify-content:center;align-items:center;gap:8px;padding:12px;border-top:1px solid var(--border-color);margin-top:8px;'; container.parentNode.appendChild(pg); }
    pg.innerHTML = `<button onclick="changeFunnelPage(-1)" style="padding:4px 12px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:var(--bg-tertiary);cursor:pointer;" ${funnelPage===1?'disabled':''}>←</button>
        <span style="font-size:0.8125rem;color:var(--text-secondary);">${funnelPage} / ${totalPages||1}</span>
        <button onclick="changeFunnelPage(1)" style="padding:4px 12px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:var(--bg-tertiary);cursor:pointer;" ${funnelPage>=totalPages?'disabled':''}>→</button>`;
}

function changeFunnelPage(dir) {
    funnelPage = Math.max(1, Math.min(funnelPage+dir, Math.ceil(Object.keys(lastFunnelData).length/funnelPerPage)));
    renderFunnelChart();
}

function sortManagers(managers, sortBy) {
    return [...managers].sort((a,b) => {
        if (sortBy==='revenue') return b.revenue-a.revenue;
        if (sortBy==='deals') return b.deals-a.deals;
        if (sortBy==='conversion') return (b.revenue/(b.deals||1))-(a.revenue/(a.deals||1));
        return 0;
    });
}

function initManagerSort() {
    const select = document.querySelector('.managers-card .chart-select');
    if (!select) return;
    select.addEventListener('change', e => {
        const map = {'По выручке':'revenue','По сделкам':'deals','По конверсии':'conversion'};
        currentManagerSort = map[e.target.value]||'revenue';
        if (currentManagers.length > 0) { dashManagerPage = 1; updateManagersChart(sortManagers(currentManagers, currentManagerSort)); }
    });
}

function initFilters() {
    document.querySelectorAll('.main-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.main-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const period = btn.dataset.period;
            updateDateRangeDisplay(period);
            fetchMainData(period);
        });
    });

    document.querySelectorAll('.page-mgr-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.page-mgr-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            pageManagersPeriod = btn.dataset.period;
            loadManagersPage(pageManagersPeriod);
        });
    });

    document.querySelectorAll('.page-leads-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.page-leads-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentLeadsPeriod = btn.dataset.period;
            const activeTab = document.querySelector('#leads-nav-controls .chart-tabs .tab-btn.active');
            const onclick = activeTab?.getAttribute('onclick')||'';
            const match = onclick.match(/'(all|accepted|rejected)'/);
            loadLeads(match?match[1]:'all', currentLeadsPeriod);
        });
    });
}

function updateDateRangeDisplay(period) {
    const el = document.getElementById('date-range-text');
    if (!el) return;
    const today = new Date();
    if (period==='day') { el.textContent = formatDate(today); }
    else if (period==='week') { const f=new Date(today); f.setDate(today.getDate()-7); el.textContent=`${formatDate(f)} — ${formatDate(today)}`; }
    else { const f=new Date(today); f.setMonth(today.getMonth()-1); el.textContent=`${formatDate(f)} — ${formatDate(today)}`; }
}

function initTabs() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', e => {
            e.preventDefault();
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            const page = item.dataset.page;
            if (page) navigateTo(page);
        });
    });
}

function navigateTo(page) {
    const dashSections = ['#section-kpi','#section-charts','#section-bottom','#section-channels'];
    dashSections.forEach(sel => { const el=document.querySelector(sel); if(el) el.style.display=page==='dashboard'?'':'none'; });
    document.querySelectorAll('.page-section').forEach(s => s.style.display='none');
    if (page !== 'dashboard') { const sec=document.getElementById(`page-${page}`); if(sec) sec.style.display='block'; }

    const dashCtrl = document.getElementById('dashboard-nav-controls');
    const mgrCtrl = document.getElementById('managers-nav-controls');
    const leadsCtrl = document.getElementById('leads-nav-controls');
    if (dashCtrl) dashCtrl.style.display = page==='dashboard'?'flex':'none';
    if (mgrCtrl) mgrCtrl.style.display = page==='managers'?'flex':'none';
    if (leadsCtrl) leadsCtrl.style.display = page==='leads'?'flex':'none';

    const titles = {
        dashboard:['Аналитический дашборд','Ключевые показатели эффективности в реальном времени'],
        managers:['Менеджеры','Детальная статистика по каждому менеджеру'],
        leads:['Обращения','Все лиды и обращения из CRM'],
        knowledge:['База знаний','Документация и справочные материалы'],
        settings:['Настройки','Конфигурация дашборда']
    };
    const t = titles[page]||['',''];
    const te = document.getElementById('top-nav-title');
    const se = document.getElementById('top-nav-subtitle');
    if (te) te.textContent = t[0];
    if (se) se.textContent = t[1];

    if (page==='managers') loadManagersPage(pageManagersPeriod);
    if (page==='leads') loadLeads('all', currentLeadsPeriod);
    if (page==='knowledge') loadKnowledgePage();
}

async function loadManagersPage(period = pageManagersPeriod) {
    pageManagersPeriod = period;
    const container = document.getElementById('managers-page-content');
    if (!container) return;
    container.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-secondary);">Загрузка...</div>';
    const { dateFromStr, dateToStr } = getPeriodDates(period);
    let url = `/api/stats/dashboard?dateFrom=${dateFromStr}&dateTo=${dateToStr}`;
    if (bitrixDomain) url += `&domain=${encodeURIComponent(bitrixDomain)}`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        if (data.managers) currentManagers = data.managers;
        renderManagersPage(currentManagers);
    } catch(e) { renderManagersPage(currentManagers); }
}

let managersPageNum = 1;
const managersPerPage = 5;

function renderManagersPage(managers) {
    const container = document.getElementById('managers-page-content');
    if (!container) return;
    if (!managers.length) { container.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-secondary);">Нет данных за выбранный период</div>'; return; }
    const medals = ['gold','silver','bronze'];
    const maxRevenue = Math.max(...managers.map(m=>m.revenue), 1);
    const totalPages = Math.ceil(managers.length/managersPerPage);
    const start = (managersPageNum-1)*managersPerPage;
    const paginated = managers.slice(start, start+managersPerPage);

    container.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px;">
            <div class="chart-card" style="text-align:center;padding:24px;">
                <div style="font-size:2rem;font-weight:800;color:var(--accent-primary)">${managers.length}</div>
                <div style="color:var(--text-secondary);margin-top:4px;">Всего менеджеров</div>
            </div>
            <div class="chart-card" style="text-align:center;padding:24px;">
                <div style="font-size:2rem;font-weight:800;color:var(--success)">₽ ${formatNumber(managers.reduce((s,m)=>s+m.revenue,0))}</div>
                <div style="color:var(--text-secondary);margin-top:4px;">Общая выручка</div>
            </div>
            <div class="chart-card" style="text-align:center;padding:24px;">
                <div style="font-size:2rem;font-weight:800;color:var(--warning)">${managers.reduce((s,m)=>s+m.deals,0)}</div>
                <div style="color:var(--text-secondary);margin-top:4px;">Всего сделок</div>
            </div>
        </div>
        <div class="chart-card">
            <div class="chart-header">
                <h3>Рейтинг менеджеров</h3>
                <select class="chart-select" onchange="const map={'По выручке':'revenue','По сделкам':'deals','По конверсии':'conversion'};currentManagerSort=map[this.value]||'revenue';managersPageNum=1;renderManagersPage(sortManagers(currentManagers,currentManagerSort));">
                    <option>По конверсии</option><option>По выручке</option><option>По сделкам</option>
                </select>
            </div>
            <div class="managers-list">
                ${paginated.map((m, idx) => {
                    const gi=start+idx, pct=m.revenue/maxRevenue*100, rc=medals[gi]||'';
                    const initials=m.name.split(' ').map(n=>n[0]).join('').slice(0,2);
                    return `<div class="manager-item" style="cursor:pointer;" onclick="window.open('https://robotcorporation.bitrix24.ru/company/personal/user/${m.id}/','_blank')">
                        <div class="manager-rank ${rc}">${gi+1}</div>
                        <div class="manager-avatar" ${m.photo?`style="background-image:url('${m.photo}');background-size:cover;background-position:center;"`:''}>
                            ${m.photo?'':initials}</div>
                        <div class="manager-info"><span class="manager-name">${m.name}</span><span class="manager-deals">${m.deals} сделок</span></div>
                        <div class="manager-stats"><div class="manager-bar"><div class="bar-fill" style="width:${pct}%"></div></div>
                        <span class="manager-value">₽ ${formatNumber(Math.round(m.revenue/1000))}K</span></div>
                        <div class="manager-revenue">₽ ${formatNumber(m.revenue)}</div>
                    </div>`;
                }).join('')}
            </div>
            <div style="display:flex;justify-content:center;align-items:center;gap:8px;padding:12px;border-top:1px solid var(--border-color);">
                <button onclick="changeManagersPageNum(-1)" style="padding:4px 12px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:var(--bg-tertiary);cursor:pointer;" ${managersPageNum===1?'disabled':''}>←</button>
                <span style="font-size:0.8125rem;color:var(--text-secondary);">${managersPageNum} / ${totalPages||1}</span>
                <button onclick="changeManagersPageNum(1)" style="padding:4px 12px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:var(--bg-tertiary);cursor:pointer;" ${managersPageNum>=totalPages?'disabled':''}>→</button>
            </div>
        </div>`;
}

function changeManagersPageNum(dir) {
    managersPageNum = Math.max(1, Math.min(managersPageNum+dir, Math.ceil(currentManagers.length/managersPerPage)));
    renderManagersPage(currentManagers);
}

async function loadLeads(status='all', period=currentLeadsPeriod) {
    currentLeadsPeriod = period;
    document.querySelectorAll('#leads-nav-controls .chart-tabs .tab-btn').forEach(btn => {
        const onclick = btn.getAttribute('onclick')||'';
        const match = onclick.match(/'(all|accepted|rejected)'/);
        btn.classList.toggle('active', match&&match[1]===status);
    });

    const container = document.getElementById('leads-table-container');
    if (!container) return;
    container.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-secondary);">Загрузка...</div>';

    const { dateFromStr, dateToStr } = getPeriodDates(period);
    let url = `/api/stats/dashboard?dateFrom=${dateFromStr}&dateTo=${dateToStr}`;
    if (bitrixDomain) url += `&domain=${encodeURIComponent(bitrixDomain)}`;

    try {
        const res = await fetch(url);
        const data = await res.json();
        let leads = (data.dealsInProgress||[]).map(deal => ({
            id:deal.ID, title:deal.TITLE||'Без названия', source:deal.stageName||'—',
            status:deal.STAGE_ID, dateCreate:deal.DATE_CREATE,
            assignedName:`Менеджер ${deal.ASSIGNED_BY_ID}`, assignedId:deal.ASSIGNED_BY_ID
        }));
        if (status==='accepted') leads=leads.filter(l=>!l.status.includes('LOSE')&&!l.status.includes('JUNK'));
        else if (status==='rejected') leads=leads.filter(l=>l.status.includes('LOSE')||l.status.includes('JUNK'));
        renderLeadsTable(leads);
    } catch(e) { container.innerHTML='<div style="padding:32px;color:var(--danger);">Ошибка загрузки</div>'; }
}

let leadsPage=1, leadsPerPage=5, currentLeads=[];

function renderLeadsTable(leads) { currentLeads=leads; leadsPage=1; renderLeadsPage(); }

function renderLeadsPage() {
    const container = document.getElementById('leads-table-container');
    if (!container) return;
    const statusLabels = {'NEW':'Новый','IN_PROCESS':'В работе','CONVERTED':'Конвертирован','JUNK':'Некачественный'};
    const statusColors = {'NEW':'var(--info)','IN_PROCESS':'var(--warning)','CONVERTED':'var(--success)','JUNK':'var(--danger)'};
    if (!currentLeads.length) { container.innerHTML='<div style="padding:32px;text-align:center;color:var(--text-secondary);">Нет обращений</div>'; return; }
    const totalPages=Math.ceil(currentLeads.length/leadsPerPage), start=(leadsPage-1)*leadsPerPage, paginated=currentLeads.slice(start,start+leadsPerPage);
    container.innerHTML = `
        <div style="padding:16px;border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;">
            <span style="font-weight:600;">Всего: ${currentLeads.length}</span>
            <span style="font-size:0.8125rem;color:var(--text-secondary);">${leadsPage} / ${totalPages}</span>
        </div>
        <div class="deals-table-wrapper">
            <table class="deals-table">
                <thead><tr><th>Обращение</th><th>Источник</th><th>Менеджер</th><th>Статус</th><th>Дата</th></tr></thead>
                <tbody>${paginated.map(lead=>`
                <tr style="cursor:pointer;" onclick="window.open('https://robotcorporation.bitrix24.ru/crm/lead/details/${lead.id}/','_blank')">
                    <td class="deal-name"><span class="deal-id">#${lead.id}</span>${lead.title}</td>
                    <td>${lead.source||'—'}</td>
                    <td><div style="display:flex;align-items:center;gap:8px;"><div class="cell-avatar">${(lead.assignedName||'М').charAt(0)}</div><span style="font-size:0.8125rem;">${lead.assignedName}</span></div></td>
                    <td><span style="padding:4px 10px;border-radius:4px;font-size:0.6875rem;font-weight:600;background:${(statusColors[lead.status]||'var(--text-tertiary)')}22;color:${statusColors[lead.status]||'var(--text-tertiary)'};">${statusLabels[lead.status]||lead.status||'—'}</span></td>
                    <td style="font-size:0.8125rem;color:var(--text-secondary);">${new Date(lead.dateCreate).toLocaleDateString('ru-RU')}</td>
                </tr>`).join('')}</tbody>
            </table>
        </div>
        <div style="display:flex;justify-content:center;align-items:center;gap:8px;padding:12px;border-top:1px solid var(--border-color);">
            <button onclick="changeLeadsPage(-1)" style="padding:4px 12px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:var(--bg-tertiary);cursor:pointer;" ${leadsPage===1?'disabled':''}>←</button>
            <span style="font-size:0.8125rem;color:var(--text-secondary);">${leadsPage} / ${totalPages||1}</span>
            <button onclick="changeLeadsPage(1)" style="padding:4px 12px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:var(--bg-tertiary);cursor:pointer;" ${leadsPage>=totalPages?'disabled':''}>→</button>
        </div>`;
}

function changeLeadsPage(dir) { leadsPage=Math.max(1,Math.min(leadsPage+dir,Math.ceil(currentLeads.length/leadsPerPage))); renderLeadsPage(); }

function loadKnowledgePage() {
    const container=document.getElementById('knowledge-content');
    if (!container) return;
    const arts=[{cat:'📖 Начало работы',items:['Как подключить Bitrix24','Первоначальная настройка','Системные требования']},{cat:'📊 Дашборд',items:['Как читать KPI-карточки','Что такое воронка продаж','Как работает конверсия','Фильтрация по периодам']},{cat:'👥 Менеджеры',items:['Рейтинг эффективности','Как рассчитывается конверсия','Планирование KPI']},{cat:'📈 Аналитика',items:['Источники обращений','Эффективность каналов','Анализ трендов']},{cat:'⚙️ Администрирование',items:['Управление доступом','Настройка воронок','Решение проблем']},{cat:'❓ FAQ',items:['Частые вопросы','Глоссарий терминов']}];
    container.innerHTML=`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;">${arts.map(s=>`<div class="chart-card"><h3 style="margin-bottom:16px;">${s.cat}</h3><div style="display:flex;flex-direction:column;gap:8px;">${s.items.map(i=>`<div style="padding:10px 14px;background:var(--bg-tertiary);border-radius:var(--radius-md);cursor:pointer;font-size:0.875rem;" onmouseover="this.style.background='var(--bg-card-hover)'" onmouseout="this.style.background='var(--bg-tertiary)'">📄 ${i}</div>`).join('')}</div></div>`).join('')}</div>`;
}

function updateKPI(selector, value, prefix='', suffix='') {
    const el=document.querySelector(selector);
    if (el) { el.classList.remove('skeleton'); el.textContent=prefix+formatNumber(value)+suffix; }
}

function updateKPIChange(cardSelector, changeValue) {
    const card=document.querySelector(cardSelector);
    if (!card) return;
    const el=card.querySelector('.kpi-change');
    if (!el) return;
    if (changeValue===null||changeValue===undefined) { el.classList.remove('skeleton'); el.textContent='— нет данных'; el.className='kpi-change neutral'; return; }
    const sign=changeValue>=0?'+':'', arrow=changeValue>=0?'↑':'↓';
    el.textContent=`${arrow} ${sign}${changeValue}% к прошлому периоду`;
    el.className=`kpi-change ${changeValue>=0?'positive':'negative'}`;
}

function initRefreshButton() {
    const btn=document.querySelector('.refresh-btn');
    if (!btn) return;
    let cooldown=false;
    btn.addEventListener('click', async () => {
        if (cooldown) return;
        cooldown=true; btn.disabled=true;
        const svg=btn.querySelector('svg');
        svg.style.transition='transform 0.8s linear'; svg.style.transform='rotate(360deg)';
        showSourcesSkeleton();
        await fetchMainData();
        await updateManagersWidget(dashMgrPeriod);
        await updateChannelsWidget(channelsPeriod);
        setTimeout(()=>{svg.style.transition='none';svg.style.transform='rotate(0deg)';},800);
        setTimeout(()=>{cooldown=false;btn.disabled=false;},3000);
    });
}

function getPeriodDates(period) {
    const today=new Date(), dateFrom=new Date();
    if (period==='day') dateFrom.setDate(today.getDate()-1);
    else if (period==='week') dateFrom.setDate(today.getDate()-7);
    else dateFrom.setMonth(today.getMonth()-1);
    return { dateFromStr:dateFrom.toISOString().split('T')[0], dateToStr:today.toISOString().split('T')[0] };
}

function formatNumber(num) { return (Math.round(parseFloat(num)||0)).toString().replace(/\B(?=(\d{3})+(?!\d))/g,','); }

function formatDate(date) {
    const m=['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
    return `${date.getDate()} ${m[date.getMonth()]} ${date.getFullYear()}`;
}

function initAnimations() {}
function animateCounters() {}
function animateDataRefresh() {}
function loadSources() {}

const observer = new IntersectionObserver(entries => {
    entries.forEach(e => { if(e.isIntersecting){e.target.classList.add('visible');observer.unobserve(e.target);} });
}, {threshold:0.1});
document.querySelectorAll('.chart-card').forEach(c=>observer.observe(c));

function createTooltip(){}