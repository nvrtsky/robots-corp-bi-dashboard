// BI Dashboard — Refactored with fully independent widget periods

// ── State ──────────────────────────────────────────────────────
let bitrixDomain = null;
let isInBitrix   = false;
let currentManagers   = [];
let currentManagerSort = 'revenue';
let currentDeals  = [];
let currentDealFilter = 'all';
let currentPage   = 1;
const dealsPerPage = 5;

// Each widget has its own period
let kpiPeriod     = 'day';
let funnelPeriod  = 'day';
let funnelCategory = 'all';
let sourcesPeriod = 'day';
let mgrPeriod     = 'day';
let chnPeriod     = 'day';
let pageMgrPeriod = 'day';
let pageLeadsPeriod = 'day';
let pageLeadsStatus = 'all';

let dashMgrPage = 1;
const dashMgrPerPage = 5;

let funnelPage = 1;
const funnelPerPage = 5;
let lastFunnelData = {};

let funnelsList = [];

// ── Init ──────────────────────────────────────────────────────
function detectBitrixContext() {
    const p = new URLSearchParams(window.location.search);
    if (p.get('inBitrix') === 'true' || p.has('DOMAIN') || p.has('domain')) {
        isInBitrix  = true;
        bitrixDomain = p.get('DOMAIN') || p.get('domain');
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
                if (auth && auth.domain) { bitrixDomain = auth.domain; initAll(); }
                document.body.classList.add('bitrix-mode');
                try { setupAutoResize(); } catch(e) {}
            });
        } catch(e) {}
    }
}

function setupAutoResize() {
    if (typeof window.BX24 === 'undefined') return;
    new ResizeObserver(() => { try { window.BX24.fitWindow(); } catch(e){} }).observe(document.body);
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
    // Скелетоны
    document.querySelectorAll('.kpi-value').forEach(el => el.classList.add('skeleton'));
    document.querySelectorAll('.kpi-change span').forEach(el => el.classList.add('skeleton'));
    showSourcesSkeleton();
    showDealsSkeleton();

    initNavButtons();
    initFunnelSelect();
    initSourcesControls();
    initManagersSort();
    initChannelsMetric();
    initRefreshButton();
    initTabs();
    initHelpTooltips();
    if (typeof checkAutoStart === "function") checkAutoStart();
    updateDateRangeDisplay('month');

    initBitrix24();
    // Всегда запускаем — BX24.init только обогащает доменом
    initAll();
});

function initAll() {
    loadFunnels();
    fetchKPI(kpiPeriod);
    fetchFunnel(funnelPeriod, funnelCategory);
    fetchSources(sourcesPeriod);
    fetchManagers(mgrPeriod);
    fetchChannels(chnPeriod);
}

// ── API helper ────────────────────────────────────────────────
function apiUrl(period, extra = '') {
    const { from, to } = periodDates(period);
    let url = `/api/stats/dashboard?dateFrom=${from}&dateTo=${to}`;
    if (bitrixDomain) url += `&domain=${encodeURIComponent(bitrixDomain)}`;
    if (extra) url += extra;
    return url;
}

function periodDates(period) {
    const today = new Date(), from = new Date();
    if (period === 'day')   from.setDate(today.getDate() - 1);
    else if (period === 'week') from.setDate(today.getDate() - 7);
    else from.setMonth(today.getMonth() - 1);
    return { from: from.toISOString().split('T')[0], to: today.toISOString().split('T')[0] };
}

// ── Fetch functions — each widget is independent ───────────────

async function fetchKPI(period) {
    kpiPeriod = period;
    updateDateRangeDisplay(period);
    try {
        const res = await fetch(apiUrl(period));
        const d = await res.json();
        if (d.error) {
            console.error('KPI error:', d.error);
            return;
        }
        // KPI
        setKPI('.kpi-card.revenue .kpi-value', d.revenue, '₽ ');
        setKPI('.kpi-card.leads .kpi-value', d.leadsCount);
        setKPI('.kpi-card.deals .kpi-value', d.dealsInProgressCount);
        if (d.conversionRate !== undefined) setKPI('.kpi-card.conversion .kpi-value', d.conversionRate, '', '%');
        if (d.changes) {
            setKPIChange('.kpi-card.revenue', d.changes.revenue);
            setKPIChange('.kpi-card.leads', d.changes.leadsCount);
            setKPIChange('.kpi-card.conversion', d.changes.conversionRate);
            setKPIChange('.kpi-card.deals', d.changes.dealsInProgress);
        }
        // Deals table — tied to KPI period
        if (d.dealsInProgress && d.dealsInProgress.length > 0) {
            currentDeals = d.dealsInProgress;
            currentPage = 1;
            renderDealsTable(filterDeals(d.dealsInProgress, currentDealFilter));
        }
        // Indicators
        if (d.dealsInProgress) {
            const hot  = d.dealsInProgress.filter(x => x.daysInProgress < 7).length;
            const warm = d.dealsInProgress.filter(x => x.daysInProgress >= 7 && x.daysInProgress <= 30).length;
            const cold = d.dealsInProgress.filter(x => x.daysInProgress > 30).length;
            const inds = document.querySelectorAll('.indicator-item span:last-child');
            if (inds[0]) inds[0].textContent = `${hot} горячих`;
            if (inds[1]) inds[1].textContent = `${warm} в процессе`;
            if (inds[2]) inds[2].textContent = `${cold} стагнирующих`;
        }
    } catch(e) { console.error('fetchKPI', e); }
}

