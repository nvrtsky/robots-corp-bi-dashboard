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

// Отдельные периоды для каждого виджета
let dashMgrPeriod = 'month';
let channelsPeriod = 'month';

function detectBitrixContext() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('inBitrix') === 'true' || urlParams.has('DOMAIN') || urlParams.has('domain')) {
        isInBitrix = true;
        bitrixDomain = urlParams.get('DOMAIN') || urlParams.get('domain');
    }
    return isInBitrix;
}

function initBitrix24() {
    if (detectBitrixContext()) {
        document.body.classList.add('bitrix-mode');
    }
    if (typeof window.BX24 !== 'undefined' && window.BX24) {
        try {
            window.BX24.init(() => {
                isInBitrix = true;
                const auth = window.BX24.getAuth();
                if (auth && auth.domain) {
                    bitrixDomain = auth.domain;
                } else {
                    try {
                        const placement = window.BX24.placement.info();
                        if (placement && placement.placement) {
                            const urlParams = new URLSearchParams(window.location.search);
                            bitrixDomain = urlParams.get('DOMAIN');
                        }
                    } catch (e) {}
                }
                if (!bitrixDomain) {
                    bitrixDomain = 'robotcorporation.bitrix24.ru';
                }
                document.body.classList.add('bitrix-mode');
                setupAutoResize();
                loadFunnels();
                fetchMainData();
                updateManagersWidget(dashMgrPeriod);
                updateChannelsWidget(channelsPeriod);
            });
        } catch (e) {
            console.warn('[Bitrix24] SDK found but init failed:', e);
        }
    }
}

function setupAutoResize() {
    if (typeof window.BX24 === 'undefined') return;
    const resizeObserver = new ResizeObserver(() => {
        try { window.BX24.fitWindow(); } catch (e) {}
    });
    resizeObserver.observe(document.body);
    setTimeout(() => { try { window.BX24.fitWindow(); } catch (e) {} }, 500);
}

document.addEventListener('DOMContentLoaded', () => {
    // Скелетоны KPI
    document.querySelectorAll('.kpi-value').forEach(el => el.classList.add('skeleton'));
    document.querySelectorAll('.kpi-change span').forEach(el => el.classList.add('skeleton'));

    // Скелетон источников
    const sourcesLegend = document.querySelector('.sources-legend');
    if (sourcesLegend) {
        sourcesLegend.innerHTML = Array(4).fill(`
            <div class="source-item">
                <div class="skeleton" style="width:12px;height:12px;border-radius:3px;flex-shrink:0;"></div>
                <div style="flex:1;display:flex;flex-direction:column;gap:4px;">
                    <div class="skeleton" style="height:12px;width:80px;border-radius:4px;"></div>
                    <div class="skeleton" style="height:10px;width:50px;border-radius:4px;"></div>
                </div>
                <div class="skeleton" style="height:6px;width:100px;border-radius:3px;"></div>
            </div>`).join('');
    }

    // Скелетон таблицы сделок
    const dealsTableBody = document.querySelector('.deals-table tbody');
    if (dealsTableBody) {
        dealsTableBody.innerHTML = Array(5).fill(`
            <tr>
                <td><div class="skeleton" style="height:16px;width:140px;border-radius:4px;"></div></td>
                <td><div class="skeleton" style="height:16px;width:60px;border-radius:4px;"></div></td>
                <td><div class="skeleton" style="height:16px;width:40px;border-radius:4px;"></div></td>
                <td><div class="skeleton" style="height:16px;width:80px;border-radius:4px;"></div></td>
                <td><div class="skeleton" style="height:16px;width:70px;border-radius:4px;"></div></td>
                <td><div class="skeleton" style="height:16px;width:50px;border-radius:4px;"></div></td>
            </tr>`).join('');
    }

    initBitrix24();
    initFilters();
    initTabs();
    initAnimations();
    initRefreshButton();
    initManagerSort();
    initHelpTooltips();
    checkAutoStart();

    if (typeof window.BX24 === 'undefined' || !window.BX24) {
        loadFunnels();
        fetchMainData();
        updateManagersWidget(dashMgrPeriod);
        updateChannelsWidget(channelsPeriod);
    }
});

async function loadFunnels() {
    try {
        let apiUrl = '/api/funnels';
        if (bitrixDomain) apiUrl += `?domain=${encodeURIComponent(bitrixDomain)}`;
        const response = await fetch(apiUrl);
        const data = await response.json();
        if (data.funnels && data.funnels.length > 0) {
            funnelsList = data.funnels;
            renderFunnelTabs();
        }
    } catch (e) {
        console.error('[Dashboard] Failed to load funnels:', e);
    }
}

function renderFunnelTabs() {
    const select = document.getElementById('funnel-select');
    if (!select) return;
    select.innerHTML = '';
    funnelsList.filter(f => f.NAME !== 'Общая').forEach(funnel => {
        const option = document.createElement('option');
        option.value = funnel.ID;
        option.textContent = funnel.NAME;
        if (currentCategory === funnel.ID) option.selected = true;
        select.appendChild(option);
    });
    if (!select.dataset.initialized) {
        select.addEventListener('change', (e) => switchFunnel(e.target.value));
        select.dataset.initialized = 'true';
    }
}

function switchFunnel(categoryId) {
    currentCategory = categoryId;
    fetchMainData(); // Только основные данные, НЕ менеджеры и НЕ каналы
}

