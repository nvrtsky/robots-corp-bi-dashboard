// Help Tooltips Component
const helpTexts = {
    revenue: {
        title: 'Выручка',
        text: 'Сумма всех успешно закрытых сделок (стадия "Выиграна") за выбранный период. Валюта: ₽. Процент изменения рассчитан относительно аналогичного предыдущего периода.'
    },
    leads: {
        title: 'Новые лиды',
        text: 'Количество лидов, созданных в CRM за выбранный период. Лид — первичное обращение потенциального клиента.'
    },
    conversion: {
        title: 'Конверсия',
        text: 'Процент сделок со статусом "Выиграна" от общего числа сделок за период. Формула: (выигранные / все сделки) × 100%.'
    },
    deals: {
        title: 'Сделки в работе',
        text: 'Количество активных сделок (не закрытых и не проигранных). Цветовая индикация: 🔴 горячие (близки к закрытию), 🟡 в процессе, ⚪ стагнирующие (без активности).'
    },
    funnel: {
        title: 'Воронка продаж',
        text: 'Визуализация распределения сделок по этапам выбранной воронки. Ширина полосы пропорциональна количеству сделок на этапе. Проценты между этапами показывают конверсию перехода.'
    },
    sources: {
        title: 'Источники обращений',
        text: 'Распределение лидов по каналам привлечения. Данные берутся из поля "Источник" в карточке лида CRM. Переключайте табы для просмотра принятых и непринятых обращений.'
    },
    managers: {
        title: 'Эффективность менеджеров',
        text: 'Рейтинг менеджеров отдела продаж. По умолчанию сортировка по конверсии. Выручка менеджера = сумма его выигранных сделок за период.'
    },
    dealsTable: {
        title: 'Сделки в работе',
        text: 'Список активных сделок с указанием менеджера, этапа и длительности нахождения в работе. Цветная метка срока: зелёный (< 7 дн.), синий (7-14), жёлтый (14-30), красный (> 30).'
    },
    channels: {
        title: 'Эффективность каналов',
        text: 'Сравнительный анализ маркетинговых каналов. "Конверсия" — процент лидов, ставших сделками. "Лиды" — абсолютное число обращений из канала.'
    }
};

// Активный popover
let activePopover = null;

function createHelpButton(widgetKey) {
    const btn = document.createElement('button');
    btn.className = 'help-btn';
    btn.innerHTML = '?';
    btn.setAttribute('aria-label', 'Подсказка');

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const existing = document.querySelector('.help-popover');
        if (existing) {
            existing.remove();
            activePopover = null;
            if (existing.dataset.key === widgetKey) return;
        }
        showHelpPopover(btn, widgetKey);
    });

    return btn;
}

function showHelpPopover(triggerBtn, widgetKey) {
    const data = helpTexts[widgetKey];
    if (!data) return;

    const popover = document.createElement('div');
    popover.className = 'help-popover';
    popover.dataset.key = widgetKey;
    popover.innerHTML = `
        <button class="help-popover-close">×</button>
        <div class="help-popover-arrow"></div>
        <div class="help-popover-title">${data.title}</div>
        <div class="help-popover-text">${data.text}</div>
    `;

    document.body.appendChild(popover);
    activePopover = popover;

    // Позиционирование
    const btnRect = triggerBtn.getBoundingClientRect();
    const popoverWidth = 320;
    let left = btnRect.right - popoverWidth;
    if (left < 8) left = btnRect.left;
    const top = btnRect.bottom + 8 + window.scrollY;

    popover.style.left = left + 'px';
    popover.style.top = top + 'px';

    // Закрытие
    popover.querySelector('.help-popover-close').addEventListener('click', () => {
        popover.remove();
        activePopover = null;
    });

    // Анимация
    setTimeout(() => popover.classList.add('visible'), 10);
}

// Закрытие по клику вне
document.addEventListener('click', () => {
    const popover = document.querySelector('.help-popover');
    if (popover) {
        popover.remove();
        activePopover = null;
    }
});

function initHelpTooltips() {
    const widgets = [
        { selector: '.kpi-card.revenue', key: 'revenue', corner: true },
        { selector: '.kpi-card.leads', key: 'leads', corner: true },
        { selector: '.kpi-card.conversion', key: 'conversion', corner: true },
        { selector: '.kpi-card.deals', key: 'deals', corner: true },
        { selector: '.funnel-card .chart-header', key: 'funnel' },
        { selector: '.sources-card .chart-header', key: 'sources' },
        { selector: '.managers-card .chart-header', key: 'managers' },
        { selector: '.deals-card .chart-header', key: 'dealsTable' },
        { selector: '.channels-card .chart-header', key: 'channels' },
    ];

    widgets.forEach(({ selector, key, corner }) => {
        const el = document.querySelector(selector);
        if (!el) return;
        const btn = createHelpButton(key);
        if (corner) {
            btn.style.position = 'absolute';
            btn.style.top = '12px';
            btn.style.right = '12px';
            btn.style.margin = '0';
            // KPI карточка должна быть position: relative — уже есть в CSS
        }
        el.appendChild(btn);
    });
}