async function fetchFunnel(period, category = funnelCategory) {
    funnelPeriod  = period;
    funnelCategory = category;
    setBtnActive('.funnel-period-btn', period);
    showFunnelSkeleton();
    let extra = '';
    if (category && category !== 'all') extra = `&categoryId=${encodeURIComponent(category)}`;
    try {
        const res = await fetch(apiUrl(period) + extra);
        const d = await res.json();
        if (d.error) {
            console.error('Funnel error:', d.error);
            return;
        }
        if (d.funnel) renderFunnelChart(d.funnel);
    } catch(e) { console.error('fetchFunnel', e); }
}

async function fetchSources(period) {
    sourcesPeriod = period;
    setBtnActive('.sources-period-btn', period);
    showSourcesSkeleton();
    try {
        const res = await fetch(apiUrl(period));
        const d = await res.json();
        if (d.error) {
            console.error('Sources error:', d.error);
            showSourcesSkeleton();
            return;
        }
        if (d.sources) {
            window._sourcesAll   = d.sources;
            window._sourcesDeals = d.dealsInProgress || [];
            sourcesPage = 1;  // ← СБРОС ПАГИНАЦИИ
            applySourcesType();
            // rejected count
            const rej = (d.dealsInProgress||[]).filter(x =>
                x.stageName==='Спам'||x.stageName==='Потребность исчезла'||
                (x.STAGE_ID&&(x.STAGE_ID==='LOSE'||x.STAGE_ID.includes('JUNK')))).length;
            const el = document.getElementById('rejected-count');
            const pe = document.getElementById('rejected-percent');
            if (el) el.textContent = rej;
            if (pe && d.dealsInProgressCount > 0) pe.textContent = ((rej/d.dealsInProgressCount)*100).toFixed(1)+'%';
        }
    } catch(e) { console.error('fetchSources', e); }
}

function applySourcesType() {
    const type = document.getElementById('sources-type-select')?.value || 'all';
    if (type === 'rejected') {
        const deals = window._sourcesDeals || [];
        const rej = deals.filter(x =>
            x.stageName==='Спам'||x.stageName==='Потребность исчезла'||
            (x.STAGE_ID&&(x.STAGE_ID==='LOSE'||x.STAGE_ID.includes('JUNK'))));
        const src = {};
        rej.forEach(x => { const k=x.stageName||'Другое'; src[k]=(src[k]||0)+1; });
        renderDonut(Object.keys(src).length ? src : {'Нет данных':1});
    } else {
        if (window._sourcesAll) renderDonut(window._sourcesAll);
        else showSourcesSkeleton();
    }
}

async function fetchManagers(period) {
    mgrPeriod = period;
    setBtnActive('.mgr-period-btn', period);
    // Show skeleton
    const container = document.querySelector('.managers-card .managers-list');
    if (container) container.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-secondary);">Загрузка...</div>';
    try {
        const res = await fetch(apiUrl(period));
        const d = await res.json();
        if (d.error) {
            console.error('Managers error:', d.error);
            return;
        }
        if (d.managers && d.managers.length > 0) {
            currentManagers = d.managers;
            dashMgrPage = 1;
            renderManagersWidget(sortMgr(d.managers, currentManagerSort));
        }
    } catch(e) { console.error('fetchManagers', e); }
}

async function fetchChannels(period) {
    chnPeriod = period;
    setBtnActive('.chn-period-btn', period);
    try {
        const res = await fetch(apiUrl(period));
        const d = await res.json();
        if (d.error) {
            console.error('Channels error:', d.error);
            return;
        }
        if (d.sources) {
            window._channelSources = d.sources;
            renderChannels(d.sources);
        }
    } catch(e) { console.error('fetchChannels', e); }
}

// ── Funnels dropdown ──────────────────────────────────────────
async function loadFunnels() {
    try {
        let url = '/api/funnels';
        if (bitrixDomain) url += `?domain=${encodeURIComponent(bitrixDomain)}`;
        const res = await fetch(url);
        const d = await res.json();
        if (d.error) {
            console.error('Funnels error:', d.error);
            return;
        }
        if (d.funnels && d.funnels.length > 0) {
            funnelsList = d.funnels;
            const sel = document.getElementById('funnel-select');
            if (sel) {
                sel.innerHTML = '';
                d.funnels.filter(f => f.NAME !== 'Общая').forEach(f => {
                    const o = document.createElement('option');
                    o.value = f.ID; o.textContent = f.NAME;
                    sel.appendChild(o);
                });
            }
        }
    } catch(e) { console.error('loadFunnels', e); }
}

function initFunnelSelect() {
    const sel = document.getElementById('funnel-select');
    if (sel && !sel.dataset.init) {
        sel.addEventListener('change', e => fetchFunnel(funnelPeriod, e.target.value));
        sel.dataset.init = '1';
    }
    document.querySelectorAll('.funnel-period-btn').forEach(btn => {
        btn.addEventListener('click', () => fetchFunnel(btn.dataset.period, funnelCategory));
    });
}

// ── Sources controls ──────────────────────────────────────────
function initSourcesControls() {
    document.querySelectorAll('.sources-period-btn').forEach(btn => {
        btn.addEventListener('click', () => fetchSources(btn.dataset.period));
    });
    const sel = document.getElementById('sources-type-select');
    if (sel) sel.addEventListener('change', applySourcesType);
}