// ============================================================
// ОСНОВНОЙ FETCH — только KPI, воронка, источники, сделки
// ============================================================
async function fetchMainData(period = currentPeriod) {
    currentPeriod = period;
    const today = new Date();
    let dateFrom = new Date();
    if (period === 'day') dateFrom.setDate(today.getDate() - 1);
    else if (period === 'week') dateFrom.setDate(today.getDate() - 7);
    else if (period === 'month') dateFrom.setMonth(today.getMonth() - 1);

    const dateFromStr = dateFrom.toISOString().split('T')[0];
    const dateToStr = today.toISOString().split('T')[0];
    let apiUrl = `/api/stats/dashboard?dateFrom=${dateFromStr}&dateTo=${dateToStr}`;
    if (bitrixDomain) apiUrl += `&domain=${encodeURIComponent(bitrixDomain)}`;
    if (currentCategory && currentCategory !== 'all') apiUrl += `&categoryId=${encodeURIComponent(currentCategory)}`;

    try {
        const response = await fetch(apiUrl);
        const data = await response.json();
        if (data.error) return;
        updateMainUI(data); // Только основные виджеты
    } catch (e) {
        console.error('[Dashboard] fetchMainData failed:', e);
    }
}

// Для обратной совместимости
async function fetchDashboardData(period = currentPeriod) {
    await fetchMainData(period);
}

// ============================================================
// FETCH МЕНЕДЖЕРОВ — независимый
// ============================================================
async function updateManagersWidget(period) {
    dashMgrPeriod = period;

    // Обновить активные кнопки в виджете менеджеров
    document.querySelectorAll('.managers-card .mgr-filter-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.period === period);
    });

    const today = new Date();
    let dateFrom = new Date();
    if (period === 'day') dateFrom.setDate(today.getDate() - 1);
    else if (period === 'week') dateFrom.setDate(today.getDate() - 7);
    else if (period === 'month') dateFrom.setMonth(today.getMonth() - 1);

    const dateFromStr = dateFrom.toISOString().split('T')[0];
    const dateToStr = today.toISOString().split('T')[0];
    let apiUrl = `/api/stats/dashboard?dateFrom=${dateFromStr}&dateTo=${dateToStr}`;
    if (bitrixDomain) apiUrl += `&domain=${encodeURIComponent(bitrixDomain)}`;

    try {
        const response = await fetch(apiUrl);
        const data = await response.json();
        if (data.managers && data.managers.length > 0) {
            currentManagers = data.managers;
            dashManagerPage = 1;
            updateManagersChart(sortManagers(data.managers, currentManagerSort));
        }
    } catch (e) {
        console.error('[Dashboard] updateManagersWidget failed:', e);
    }
}

// ============================================================
// FETCH КАНАЛОВ — независимый
// ============================================================
async function updateChannelsWidget(period) {
    channelsPeriod = period;

    // Обновить активные кнопки в виджете каналов
    document.querySelectorAll('.channels-card .chn-filter-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.period === period);
    });

    const today = new Date();
    let dateFrom = new Date();
    if (period === 'day') dateFrom.setDate(today.getDate() - 1);
    else if (period === 'week') dateFrom.setDate(today.getDate() - 7);
    else if (period === 'month') dateFrom.setMonth(today.getMonth() - 1);

    const dateFromStr = dateFrom.toISOString().split('T')[0];
    const dateToStr = today.toISOString().split('T')[0];
    let apiUrl = `/api/stats/dashboard?dateFrom=${dateFromStr}&dateTo=${dateToStr}`;
    if (bitrixDomain) apiUrl += `&domain=${encodeURIComponent(bitrixDomain)}`;

    try {
        const response = await fetch(apiUrl);
        const data = await response.json();
        if (data.sources) {
            window._lastChannelSources = data.sources;
            const activeMetric = document.querySelector('.channels-card .metric-btn.active');
            if (activeMetric && activeMetric.textContent.trim() === 'Лиды') {
                updateChannelsChartLeads(data.sources);
            } else {
                updateChannelsChart(data.sources);
            }
        }
    } catch (e) {
        console.error('[Dashboard] updateChannelsWidget failed:', e);
    }
}

// ============================================================
// UI UPDATE — только основные виджеты (БЕЗ менеджеров и каналов)
// ============================================================
function updateMainUI(data) {
    // 1. KPI
    updateKPI('.kpi-card.revenue .kpi-value', data.revenue, '₽ ');
    updateKPI('.kpi-card.leads .kpi-value', data.leadsCount);
    updateKPI('.kpi-card.deals .kpi-value', data.dealsInProgressCount);
    if (data.conversionRate !== undefined) {
        updateKPI('.kpi-card.conversion .kpi-value', data.conversionRate, '', '%');
    }

    // 2. KPI changes
    if (data.changes) {
        updateKPIChange('.kpi-card.revenue', data.changes.revenue);
        updateKPIChange('.kpi-card.leads', data.changes.leadsCount);
        updateKPIChange('.kpi-card.conversion', data.changes.conversionRate);
        updateKPIChange('.kpi-card.deals', data.changes.dealsInProgress);
    }

    // 3. Источники
    if (data.sources) {
        window._lastSources = data.sources;
        updateDonutChart(data.sources);
        // Непринятые заявок
        if (data.dealsInProgress) {
            const rejected = data.dealsInProgress.filter(d =>
                d.stageName === 'Спам' || d.stageName === 'Потребность исчезла' ||
                (d.STAGE_ID && (d.STAGE_ID.includes('JUNK') || d.STAGE_ID === 'LOSE'))
            ).length;
            const rejectedEl = document.getElementById('rejected-count');
            const rejectedPct = document.getElementById('rejected-percent');
            if (rejectedEl) rejectedEl.textContent = rejected;
            if (rejectedPct && data.dealsInProgressCount > 0) {
                rejectedPct.textContent = ((rejected / data.dealsInProgressCount) * 100).toFixed(1) + '%';
            }
        }
    }

    // 4. Индикаторы сделок
    if (data.dealsInProgress) {
        const hot = data.dealsInProgress.filter(d => d.daysInProgress < 7).length;
        const warm = data.dealsInProgress.filter(d => d.daysInProgress >= 7 && d.daysInProgress <= 30).length;
        const cold = data.dealsInProgress.filter(d => d.daysInProgress > 30).length;
        const indicators = document.querySelectorAll('.indicator-item span:last-child');
        if (indicators[0]) indicators[0].textContent = `${hot} горячих`;
        if (indicators[1]) indicators[1].textContent = `${warm} в процессе`;
        if (indicators[2]) indicators[2].textContent = `${cold} стагнирующих`;
    }

    // 5. Сделки в работе
    if (data.dealsInProgress && data.dealsInProgress.length > 0) {
        currentDeals = data.dealsInProgress;
        currentPage = 1;
        updateDealsTable(filterDeals(data.dealsInProgress, currentDealFilter));
    }

    // 6. Воронка
    if (data.funnel) {
        updateFunnelChart(data.funnel);
    }

    // НЕ обновляем менеджеров и каналы — у них свои независимые данные
}

