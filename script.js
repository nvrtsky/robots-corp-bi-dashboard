// BI Dashboard Interactive JavaScript

// Bitrix24 Integration
let currentDeals = []; // кэш сделок
let currentDealFilter = 'all'; // текущий фильтр
let isInBitrix = false;
let bitrixDomain = null;
let currentPeriod = 'month'; // day, week, month
let currentCategory = 'all'; // funnel category ID ('all' = all funnels)
let funnelsList = []; // loaded funnels
let currentManagers = []; // кэш загруженных менеджеров
let currentManagerSort = 'revenue'; // текущая сортировка
let currentPage = 1;
const dealsPerPage = 5;

// Check if running in Bitrix24 context
function detectBitrixContext() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('inBitrix') === 'true' || urlParams.has('DOMAIN') || urlParams.has('domain')) {
        isInBitrix = true;
        bitrixDomain = urlParams.get('DOMAIN') || urlParams.get('domain');
    }
    return isInBitrix;
}

// Initialize Bitrix24 SDK
function initBitrix24() {
    // 1. Immediate Visual Adaptation based on URL/Context
    // This ensures UI adapts even if SDK fails to load or init callback is delayed
    if (detectBitrixContext()) {
        document.body.classList.add('bitrix-mode');
        console.log('[Bitrix24] Applied Bitrix mode (URL/Context detected)');
    }

    // 2. SDK Initialization (if available and valid)
    if (typeof window.BX24 !== 'undefined' && window.BX24) {
        console.log('[Bitrix24] BX24 SDK found, initializing...');
        try {
            window.BX24.init(() => {
                console.log('[Bitrix24] SDK initialized successfully');

                // Set flag
                isInBitrix = true;

                // Try multiple ways to get domain
                const auth = window.BX24.getAuth();
                console.log('[Bitrix24] Auth object:', JSON.stringify(auth));

                if (auth && auth.domain) {
                    bitrixDomain = auth.domain;
                    console.log('[Bitrix24] Domain from getAuth():', bitrixDomain);
                } else {
                    // Fallback: try to get from placement info
                    try {
                        const placement = window.BX24.placement.info();
                        console.log('[Bitrix24] Placement info:', JSON.stringify(placement));
                        if (placement && placement.placement) {
                            // Extract domain from DOMAIN parameter if available
                            const urlParams = new URLSearchParams(window.location.search);
                            bitrixDomain = urlParams.get('DOMAIN');
                        }
                    } catch (e) {
                        console.log('[Bitrix24] Placement info not available');
                    }
                }

                // Final fallback: hard-coded domain for this specific portal
                if (!bitrixDomain) {
                    bitrixDomain = 'robotcorporation.bitrix24.ru';
                    console.log('[Bitrix24] Using hardcoded fallback domain:', bitrixDomain);
                }

                // Ensure Bitrix mode is applied (if not already by URL check)
                document.body.classList.add('bitrix-mode');

                // Auto-resize iframe to fit content
                setupAutoResize();

                // Load funnels and then fetch data
                console.log('[Bitrix24] Calling loadFunnels and fetchDashboardData with domain:', bitrixDomain);
                loadFunnels();
                fetchDashboardData();
            });
        } catch (e) {
            console.warn('[Bitrix24] SDK found but init failed:', e);
        }
    } else {
        console.log('[Bitrix24] SDK not available');
    }
}

// Auto-resize iframe using ResizeObserver
function setupAutoResize() {
    if (typeof window.BX24 === 'undefined') return;

    const resizeObserver = new ResizeObserver(() => {
        try {
            window.BX24.fitWindow();
        } catch (e) {
            console.warn('[Bitrix24] fitWindow failed:', e);
        }
    });

    resizeObserver.observe(document.body);

    // Initial fit
    setTimeout(() => {
        try {
            window.BX24.fitWindow();
        } catch (e) { }
    }, 500);
}