// ── Nav period buttons ────────────────────────────────────────
function initNavButtons() {
    document.querySelectorAll('.main-kpi-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.main-kpi-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            fetchKPI(btn.dataset.period);
        });
    });
    document.querySelectorAll('.page-mgr-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.page-mgr-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            pageMgrPeriod = btn.dataset.period;
            loadPageManagers(pageMgrPeriod);
        });
    });
    document.querySelectorAll('.page-leads-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.page-leads-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            pageLeadsPeriod = btn.dataset.period;
            loadPageLeads(pageLeadsStatus, pageLeadsPeriod);
        });
    });
    document.querySelectorAll('.mgr-period-btn').forEach(btn => {
        btn.addEventListener('click', () => fetchManagers(btn.dataset.period));
    });
    document.querySelectorAll('.chn-period-btn').forEach(btn => {
        btn.addEventListener('click', () => fetchChannels(btn.dataset.period));
    });
}

function initManagersSort() {
    const sel = document.querySelector('.managers-sort-select');
    if (!sel) return;
    sel.addEventListener('change', e => {
        const m = {'По выручке':'revenue','По сделкам':'deals','По конверсии':'conversion'};
        currentManagerSort = m[e.target.value] || 'revenue';
        if (currentManagers.length) { dashMgrPage = 1; renderManagersWidget(sortMgr(currentManagers, currentManagerSort)); }
    });
}

function initChannelsMetric() {
    const sel = document.getElementById('channels-metric-select');
    if (sel) sel.addEventListener('change', () => { if (window._channelSources) renderChannels(window._channelSources); });
}

// ── KPI helpers ───────────────────────────────────────────────
function setKPI(sel, val, pre='', suf='') {
    const el = document.querySelector(sel);
    if (el) { el.classList.remove('skeleton'); el.textContent = pre + fmt(val) + suf; }
}

function setKPIChange(cardSel, val) {
    const card = document.querySelector(cardSel);
    if (!card) return;
    const el = card.querySelector('.kpi-change');
    if (!el) return;
    el.classList.remove('skeleton');
    if (val === null || val === undefined) { el.textContent = '— нет данных'; el.className = 'kpi-change neutral'; return; }
    el.textContent = `${val>=0?'↑':'↓'} ${val>=0?'+':''}${val}% к прошлому периоду`;
    el.className = `kpi-change ${val>=0?'positive':'negative'}`;
}

// ── Funnel ────────────────────────────────────────────────────
function renderFunnelChart(funnel) {
    lastFunnelData = Object.fromEntries(Object.entries(funnel).sort((a,b)=>b[1]-a[1]));
    funnelPage = 1;
    drawFunnel();
}

function drawFunnel() {
    const container = document.querySelector('.funnel-container');
    if (!container) return;
    const all = Object.entries(lastFunnelData);
    const totalPages = Math.ceil(all.length / funnelPerPage);
    const stages = all.slice((funnelPage-1)*funnelPerPage, funnelPage*funnelPerPage);
    const maxCount = Math.max(...all.map(([,c])=>c), 1);
    const cls = ['stage-1','stage-2','stage-3','stage-4','stage-1'];

    container.innerHTML = stages.map(([name, count], i) => {
        const pct = Math.round(count/maxCount*100);
        const conn = i < stages.length-1 ? `<div class="funnel-connector"><span class="conversion-rate">→ ${pct}%</span></div>` : '';
        return `<div class="funnel-stage ${cls[i%cls.length]}">
            <div class="funnel-bar" style="--width:${pct}%"><span class="funnel-value">${count}</span></div>
            <div class="funnel-info"><span class="stage-name">${name}</span><span class="stage-percent">${pct}%</span></div>
        </div>${conn}`;
    }).join('');

    let pg = document.querySelector('.funnel-pagination');
    if (!pg) { pg = document.createElement('div'); pg.className = 'funnel-pagination'; pg.style.cssText = 'display:flex;justify-content:center;align-items:center;gap:8px;padding:12px;border-top:1px solid var(--border-color);margin-top:8px;'; container.parentNode.appendChild(pg); }
    pg.innerHTML = pgHTML(funnelPage, totalPages, 'changeFunnelPage');
}

function changeFunnelPage(dir) {
    funnelPage = Math.max(1, Math.min(funnelPage+dir, Math.ceil(Object.keys(lastFunnelData).length/funnelPerPage)));
    drawFunnel();
}

// ── Sources / Donut ───────────────────────────────────────────
function showSourcesSkeleton() {
    const legend = document.getElementById('sources-legend');
    if (legend) legend.innerHTML = Array(4).fill(`
        <div class="source-item">
            <div class="skeleton" style="width:12px;height:12px;border-radius:3px;flex-shrink:0;"></div>
            <div style="flex:1;display:flex;flex-direction:column;gap:4px;">
                <div class="skeleton" style="height:12px;width:80px;border-radius:4px;"></div>
                <div class="skeleton" style="height:10px;width:50px;border-radius:4px;"></div>
            </div>
            <div class="skeleton" style="height:6px;width:100px;border-radius:3px;"></div>
        </div>`).join('');
    const dt = document.getElementById('donut-total');
    if (dt) {
        dt.textContent = '';
        dt.classList.add('skeleton');
    }
    const svg = document.getElementById('donut-svg');
    if (svg) {
        svg.classList.add('skeleton');
        svg.querySelectorAll('.dyn-seg').forEach(s => s.remove());
    }
}

function showFunnelSkeleton() {
    const container = document.querySelector('.funnel-container');
    if (!container) return;
    container.innerHTML = Array(3).fill(`
        <div class="funnel-stage">
            <div class="funnel-bar skeleton" style="--width:70%"><span class="funnel-value skeleton">-</span></div>
            <div class="funnel-info"><span class="stage-name skeleton">Загрузка...</span><span class="stage-percent skeleton">-</span></div>
        </div>
    `).join('');
}

let sourcesPage = 1;
const sourcesPerPage = 5;
let currentSourcesEntries = [];

