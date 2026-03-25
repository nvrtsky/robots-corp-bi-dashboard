// Interactive Onboarding
const onboardingSteps = [
    {
        element: null,
        title: 'Добро пожаловать в BI Analytics!',
        text: 'Давайте познакомимся с основными возможностями дашборда.',
        position: 'center'
    },
    {
        element: '.kpi-grid',
        title: 'KPI-карточки',
        text: 'Здесь отображаются ключевые метрики: выручка, количество лидов, конверсия и активные сделки. Данные обновляются в реальном времени.',
        position: 'bottom'
    },
    {
        element: '.date-filter',
        title: 'Фильтр периода',
        text: 'Переключайте период для анализа: день, неделя или месяц. Данные автоматически пересчитаются.',
        position: 'bottom'
    },
    {
        element: '.funnel-card',
        title: 'Воронка продаж',
        text: 'Воронка показывает, сколько сделок находится на каждом этапе. Выберите конкретную воронку или смотрите все сразу.',
        position: 'right'
    },
    {
        element: '#funnel-select',
        title: 'Выбор воронки',
        text: 'Здесь можно выбрать конкретную воронку продаж из вашего Битрикс24.',
        position: 'bottom'
    },
    {
        element: '.sources-card',
        title: 'Источники обращений',
        text: 'Кольцевая диаграмма показывает распределение лидов по каналам привлечения.',
        position: 'left'
    },
    {
        element: '.managers-card',
        title: 'Эффективность менеджеров',
        text: 'Рейтинг менеджеров по ключевым показателям. Сортируйте по конверсии, выручке или количеству сделок.',
        position: 'right'
    },
    {
        element: '.deals-card',
        title: 'Таблица сделок',
        text: 'Детальная таблица активных сделок с цветовой индикацией сроков. Красный = сделка "зависла".',
        position: 'left'
    },
    {
        element: '.channels-card',
        title: 'Эффективность каналов',
        text: 'Сравнивайте эффективность маркетинговых каналов по конверсии или количеству лидов.',
        position: 'top'
    },
    {
        element: '.refresh-btn',
        title: 'Кнопка обновления',
        text: 'Нажмите, чтобы обновить все данные с Bitrix24.',
        position: 'bottom'
    },
    {
        element: '.sidebar-nav',
        title: 'Боковое меню',
        text: 'Используйте навигацию для переключения между разделами.',
        position: 'right',
        skipInBitrix: true
    },
    {
        element: null,
        title: 'Готово! 🎉',
        text: 'Теперь вы знаете основы. Нажмите ❓ на любом виджете для получения подсказки.',
        position: 'center'
    }
];

let currentStep = 0;
let onboardingActive = false;
let activeTooltipScrollHandler = null;

function startOnboarding() {
    if (onboardingActive) return;
    onboardingActive = true;
    currentStep = 0;
    createOnboardingOverlay();
    showStep(currentStep);
    window.addEventListener('scroll', onboardingScrollHandler);
}

function onboardingScrollHandler() {
    if (!onboardingActive) return;
    const step = onboardingSteps[currentStep];
    if (step && step.element) {
        const el = document.querySelector(step.element);
        if (el) {
            highlightElement(el);
            updatePulsePosition(el);
        }
    }
}

function updatePulsePosition(el) {
    const pulse = document.querySelector('.onboarding-pulse');
    if (!pulse) return;
    const rect = el.getBoundingClientRect();
    pulse.style.top = (rect.top + 8) + 'px';
    pulse.style.left = (rect.left + 8) + 'px';
}

function createOnboardingOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'onboarding-overlay';
    overlay.id = 'onboarding-overlay';
    document.body.appendChild(overlay);
}