// updateDashboardUI — алиас для совместимости
function updateDashboardUI(data) {
    updateMainUI(data);
}

function filterDeals(deals, filter) {
    if (filter === 'all') return deals;
    return deals.filter(deal => {
        const days = deal.daysInProgress || 0;
        if (filter === 'fresh') return days < 7;
        if (filter === 'normal') return days >= 7 && days <= 14;
        if (filter === 'warning') return days > 14 && days <= 30;
        if (filter === 'critical') return days > 30;
        return true;
    });
}

function filterDealsByDuration(filter) {
    currentDealFilter = filter;
    document.querySelectorAll('.duration-badge').forEach(btn => {
        btn.style.opacity = btn.dataset.filter === filter ? '1' : '0.5';
    });
    if (currentDeals.length > 0) {
        updateDealsTable(filterDeals(currentDeals, filter));
    }
}

function updateKPI(selector, value, prefix = '', suffix = '') {
    const el = document.querySelector(selector);
    if (el) {
        el.classList.remove('skeleton');
        el.textContent = prefix + formatNumber(value) + suffix;
    }
}

function updateKPIChange(cardSelector, changeValue) {
    const card = document.querySelector(cardSelector);
    if (!card) return;
    const changeEl = card.querySelector('.kpi-change');
    if (!changeEl) return;
    if (changeValue === null || changeValue === undefined) {
        changeEl.classList.remove('skeleton');
        changeEl.textContent = '— нет данных';
        changeEl.className = 'kpi-change neutral';
        return;
    }
    const sign = changeValue >= 0 ? '+' : '';
    const arrow = changeValue >= 0 ? '↑' : '↓';
    const cssClass = changeValue >= 0 ? 'positive' : 'negative';
    changeEl.textContent = `${arrow} ${sign}${changeValue}% к прошлому периоду`;
    changeEl.className = `kpi-change ${cssClass}`;
}

function updateDonutChart(sources) {
    const total = Object.values(sources).reduce((a, b) => a + b, 0);
    if (total === 0) return;
    const centerTotal = document.querySelector('.donut-total');
    if (centerTotal) centerTotal.textContent = formatNumber(total);

    const colors = ['#6366f1','#8b5cf6','#a855f7','#ec4899','#2fc6f6','#14b8a6','#ffa900','#9dcf00','#ff5752'];
    const legend = document.querySelector('.sources-legend');
    if (legend) {
        legend.innerHTML = Object.entries(sources).map(([name, count], idx) => {
            const color = colors[idx % colors.length];
            const percent = ((count / total) * 100).toFixed(0);
            return `
            <div class="source-item">
                <div class="source-color" style="background:${color};border-radius:3px;width:12px;height:12px;flex-shrink:0;"></div>
                <div class="source-info">
                    <span class="source-name">${name}</span>
                    <span class="source-stat">${count} (${percent}%)</span>
                </div>
                <div class="source-bar">
                    <div class="source-fill" style="width:${percent}%;background:${color}"></div>
                </div>
            </div>`;
        }).join('');
    }
}

function updateDealsTable(deals) {
    const tbody = document.querySelector('.deals-table tbody');
    if (!tbody) return;

    const total = deals.length;
    const totalPages = Math.ceil(total / dealsPerPage);
    const start = (currentPage - 1) * dealsPerPage;
    const paginated = deals.slice(start, start + dealsPerPage);

    tbody.innerHTML = paginated.map(deal => {
        let durationClass = 'normal';
        const days = deal.daysInProgress || 0;
        if (days > 30) durationClass = 'critical';
        else if (days > 14) durationClass = 'warning';
        else if (days < 7) durationClass = 'fresh';

        const initials = deal.ASSIGNED_BY_ID ? `ID${deal.ASSIGNED_BY_ID}` : '?';
        return `
        <tr style="cursor:pointer;" onclick="window.open('https://robotcorporation.bitrix24.ru/crm/deal/details/${deal.ID}/','_blank')">
            <td class="deal-name"><span class="deal-id">#${deal.ID}</span>${deal.TITLE||'Без названия'}</td>
            <td>—</td>
            <td><div class="cell-avatar">${initials}</div></td>
            <td><span class="stage-badge">${deal.stageName||deal.STAGE_ID}</span></td>
            <td class="deal-amount">₽ ${formatNumber(parseFloat(deal.OPPORTUNITY)||0)}</td>
            <td><span class="duration ${durationClass}">${days} дн.</span></td>
        </tr>`;
    }).join('');

    // Пагинация — не дублировать
    let pagination = document.querySelector('.deals-pagination');
    if (!pagination) {
        pagination = document.createElement('div');
        pagination.className = 'deals-pagination';
        const summary = document.querySelector('.deals-summary');
        if (summary) summary.parentNode.insertBefore(pagination, summary);
    }
    pagination.style.cssText = 'display:flex;justify-content:center;align-items:center;gap:8px;padding:12px;border-top:1px solid var(--border-color);';
    pagination.innerHTML = `
        <button onclick="changePage(-1)" style="padding:4px 12px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:var(--bg-tertiary);cursor:pointer;" ${currentPage===1?'disabled':''}>←</button>
        <span style="font-size:0.8125rem;color:var(--text-secondary);">${currentPage} / ${totalPages||1}</span>
        <button onclick="changePage(1)" style="padding:4px 12px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:var(--bg-tertiary);cursor:pointer;" ${currentPage>=totalPages?'disabled':''}>→</button>
    `;

    // Summary
    const summaryItems = document.querySelectorAll('.deals-summary .summary-value');
    if (summaryItems.length >= 3) {
        const allDeals = currentDeals;
        const totalSum = allDeals.reduce((s, d) => s + parseFloat(d.OPPORTUNITY || 0), 0);
        const avgDays = allDeals.length > 0 ? Math.round(allDeals.reduce((s, d) => s + (d.daysInProgress || 0), 0) / allDeals.length) : 0;
        summaryItems[0].textContent = allDeals.length;
        summaryItems[1].textContent = '₽ ' + formatNumber(Math.round(totalSum / 1000000 * 10) / 10) + 'M';
        summaryItems[2].textContent = avgDays;
    }
}