function renderDonut(sources) {
    const total = Object.values(sources).reduce((a,b)=>a+b,0);
    if (!total) return;
    
    // Убираем скелетон с круговой диаграммы
    const svgEl = document.getElementById('donut-svg');
    if (svgEl) svgEl.classList.remove('skeleton');
    
    const el = document.getElementById('donut-total');
    if (el) {
        el.textContent = fmt(total);
        el.classList.remove('skeleton');
    }

    const colors = ['#6366f1','#2fc6f6','#ffa900','#9dcf00','#ec4899','#14b8a6','#ff5752','#ab7fe6'];
    const entries = Object.entries(sources).sort((a,b)=>b[1]-a[1]);
    currentSourcesEntries = entries;
    
    const circ = 2 * Math.PI * 45;
    const svg = document.getElementById('donut-svg');
    if (svg) {
        svg.querySelectorAll('.dyn-seg').forEach(s => s.remove());
        let offset = 0;
        entries.forEach(([, count], i) => {
            const dashLen = (count/total) * circ;
            const c = document.createElementNS('http://www.w3.org/2000/svg','circle');
            c.setAttribute('class','donut-segment dyn-seg');
            c.setAttribute('cx','60'); c.setAttribute('cy','60'); c.setAttribute('r','45');
            c.setAttribute('stroke', colors[i%colors.length]);
            c.setAttribute('stroke-dasharray', `${dashLen} ${circ-dashLen}`);
            c.setAttribute('stroke-dashoffset', `-${offset}`);
            c.setAttribute('fill','none'); c.setAttribute('stroke-width','20');
            const hole = svg.querySelector('.donut-hole');
            hole ? svg.insertBefore(c, hole) : svg.appendChild(c);
            offset += dashLen;
        });
    }

    sourcesPage = 1;
    renderSourcesLegend();
}

function renderSourcesLegend() {
    const legend = document.getElementById('sources-legend');
    if (!legend) return;
    
    const total = currentSourcesEntries.reduce((s,[,c])=>s+c,0);
    const colors = ['#6366f1','#2fc6f6','#ffa900','#9dcf00','#ec4899','#14b8a6','#ff5752','#ab7fe6'];
    const totalPages = Math.ceil(currentSourcesEntries.length / sourcesPerPage);
    const start = (sourcesPage - 1) * sourcesPerPage;
    const pageEntries = currentSourcesEntries.slice(start, start + sourcesPerPage);
    
    legend.innerHTML = pageEntries.map(([name, count], i) => {
        const color = colors[(start + i) % colors.length];
        const pct = ((count/total)*100).toFixed(0);
        return `<div class="source-item">
            <div style="width:12px;height:12px;border-radius:3px;background:${color};flex-shrink:0;"></div>
            <div class="source-info"><span class="source-name">${name}</span><span class="source-stat">${count} (${pct}%)</span></div>
            <div class="source-bar"><div class="source-fill" style="width:${pct}%;background:${color}"></div></div>
        </div>`;
    }).join('');
    
    // Добавляем пагинацию, если нужно
    if (totalPages > 1) {
        let paginationDiv = document.getElementById('sources-pagination');
        if (!paginationDiv) {
            paginationDiv = document.createElement('div');
            paginationDiv.id = 'sources-pagination';
            paginationDiv.style.cssText = 'display:flex;justify-content:center;align-items:center;gap:8px;padding:12px;margin-top:8px;border-top:1px solid var(--border-color);';
            legend.parentNode.appendChild(paginationDiv);
        }
        paginationDiv.innerHTML = `
            <button onclick="changeSourcesPage(-1)" style="padding:4px 12px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:var(--bg-tertiary);cursor:pointer;" ${sourcesPage===1?'disabled':''}>←</button>
            <span style="font-size:0.8125rem;color:var(--text-secondary);">${sourcesPage} / ${totalPages}</span>
            <button onclick="changeSourcesPage(1)" style="padding:4px 12px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:var(--bg-tertiary);cursor:pointer;" ${sourcesPage>=totalPages?'disabled':''}>→</button>
        `;
    } else {
        const paginationDiv = document.getElementById('sources-pagination');
        if (paginationDiv) paginationDiv.remove();
    }
}

function changeSourcesPage(dir) {
    sourcesPage = Math.max(1, Math.min(sourcesPage + dir, Math.ceil(currentSourcesEntries.length / sourcesPerPage)));
    renderSourcesLegend();
}

// ── Managers widget (dashboard) ───────────────────────────────
function renderManagersWidget(managers) {
    const container = document.querySelector('.managers-card .managers-list');
    if (!container) return;
    const maxRev = Math.max(...managers.map(m=>m.revenue), 1);
    const medals = ['gold','silver','bronze'];
    const totalPages = Math.ceil(managers.length/dashMgrPerPage);
    const start = (dashMgrPage-1)*dashMgrPerPage;
    const page  = managers.slice(start, start+dashMgrPerPage);

    container.innerHTML = page.map((m, i) => {
        const gi = start+i, pct = m.revenue/maxRev*100, rc = medals[gi]||'';
        const initials = m.name.split(' ').map(n=>n[0]).join('').slice(0,2);
        return `<div class="manager-item" style="cursor:pointer;" onclick="window.open('https://robotcorporation.bitrix24.ru/company/personal/user/${m.id}/','_blank')">
            <div class="manager-rank ${rc}">${gi+1}</div>
            <div class="manager-avatar" ${m.photo?`style="background-image:url('${m.photo}');background-size:cover;background-position:center;"`:''}>
                ${m.photo?'':initials}</div>
            <div class="manager-info"><span class="manager-name">${m.name}</span><span class="manager-deals">${m.deals} сделок</span></div>
            <div class="manager-stats"><div class="manager-bar"><div class="bar-fill" style="width:${pct}%"></div></div></div>
            <div class="manager-revenue" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100px;">₽ ${fmt(m.revenue)}</div>
        </div>`;
    }).join('');

    let pg = container.parentNode.querySelector('.dash-mgr-pg');
    if (!pg) { pg = document.createElement('div'); pg.className = 'dash-mgr-pg'; container.parentNode.appendChild(pg); }
    pg.style.cssText = 'display:flex;justify-content:center;align-items:center;gap:8px;padding:12px;border-top:1px solid var(--border-color);';
    pg.innerHTML = pgHTML(dashMgrPage, totalPages, 'changeDashMgrPage');
}