document.addEventListener('DOMContentLoaded', () => {
    // Показать скелетоны до загрузки данных
    document.querySelectorAll('.mgr-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.mgr-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const period = btn.dataset.period;
            if (period) fetchDashboardData(period);
        });
    });
    document.querySelectorAll('.manager-item').forEach(el => {
        el.style.opacity = '0.3';
        el.style.pointerEvents = 'none';
    });
    // Initialize Bitrix24 integration
    initBitrix24();

    // Initialize all components
    initFilters();
    initTabs();
    initAnimations();
    initRefreshButton();
    initManagerSort();
    initHelpTooltips();
    checkAutoStart();

    // Fetch real data - only if NOT running in Bitrix24 context
    // If BX24 SDK is available, fetchDashboardData will be called from BX24.init callback
    if (typeof window.BX24 === 'undefined' || !window.BX24) {
        console.log('[Dashboard] No BX24 SDK, fetching data immediately');
        loadFunnels(); // Load funnel tabs first
        fetchDashboardData();
    }
});

// Load available funnels (deal categories)
async function loadFunnels() {
    try {
        let apiUrl = '/api/funnels';
        if (bitrixDomain) {
            apiUrl += `?domain=${encodeURIComponent(bitrixDomain)}`;
        }

        const response = await fetch(apiUrl);
        const data = await response.json();

        if (data.funnels && data.funnels.length > 0) {
            funnelsList = data.funnels;
            renderFunnelTabs();
            console.log('[Dashboard] Funnels loaded:', funnelsList.length);
        }
    } catch (e) {
        console.error('[Dashboard] Failed to load funnels:', e);
    }
}

// Render funnel dropdown options
function renderFunnelTabs() {
    const select = document.getElementById('funnel-select');
    if (!select) return;

    // Keep "All" option, add others
    select.innerHTML = '';

    // Add options for each funnel
    funnelsList.filter(f => f.NAME !== 'Общая').forEach(funnel => {
        const option = document.createElement('option');
        option.value = funnel.ID;
        option.textContent = funnel.NAME;
        if (currentCategory === funnel.ID) {
            option.selected = true;
        }
        select.appendChild(option);
    });

    // Add change event listener (only once)
    if (!select.dataset.initialized) {
        select.addEventListener('change', (e) => {
            switchFunnel(e.target.value);
        });
        select.dataset.initialized = 'true';
    }
}

// Switch funnel
function switchFunnel(categoryId) {
    currentCategory = categoryId;

    // Refetch data for this funnel
    fetchDashboardData();
}

// Fetch Real Data from API
async function fetchDashboardData(period = currentPeriod) {
    currentPeriod = period;

    // Calculate date range based on period
    const today = new Date();
    let dateFrom = new Date();

    if (period === 'day') {
        dateFrom.setDate(today.getDate() - 1);
    } else if (period === 'week') {
        dateFrom.setDate(today.getDate() - 7);
    } else if (period === 'month') {
        dateFrom.setMonth(today.getMonth() - 1);
    }

    const dateFromStr = dateFrom.toISOString().split('T')[0];
    const dateToStr = today.toISOString().split('T')[0];

    // Build API URL with category filter
    let apiUrl = `/api/stats/dashboard?dateFrom=${dateFromStr}&dateTo=${dateToStr}`;
    if (bitrixDomain) {
        apiUrl += `&domain=${encodeURIComponent(bitrixDomain)}`;
    }
    if (currentCategory && currentCategory !== 'all') {
        apiUrl += `&categoryId=${encodeURIComponent(currentCategory)}`;
    }

    try {
        console.log('[Dashboard] Fetching data for period:', period, '| category:', currentCategory, '| URL:', apiUrl);
        const response = await fetch(apiUrl);
        const data = await response.json();

        if (data.error) {
            console.warn('[Dashboard] API error:', data.error);
            return;
        }

        updateDashboardUI(data);

    } catch (e) {
        console.error('[Dashboard] Fetch failed:', e);
    }
}

