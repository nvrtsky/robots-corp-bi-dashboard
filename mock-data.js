// Mock data for local development without Bitrix24 connection
// Тестовые данные для BI дашборда

const mockFunnels = [
    { ID: '0', NAME: 'Общая' },
    { ID: '1', NAME: 'Продажи B2B' },
    { ID: '2', NAME: 'Розничные продажи' },
    { ID: '3', NAME: 'Сервисное обслуживание' }
];

const mockStages = {
    '0': [
        { STATUS_ID: 'NEW', NAME: 'Новая', SORT: 10 },
        { STATUS_ID: 'PREPARATION', NAME: 'Подготовка документов', SORT: 20 },
        { STATUS_ID: 'NEGOTIATION', NAME: 'Переговоры', SORT: 30 },
        { STATUS_ID: 'EXECUTING', NAME: 'В работе', SORT: 40 },
        { STATUS_ID: 'FINAL_INVOICE', NAME: 'Финальный счёт', SORT: 50 },
        { STATUS_ID: 'WON', NAME: 'Успешно', SORT: 60 },
        { STATUS_ID: 'LOSE', NAME: 'Провалена', SORT: 70 }
    ],
    '1': [
        { STATUS_ID: 'C1:NEW', NAME: 'Входящий запрос', SORT: 10 },
        { STATUS_ID: 'C1:PREPARATION', NAME: 'Подготовка КП', SORT: 20 },
        { STATUS_ID: 'C1:NEGOTIATION', NAME: 'Согласование', SORT: 30 },
        { STATUS_ID: 'C1:EXECUTING', NAME: 'Реализация', SORT: 40 },
        { STATUS_ID: 'C1:WON', NAME: 'Закрыта', SORT: 50 },
        { STATUS_ID: 'C1:LOSE', NAME: 'Отказ', SORT: 60 }
    ],
    '2': [
        { STATUS_ID: 'C2:NEW', NAME: 'Заявка', SORT: 10 },
        { STATUS_ID: 'C2:PREPARATION', NAME: 'Консультация', SORT: 20 },
        { STATUS_ID: 'C2:EXECUTING', NAME: 'Оплата', SORT: 30 },
        { STATUS_ID: 'C2:WON', NAME: 'Успех', SORT: 40 },
        { STATUS_ID: 'C2:LOSE', NAME: 'Отмена', SORT: 50 }
    ],
    '3': [
        { STATUS_ID: 'C3:NEW', NAME: 'Обращение', SORT: 10 },
        { STATUS_ID: 'C3:PREPARATION', NAME: 'Диагностика', SORT: 20 },
        { STATUS_ID: 'C3:EXECUTING', NAME: 'Ремонт', SORT: 30 },
        { STATUS_ID: 'C3:FINAL_INVOICE', NAME: 'Выдача', SORT: 40 },
        { STATUS_ID: 'C3:WON', NAME: 'Завершён', SORT: 50 },
        { STATUS_ID: 'C3:LOSE', NAME: 'Отказ от ремонта', SORT: 60 }
    ]
};

const managerNames = [
    { id: '1', name: 'Алексей Петров' },
    { id: '3', name: 'Мария Козлова' },
    { id: '5', name: 'Дмитрий Волков' },
    { id: '7', name: 'Елена Сидорова' },
    { id: '9', name: 'Иван Новиков' },
    { id: '11', name: 'Ольга Морозова' }
];

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min, max, decimals = 0) {
    const val = Math.random() * (max - min) + min;
    return parseFloat(val.toFixed(decimals));
}

function randomDate(daysBack) {
    const d = new Date();
    d.setDate(d.getDate() - randomInt(0, daysBack));
    return d.toISOString();
}

function generateDashboardData(categoryId = 'all') {
    // Стадии для выбранной воронки
    const catKey = (categoryId && categoryId !== 'all') ? categoryId : '0';
    const stages = mockStages[catKey] || mockStages['0'];
    const stageMap = {};
    stages.forEach(s => { stageMap[s.STATUS_ID] = s.NAME; });

    // Воронка (распределение сделок по стадиям)
    const funnel = {};
    const activeStages = stages.filter(s => s.STATUS_ID !== 'WON' && s.STATUS_ID !== 'LOSE'
        && !s.STATUS_ID.endsWith(':WON') && !s.STATUS_ID.endsWith(':LOSE'));

    // Убывающее количество по стадиям (эффект воронки)
    let baseCount = randomInt(40, 80);
    activeStages.forEach(stage => {
        funnel[stage.NAME] = baseCount;
        baseCount = Math.max(3, Math.floor(baseCount * randomFloat(0.5, 0.85, 2)));
    });

    // Выигранные сделки
    const wonCount = randomInt(12, 35);
    const totalDeals = randomInt(wonCount + 20, wonCount + 90);

    // Выручка
    const revenue = randomInt(800000, 4500000);

    // Лиды
    const leadsCount = randomInt(45, 180);

    // Сделки в работе
    const dealsInProgressCount = totalDeals - wonCount - randomInt(3, 12);

    // Конверсия
    const conversionRate = parseFloat(((wonCount / totalDeals) * 100).toFixed(1));

    // Источники лидов
    const sources = {
        'Сайт': randomInt(15, 60),
        'Реклама': randomInt(10, 40),
        'Звонки': randomInt(8, 30),
        'Рекомендации': randomInt(5, 25),
        'Партнёры': randomInt(3, 15),
        'Другие': randomInt(2, 10)
    };

    // Менеджеры
    const managers = managerNames.map(m => ({
        id: m.id,
        name: m.name,
        deals: randomInt(3, 18),
        revenue: randomInt(150000, 900000)
    })).sort((a, b) => b.revenue - a.revenue);

    // Сделки в работе (таблица)
    const dealTitles = [
        'Поставка роботов-манипуляторов',
        'Интеграция конвейерной линии',
        'ТО промышленных роботов',
        'Обучение персонала',
        'Модернизация участка сварки',
        'Комплексная автоматизация',
        'Пуско-наладочные работы',
        'Разработка ПО для робота',
        'Запчасти для KUKA KR60',
        'Проект роботизированной ячейки'
    ];

    const dealsInProgress = dealTitles.map((title, i) => {
        const stageIndex = randomInt(0, activeStages.length - 1);
        const created = randomDate(90);
        const daysInProgress = Math.floor((new Date() - new Date(created)) / (1000 * 60 * 60 * 24));
        return {
            ID: String(1000 + i),
            TITLE: title,
            OPPORTUNITY: String(randomInt(50000, 1200000)),
            ASSIGNED_BY_ID: managerNames[randomInt(0, managerNames.length - 1)].id,
            DATE_CREATE: created,
            STAGE_ID: activeStages[stageIndex].STATUS_ID,
            stageName: activeStages[stageIndex].NAME,
            daysInProgress
        };
    });

    return {
        revenue,
        leadsCount,
        dealsInProgressCount,
        dealsInProgress,
        sources,
        funnel,
        managers: managers.slice(0, 6),
        conversionRate,
        totalDeals,
        wonDeals: wonCount
    };
}

function getFunnels() {
    return { funnels: mockFunnels };
}

module.exports = {
    generateDashboardData,
    getFunnels,
    mockStages,
    mockFunnels
};