function changeDashMgrPage(dir) {
    dashMgrPage = Math.max(1, Math.min(dashMgrPage+dir, Math.ceil(currentManagers.length/dashMgrPerPage)));
    renderManagersWidget(sortMgr(currentManagers, currentManagerSort));
}

function sortMgr(managers, by) {
    return [...managers].sort((a,b) => {
        if (by==='revenue') return b.revenue-a.revenue;
        if (by==='deals')   return b.deals-a.deals;
        return (b.revenue/(b.deals||1)) - (a.revenue/(a.deals||1));
    });
}

// ── Deals table ───────────────────────────────────────────────
function showDealsSkeleton() {
    const tbody = document.querySelector('.deals-table tbody');
    if (tbody) tbody.innerHTML = Array(5).fill(`<tr>${['140','60','40','80','70','50'].map(w=>`<td><div class="skeleton" style="height:14px;width:${w}px;border-radius:4px;"></div></td>`).join('')}</tr>`).join('');
}

function filterDeals(deals, filter) {
    if (filter==='all') return deals;
    return deals.filter(d => {
        const days = d.daysInProgress||0;
        if (filter==='fresh')    return days<7;
        if (filter==='normal')   return days>=7&&days<=14;
        if (filter==='warning')  return days>14&&days<=30;
        if (filter==='critical') return days>30;
        return true;
    });
}

function filterDealsByDuration(filter) {
    currentDealFilter = filter;
    document.querySelectorAll('.duration-badge').forEach(b => b.style.opacity = b.dataset.filter===filter?'1':'0.5');
    if (currentDeals.length) renderDealsTable(filterDeals(currentDeals, filter));
}

function renderDealsTable(deals) {
    const tbody = document.querySelector('.deals-table tbody');
    if (!tbody) return;
    const totalPages = Math.ceil(deals.length/dealsPerPage);
    const start = (currentPage-1)*dealsPerPage;
    const page  = deals.slice(start, start+dealsPerPage);

    tbody.innerHTML = page.map(deal => {
        const days = deal.daysInProgress||0;
        const dc = days>30?'critical':days>14?'warning':days<7?'fresh':'normal';
        const mgr = currentManagers.find(m => String(m.id)===String(deal.ASSIGNED_BY_ID));
        const mgrPhoto = mgr?.photo ? `background-image:url('${mgr.photo}');background-size:cover;background-position:center;` : '';
        const mgrName  = mgr ? mgr.name.split(' ')[0] : `ID${deal.ASSIGNED_BY_ID||'?'}`;
        const mgrInit  = mgr ? mgr.name.split(' ').map(n=>n[0]).join('').slice(0,2) : (deal.ASSIGNED_BY_ID||'?');
        return `<tr style="cursor:pointer;" onclick="window.open('https://robotcorporation.bitrix24.ru/crm/deal/details/${deal.ID}/','_blank')">
            <td class="deal-name"><span class="deal-id">#${deal.ID}</span>${deal.TITLE||'Без названия'}</td>
            <td style="font-size:0.8125rem;color:var(--text-secondary);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${deal.TITLE||'—'}</td>
            <td><div style="display:flex;align-items:center;gap:6px;"><div class="cell-avatar" style="${mgrPhoto}">${mgrPhoto?'':mgrInit}</div><span style="font-size:0.75rem;color:var(--text-secondary);">${mgrName}</span></div></td>
            <td><span class="stage-badge">${deal.stageName||deal.STAGE_ID}</span></td>
            <td class="deal-amount">₽ ${fmt(parseFloat(deal.OPPORTUNITY)||0)}</td>
            <td><span class="duration ${dc}">${days} дн.</span></td>
         </tr>`;
    }).join('');

    let pg = document.querySelector('.deals-pagination');
    if (!pg) { pg = document.createElement('div'); pg.className = 'deals-pagination'; const sm=document.querySelector('.deals-summary'); if(sm) sm.parentNode.insertBefore(pg,sm); }
    pg.style.cssText = 'display:flex;justify-content:center;align-items:center;gap:8px;padding:12px;border-top:1px solid var(--border-color);';
    pg.innerHTML = pgHTML(currentPage, totalPages, 'changeDealPage');

    const sv = document.querySelectorAll('.deals-summary .summary-value');
    if (sv.length>=3) {
        const sum = currentDeals.reduce((s,d)=>s+parseFloat(d.OPPORTUNITY||0),0);
        const avg = currentDeals.length ? Math.round(currentDeals.reduce((s,d)=>s+(d.daysInProgress||0),0)/currentDeals.length) : 0;
        sv[0].textContent = currentDeals.length;
        sv[1].textContent = '₽ '+fmt(Math.round(sum/1000000*10)/10)+'M';
        sv[2].textContent = avg;
    }
}