// Update UI with Real Data
function updateDashboardUI(data) {
    console.log('[Dashboard] Updating UI with real data', data);

    // 1. Update KPIs
    updateKPI('.kpi-card.revenue .kpi-value', data.revenue, '₽ ');
    updateKPI('.kpi-card.leads .kpi-value', data.leadsCount);
    updateKPI('.kpi-card.deals .kpi-value', data.dealsInProgressCount);

    // Update Conversion KPI if available
    if (data.conversionRate !== undefined) {
        updateKPI('.kpi-card.conversion .kpi-value', data.conversionRate, '', '%');
    }

    // 2. Update KPI changes (%)
    if (data.changes) {
        updateKPIChange('.kpi-card.revenue', data.changes.revenue);
        updateKPIChange('.kpi-card.leads', data.changes.leadsCount);
        updateKPIChange('.kpi-card.conversion', data.changes.conversionRate);
        updateKPIChange('.kpi-card.deals', data.changes.dealsInProgress);
    }

    // 2. Update Sources Donut Chart
    if (data.sources) {
        window._lastSources = data.sources;
        updateDonutChart(data.sources);
        updateChannelsChart(data.sources); // Update channels section too
    }

    // 3. Update Deals Table
    if (data.dealsInProgress && data.dealsInProgress.length > 0) {
        currentDeals = data.dealsInProgress;
        updateDealsTable(filterDeals(data.dealsInProgress, currentDealFilter));
    }
    

    // 4. Update Manager Stats
    if (data.managers && data.managers.length > 0) {
        currentManagers = data.managers;
        updateManagersChart(sortManagers(data.managers, currentManagerSort));
    }

    // 5. Update Funnel
    if (data.funnel) {
        updateFunnelChart(data.funnel);
    }
}

