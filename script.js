// BI Dashboard Interactive JavaScript

// Bitrix24 Integration
let isInBitrix = false;
let bitrixDomain = null;

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
        try {
            window.BX24.init(() => {
                console.log('[Bitrix24] SDK initialized');

                // Set flag
                isInBitrix = true;

                // Get auth info
                const auth = window.BX24.getAuth();
                if (auth && auth.domain) {
                    bitrixDomain = auth.domain;
                }

                // Ensure Bitrix mode is applied (if not already by URL check)
                document.body.classList.add('bitrix-mode');

                // Auto-resize iframe to fit content
                setupAutoResize();
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
    // Initialize Bitrix24 integration
    initBitrix24();

    // Initialize all components
    initFilters();
    initTabs();
    initAnimations();
    initRefreshButton();

    // Fetch real data
    fetchDashboardData();
});

// Fetch Real Data from API
async function fetchDashboardData() {
    if (!bitrixDomain) {
        console.log('[Dashboard] No domain detected, using demo data');
        return;
    }

    try {
        const response = await fetch(`/api/stats/dashboard?domain=${encodeURIComponent(bitrixDomain)}`);
        const data = await response.json();

        if (data.isDemo || data.error) {
            console.warn('[Dashboard] API returned demo/error:', data.error);
            return; // Keep static demo data
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

    // 2. Update Sources Donut Chart
    if (data.sources) {
        updateDonutChart(data.sources);
    }

    // 3. Update Deals Table
    if (data.dealsInProgress && data.dealsInProgress.length > 0) {
        updateDealsTable(data.dealsInProgress);
    }

    // 4. Update Manager Stats
    if (data.managers && data.managers.length > 0) {
        updateManagersChart(data.managers);
    }

    // 5. Update Funnel
    if (data.funnel) {
        updateFunnelChart(data.funnel);
    }
}

function updateKPI(selector, value, prefix = '', suffix = '') {
    const el = document.querySelector(selector);
    if (el) {
        el.textContent = prefix + formatNumber(value) + suffix;
    }
}

function updateDonutChart(sources) {
    const total = Object.values(sources).reduce((a, b) => a + b, 0);
    const radius = 45;
    const circumference = 2 * Math.PI * radius; // ~282.74
    let offset = 0;

    // Map source IDs to classes (simplified mapping)
    const classMap = {
        'WEB': 'website',
        'ADVERTISING': 'ads',
        'PARTNER': 'partners',
        'RECOMMENDATION': 'referral',
        'OTHER': 'other'
    };

    // Update segments
    // Note: This is a simplified update that assumes standard standard sources.
    // For a robust implementation, we would need to regenerate the SVG elements.
    // Here we just accept that we might not match all source types perfectly.
}

function updateDealsTable(deals) {
    const tbody = document.querySelector('.deals-table tbody');
    if (!tbody) return;

    tbody.innerHTML = deals.map(deal => {
        // Duration badge color
        let durationClass = 'normal';
        const days = deal.daysInProgress || 0;
        if (days > 60) durationClass = 'critical';
        else if (days > 30) durationClass = 'warning';

        return `
        <tr>
            <td class="deal-name">
                <span class="deal-id">#${deal.ID}</span>
                ${deal.TITLE || 'Без названия'}
            </td>
            <td>—</td>
            <td>
                <div class="cell-avatar">ID${deal.ASSIGNED_BY_ID}</div>
            </td>
            <td><span class="stage-badge">${deal.stageName || deal.STAGE_ID}</span></td>
            <td class="deal-amount">₽ ${formatNumber(deal.OPPORTUNITY || 0)}</td>
            <td><span class="duration ${durationClass}">${days} дн.</span></td>
        </tr>
    `;
    }).join('');
}

// Update Managers Chart
function updateManagersChart(managers) {
    const container = document.querySelector('.manager-bars');
    if (!container) return;

    const maxRevenue = Math.max(...managers.map(m => m.revenue));

    container.innerHTML = managers.map(manager => {
        const percent = maxRevenue > 0 ? (manager.revenue / maxRevenue * 100) : 0;
        return `
        <div class="manager-bar">
            <div class="manager-info">
                <div class="manager-avatar">${manager.name.charAt(0)}</div>
                <span class="manager-name">${manager.name}</span>
            </div>
            <div class="bar-container">
                <div class="bar" style="width: ${percent}%"></div>
                <span class="bar-value">₽ ${formatNumber(manager.revenue)}</span>
            </div>
        </div>
    `;
    }).join('');
}

// Update Funnel Chart
function updateFunnelChart(funnel) {
    const container = document.querySelector('.funnel-stages');
    if (!container) return;

    const stages = Object.entries(funnel);
    const maxCount = Math.max(...stages.map(([_, count]) => count));

    container.innerHTML = stages.map(([name, count], idx) => {
        const percent = maxCount > 0 ? (count / maxCount * 100) : 0;
        const colors = ['#2fc6f6', '#9dcf00', '#ffa900', '#ff5752', '#ab7fe6'];
        const color = colors[idx % colors.length];
        return `
        <div class="funnel-stage">
            <div class="stage-label">${name}</div>
            <div class="stage-bar-container">
                <div class="stage-bar" style="width: ${percent}%; background: ${color}">
                    <span class="stage-count">${count}</span>
                </div>
            </div>
        </div>
    `;
    }).join('');
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

            // Simulate data refresh with animation
            animateDataRefresh();
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
            }
        });
    });

    // Metric buttons for channels
    const metricBtns = document.querySelectorAll('.metric-btn');
    metricBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            metricBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Animate channel bars with new values
            animateChannelBars();
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
        });
    });
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

// Animate counters
function animateCounters() {
    const kpiValues = document.querySelectorAll('.kpi-value');

    kpiValues.forEach(el => {
        const text = el.textContent;
        const hasNumber = /[\d,]+/.test(text);

        if (hasNumber) {
            const match = text.match(/(.*?)([\d,]+)(.*)/);
            if (match) {
                const prefix = match[1];
                const numStr = match[2].replace(/,/g, '');
                const suffix = match[3];
                const target = parseInt(numStr);

                if (!isNaN(target)) {
                    let current = 0;
                    const duration = 1500;
                    const step = target / (duration / 16);

                    const animate = () => {
                        current += step;
                        if (current < target) {
                            el.textContent = prefix + formatNumber(Math.floor(current)) + suffix;
                            requestAnimationFrame(animate);
                        } else {
                            el.textContent = text;
                        }
                    };

                    setTimeout(animate, 500);
                }
            }
        }
    });
}

// Format number with commas
function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Format date
function formatDate(date) {
    const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

// Refresh button functionality
function initRefreshButton() {
    const refreshBtn = document.querySelector('.refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            // Spin animation
            const svg = refreshBtn.querySelector('svg');
            svg.style.transition = 'transform 0.5s ease';
            svg.style.transform = 'rotate(360deg)';

            setTimeout(() => {
                svg.style.transition = 'none';
                svg.style.transform = 'rotate(0deg)';
            }, 500);

            // Simulate data refresh
            animateDataRefresh();
        });
    }
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
    const bars = document.querySelectorAll('.channel-bar');
    const values = document.querySelectorAll('.channel-value');

    bars.forEach((bar, index) => {
        const newWidth = 30 + Math.random() * 60;
        bar.style.width = newWidth + '%';

        if (values[index]) {
            values[index].textContent = (15 + Math.random() * 20).toFixed(1) + '%';
        }
    });
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