function changeDealPage(dir) {
    currentPage = Math.max(1, Math.min(currentPage+dir, Math.ceil(currentDeals.length/dealsPerPage)));
    renderDealsTable(filterDeals(currentDeals, currentDealFilter));
}

// ── Channels ──────────────────────────────────────────────────
const CHN_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
const CHN_COLORS = ['#2fc6f6','#ffa900','#9dcf00','#ff5752','#ab7fe6','#ec4899','#14b8a6','#6366f1'];

function renderChannels(sources) {
    const metric = document.getElementById('channels-metric-select')?.value || 'leads';
    const container = document.getElementById('channels-container');
    if (!container) return;
    const sorted = Object.entries(sources).sort((a,b)=>b[1]-a[1]).slice(0,8);
    if (!sorted.length) return;
    const total = sorted.reduce((s,[,c])=>s+c,0);
    const maxCount = sorted[0][1];

    container.innerHTML = sorted.map(([name, count], i) => {
        const color = CHN_COLORS[i%CHN_COLORS.length];
        let val, bw;
        if (metric==='leads') {
            val = count;
            bw  = ((count/maxCount)*100).toFixed(0);
        } else {
            const pct = (count/total)*100;
            val = pct.toFixed(1)+'%';
            bw  = (pct/(sorted[0][1]/total*100)*100).toFixed(0);
        }
        return `<div class="channel-row">
            <div class="channel-info"><div class="channel-icon" style="background:${color}20;color:${color};">${CHN_ICON}</div>
            <div class="channel-name"><span>${name}</span><span class="channel-leads">${count} лидов</span></div></div>
            <div class="channel-bar-container"><div class="channel-bar" style="width:${bw}%;background:${color};"></div><span class="channel-value">${val}</span></div>
        </div>`;
    }).join('');
}

// ── Page: Managers ────────────────────────────────────────────
let pageMgrPageNum = 1;
const pageMgrPerPage = 5;

async function loadPageManagers(period = pageMgrPeriod) {
    pageMgrPeriod = period;
    const container = document.getElementById('managers-page-content');
    if (!container) return;
    container.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-secondary);">Загрузка...</div>';
    try {
        const res = await fetch(apiUrl(period));
        const d = await res.json();
        if (d.error) {
            console.error('Page managers error:', d.error);
            container.innerHTML = '<div style="padding:32px;text-align:center;color:var(--danger);">Ошибка загрузки</div>';
            return;
        }
        if (d.managers) currentManagers = d.managers;
        renderPageManagers(currentManagers);
    } catch(e) { 
        console.error('loadPageManagers', e);
        container.innerHTML = '<div style="padding:32px;text-align:center;color:var(--danger);">Ошибка загрузки</div>';
    }
}

