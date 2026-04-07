#!/bin/bash
# Запускать НА СЕРВЕРЕ: ssh root@79.174.77.28
# Диагностика воронки "Дни рожденья КулибинПро" и источников
# Все команды - последовательно, результаты смотреть внимательно

DOMAIN="robotcorporation.bitrix24.ru"
BASE="http://localhost:3000"
TODAY=$(date +%Y-%m-%d)

echo "=========================================="
echo "ШАГИ ДИАГНОСТИКИ"
echo "Сегодня: $TODAY"
echo "=========================================="

# ── ШАГ 1: здоровье сервера ───────────────────────────────────
echo ""
echo "── Шаг 1: Сервер жив? ──"
curl -s "$BASE/api/health?domain=$DOMAIN" | python3 -m json.tool 2>/dev/null || \
curl -s "$BASE/api/health?domain=$DOMAIN"

# ── ШАГ 2: список воронок ─────────────────────────────────────
echo ""
echo "── Шаг 2: Список воронок (найди ID воронки 'Дни рожденья КулибинПро') ──"
curl -s "$BASE/api/funnels?domain=$DOMAIN" | python3 -m json.tool 2>/dev/null || \
curl -s "$BASE/api/funnels?domain=$DOMAIN"

# ── ШАГ 3: стадии воронки (нужен ID из шага 2) ───────────────
# Подставь реальный ID воронки вместо FUNNEL_ID
FUNNEL_ID="ПОДСТАВЬ_ID_ВОРОНКИ"
echo ""
echo "── Шаг 3: Стадии выбранной воронки (замени FUNNEL_ID) ──"
echo "Команда:"
echo "  curl -s '$BASE/api/debug/stages?domain=$DOMAIN' | python3 -m json.tool | grep -A3 'КулибинПро\|Новая заявка\|Дни рожд'"

curl -s "$BASE/api/debug/stages?domain=$DOMAIN" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('=== Все стадии (STAGE_ID → NAME) ===')
for s in d.get('allStages', []):
    flag = '[SUCCESS]' if s['isSuccess'] else '[fail]' if s['isFail'] else ''
    print(f\"  {s['STAGE_ID']:40} → {s['NAME']} {flag}\")
print()
print('=== SUCCESS стадии ===')
for s in d.get('allStages', []):
    if s['isSuccess']:
        print(f\"  {s['STAGE_ID']} → {s['NAME']}\")
" 2>/dev/null || curl -s "$BASE/api/debug/stages?domain=$DOMAIN"

# ── ШАГ 4: сделки за сегодня напрямую через Bitrix API ────────
# Проверяем что сделки вообще есть в системе за сегодня
echo ""
echo "── Шаг 4: Сделки за сегодня через /api/debug/manager-all (менеджер 33 = Субхон) ──"
echo "  Смотрим stageName для сделок — правильно ли маппится 'Новая заявка'"
curl -s "$BASE/api/debug/manager-all?managerId=33&period=day&domain=$DOMAIN" | python3 -c "
import sys, json
d = json.load(sys.stdin)
s = d.get('summary', {})
print(f\"Итого сделок за день: {s.get('total', 0)}\")
print(f\"  success: {s.get('success', 0)}\")
print(f\"  inProgress: {s.get('inProgress', 0)}\")
print(f\"  fail: {s.get('fail', 0)}\")
print()
print('Детали сделок:')
for deal in d.get('deals', []):
    print(f\"  #{deal['id']} | stageId={deal['stageId']} | stageName={deal['stageName']} | {deal['dateCreate'][:10]}\")
" 2>/dev/null || curl -s "$BASE/api/debug/manager-all?managerId=33&period=day&domain=$DOMAIN"

# ── ШАГ 5: что возвращает /api/funnel за сегодня ─────────────
echo ""
echo "── Шаг 5: /api/funnel за День — что сейчас возвращается? ──"
curl -s "$BASE/api/funnel?period=day&domain=$DOMAIN" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f\"Total deals in funnel: {d.get('total', 0)}\")
print('Стадии:')
for name, count in d.get('funnel', {}).items():
    mark = ' <-- ЕСТЬ!' if count > 0 else ''
    print(f\"  {count:4}  {name}{mark}\")
" 2>/dev/null || curl -s "$BASE/api/funnel?period=day&domain=$DOMAIN"

# ── ШАГ 6: что возвращает /api/sources за сегодня ────────────
echo ""
echo "── Шаг 6: /api/sources за День — источники сделок ──"
curl -s "$BASE/api/sources?period=day&domain=$DOMAIN" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f\"Total deals: {d.get('total', 0)}\")
print('Источники:')
for name, count in sorted(d.get('sources', {}).items(), key=lambda x: -x[1]):
    mark = ' <-- ЕСТЬ!' if count > 0 else ''
    print(f\"  {count:4}  {name}{mark}\")
" 2>/dev/null || curl -s "$BASE/api/sources?period=day&domain=$DOMAIN"

# ── ШАГ 7: проверка SOURCE_ID в сырых данных Bitrix ──────────
echo ""
echo "── Шаг 7: KPI за День — сколько сделок создано сегодня? ──"
curl -s "$BASE/api/kpi?period=day&domain=$DOMAIN" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f\"leadsCount (сделок за сегодня): {d.get('leadsCount', 0)}\")
print(f\"wonDeals:   {d.get('wonDeals', 0)}\")
print(f\"revenue:    {d.get('revenue', 0)}\")
print(f\"conversion: {d.get('conversionRate', 0)}%\")
" 2>/dev/null || curl -s "$BASE/api/kpi?period=day&domain=$DOMAIN"

echo ""
echo "=========================================="
echo "Что искать в результатах:"
echo ""
echo "ШАГ 2: найти ID воронки 'Дни рожденья КулибинПро'"
echo "ШАГ 3: найти STAGE_ID для 'Новая заявка' в этой воронке"
echo "       формат обычно C{ID}:NEW или C{ID}:UC_XXXXX"
echo "ШАГ 4: проверить — stageName для сделок совпадает с 'Новая заявка'?"
echo "       если stageName = STAGE_ID (типа C5:NEW) — маппинг сломан"
echo "ШАГ 5: количество сделок в воронке > 0? Если 0 — фильтр DATE_CREATE отсекает"
echo "ШАГ 6: если 'Сайт...' не видно — SOURCE_ID в Bitrix не совпадает с crm.status.list"
echo "       возможно SOURCE_ID = 'WWW' или пустой, а имя 'Сайт https://kulibinpro.ru/'"
echo "       хранится не в SOURCE_ID, а в поле UTM или USER_FIELD"
echo "ШАГ 7: если leadsCount = 0 — сделки созданы не сегодня или фильтр не работает"
echo "=========================================="