function showStep(stepIndex) {
    // Удалить старый tooltip
    const oldTooltip = document.querySelector('.onboarding-tooltip');
    if (oldTooltip) {
        if (activeTooltipScrollHandler) {
            window.removeEventListener('scroll', activeTooltipScrollHandler);
            activeTooltipScrollHandler = null;
        }
        oldTooltip.remove();
    }

    // Удалить старую точку
    const oldPulse = document.querySelector('.onboarding-pulse');
    if (oldPulse) oldPulse.remove();

    const step = onboardingSteps[stepIndex];

    // Пропускаем шаги с sidebar в Bitrix режиме
    if (step.skipInBitrix && document.body.classList.contains('bitrix-mode')) {
        currentStep++;
        if (currentStep < onboardingSteps.length) {
            showStep(currentStep);
        } else {
            finishOnboarding();
        }
        return;
    }

    const overlay = document.getElementById('onboarding-overlay');
    const total = onboardingSteps.length;

    if (step.element) {
        const el = document.querySelector(step.element);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });

            setTimeout(() => {
                highlightElement(el);

                // Пульсирующая точка
                const pulse = document.createElement('div');
                pulse.className = 'onboarding-pulse';
                document.body.appendChild(pulse);
                const rect = el.getBoundingClientRect();
                pulse.style.top = (rect.top + 8) + 'px';
                pulse.style.left = (rect.left + 8) + 'px';
            }, 400);
        } else {
            overlay.style.background = 'rgba(0,0,0,0.5)';
            overlay.style.clipPath = 'none';
        }
    } else {
        overlay.style.background = 'rgba(0,0,0,0.5)';
        overlay.style.clipPath = 'none';
    }

    // Создать tooltip
    const tooltip = document.createElement('div');
    tooltip.className = 'onboarding-tooltip';
    tooltip.innerHTML = `
        <div class="onboarding-progress-bar">
            <div class="onboarding-progress-fill" style="width: ${((stepIndex + 1) / total * 100)}%"></div>
        </div>
        <div class="onboarding-step-counter">${stepIndex + 1} из ${total}</div>
        <div class="onboarding-title">${step.title}</div>
        <div class="onboarding-text">${step.text}</div>
        <div class="onboarding-buttons">
            <button class="onboarding-skip">Пропустить тур</button>
            <div class="onboarding-nav">
                ${stepIndex > 0 ? '<button class="onboarding-prev">← Назад</button>' : ''}
                <button class="onboarding-next">${stepIndex === total - 1 ? 'Завершить ✓' : 'Далее →'}</button>
            </div>
        </div>
    `;
    document.body.appendChild(tooltip);

    // Позиционирование после скролла
    setTimeout(() => {
        positionTooltip(tooltip, step);

        // Обновлять позицию tooltip при скролле
        activeTooltipScrollHandler = () => {
            if (document.querySelector('.onboarding-tooltip') === tooltip) {
                positionTooltip(tooltip, step);
            }
        };
        window.addEventListener('scroll', activeTooltipScrollHandler);
    }, 450);

    // Анимация появления
    setTimeout(() => tooltip.classList.add('visible'), 10);

    // Обработчики кнопок
    tooltip.querySelector('.onboarding-next').addEventListener('click', () => {
        if (currentStep === onboardingSteps.length - 1) {
            finishOnboarding();
        } else {
            currentStep++;
            showStep(currentStep);
        }
    });

    const prevBtn = tooltip.querySelector('.onboarding-prev');
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            currentStep--;
            showStep(currentStep);
        });
    }

    tooltip.querySelector('.onboarding-skip').addEventListener('click', finishOnboarding);
}

function highlightElement(el) {
    const rect = el.getBoundingClientRect();
    const overlay = document.getElementById('onboarding-overlay');
    if (!overlay) return;

    const padding = 8;
    const top = rect.top - padding;
    const left = rect.left - padding;
    const width = rect.width + padding * 2;
    const height = rect.height + padding * 2;

    overlay.style.background = 'rgba(0,0,0,0.6)';
    overlay.style.clipPath = `polygon(
        0% 0%, 100% 0%, 100% 100%, 0% 100%,
        0% ${top}px,
        ${left}px ${top}px,
        ${left}px ${top + height}px,
        ${left + width}px ${top + height}px,
        ${left + width}px ${top}px,
        0% ${top}px
    )`;
}

function positionTooltip(tooltip, step) {
    const margin = 16;
    const tw = 320;

    if (step.position === 'center' || !step.element) {
        tooltip.style.top = '50%';
        tooltip.style.left = '50%';
        tooltip.style.transform = 'translate(-50%, -50%)';
        return;
    }

    const el = document.querySelector(step.element);
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const th = tooltip.offsetHeight;
    const winW = window.innerWidth;
    const winH = window.innerHeight;

    let top, left;

    if (step.position === 'bottom') {
        top = rect.bottom + margin;
        left = rect.left + rect.width / 2 - tw / 2;
    } else if (step.position === 'top') {
        top = rect.top - th - margin;
        left = rect.left + rect.width / 2 - tw / 2;
    } else if (step.position === 'right') {
        top = rect.top + rect.height / 2 - th / 2;
        left = rect.right + margin;
    } else if (step.position === 'left') {
        top = rect.top + rect.height / 2 - th / 2;
        left = rect.left - tw - margin;
    }

    // Не выходить за края экрана
    left = Math.max(8, Math.min(left, winW - tw - 8));
    top = Math.max(8, Math.min(top, winH - th - 8));

    tooltip.style.transform = 'none';
    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';
}

function finishOnboarding() {
    onboardingActive = false;
    window.removeEventListener('scroll', onboardingScrollHandler);
    if (activeTooltipScrollHandler) {
        window.removeEventListener('scroll', activeTooltipScrollHandler);
        activeTooltipScrollHandler = null;
    }

    const overlay = document.getElementById('onboarding-overlay');
    if (overlay) overlay.remove();
    const tooltip = document.querySelector('.onboarding-tooltip');
    if (tooltip) tooltip.remove();
    const pulse = document.querySelector('.onboarding-pulse');
    if (pulse) pulse.remove();

    localStorage.setItem('onboarding_completed', 'true');
}

function checkAutoStart() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('tour') === 'true') {
        setTimeout(startOnboarding, 1500);
        return;
    }
    if (!localStorage.getItem('onboarding_completed')) {
        setTimeout(startOnboarding, 1500);
    }
}