function renderPageManagers(managers) {
    const container = document.getElementById('managers-page-content');
    if (!container) return;
    if (!managers.length) { container.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-secondary);">Нет данных за выбранный период</div>'; return; }
    const medals = ['gold','silver','bronze'];
    const maxRev = Math.max(...managers.map(m=>m.revenue),1);
    const totalPages = Math.ceil(managers.length/pageMgrPerPage);
    const start = (pageMgrPageNum-1)*pageMgrPerPage;
    const page  = managers.slice(start, start+pageMgrPerPage);

    container.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px;">
            <div class="chart-card" style="text-align:center;padding:24px;"><div style="font-size:2rem;font-weight:800;color:var(--accent-primary)">${managers.length}</div><div style="color:var(--text-secondary);margin-top:4px;">Всего менеджеров</div></div>
            <div class="chart-card" style="text-align:center;padding:24px;"><div style="font-size:2rem;font-weight:800;color:var(--success)">₽ ${fmt(managers.reduce((s,m)=>s+m.revenue,0))}</div><div style="color:var(--text-secondary);margin-top:4px;">Общая выручка</div></div>
            <div class="chart-card" style="text-align:center;padding:24px;"><div style="font-size:2rem;font-weight:800;color:var(--warning)">${managers.reduce((s,m)=>s+m.deals,0)}</div><div style="color:var(--text-secondary);margin-top:4px;">Всего сделок</div></div>
        </div>
        <div class="chart-card">
            <div class="chart-header"><h3>Рейтинг менеджеров</h3>
            <select class="chart-select" onchange="const m={'По выручке':'revenue','По сделкам':'deals','По конверсии':'conversion'};currentManagerSort=m[this.value]||'revenue';pageMgrPageNum=1;renderPageManagers(sortMgr(currentManagers,currentManagerSort));"><option>По конверсии</option><option>По выручке</option><option>По сделкам</option></select>
            </div>
            <div class="managers-list">${page.map((m,i)=>{
                const gi=start+i,pct=m.revenue/maxRev*100,rc=medals[gi]||'';
                const ini=m.name.split(' ').map(n=>n[0]).join('').slice(0,2);
                return `<div class="manager-item" style="cursor:pointer;" onclick="window.open('https://robotcorporation.bitrix24.ru/company/personal/user/${m.id}/','_blank')">
                    <div class="manager-rank ${rc}">${gi+1}</div>
                    <div class="manager-avatar" ${m.photo?`style="background-image:url('${m.photo}');background-size:cover;background-position:center;"`:''}>
                        ${m.photo?'':ini}</div>
                    <div class="manager-info"><span class="manager-name">${m.name}</span><span class="manager-deals">${m.deals} сделок</span></div>
                    <div class="manager-stats"><div class="manager-bar"><div class="bar-fill" style="width:${pct}%"></div></div></div>
                    <div class="manager-revenue" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100px;">₽ ${fmt(m.revenue)}</div>
                </div>`;
            }).join('')}</div>
            <div style="display:flex;justify-content:center;align-items:center;gap:8px;padding:12px;border-top:1px solid var(--border-color);">
                ${pgHTML(pageMgrPageNum, totalPages, 'changePageMgrPage')}
            </div>
        </div>`;
}

function changePageMgrPage(dir) {
    pageMgrPageNum = Math.max(1, Math.min(pageMgrPageNum+dir, Math.ceil(currentManagers.length/pageMgrPerPage)));
    renderPageManagers(currentManagers);
}

// ── Page: Leads ───────────────────────────────────────────────
let leadsPage = 1;
const leadsPerPage = 5;
let currentLeads = [];

function setLeadsStatus(status, btn) {
    pageLeadsStatus = status;
    document.querySelectorAll('#page-leads .widget-filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    loadPageLeads(status, pageLeadsPeriod);
}

async function loadPageLeads(status = pageLeadsStatus, period = pageLeadsPeriod) {
    pageLeadsStatus = status;
    pageLeadsPeriod = period;
    const container = document.getElementById('leads-table-container');
    if (!container) return;
    container.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-secondary);">Загрузка...</div>';
    try {
        const res = await fetch(apiUrl(period));
        const d = await res.json();
        if (d.error) {
            console.error('Page leads error:', d.error);
            container.innerHTML = '<div style="padding:32px;color:var(--danger);">Ошибка загрузки</div>';
            return;
        }
        let leads = (d.dealsInProgress||[]).map(deal => ({
            id: deal.ID, title: deal.TITLE||'Без названия',
            source: deal.stageName||'—', status: deal.STAGE_ID,
            dateCreate: deal.DATE_CREATE,
            assignedName: `Менеджер ${deal.ASSIGNED_BY_ID}`
        }));
        if (status==='accepted') leads = leads.filter(l=>!l.status.includes('LOSE')&&!l.status.includes('JUNK'));
        else if (status==='rejected') leads = leads.filter(l=>l.status.includes('LOSE')||l.status.includes('JUNK'));
        currentLeads = leads; leadsPage = 1; renderLeadsPage();
    } catch(e) { 
        console.error('loadPageLeads', e);
        container.innerHTML = '<div style="padding:32px;color:var(--danger);">Ошибка загрузки</div>';
    }
}

function renderLeadsPage() {
    const container = document.getElementById('leads-table-container');
    if (!container) return;
    const statusLabels = {'NEW':'Новый','IN_PROCESS':'В работе','CONVERTED':'Конвертирован','JUNK':'Некачественный'};
    const statusColors = {'NEW':'var(--info)','IN_PROCESS':'var(--warning)','CONVERTED':'var(--success)','JUNK':'var(--danger)'};
    if (!currentLeads.length) { container.innerHTML='<div style="padding:32px;text-align:center;color:var(--text-secondary);">Нет обращений</div>'; return; }
    const totalPages = Math.ceil(currentLeads.length/leadsPerPage);
    const page = currentLeads.slice((leadsPage-1)*leadsPerPage, leadsPage*leadsPerPage);
    container.innerHTML = `
        <div style="padding:16px;border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;"><span style="font-weight:600;">Всего: ${currentLeads.length}</span><span style="font-size:0.8125rem;color:var(--text-secondary);">${leadsPage} / ${totalPages}</span></div>
        <div class="deals-table-wrapper"><table class="deals-table">
            <thead><tr><th>Обращение</th><th>Источник</th><th>Менеджер</th><th>Статус</th><th>Дата</th></tr></thead>
            <tbody>${page.map(l=>`<tr style="cursor:pointer;" onclick="window.open('https://robotcorporation.bitrix24.ru/crm/lead/details/${l.id}/','_blank')">
                <td class="deal-name"><span class="deal-id">#${l.id}</span>${l.title}</td>
                <td>${l.source||'—'}</td>
                <td><div style="display:flex;align-items:center;gap:8px;"><div class="cell-avatar">${(l.assignedName||'М').charAt(0)}</div><span style="font-size:0.8125rem;">${l.assignedName}</span></div></td>
                <td><span style="padding:4px 10px;border-radius:4px;font-size:0.6875rem;font-weight:600;background:${(statusColors[l.status]||'var(--text-tertiary)')}22;color:${statusColors[l.status]||'var(--text-tertiary)'};">${statusLabels[l.status]||l.status||'—'}</span></td>
                <td style="font-size:0.8125rem;color:var(--text-secondary);">${new Date(l.dateCreate).toLocaleDateString('ru-RU')}</td>
             </tr>`).join('')}</tbody>
         </table></div>
        <div style="display:flex;justify-content:center;align-items:center;gap:8px;padding:12px;border-top:1px solid var(--border-color);">${pgHTML(leadsPage, totalPages, 'changeLeadsPage')}</div>`;
}

function changeLeadsPage(dir) { leadsPage = Math.max(1, Math.min(leadsPage+dir, Math.ceil(currentLeads.length/leadsPerPage))); renderLeadsPage(); }

// ── Navigation ────────────────────────────────────────────────
function initTabs() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', e => {
            e.preventDefault();
            document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
            item.classList.add('active');
            const page = item.dataset.page;
            if (page) navigateTo(page);
        });
    });
}

function navigateTo(page) {
    ['#section-kpi','#section-charts','#section-bottom','#section-channels'].forEach(sel => {
        const el = document.querySelector(sel);
        if (el) el.style.display = page==='dashboard' ? '' : 'none';
    });
    document.querySelectorAll('.page-section').forEach(s => s.style.display='none');
    if (page!=='dashboard') { const sec=document.getElementById(`page-${page}`); if(sec) sec.style.display='block'; }

    document.getElementById('dashboard-nav-controls').style.display = page==='dashboard'?'flex':'none';
    document.getElementById('managers-nav-controls').style.display  = page==='managers' ?'flex':'none';
    document.getElementById('leads-nav-controls').style.display     = page==='leads'    ?'flex':'none';

    const titles = {
        dashboard: ['Аналитический дашборд','Ключевые показатели эффективности в реальном времени'],
        managers:  ['Менеджеры','Детальная статистика по каждому менеджеру'],
        leads:     ['Обращения','Все лиды и обращения из CRM'],
        knowledge: ['База знаний','Документация и справочные материалы'],
        settings:  ['Настройки','Конфигурация дашборда']
    };
    const t = titles[page]||['',''];
    const te=document.getElementById('top-nav-title'); const se=document.getElementById('top-nav-subtitle');
    if (te) te.textContent=t[0]; if (se) se.textContent=t[1];

    if (page==='managers') loadPageManagers(pageMgrPeriod);
    if (page==='leads')    loadPageLeads(pageLeadsStatus, pageLeadsPeriod);
    if (page==='knowledge') loadKnowledgePage();
}

// ── Knowledge ─────────────────────────────────────────────────
function loadKnowledgePage() {
    const c = document.getElementById('knowledge-content');
    if (!c) return;
    const arts=[{cat:'📖 Начало работы',items:['Как подключить Bitrix24','Первоначальная настройка','Системные требования']},{cat:'📊 Дашборд',items:['Как читать KPI-карточки','Что такое воронка продаж','Как работает конверсия','Фильтрация по периодам']},{cat:'👥 Менеджеры',items:['Рейтинг эффективности','Как рассчитывается конверсия','Планирование KPI']},{cat:'📈 Аналитика',items:['Источники обращений','Эффективность каналов','Анализ трендов']},{cat:'⚙️ Администрирование',items:['Управление доступом','Настройка воронок','Решение проблем']},{cat:'❓ FAQ',items:['Частые вопросы','Глоссарий терминов']}];
    c.innerHTML=`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;">${arts.map(s=>`<div class="chart-card"><h3 style="margin-bottom:16px;">${s.cat}</h3><div style="display:flex;flex-direction:column;gap:8px;">${s.items.map(i=>`<div style="padding:10px 14px;background:var(--bg-tertiary);border-radius:var(--radius-md);cursor:pointer;font-size:0.875rem;" onmouseover="this.style.background='var(--bg-card-hover)'" onmouseout="this.style.background='var(--bg-tertiary)'">📄 ${i}</div>`).join('')}</div></div>`).join('')}</div>`;
}