// Эти функции СНАРУЖИ:
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
    console.log('[Dashboard] updateKPI:', selector, '-> element:', el, '| value:', value);
    if (el) {
        el.classList.remove('skeleton');
        el.textContent = prefix + formatNumber(value) + suffix;
    } else {
        console.warn('[Dashboard] Element not found:', selector);
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

    // Update center text
    const centerTotal = document.querySelector('.donut-total');
    if (centerTotal) centerTotal.textContent = formatNumber(total);

    // Source color mapping
    const sourceColors = {
        'WEB': { class: 'website', name: 'Сайт', color: '#6366f1' },
        'ADVERTISING': { class: 'social', name: 'Реклама', color: '#8b5cf6' },
        'PARTNER': { class: 'referral', name: 'Партнёры', color: '#a855f7' },
        'RECOMMENDATION': { class: 'direct', name: 'Рекомендации', color: '#ec4899' },
        'CALL': { class: 'website', name: 'Звонки', color: '#2fc6f6' },
        'OTHER': { class: 'other', name: 'Другие', color: '#14b8a6' }
    };

    // Update legend
    const legend = document.querySelector('.sources-legend');
    if (legend) {
        legend.innerHTML = Object.entries(sources).map(([sourceId, count]) => {
            const src = sourceColors[sourceId] || { class: 'other', name: sourceId, color: '#64748b' };
            const percent = ((count / total) * 100).toFixed(0);
            return `
            <div class="source-item">
                <div class="source-color" style="background: ${src.color}"></div>
                <div class="source-info">
                    <span class="source-name">${src.name}</span>
                    <span class="source-stat">${count} (${percent}%)</span>
                </div>
                <div class="source-bar">
                    <div class="source-fill" style="width: ${percent}%; background: ${src.color}"></div>
                </div>
            </div>
        `;
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

        return `
        <tr style="cursor:pointer;" onclick="window.open('https://robotcorporation.bitrix24.ru/crm/deal/details/${deal.ID}/','_blank')">
            <td class="deal-name"><span class="deal-id">#${deal.ID}</span>${deal.TITLE||'Без названия'}</td>
            <td>—</td>
            <td><div class="cell-avatar">ID${deal.ASSIGNED_BY_ID}</div></td>
            <td><span class="stage-badge">${deal.stageName||deal.STAGE_ID}</span></td>
            <td class="deal-amount">₽ ${formatNumber(parseFloat(deal.OPPORTUNITY)||0)}</td>
            <td><span class="duration ${durationClass}">${days} дн.</span></td>
        </tr>`;
    }).join('');

    // Пагинация
    const summary = document.querySelector('.deals-summary');
    if (summary) {
        const pagination = document.querySelector('.deals-pagination') || document.createElement('div');
        pagination.className = 'deals-pagination';
        pagination.style.cssText = 'display:flex;justify-content:center;align-items:center;gap:8px;padding:12px;border-top:1px solid var(--border-color);';
        pagination.innerHTML = `
            <button onclick="changePage(-1)" style="padding:4px 12px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:var(--bg-tertiary);cursor:pointer;" ${currentPage===1?'disabled':''}>←</button>
            <span style="font-size:0.8125rem;color:var(--text-secondary);">${currentPage} / ${totalPages||1}</span>
            <button onclick="changePage(1)" style="padding:4px 12px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:var(--bg-tertiary);cursor:pointer;" ${currentPage>=totalPages?'disabled':''}>→</button>
        `;
        summary.parentNode.insertBefore(pagination, summary);
    }

    // Обновить summary
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

// Update Channels Chart (Эффективность каналов)
function updateChannelsChart(sources) {
    const container = document.getElementById('channels-container');
    if (!container) return;

    const total = Object.values(sources).reduce((a, b) => a + b, 0);
    if (total === 0) {
        container.innerHTML = '<div class="no-data">Нет данных по каналам</div>';
        return;
    }

    // Sort sources by count descending
    const sortedSources = Object.entries(sources)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8); // Show top 8

    const maxCount = sortedSources[0][1];

    // Channel icons mapping
    const channelIcons = {
        'default': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`
    };

    // Color palette for channels
    const colors = ['#2fc6f6', '#ffa900', '#9dcf00', '#ff5752', '#ab7fe6', '#ec4899', '#14b8a6', '#6366f1'];

    container.innerHTML = sortedSources.map(([name, count], index) => {
        const percentage = ((count / total) * 100).toFixed(1);
        const barWidth = ((count / maxCount) * 100).toFixed(0);
        const color = colors[index % colors.length];

        return `
            <div class="channel-row">
                <div class="channel-info">
                    <div class="channel-icon" style="background: ${color}20; color: ${color};">
                        ${channelIcons.default}
                    </div>
                    <div class="channel-name">
                        <span>${name}</span>
                        <span class="channel-leads">${count} лидов</span>
                    </div>
                </div>
                <div class="channel-bar-container">
                    <div class="channel-bar" style="width: ${barWidth}%; background: ${color};"></div>
                    <span class="channel-value">${percentage}%</span>
                </div>
            </div>
        `;
    }).join('');
}

let dashManagerPage = 1;
const dashManagersPerPage = 5;

function updateManagersChart(managers) {
    document.querySelectorAll('.manager-item').forEach(el => {
        el.style.opacity = '';
        el.style.pointerEvents = '';
    });

    const container = document.querySelector('.managers-list');
    if (!container) return;

    const maxRevenue = Math.max(...managers.map(m => m.revenue));
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

    // Пагинация
    let pagination = container.parentNode.querySelector('.dash-mgr-pagination');
    if (!pagination) {
        pagination = document.createElement('div');
        pagination.className = 'dash-mgr-pagination';
        pagination.style.cssText = 'display:flex;justify-content:center;align-items:center;gap:8px;padding:12px;border-top:1px solid var(--border-color);';
        container.parentNode.appendChild(pagination);
    }
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

let funnelPage = 1;
const funnelPerPage = 5;
let lastFunnelData = {};

function updateFunnelChart(funnel) {
    lastFunnelData = funnel;
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
    const maxCount = Math.max(...allStages.map(([_, c]) => c));
    const stageClasses = ['stage-1', 'stage-2', 'stage-3', 'stage-4', 'stage-1'];

    container.innerHTML = stages.map(([name, count], idx) => {
        const percent = maxCount > 0 ? Math.round(count / maxCount * 100) : 0;
        const stageClass = stageClasses[idx % stageClasses.length];
        const connector = idx < stages.length - 1 ? `
        <div class="funnel-connector">
            <span class="conversion-rate">→ ${percent}%</span>
        </div>` : '';
        return `
        <div class="funnel-stage ${stageClass}">
            <div class="funnel-bar" style="--width: ${percent}%">
                <span class="funnel-value">${count}</span>
            </div>
            <div class="funnel-info">
                <span class="stage-name">${name}</span>
                <span class="stage-percent">${percent}%</span>
            </div>
        </div>
        ${connector}`;
    }).join('');

    // Пагинация
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
    const select = document.querySelector('.chart-select');
    if (!select) return;

    select.addEventListener('change', (e) => {
        const map = {
            'По выручке': 'revenue',
            'По сделкам': 'deals',
            'По конверсии': 'conversion'
        };
        currentManagerSort = map[e.target.value] || 'revenue';
        if (currentManagers.length > 0) {
            updateManagersChart(sortManagers(currentManagers, currentManagerSort));
        }
    });
}

// Period Filter Buttons
function initFilters() {
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Update date range display based on period
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

            // Fetch real data for selected period
            fetchDashboardData(period);
        });
    });

    // Tab buttons for sources and channels
    const tabButtons = document.querySelectorAll('.tab-btn');
    tabButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const parent = e.target.closest('.chart-tabs');
            if (parent) {
                parent.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // Фильтрация источников
                if (parent.closest('.sources-card')) {
                    const text = btn.textContent.trim();
                    if (text === 'Принятые') loadSources('accepted');
                    else if (text === 'Непринятые') loadSources('rejected');
                    else loadSources('all');
                }
            }
        });
    });

    // Metric buttons for channels
    const metricBtns = document.querySelectorAll('.metric-btn');
    metricBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            metricBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            if (btn.textContent.trim() === 'Лиды' && window._lastSources) {
                updateChannelsChartLeads(window._lastSources);
            } else if (window._lastSources) {
                updateChannelsChart(window._lastSources);
            }
        });
    });
}

// Tab Navigation
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

async function loadManagersPage() {
    const container = document.getElementById('managers-page-content');
    if (!container) return;
    container.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-secondary);">Загрузка...</div>';

    if (currentManagers.length === 0) await fetchDashboardData();
    renderManagersPage(currentManagers);
}

let managersPeriod = 'month';
let managersPage = 1;
const managersPerPage = 5;

function renderManagersPage(managers) {
    const container = document.getElementById('managers-page-content');
    if (!container || !managers.length) return;

    const medals = ['gold', 'silver', 'bronze'];
    const maxRevenue = Math.max(...managers.map(m => m.revenue));
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
            <div class="chart-header">
                <h3>Рейтинг менеджеров</h3>
                <div class="date-filter">
                    <button class="filter-btn ${managersPeriod==='day'?'active':''}" onclick="changeManagersPeriod('day')">День</button>
                    <button class="filter-btn ${managersPeriod==='week'?'active':''}" onclick="changeManagersPeriod('week')">Неделя</button>
                    <button class="filter-btn ${managersPeriod==='month'?'active':''}" onclick="changeManagersPeriod('month')">Месяц</button>
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
    const container = document.getElementById('managers-page-content');
    if (container) container.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-secondary);">Загрузка...</div>';
    await fetchDashboardData(period);
    renderManagersPage(currentManagers);
}

function changeManagersPage(dir) {
    const totalPages = Math.ceil(currentManagers.length / managersPerPage);
    managersPage = Math.max(1, Math.min(managersPage + dir, totalPages));
    renderManagersPage(currentManagers);
}

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

        // Берём сделки в работе как обращения
        let leads = (data.dealsInProgress || []).map(deal => ({
            id: deal.ID,
            title: deal.TITLE || 'Без названия',
            source: deal.stageName || '—',
            status: deal.STAGE_ID,
            dateCreate: deal.DATE_CREATE,
            assignedName: `Менеджер ${deal.ASSIGNED_BY_ID}`,
            assignedId: deal.ASSIGNED_BY_ID
        }));

        // Фильтрация
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
                        onmouseout="this.style.background='var(--bg-tertiary)'">
                        📄 ${item}
                    </div>`).join('')}
                </div>
            </div>`).join('')}
        </div>`;
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

        // Фильтруем сделки по статусу для имитации принятых/непринятых
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

// Scroll Animations
function initAnimations() {
    // Animate funnel bars on load
    const funnelBars = document.querySelectorAll('.funnel-bar');
    funnelBars.forEach((bar, index) => {
        bar.style.opacity = '0';
        bar.style.transform = 'scaleX(0)';
        bar.style.transformOrigin = 'left';

        setTimeout(() => {
            bar.style.transition = 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)';
            bar.style.opacity = '1';
            bar.style.transform = 'scaleX(1)';
        }, 600 + index * 150);
    });

    // Animate source bars
    const sourceFills = document.querySelectorAll('.source-fill');
    sourceFills.forEach((fill, index) => {
        const width = fill.style.width;
        fill.style.width = '0';

        setTimeout(() => {
            fill.style.width = width;
        }, 800 + index * 100);
    });

    // Animate channel bars
    const channelBars = document.querySelectorAll('.channel-bar');
    channelBars.forEach((bar, index) => {
        const width = bar.style.width;
        bar.style.width = '0';

        setTimeout(() => {
            bar.style.width = width;
        }, 1000 + index * 100);
    });

    // Animate manager bars
    const managerFills = document.querySelectorAll('.manager-bar .bar-fill');
    managerFills.forEach((fill, index) => {
        const width = fill.style.width;
        fill.style.width = '0';

        setTimeout(() => {
            fill.style.width = width;
        }, 700 + index * 100);
    });

    // Counter animation for KPI values
    animateCounters();
}