function changePage(dir) {
    const totalPages = Math.ceil(currentDeals.length / dealsPerPage);
    currentPage = Math.max(1, Math.min(currentPage + dir, totalPages));
    updateDealsTable(filterDeals(currentDeals, currentDealFilter));
}

// ============================================================
// КАНАЛЫ
// ============================================================
function updateChannelsChart(sources) {
    const container = document.getElementById('channels-container');
    if (!container) return;
    const total = Object.values(sources).reduce((a, b) => a + b, 0);
    if (total === 0) { container.innerHTML = '<div class="no-data">Нет данных</div>'; return; }

    const sortedSources = Object.entries(sources).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const maxCount = sortedSources[0][1];
    const colors = ['#2fc6f6','#ffa900','#9dcf00','#ff5752','#ab7fe6','#ec4899','#14b8a6','#6366f1'];
    const icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;

    container.innerHTML = sortedSources.map(([name, count], index) => {
        const percentage = ((count / total) * 100).toFixed(1);
        const barWidth = ((count / maxCount) * 100).toFixed(0);
        const color = colors[index % colors.length];
        return `
        <div class="channel-row">
            <div class="channel-info">
                <div class="channel-icon" style="background:${color}20;color:${color};">${icon}</div>
                <div class="channel-name"><span>${name}</span><span class="channel-leads">${count} лидов</span></div>
            </div>
            <div class="channel-bar-container">
                <div class="channel-bar" style="width:${barWidth}%;background:${color};"></div>
                <span class="channel-value">${percentage}%</span>
            </div>
        </div>`;
    }).join('');
}

function updateChannelsChartLeads(sources) {
    const container = document.getElementById('channels-container');
    if (!container) return;
    const sortedSources = Object.entries(sources).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const maxCount = sortedSources[0]?.[1] || 1;
    const colors = ['#2fc6f6','#ffa900','#9dcf00','#ff5752','#ab7fe6','#ec4899','#14b8a6','#6366f1'];
    const icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;

    container.innerHTML = sortedSources.map(([name, count], index) => {
        const barWidth = ((count / maxCount) * 100).toFixed(0);
        const color = colors[index % colors.length];
        return `
        <div class="channel-row">
            <div class="channel-info">
                <div class="channel-icon" style="background:${color}20;color:${color};">${icon}</div>
                <div class="channel-name"><span>${name}</span><span class="channel-leads">${count} лидов</span></div>
            </div>
            <div class="channel-bar-container">
                <div class="channel-bar" style="width:${barWidth}%;background:${color};"></div>
                <span class="channel-value">${count}</span>
            </div>
        </div>`;
    }).join('');
}

function animateChannelBars() {}

// ============================================================
// МЕНЕДЖЕРЫ
// ============================================================
let dashManagerPage = 1;
const dashManagersPerPage = 5;

function updateManagersChart(managers) {
    const container = document.querySelector('.managers-card .managers-list');
    if (!container) return;

    const maxRevenue = Math.max(...managers.map(m => m.revenue), 1);
    const medals = ['gold', 'silver', 'bronze'];
    const totalPages = Math.ceil(managers.length / dashManagersPerPage);
    const start = (dashManagerPage - 1) * dashManagersPerPage;
    const paginated = managers.slice(start, start + dashManagersPerPage);

    container.innerHTML = paginated.map((manager, idx) => {
        const globalIdx = start + idx;
        const percent = maxRevenue > 0 ? (manager.revenue / maxRevenue * 100) : 0;
        const rankClass = medals[globalIdx] || '';
        const initials = manager.name.split(' ').map(n => n[0]).join('').slice(0, 2);
        return `
        <div class="manager-item" style="cursor:pointer;" onclick="window.open('https://robotcorporation.bitrix24.ru/company/personal/user/${manager.id}/','_blank')">
            <div class="manager-rank ${rankClass}">${globalIdx+1}</div>
            <div class="manager-avatar" ${manager.photo?`style="background-image:url('${manager.photo}');background-size:cover;background-position:center;"`:''}>
                ${manager.photo?'':initials}
            </div>
            <div class="manager-info">
                <span class="manager-name">${manager.name}</span>
                <span class="manager-deals">${manager.deals} сделок</span>
            </div>
            <div class="manager-stats">
                <div class="manager-bar"><div class="bar-fill" style="width:${percent}%"></div></div>
                <span class="manager-value">₽ ${formatNumber(Math.round(manager.revenue/1000))}K</span>
            </div>
            <div class="manager-revenue">₽ ${formatNumber(manager.revenue)}</div>
        </div>`;
    }).join('');

    let pagination = container.parentNode.querySelector('.dash-mgr-pagination');
    if (!pagination) {
        pagination = document.createElement('div');
        pagination.className = 'dash-mgr-pagination';
        container.parentNode.appendChild(pagination);
    }
    pagination.style.cssText = 'display:flex;justify-content:center;align-items:center;gap:8px;padding:12px;border-top:1px solid var(--border-color);';
    pagination.innerHTML = `
        <button onclick="changeDashManagerPage(-1)" style="padding:4px 12px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:var(--bg-tertiary);cursor:pointer;" ${dashManagerPage===1?'disabled':''}>←</button>
        <span style="font-size:0.8125rem;color:var(--text-secondary);">${dashManagerPage} / ${totalPages||1}</span>
        <button onclick="changeDashManagerPage(1)" style="padding:4px 12px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:var(--bg-tertiary);cursor:pointer;" ${dashManagerPage>=totalPages?'disabled':''}>→</button>
    `;
}