// ── Refresh ───────────────────────────────────────────────────
function initRefreshButton() {
    const btn = document.querySelector('.refresh-btn');
    if (!btn) return;
    let cd = false;
    btn.addEventListener('click', async () => {
        if (cd) return;
        cd = true; btn.disabled = true;
        const svg = btn.querySelector('svg');
        svg.style.transition='transform 0.8s linear'; svg.style.transform='rotate(360deg)';
        showSourcesSkeleton(); showDealsSkeleton();
        await fetchKPI(kpiPeriod);
        await fetchFunnel(funnelPeriod, funnelCategory);
        await fetchSources(sourcesPeriod);
        await fetchManagers(mgrPeriod);
        await fetchChannels(chnPeriod);
        setTimeout(()=>{svg.style.transition='none';svg.style.transform='rotate(0deg)';},800);
        setTimeout(()=>{cd=false;btn.disabled=false;},3000);
    });
}

// ── Helpers ───────────────────────────────────────────────────
function setBtnActive(selector, period) {
    document.querySelectorAll(selector).forEach(b => b.classList.toggle('active', b.dataset.period===period));
}

function pgHTML(page, total, fn) {
    return `<button onclick="${fn}(-1)" style="padding:4px 12px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:var(--bg-tertiary);cursor:pointer;" ${page===1?'disabled':''}>←</button>
        <span style="font-size:0.8125rem;color:var(--text-secondary);">${page} / ${total||1}</span>
        <button onclick="${fn}(1)" style="padding:4px 12px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:var(--bg-tertiary);cursor:pointer;" ${page>=total?'disabled':''}>→</button>`;
}

function fmt(num) { return (Math.round(parseFloat(num)||0)).toString().replace(/\B(?=(\d{3})+(?!\d))/g,','); }

function fmtDate(date) {
    const m=['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
    return `${date.getDate()} ${m[date.getMonth()]} ${date.getFullYear()}`;
}

function updateDateRangeDisplay(period) {
    const el = document.getElementById('date-range-text');
    if (!el) return;
    const today = new Date();
    if (period==='day') { el.textContent=fmtDate(today); }
    else if (period==='week') { const f=new Date(today);f.setDate(today.getDate()-7);el.textContent=`${fmtDate(f)} — ${fmtDate(today)}`; }
    else { const f=new Date(today);f.setMonth(today.getMonth()-1);el.textContent=`${fmtDate(f)} — ${fmtDate(today)}`; }
}

// Stubs
function initAnimations() {}
function animateCounters() {}
function animateDataRefresh() {}
function loadSources() {}
function updateDashboardUI() {}
function fetchDashboardData(p) { return fetchKPI(p||kpiPeriod); }
function updateChannelsChart(s) { window._channelSources=s; renderChannels(s); }
function updateChannelsChartLeads(s) { window._channelSources=s; renderChannels(s); }

const _obs = new IntersectionObserver(entries=>{entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');_obs.unobserve(e.target);}});},{threshold:0.1});
document.querySelectorAll('.chart-card').forEach(c=>_obs.observe(c));