// Animate counters - DISABLED to prevent overwriting real API data
function animateCounters() {
    // Animation disabled - it was overwriting real data loaded from API
    // with demo values from the original HTML
    console.log('[Dashboard] Counter animation disabled to preserve API data');
}

// Format number with commas
function formatNumber(num) {
    const n = parseFloat(num) || 0;
    return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Format date
function formatDate(date) {
    const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

// Refresh button functionality
function initRefreshButton() {
    const refreshBtn = document.querySelector('.refresh-btn');
    if (!refreshBtn) return;

    let cooldown = false;

    refreshBtn.addEventListener('click', async () => {
        if (cooldown) return; // блокируем повторный клик

        // Запускаем анимацию вращения
        cooldown = true;
        refreshBtn.disabled = true;
        const svg = refreshBtn.querySelector('svg');
        svg.style.transition = 'transform 0.8s linear';
        svg.style.transform = 'rotate(360deg)';

        // Реальный запрос данных
        await fetchDashboardData();

        // Сброс анимации
        setTimeout(() => {
            svg.style.transition = 'none';
            svg.style.transform = 'rotate(0deg)';
        }, 800);

        // Cooldown 5 секунд
        setTimeout(() => {
            cooldown = false;
            refreshBtn.disabled = false;
        }, 3000);
    });
}

// Data refresh animation
function animateDataRefresh() {
    const cards = document.querySelectorAll('.kpi-card, .chart-card');

    cards.forEach(card => {
        card.style.opacity = '0.5';
        card.style.transform = 'scale(0.98)';

        setTimeout(() => {
            card.style.transition = 'all 0.3s ease';
            card.style.opacity = '1';
            card.style.transform = 'scale(1)';
        }, 300);
    });
}

// Animate channel bars with new random values
function animateChannelBars() {
    const activeMetric = document.querySelector('.metric-btn.active');
    const showLeads = activeMetric && activeMetric.textContent.trim() === 'Лиды';
    
    if (showLeads && window._lastSources) {
        updateChannelsChartLeads(window._lastSources);
    }
}

function updateChannelsChartLeads(sources) {
    const container = document.getElementById('channels-container');
    if (!container) return;

    const sortedSources = Object.entries(sources).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const maxCount = sortedSources[0]?.[1] || 1;
    const colors = ['#2fc6f6', '#ffa900', '#9dcf00', '#ff5752', '#ab7fe6', '#ec4899', '#14b8a6', '#6366f1'];
    const channelIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;

    container.innerHTML = sortedSources.map(([name, count], index) => {
        const barWidth = ((count / maxCount) * 100).toFixed(0);
        const color = colors[index % colors.length];
        return `
        <div class="channel-row">
            <div class="channel-info">
                <div class="channel-icon" style="background:${color}20;color:${color};">${channelIcon}</div>
                <div class="channel-name"><span>${name}</span><span class="channel-leads">${count} лидов</span></div>
            </div>
            <div class="channel-bar-container">
                <div class="channel-bar" style="width:${barWidth}%;background:${color};"></div>
                <span class="channel-value">${count}</span>
            </div>
        </div>`;
    }).join('');
}

// Hover effects for donut chart segments
document.querySelectorAll('.donut-segment').forEach(segment => {
    segment.addEventListener('mouseenter', function () {
        const sourceType = this.classList[1];
        const legendItem = document.querySelector(`.source-color.${sourceType}`);
        if (legendItem) {
            legendItem.closest('.source-item').style.transform = 'translateX(4px)';
            legendItem.closest('.source-item').style.background = 'var(--bg-tertiary)';
        }
    });

    segment.addEventListener('mouseleave', function () {
        const sourceType = this.classList[1];
        const legendItem = document.querySelector(`.source-color.${sourceType}`);
        if (legendItem) {
            legendItem.closest('.source-item').style.transform = '';
            legendItem.closest('.source-item').style.background = '';
        }
    });
});

// Table row hover interactions
document.querySelectorAll('.deals-table tbody tr').forEach(row => {
    row.addEventListener('click', () => {
        row.style.background = 'var(--bg-card-hover)';
        setTimeout(() => {
            row.style.background = '';
        }, 200);
    });
});

// Intersection Observer for scroll animations
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
        }
    });
}, observerOptions);