function changeDashManagerPage(dir) {
    const totalPages = Math.ceil(currentManagers.length / dashManagersPerPage);
    dashManagerPage = Math.max(1, Math.min(dashManagerPage + dir, totalPages));
    updateManagersChart(sortManagers(currentManagers, currentManagerSort));
}

// ============================================================
// ВОРОНКА
// ============================================================
let funnelPage = 1;
const funnelPerPage = 5;
let lastFunnelData = {};

function updateFunnelChart(funnel) {
    lastFunnelData = Object.fromEntries(Object.entries(funnel).sort((a, b) => b[1] - a[1]));
    funnelPage = 1;
    renderFunnelChart();
}

function renderFunnelChart() {
    const container = document.querySelector('.funnel-container');
    if (!container) return;
    const allStages = Object.entries(lastFunnelData);
    const totalPages = Math.ceil(allStages.length / funnelPerPage);
    const start = (funnelPage - 1) * funnelPerPage;
    const stages = allStages.slice(start, start + funnelPerPage);
    const maxCount = Math.max(...allStages.map(([_, c]) => c), 1);
    const stageClasses = ['stage-1','stage-2','stage-3','stage-4','stage-1'];

    container.innerHTML = stages.map(([name, count], idx) => {
        const percent = maxCount > 0 ? Math.round(count / maxCount * 100) : 0;
        const stageClass = stageClasses[idx % stageClasses.length];
        const connector = idx < stages.length - 1 ? `
        <div class="funnel-connector"><span class="conversion-rate">→ ${percent}%</span></div>` : '';
        return `
        <div class="funnel-stage ${stageClass}">
            <div class="funnel-bar" style="--width: ${percent}%">
                <span class="funnel-value">${count}</span>
            </div>
            <div class="funnel-info">
                <span class="stage-name">${name}</span>
                <span class="stage-percent">${percent}%</span>
            </div>
        </div>${connector}`;
    }).join('');

    let pagination = document.querySelector('.funnel-pagination');
    if (!pagination) {
        pagination = document.createElement('div');
        pagination.className = 'funnel-pagination';
        pagination.style.cssText = 'display:flex;justify-content:center;align-items:center;gap:8px;padding:12px;border-top:1px solid var(--border-color);margin-top:8px;';
        container.parentNode.appendChild(pagination);
    }
    pagination.innerHTML = `
        <button onclick="changeFunnelPage(-1)" style="padding:4px 12px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:var(--bg-tertiary);cursor:pointer;" ${funnelPage===1?'disabled':''}>←</button>
        <span style="font-size:0.8125rem;color:var(--text-secondary);">${funnelPage} / ${totalPages||1}</span>
        <button onclick="changeFunnelPage(1)" style="padding:4px 12px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:var(--bg-tertiary);cursor:pointer;" ${funnelPage>=totalPages?'disabled':''}>→</button>
    `;
}

function changeFunnelPage(dir) {
    const totalPages = Math.ceil(Object.keys(lastFunnelData).length / funnelPerPage);
    funnelPage = Math.max(1, Math.min(funnelPage + dir, totalPages));
    renderFunnelChart();
}

function sortManagers(managers, sortBy) {
    return [...managers].sort((a, b) => {
        if (sortBy === 'revenue') return b.revenue - a.revenue;
        if (sortBy === 'deals') return b.deals - a.deals;
        if (sortBy === 'conversion') return (b.revenue / (b.deals || 1)) - (a.revenue / (a.deals || 1));
        return 0;
    });
}

function initManagerSort() {
    const select = document.querySelector('.managers-card .chart-select');
    if (!select) return;
    select.addEventListener('change', (e) => {
        const map = {'По выручке':'revenue','По сделкам':'deals','По конверсии':'conversion'};
        currentManagerSort = map[e.target.value] || 'revenue';
        if (currentManagers.length > 0) {
            dashManagerPage = 1;
            updateManagersChart(sortManagers(currentManagers, currentManagerSort));
        }
    });
}

// ============================================================
// ФИЛЬТРЫ
// ============================================================
function initFilters() {
    // Только главный хедер
    const filterBtns = document.querySelectorAll('.main-filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const period = btn.dataset.period;
            const dateRange = document.querySelector('.date-range span');
            const today = new Date();
            if (period === 'day') {
                dateRange.textContent = formatDate(today);
            } else if (period === 'week') {
                const weekAgo = new Date(today);
                weekAgo.setDate(today.getDate() - 7);
                dateRange.textContent = `${formatDate(weekAgo)} — ${formatDate(today)}`;
            } else if (period === 'month') {
                const monthAgo = new Date(today);
                monthAgo.setMonth(today.getMonth() - 1);
                dateRange.textContent = `${formatDate(monthAgo)} — ${formatDate(today)}`;
            }
            fetchMainData(period); // Только основные данные
        });
    });

    // Табы источников
    const tabButtons = document.querySelectorAll('.tab-btn');
    tabButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const parent = e.target.closest('.chart-tabs');
            if (parent) {
                parent.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                if (parent.closest('.sources-card')) {
                    const text = btn.textContent.trim();
                    if (text === 'Принятые') loadSources('accepted');
                    else if (text === 'Непринятые') loadSources('rejected');
                    else loadSources('all');
                }
            }
        });
    });

    // Метрики каналов (Конверсия / Лиды)
    const metricBtns = document.querySelectorAll('.metric-btn');
    metricBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            metricBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const src = window._lastChannelSources || window._lastSources;
            if (btn.textContent.trim() === 'Лиды' && src) {
                updateChannelsChartLeads(src);
            } else if (src) {
                updateChannelsChart(src);
            }
        });
    });
}

