# Vorovayka MVP

Минимальный MV3-прототип расширения Chrome для:

- выбора DOM-узла на странице
- сбора ограниченного DOM snapshot
- захвата последних релевантных `fetch`/`XHR`
- выбора до 8 запросов пользователем
- сборки эвристического API-рецепта выбранного элемента
- изолированного HTML-превью выбранного элемента во viewer
- карты происхождения видимых значений: DOM fact → API response path → render evidence
- sequence-диаграммы API-зависимостей, если значение из ответа одного захваченного запроса использовано в URL/body/header следующего
- локальной настраиваемой JSON-выгрузки render-spec для вашей системы
- передачи данных через `chrome.storage.local.latestCapture`
- явного включения capture только на выбранном домене
- popup-меню для включения/выключения capture и копирования результата

## Как проверить

1. Откройте `chrome://extensions`.
2. Включите `Developer mode`.
3. Нажмите `Load unpacked` и выберите корень проекта.
4. Откройте `chrome-extension://<extension-id>/src/viewer.html`.
5. На целевом домене откройте popup расширения.
6. Включите toggle `Сбор сети на домене`: вкладка перезагрузится, и после этого ранние `fetch`/`XHR` начнут попадать в ring buffer.
7. Нажмите `Выбрать DOM-элемент` в popup или используйте `Ctrl+Shift+Y`.
8. Подтвердите выбранные запросы в модальном окне.
9. Кнопка `Открыть viewer` сразу сохранит capture и откроет viewer; отдельное сохранение перед этим не нужно.

## Что входит в MVP

- DOM snapshot: `outerHTML`, `previewHTML`, `innerText`, `rect`, `selector`, `ancestorChain`, `dataset`, `aria`, `role`, ограниченные computed styles
- Network capture: ring buffer `N=30`
- Фильтрация: убираются `OPTIONS`, analytics/telemetry и статические ресурсы
- Request context: best-effort `requestBody` для `fetch(init.body)` и `XHR.send(body)` с редактированием очевидных секретов
- Element recipe / clone spec: упорядоченная API-последовательность, shape JSON-ответа, `domFacts`, `responseFacts`, `bindings`, `apiDependencies`, `renderEvidence` и найденные поля, совпавшие с видимыми данными выбранного элемента
- API dependencies: viewer показывает sequence только при доказанном совпадении “response value из раннего API → request URL/body/header более позднего API”; если таких связей нет, diagram скрыта
- Export JSON: viewer выгружает строгий `element-export` только по выбранному элементу: верстка элемента и связанные API с JSON-path нужных данных; `responseShape`, сырые ответы, DOM-контекст и debug не попадают в export
- Viewer UX: первый экран показывает превью, краткие метрики и человеческую таблицу минимального API-рецепта; подробности разнесены по вкладкам `Поля`, `API`, `Export`, `DOM`, `Debug`
- Provenance matching: нормализация текста, чисел, валют, процентов и дат; multi-field context matching внутри одного JSON-объекта; лёгкий DOM mutation trace для evidence “ответ пришёл → DOM изменился”
- Viewer preview: `previewHTML` рендерится в sandboxed `iframe` с CSP `default-src 'none'`, без внешних ресурсов; нужные computed styles выбранного фрагмента инлайнятся в безопасном виде
- Frontend evidence: best-effort call stack места вызова `fetch`/`XHR` сохраняется локально и показывается во viewer
- Progress UX: долгий анализ показывает этапы и прогресс при выборе элемента и при сохранении/открытии viewer
- Ограничения: HTML до `50KB`, preview HTML до `50KB`, request body до `20KB`, response body до `100KB`, call stack до `8KB`, не более `8` запросов
- Безопасность: capture включается только на armed-доменах, может быть выключен из popup, channel page→content изолирован случайным именем события, чувствительные заголовки и очевидные токены редактируются, `latestCapture` очищается после чтения, а локальная копия для повторного копирования автоудаляется по тому же TTL
- UX: открытие viewer автоматически сохраняет текущий capture, без двойного действия `сохранить` → `открыть`

## Что сознательно не покрыто

- точная причинная корреляция DOM ↔ API; recipe остаётся эвристикой по времени запроса, совпадениям DOM/JSON-фактов, контексту соседних полей и DOM mutation evidence
- DevTools/CDP/WebSocket/GraphQL
- устойчивость ко всем типам навигации и edge-case SPA
- production-grade защита от всех видов секретов внутри произвольных text response body