document.querySelectorAll('.chart-card').forEach(card => {
    observer.observe(card);
});

// Tooltip functionality
function createTooltip(element, content) {
    const tooltip = document.createElement('div');
    tooltip.className = 'tooltip';
    tooltip.innerHTML = content;
    tooltip.style.cssText = `
        position: absolute;
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-sm);
        padding: 8px 12px;
        font-size: 0.75rem;
        color: var(--text-primary);
        box-shadow: var(--shadow-md);
        z-index: 1000;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.2s ease;
    `;

    element.addEventListener('mouseenter', (e) => {
        document.body.appendChild(tooltip);
        const rect = element.getBoundingClientRect();
        tooltip.style.left = rect.left + 'px';
        tooltip.style.top = (rect.top - tooltip.offsetHeight - 8) + 'px';
        tooltip.style.opacity = '1';
    });

    element.addEventListener('mouseleave', () => {
        tooltip.style.opacity = '0';
        setTimeout(() => tooltip.remove(), 200);
    });
}

// Live data simulation (demo purposes)
function simulateLiveData() {
    const revenueEl = document.querySelector('.kpi-card.revenue .kpi-value');
    if (revenueEl) {
        setInterval(() => {
            const currentText = revenueEl.textContent;
            const match = currentText.match(/[\d,]+/);
            if (match) {
                const current = parseInt(match[0].replace(/,/g, ''));
                const change = Math.floor(Math.random() * 10000) - 5000;
                const newValue = Math.max(0, current + change);
                revenueEl.textContent = '₽ ' + formatNumber(newValue);
            }
        }, 5000);
    }
}

// Uncomment to enable live data simulation
// simulateLiveData();