function initTabs() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            const page = item.dataset.page;
            if (page) navigateTo(page);
        });
    });
}

function navigateTo(page) {
    const dashboardSections = [
        '.main-content > .header',
        '.kpi-grid',
        '.charts-row',
        '.bottom-row',
        '.channels-section'
    ];
    dashboardSections.forEach(sel => {
        const el = document.querySelector(sel);
        if (el) el.style.display = page === 'dashboard' ? '' : 'none';
    });
    document.querySelectorAll('.page-section').forEach(s => s.style.display = 'none');
    if (page !== 'dashboard') {
        const section = document.getElementById(`page-${page}`);
        if (section) section.style.display = 'block';
    }
    if (page === 'managers') loadManagersPage();
    if (page === 'leads') loadLeads('all');
    if (page === 'knowledge') loadKnowledgePage();
}

// ============================================================
// СТРАНИЦА МЕНЕДЖЕРЫ
// ============================================================
async function loadManagersPage() {
    const container = document.getElementById('managers-page-content');
    if (!container) return;
    container.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-secondary);">Загрузка...</div>';
    if (currentManagers.length === 0) await updateManagersWidget(dashMgrPeriod);
    renderManagersPage(currentManagers);
}

let managersPeriod = 'month';
let managersPage = 1;
const managersPerPage = 5;

function renderManagersPage(managers) {
    const container = document.getElementById('managers-page-content');
    if (!container || !managers.length) return;
    const medals = ['gold','silver','bronze'];
    const maxRevenue = Math.max(...managers.map(m => m.revenue), 1);
    const totalPages = Math.ceil(managers.length / managersPerPage);
    const start = (managersPage - 1) * managersPerPage;
    const paginated = managers.slice(start, start + managersPerPage);

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
            <div class="chart-header" style="flex-direction:column;gap:8px;">
                <div style="display:flex;justify-content:space-between;align-items:center;width:100%;">
                    <h3>Эффективность менеджеров</h3>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;width:100%;">
                    <select class="chart-select" onchange="const map={'По выручке':'revenue','По сделкам':'deals','По конверсии':'conversion'};currentManagerSort=map[this.value]||'revenue';renderManagersPage(sortManagers(currentManagers,currentManagerSort));">
                        <option>По конверсии</option>
                        <option>По выручке</option>
                        <option>По сделкам</option>
                    </select>
                    <div class="date-filter" style="margin:0;">
                        <button class="mgr-filter-btn ${managersPeriod==='day'?'active':''}" onclick="changeManagersPeriod('day')">День</button>
                        <button class="mgr-filter-btn ${managersPeriod==='week'?'active':''}" onclick="changeManagersPeriod('week')">Неделя</button>
                        <button class="mgr-filter-btn ${managersPeriod==='month'?'active':''}" onclick="changeManagersPeriod('month')">Месяц</button>
                    </div>
                </div>
            </div>
            <div class="managers-list">
                ${paginated.map((m, idx) => {
                    const globalIdx = start + idx;
                    const percent = maxRevenue > 0 ? (m.revenue / maxRevenue * 100) : 0;
                    const rankClass = medals[globalIdx] || '';
                    const initials = m.name.split(' ').map(n=>n[0]).join('').slice(0,2);
                    return `
                    <div class="manager-item" style="cursor:pointer;" onclick="window.open('https://robotcorporation.bitrix24.ru/company/personal/user/${m.id}/','_blank')">
                        <div class="manager-rank ${rankClass}">${globalIdx+1}</div>
                        <div class="manager-avatar" ${m.photo?`style="background-image:url('${m.photo}');background-size:cover;background-position:center;"`:''}>${m.photo?'':initials}</div>
                        <div class="manager-info">
                            <span class="manager-name">${m.name}</span>
                            <span class="manager-deals">${m.deals} сделок</span>
                        </div>
                        <div class="manager-stats">
                            <div class="manager-bar"><div class="bar-fill" style="width:${percent}%"></div></div>
                            <span class="manager-value">₽ ${formatNumber(Math.round(m.revenue/1000))}K</span>
                        </div>
                        <div class="manager-revenue">₽ ${formatNumber(m.revenue)}</div>
                    </div>`;
                }).join('')}
            </div>
            <div style="display:flex;justify-content:center;align-items:center;gap:8px;padding:12px;border-top:1px solid var(--border-color);">
                <button onclick="changeManagersPage(-1)" style="padding:4px 12px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:var(--bg-tertiary);cursor:pointer;" ${managersPage===1?'disabled':''}>←</button>
                <span style="font-size:0.8125rem;color:var(--text-secondary);">${managersPage} / ${totalPages||1}</span>
                <button onclick="changeManagersPage(1)" style="padding:4px 12px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:var(--bg-tertiary);cursor:pointer;" ${managersPage>=totalPages?'disabled':''}>→</button>
            </div>
        </div>`;
}

async function changeManagersPeriod(period) {
    managersPeriod = period;
    managersPage = 1;
    document.querySelectorAll('#managers-page-content .mgr-filter-btn').forEach(b => {
        b.classList.toggle('active', b.textContent.trim() === {day:'День',week:'Неделя',month:'Месяц'}[period]);
    });
    const container = document.getElementById('managers-page-content');
    if (container) container.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-secondary);">Загрузка...</div>';
    
    // Независимый запрос для страницы менеджеров
    const today = new Date();
    let dateFrom = new Date();
    if (period === 'day') dateFrom.setDate(today.getDate() - 1);
    else if (period === 'week') dateFrom.setDate(today.getDate() - 7);
    else if (period === 'month') dateFrom.setMonth(today.getMonth() - 1);
    
    let apiUrl = `/api/stats/dashboard?dateFrom=${dateFrom.toISOString().split('T')[0]}&dateTo=${today.toISOString().split('T')[0]}`;
    if (bitrixDomain) apiUrl += `&domain=${encodeURIComponent(bitrixDomain)}`;
    
    try {
        const res = await fetch(apiUrl);
        const data = await res.json();
        if (data.managers) currentManagers = data.managers;
        renderManagersPage(currentManagers);
    } catch (e) {
        renderManagersPage(currentManagers);
    }
}

function changeManagersPage(dir) {
    const totalPages = Math.ceil(currentManagers.length / managersPerPage);
    managersPage = Math.max(1, Math.min(managersPage + dir, totalPages));
    renderManagersPage(currentManagers);
}

// ============================================================
// ОБРАЩЕНИЯ
// ============================================================
async function loadLeads(status = 'all') {
    const container = document.getElementById('leads-table-container');
    if (!container) return;
    document.querySelectorAll('#page-leads .tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('onclick')?.includes(`'${status}'`)) btn.classList.add('active');
    });
    container.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-secondary);">Загрузка...</div>';
    try {
        const today = new Date();
        const dateFrom = new Date();
        dateFrom.setDate(today.getDate() - 30);
        let url = `/api/stats/dashboard?dateFrom=${dateFrom.toISOString().split('T')[0]}&dateTo=${today.toISOString().split('T')[0]}`;
        if (bitrixDomain) url += `&domain=${encodeURIComponent(bitrixDomain)}`;
        const res = await fetch(url);
        const data = await res.json();
        let leads = (data.dealsInProgress || []).map(deal => ({
            id: deal.ID,
            title: deal.TITLE || 'Без названия',
            source: deal.stageName || '—',
            status: deal.STAGE_ID,
            dateCreate: deal.DATE_CREATE,
            assignedName: `Менеджер ${deal.ASSIGNED_BY_ID}`,
            assignedId: deal.ASSIGNED_BY_ID
        }));
        if (status === 'accepted') {
            leads = leads.filter(l => !l.status.includes('LOSE') && !l.status.includes('JUNK'));
        } else if (status === 'rejected') {
            leads = leads.filter(l => l.status.includes('LOSE') || l.status.includes('JUNK'));
        }
        renderLeadsTable(leads);
    } catch (e) {
        container.innerHTML = '<div style="padding:32px;color:var(--danger);">Ошибка загрузки</div>';
    }
}

let leadsPage = 1;
const leadsPerPage = 5;
let currentLeads = [];

function renderLeadsTable(leads) {
    currentLeads = leads;
    leadsPage = 1;
    renderLeadsPage();
}

function renderLeadsPage() {
    const container = document.getElementById('leads-table-container');
    if (!container) return;
    const statusLabels = {'NEW':'Новый','IN_PROCESS':'В работе','CONVERTED':'Конвертирован','JUNK':'Некачественный'};
    const statusColors = {'NEW':'var(--info)','IN_PROCESS':'var(--warning)','CONVERTED':'var(--success)','JUNK':'var(--danger)'};
    if (!currentLeads.length) {
        container.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-secondary);">Нет обращений</div>';
        return;
    }
    const totalPages = Math.ceil(currentLeads.length / leadsPerPage);
    const start = (leadsPage - 1) * leadsPerPage;
    const paginated = currentLeads.slice(start, start + leadsPerPage);
    container.innerHTML = `
        <div style="padding:16px;border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;">
            <span style="font-weight:600;">Всего: ${currentLeads.length}</span>
            <span style="font-size:0.8125rem;color:var(--text-secondary);">${leadsPage} / ${totalPages}</span>
        </div>
        <div class="deals-table-wrapper">
            <table class="deals-table">
                <thead><tr><th>Обращение</th><th>Источник</th><th>Менеджер</th><th>Статус</th><th>Дата</th></tr></thead>
                <tbody>
                    ${paginated.map(lead => `
                    <tr style="cursor:pointer;" onclick="window.open('https://robotcorporation.bitrix24.ru/crm/lead/details/${lead.id}/','_blank')">
                        <td class="deal-name"><span class="deal-id">#${lead.id}</span>${lead.title||'Без названия'}</td>
                        <td>${lead.source||'—'}</td>
                        <td><div style="display:flex;align-items:center;gap:8px;"><div class="cell-avatar">${(lead.assignedName||'М').charAt(0)}</div><span style="font-size:0.8125rem;">${lead.assignedName||'—'}</span></div></td>
                        <td><span style="padding:4px 10px;border-radius:4px;font-size:0.6875rem;font-weight:600;background:${(statusColors[lead.status]||'var(--text-tertiary)')}22;color:${statusColors[lead.status]||'var(--text-tertiary)'};">${statusLabels[lead.status]||lead.status||'—'}</span></td>
                        <td style="font-size:0.8125rem;color:var(--text-secondary);">${new Date(lead.dateCreate).toLocaleDateString('ru-RU')}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>
        <div style="display:flex;justify-content:center;align-items:center;gap:8px;padding:12px;border-top:1px solid var(--border-color);">
            <button onclick="changeLeadsPage(-1)" style="padding:4px 12px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:var(--bg-tertiary);cursor:pointer;" ${leadsPage===1?'disabled':''}>←</button>
            <span style="font-size:0.8125rem;color:var(--text-secondary);">${leadsPage} / ${totalPages||1}</span>
            <button onclick="changeLeadsPage(1)" style="padding:4px 12px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:var(--bg-tertiary);cursor:pointer;" ${leadsPage>=totalPages?'disabled':''}>→</button>
        </div>`;
}

function changeLeadsPage(dir) {
    const totalPages = Math.ceil(currentLeads.length / leadsPerPage);
    leadsPage = Math.max(1, Math.min(leadsPage + dir, totalPages));
    renderLeadsPage();
}

async function loadSources(status) {
    try {
        const today = new Date();
        const dateFrom = new Date();
        dateFrom.setDate(today.getDate() - 30);
        let url = `/api/stats/dashboard?dateFrom=${dateFrom.toISOString().split('T')[0]}&dateTo=${today.toISOString().split('T')[0]}`;
        if (bitrixDomain) url += `&domain=${encodeURIComponent(bitrixDomain)}`;
        const res = await fetch(url);
        const data = await res.json();
        if (status === 'all' || !status) {
            updateDonutChart(window._lastSources || data.sources || {});
            return;
        }
        const allDeals = data.dealsInProgress || [];
        const filtered = status === 'rejected'
            ? allDeals.filter(d => d.STAGE_ID && (d.STAGE_ID.includes('JUNK') || d.STAGE_ID.includes('LOSE') || d.stageName === 'Спам'))
            : allDeals.filter(d => d.STAGE_ID && !d.STAGE_ID.includes('JUNK') && !d.STAGE_ID.includes('LOSE') && d.stageName !== 'Спам');
        const sources = {};
        filtered.forEach(deal => {
            const src = deal.stageName || 'Другие';
            sources[src] = (sources[src] || 0) + 1;
        });
        updateDonutChart(Object.keys(sources).length > 0 ? sources : {'Нет данных': 1});
    } catch (e) {
        console.error('Failed to load sources:', e);
    }
}

function loadKnowledgePage() {
    const container = document.getElementById('knowledge-content');
    if (!container) return;
    const articles = [
        { cat: '📖 Начало работы', items: ['Как подключить Bitrix24', 'Первоначальная настройка', 'Системные требования'] },
        { cat: '📊 Дашборд', items: ['Как читать KPI-карточки', 'Что такое воронка продаж', 'Как работает конверсия', 'Фильтрация по периодам'] },
        { cat: '👥 Менеджеры', items: ['Рейтинг эффективности', 'Как рассчитывается конверсия', 'Планирование KPI'] },
        { cat: '📈 Аналитика', items: ['Источники обращений', 'Эффективность каналов', 'Анализ трендов'] },
        { cat: '⚙️ Администрирование', items: ['Управление доступом', 'Настройка воронок', 'Решение проблем'] },
        { cat: '❓ FAQ', items: ['Частые вопросы', 'Глоссарий терминов'] },
    ];
    container.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;">
            ${articles.map(s => `
            <div class="chart-card">
                <h3 style="margin-bottom:16px;">${s.cat}</h3>
                <div style="display:flex;flex-direction:column;gap:8px;">
                    ${s.items.map(item => `
                    <div style="padding:10px 14px;background:var(--bg-tertiary);border-radius:var(--radius-md);cursor:pointer;font-size:0.875rem;transition:all 0.15s;"
                        onmouseover="this.style.background='var(--bg-card-hover)'"
                        onmouseout="this.style.background='var(--bg-tertiary)'">📄 ${item}</div>`).join('')}
                </div>
            </div>`).join('')}
        </div>`;
}

function initAnimations() {
    animateCounters();
}

function animateCounters() {}

function formatNumber(num) {
    const n = parseFloat(num) || 0;
    return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatDate(date) {
    const months = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
    return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

function initRefreshButton() {
    const refreshBtn = document.querySelector('.refresh-btn');
    if (!refreshBtn) return;
    let cooldown = false;
    refreshBtn.addEventListener('click', async () => {
        if (cooldown) return;
        cooldown = true;
        refreshBtn.disabled = true;
        const svg = refreshBtn.querySelector('svg');
        svg.style.transition = 'transform 0.8s linear';
        svg.style.transform = 'rotate(360deg)';
        await fetchMainData();
        await updateManagersWidget(dashMgrPeriod);
        await updateChannelsWidget(channelsPeriod);
        setTimeout(() => { svg.style.transition = 'none'; svg.style.transform = 'rotate(0deg)'; }, 800);
        setTimeout(() => { cooldown = false; refreshBtn.disabled = false; }, 3000);
    });
}

function animateDataRefresh() {}

document.querySelectorAll('.donut-segment').forEach(segment => {
    segment.addEventListener('mouseenter', function () {
        const sourceType = this.classList[1];
        const legendItem = document.querySelector(`.source-color.${sourceType}`);
        if (legendItem) {
            legendItem.closest('.source-item').style.transform = 'translateX(4px)';
        }
    });
    segment.addEventListener('mouseleave', function () {
        const sourceType = this.classList[1];
        const legendItem = document.querySelector(`.source-color.${sourceType}`);
        if (legendItem) {
            legendItem.closest('.source-item').style.transform = '';
        }
    });
});

const observerOptions = { threshold: 0.1, rootMargin: '0px 0px -50px 0px' };
const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
        }
    });
}, observerOptions);
document.querySelectorAll('.chart-card').forEach(card => observer.observe(card));

function createTooltip(element, content) {
    const tooltip = document.createElement('div');
    tooltip.className = 'tooltip';
    tooltip.innerHTML = content;
    tooltip.style.cssText = `position:absolute;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:var(--radius-sm);padding:8px 12px;font-size:0.75rem;color:var(--text-primary);box-shadow:var(--shadow-md);z-index:1000;pointer-events:none;opacity:0;transition:opacity 0.2s ease;`;
    element.addEventListener('mouseenter', () => {
        document.body.appendChild(tooltip);
        const rect = element.getBoundingClientRect();
        tooltip.style.left = rect.left + 'px';
        tooltip.style.top = (rect.top - tooltip.offsetHeight - 8 + window.scrollY) + 'px';
        tooltip.style.opacity = '1';
    });
    element.addEventListener('mouseleave', () => {
        tooltip.style.opacity = '0';
        setTimeout(() => tooltip.remove(), 200);
    });
}