// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Часть проекта chess-kg-lichess-learn (https://github.com/Takeboshi-Programmer/chess-kg-lichess-learn).
// Основано на материалах Lichess — https://github.com/lichess-org/lila (ui/learn),
// © 2012–2026 the lila authors, GNU Affero General Public License v3.0 или новее.
// ИЗМЕНЕНО относительно оригинала: интерфейс уроков (меню этапов, вступление, уровни, итог этапа) на чистом DOM/JS по мотивам ui/learn; данные грузятся из JSON.
// Дата изменения: 30 октября 2026 г. Подробности — в NOTICE.md.
// Этот файл — свободное ПО: вы можете распространять и/или изменять его на условиях
// GNU AGPL версии 3 или (по вашему выбору) любой более поздней. Файл распространяется
// БЕЗ КАКИХ-ЛИБО ГАРАНТИЙ. Текст лицензии — в файле LICENSE.
//
// lichess-learn.js
//
// ИНТЕРФЕЙС уроков Lichess Learn внутри chess.kg: меню этапов → вступление → уровни
// (доска, стрелки-подсказки, звёзды-«яблоки», сценарии соперника) → итог этапа.
// Логика уровней — js/lichess-learn-engine.js. Данные уроков (производные от Lichess, AGPL-3.0) — это
// ОТДЕЛЬНЫЙ JSON-файл, который грузится обычным fetch() при открытии раздела и НЕ входит в бандл:
// /open/lichess-learn/data/lichess-learn-data.json (источник — открытый репозиторий, см. /legal/licenses.html).
//
// Подключение:
//   import { mountLichessLearn } from './lichess-learn.js';
//   var learn = mountLichessLearn(document.getElementById('lichess-learn-root'), {
//       lang: 'ru',                       // 'ru' | 'en' | 'ky' (если задан setMessages('ky', …))
//       onExit: function () { … },        // кнопка «← назад» в меню этапов (необязательно)
//       onProgress: function (p) { … },   // сохранить на бэкенд (необязательно)
//       progress: { load: fn, save: fn }, // своё хранилище; по умолчанию localStorage
//       sound: function (name) { … },     // 'move' | 'capture' | 'fail' | 'start' | 'win'
//   });
//   learn.destroy();                      // при уходе из раздела
//
// Всё рисуется через createElement/textContent (без innerHTML) — CSP и eslint-plugin-no-unsanitized.
// Стили вставляются один раз (<style data-ll>), классы с префиксом «ll-».

import { createLevel, levelRank, stageRank, colorWord } from './lichess-learn-engine.js';

// ---------------------------------------------------------------------------
// Данные и переводы
// ---------------------------------------------------------------------------
export var DEFAULT_DATA_URL = '/open/lichess-learn/data/lichess-learn-data.json';
var dataPromises = {};
export function loadLearnData(url) {
    url = url || DEFAULT_DATA_URL;
    if (!dataPromises[url]) {
        dataPromises[url] = fetch(url, { credentials: 'same-origin' }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
            return r.json();
        }).catch(function (e) { delete dataPromises[url]; throw e; });
    }
    return dataPromises[url];
}

var extraMessages = {};
// Свой перевод (например, кыргызский — у Lichess он пуст): setMessages('ky', { rookGoal: '…', … }).
// Недостающие ключи берутся из ru, затем из en.
export function setMessages(lang, dict) {
    extraMessages[lang] = Object.assign(extraMessages[lang] || {}, dict);
}

var PRAISE = ['awesome', 'excellent', 'greatJob', 'perfect', 'outstanding', 'wayToGo', 'yesYesYes', 'youreGoodAtThis', 'nailedIt', 'rightOn'];
var STORAGE_KEY = 'chessKgLichessLearn.v1';
var FILES = 'abcdefgh';
var BRUSH = {
    green: ['#15781b', 0.9], red: ['#882020', 0.9], blue: ['#003088', 0.9], yellow: ['#e68f00', 0.95],
    paleGreen: ['#15781b', 0.5], paleBlue: ['#003088', 0.45], paleRed: ['#882020', 0.5], paleGrey: ['#4a4a4a', 0.4],
};

// ---------------------------------------------------------------------------
// Мелкие помощники DOM
// ---------------------------------------------------------------------------
var SVGNS = 'http://www.w3.org/2000/svg';
function el(tag, cls, kids) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    (kids || []).forEach(function (k) { if (k != null) n.appendChild(typeof k === 'string' ? document.createTextNode(k) : k); });
    return n;
}
function svg(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
}
function btn(text, cls, onClick) {
    var b = el('button', cls, [text]);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
}
function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

function injectStyle() {
    if (document.querySelector('style[data-ll]')) return;
    var s = document.createElement('style');
    s.setAttribute('data-ll', '');
    s.textContent = CSS;
    document.head.appendChild(s);
}

// ---------------------------------------------------------------------------
// Прогресс: { stages: { [stageKey]: { scores: [score|null, …] } } }
// ---------------------------------------------------------------------------
function defaultStore() {
    return {
        load: function () {
            try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { stages: {} }; } catch (e) { return { stages: {} }; }
        },
        save: function (p) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch (e) { /* приватный режим */ } },
    };
}

// ---------------------------------------------------------------------------
// Монтирование
// ---------------------------------------------------------------------------
export function mountLichessLearn(root, opts) {
    opts = opts || {};
    injectStyle();
    var baseUrl = opts.baseUrl || ''; // URL папки с иконками этапов, например '/open/lichess-learn/images/learn/'
    var dataUrl = opts.dataUrl || DEFAULT_DATA_URL; // URL файла данных (отдельный запрос, не в бандле)
    var pieceUrl = opts.pieceUrl || function (code) { return baseUrl + 'pieces/' + code + '.svg'; };
    var store = opts.progress || defaultStore();
    var sound = typeof opts.sound === 'function' ? opts.sound : function () {};
    var lang = opts.lang || 'ru';

    var data = null;
    var progress = { stages: {} };
    var timers = [];
    var destroyed = false;
    var cleanupView = function () {};

    root.classList.add('ll-root');
    clear(root);
    root.appendChild(el('div', 'll-loading', ['…']));

    function later(fn, ms) {
        var id = setTimeout(function () { if (!destroyed) fn(); }, ms);
        timers.push(id);
        return id;
    }
    function clearTimers() { timers.forEach(clearTimeout); timers = []; }

    function t(key) {
        var a = Array.prototype.slice.call(arguments, 1);
        var m = data ? data.messages : {};
        var s = (extraMessages[lang] || {})[key] || (m[lang] || {})[key] || (extraMessages.ru || {})[key] || (m.ru || {})[key] || (m.en || {})[key] || key;
        a.forEach(function (v) { s = s.replace('%s', v); });
        return s;
    }
    function stageProgress(stage) {
        var sp = progress.stages[stage.key];
        var scores = (sp && sp.scores) || [];
        var done = 0;
        stage.levels.forEach(function (l, i) { if (scores[i] != null) done++; });
        return { scores: scores, done: done, complete: done === stage.levels.length };
    }
    function allStages() {
        return data.categories.reduce(function (a, c) { return a.concat(c.stages); }, []);
    }
    function saveScore(stage, idx, score) {
        var sp = progress.stages[stage.key] || (progress.stages[stage.key] = { scores: [] });
        var old = sp.scores[idx];
        if (old == null || score > old) sp.scores[idx] = score;
        persist();
    }
    function persist() {
        try { store.save(progress); } catch (e) { /* не критично */ }
        if (opts.onProgress) { try { opts.onProgress(progress); } catch (e) { /* не критично */ } }
    }
    function show(viewNode, cleanup) {
        cleanupView();
        clearTimers();
        cleanupView = cleanup || function () {};
        clear(root);
        root.appendChild(viewNode);
        if (root.scrollIntoView && opts.scrollIntoView !== false) { try { root.scrollIntoView({ block: 'nearest' }); } catch (e) { /* старые WebView */ } }
    }
    function img(src, cls, alt) {
        var i = el('img', cls);
        i.src = baseUrl + src;
        i.alt = alt || '';
        i.draggable = false;
        return i;
    }

    // -------------------------------------------------------------------
    // МЕНЮ
    // -------------------------------------------------------------------
    function showMenu() {
        var wrap = el('div', 'll-menu');
        var total = 0;
        var done = 0;
        allStages().forEach(function (s) { total += s.levels.length; done += stageProgress(s).done; });
        var head = el('div', 'll-menu-head', [
            el('div', null, [
                el('h2', 'll-title', [t('learnChess') + ' ' + t('byPlaying')]),
                el('div', 'll-sub', [t('progressX', Math.round(100 * done / Math.max(1, total)) + '%')]),
            ]),
        ]);
        if (opts.onExit) head.insertBefore(btn('←', 'll-back', function () { opts.onExit(); }), head.firstChild);
        wrap.appendChild(head);
        data.categories.forEach(function (c) {
            wrap.appendChild(el('h3', 'll-categ', [t(c.name)]));
            var grid = el('div', 'll-grid');
            c.stages.forEach(function (s) {
                var sp = stageProgress(s);
                var card = el('button', 'll-card' + (sp.complete ? ' ll-card-done' : ''));
                card.type = 'button';
                card.appendChild(s.illustration && s.illustration.piece ? img(s.image, 'll-card-img') : img(s.image, 'll-card-img'));
                var info = el('div', 'll-card-info', [
                    el('div', 'll-card-title', [t(s.title)]),
                    el('div', 'll-card-sub', [t(s.subtitle)]),
                ]);
                var dots = el('div', 'll-dots');
                s.levels.forEach(function (l, i) { dots.appendChild(el('span', 'll-dot' + (sp.scores[i] != null ? ' ll-dot-on' : ''))); });
                info.appendChild(dots);
                card.appendChild(info);
                card.appendChild(el('div', 'll-card-id', [String(s.id)]));
                card.addEventListener('click', function () { showIntro(s); });
                grid.appendChild(card);
            });
            wrap.appendChild(grid);
        });
        wrap.appendChild(btn(t('resetMyProgress'), 'll-link', function () {
            if (window.confirm(t('youWillLoseAllYourProgress'))) { progress = { stages: {} }; persist(); showMenu(); }
        }));
        show(wrap);
    }

    // -------------------------------------------------------------------
    // ВСТУПЛЕНИЕ В ЭТАП
    // -------------------------------------------------------------------
    function firstOpenLevel(stage) {
        var sp = stageProgress(stage);
        for (var i = 0; i < stage.levels.length; i++) if (sp.scores[i] == null) return i;
        return 0;
    }
    function showIntro(stage) {
        var wrap = el('div', 'll-intro');
        wrap.appendChild(btn('←', 'll-back', showMenu));
        var ill = stage.illustration && stage.illustration.piece
            ? el('div', 'll-ill ll-ill-piece', [img(stage.image, 'll-ill-img')])
            : el('div', 'll-ill', [img(stage.image, 'll-ill-img')]);
        wrap.appendChild(ill);
        wrap.appendChild(el('h2', 'll-title', [t(stage.title)]));
        wrap.appendChild(el('div', 'll-sub', [t(stage.subtitle)]));
        wrap.appendChild(el('p', 'll-intro-text', [t(stage.intro)]));
        var go = btn(t('letsGo'), 'll-primary', function () { startLevel(stage, firstOpenLevel(stage)); });
        wrap.appendChild(go);
        show(wrap);
        go.focus({ preventScroll: true });
    }

    // -------------------------------------------------------------------
    // ЭКРАН ЭТАПА ЗАВЕРШЁН
    // -------------------------------------------------------------------
    function showStageComplete(stage) {
        var sp = stageProgress(stage);
        var scores = stage.levels.map(function (l, i) { return sp.scores[i] || 0; });
        var rank = stageRank(stage, scores);
        var all = allStages();
        var next = all[all.indexOf(stage) + 1];
        var wrap = el('div', 'll-intro ll-done');
        sound('win');
        wrap.appendChild(el('div', 'll-stars', [0, 1, 2].map(function (i) { return el('span', 'll-star' + (i < 4 - rank ? ' ll-star-on' : ''), ['★']); })));
        wrap.appendChild(el('h2', 'll-title', [t('stageXComplete', stage.id)]));
        wrap.appendChild(el('p', 'll-intro-text', [t(stage.complete)]));
        wrap.appendChild(el('div', 'll-sub', ['★ ' + scores.reduce(function (a, b) { return a + b; }, 0)]));
        var row = el('div', 'll-row');
        if (next) row.appendChild(btn(t('nextX', t(next.title)), 'll-primary', function () { showIntro(next); }));
        row.appendChild(btn(t('backToMenu'), 'll-secondary', showMenu));
        wrap.appendChild(row);
        show(wrap);
    }

    // -------------------------------------------------------------------
    // УРОВЕНЬ
    // -------------------------------------------------------------------
    function startLevel(stage, idx) {
        if (idx >= stage.levels.length) { showStageComplete(stage); return; }
        var bp = stage.levels[idx];
        var L = createLevel(bp);
        var flip = bp.color === 'black';
        var locked = false;      // пока идёт ход соперника/анимация/конец уровня
        var selected = null;
        var shapes = (bp.shapes || []).slice();
        var viewBoard = Object.assign({}, L.pos.b);
        var lastMove = null;
        var checkSq = null;
        var drag = null;
        var promoUi = null;

        var wrap = el('div', 'll-level' + (stage.cssClass ? ' ' + stage.cssClass : ''));
        var side = el('div', 'll-side');
        var top = el('div', 'll-side-top', [
            btn('←', 'll-back', showMenu),
            el('div', 'll-stage-name', [t(stage.title)]),
        ]);
        var dots = el('div', 'll-dots ll-dots-lg');
        stage.levels.forEach(function (l, i) {
            var cls = 'll-dot' + (i < idx || stageProgress(stage).scores[i] != null ? ' ll-dot-on' : '') + (i === idx ? ' ll-dot-cur' : '');
            dots.appendChild(el('span', cls));
        });
        var goal = el('div', 'll-goal', [t(bp.goal)]);
        goal.setAttribute('aria-live', 'polite');
        var scoreEl = el('div', 'll-score', ['★ 0']);
        var msg = el('div', 'll-msg');
        side.appendChild(top);
        side.appendChild(dots);
        side.appendChild(goal);
        side.appendChild(scoreEl);
        side.appendChild(msg);

        var boardWrap = el('div', 'll-board-wrap');
        var board = el('div', 'll-board');
        var cells = {};
        for (var r = 0; r < 8; r++) {
            for (var c = 0; c < 8; c++) {
                var file = flip ? 7 - c : c;
                var rank = flip ? r : 7 - r;
                var name = FILES.charAt(file) + (rank + 1);
                var cell = el('div', 'll-sq ' + ((file + rank) % 2 === 0 ? 'll-dark' : 'll-light'));
                cell.setAttribute('data-sq', name);
                if (c === 0) cell.appendChild(el('span', 'll-coord ll-coord-r', [String(rank + 1)]));
                if (r === 7) cell.appendChild(el('span', 'll-coord ll-coord-f', [FILES.charAt(file)]));
                cells[name] = cell;
                board.appendChild(cell);
            }
        }
        var hl = /highlight-(\d)\w+-rank/.exec(bp.cssClass || '');
        if (hl) {
            var hlRank = parseInt(hl[1], 10);
            for (var f = 0; f < 8; f++) cells[FILES.charAt(f) + hlRank].classList.add('ll-rank-hl');
        }
        var shapeLayer = svg('svg', { viewBox: '0 0 8 8', class: 'll-shapes' });
        shapeLayer.setAttribute('aria-hidden', 'true');
        var piecesLayer = el('div', 'll-pieces');
        board.appendChild(piecesLayer);
        board.appendChild(shapeLayer);
        boardWrap.appendChild(board);
        var overlay = el('div', 'll-overlay hidden');
        boardWrap.appendChild(overlay);
        wrap.appendChild(boardWrap);
        wrap.appendChild(side);

        // ---- геометрия ----
        function center(s) {
            var x = FILES.indexOf(s.charAt(0));
            var y = parseInt(s.charAt(1), 10) - 1;
            return [(flip ? 7 - x : x) + 0.5, (flip ? y : 7 - y) + 0.5];
        }
        function squareAt(clientX, clientY) {
            var rc = board.getBoundingClientRect();
            var cx = Math.floor(((clientX - rc.left) / rc.width) * 8);
            var cy = Math.floor(((clientY - rc.top) / rc.height) * 8);
            if (cx < 0 || cx > 7 || cy < 0 || cy > 7) return null;
            return FILES.charAt(flip ? 7 - cx : cx) + (flip ? cy + 1 : 8 - cy);
        }

        // ---- отрисовка ----
        function drawShapes() {
            clear(shapeLayer);
            L.apples.forEach(function (a) {
                var p = center(a);
                shapeLayer.appendChild(svg('path', { d: starPath(p[0], p[1], 0.36, 0.15), fill: '#f6c343', stroke: '#b9831a', 'stroke-width': 0.04 }));
            });
            shapes.forEach(function (s) {
                var b = BRUSH[s.brush] || BRUSH.green;
                var a = center(s.orig);
                if (!s.dest) {
                    shapeLayer.appendChild(svg('circle', { cx: a[0], cy: a[1], r: 0.44, fill: 'none', stroke: b[0], 'stroke-width': 0.075, opacity: b[1] }));
                    return;
                }
                var d = center(s.dest);
                var dx = d[0] - a[0];
                var dy = d[1] - a[1];
                var len = Math.sqrt(dx * dx + dy * dy) || 1;
                var ux = dx / len;
                var uy = dy / len;
                var head = 0.3;
                var x1 = a[0] + ux * 0.2;
                var y1 = a[1] + uy * 0.2;
                var x2 = d[0] - ux * (head + 0.05);
                var y2 = d[1] - uy * (head + 0.05);
                var g = svg('g', { opacity: b[1] });
                g.appendChild(svg('line', { x1: x1, y1: y1, x2: x2, y2: y2, stroke: b[0], 'stroke-width': 0.14, 'stroke-linecap': 'round' }));
                var tipx = d[0] - ux * 0.08;
                var tipy = d[1] - uy * 0.08;
                var bx = tipx - ux * head;
                var by = tipy - uy * head;
                g.appendChild(svg('polygon', { points: tipx + ',' + tipy + ' ' + (bx - uy * 0.17) + ',' + (by + ux * 0.17) + ' ' + (bx + uy * 0.17) + ',' + (by - ux * 0.17), fill: b[0] }));
                shapeLayer.appendChild(g);
            });
        }
        function starPath(cx, cy, R, r) {
            var pts = [];
            for (var i = 0; i < 10; i++) {
                var ang = -Math.PI / 2 + (i * Math.PI) / 5;
                var rad = i % 2 === 0 ? R : r;
                pts.push((cx + Math.cos(ang) * rad).toFixed(3) + ',' + (cy + Math.sin(ang) * rad).toFixed(3));
            }
            return 'M' + pts.join('L') + 'Z';
        }
        function render(anim) {
            clear(piecesLayer);
            Object.keys(cells).forEach(function (s) {
                cells[s].classList.remove('ll-last', 'll-sel', 'll-dest', 'll-dest-cap', 'll-check', 'll-bang');
            });
            if (lastMove) { cells[lastMove.from].classList.add('ll-last'); cells[lastMove.to].classList.add('ll-last'); }
            if (checkSq && cells[checkSq]) cells[checkSq].classList.add('ll-check');
            var movable = locked ? {} : L.dests();
            var appleSquares = L.apples;
            Object.keys(viewBoard).forEach(function (s) {
                // «яблоко» в движке — вражеская пешка-заглушка; на доске рисуется только звезда
                if (appleSquares.indexOf(s) >= 0) return;
                var code = viewBoard[s];
                var p = center(s);
                var node = el('div', 'll-piece' + (movable[s] ? ' ll-movable' : ''));
                node.style.backgroundImage = 'url("' + pieceUrl(code) + '")';
                node.style.left = (p[0] - 0.5) * 12.5 + '%';
                node.style.top = (p[1] - 0.5) * 12.5 + '%';
                node.setAttribute('data-sq', s);
                if (anim && anim.to === s && anim.from) {
                    var q = center(anim.from);
                    node.style.transform = 'translate(' + (q[0] - p[0]) * 100 + '%,' + (q[1] - p[1]) * 100 + '%)';
                    node.style.transition = 'none';
                    requestAnimationFrame(function () {
                        requestAnimationFrame(function () { node.style.transition = 'transform .18s ease-out'; node.style.transform = ''; });
                    });
                }
                piecesLayer.appendChild(node);
            });
            if (selected && !locked) {
                cells[selected].classList.add('ll-sel');
                (movable[selected] || []).forEach(function (d) { cells[d].classList.add(viewBoard[d] && appleSquares.indexOf(d) < 0 ? 'll-dest-cap' : 'll-dest'); });
            }
            drawShapes();
            scoreEl.textContent = '★ ' + L.vm.score;
        }
        function pop(sqName, text) {
            var p = center(sqName);
            var n = el('div', 'll-pop', [text]);
            n.style.left = (p[0] - 0.5) * 12.5 + '%';
            n.style.top = (p[1] - 0.5) * 12.5 + '%';
            board.appendChild(n);
            later(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 900);
        }
        function syncBoard() { viewBoard = Object.assign({}, L.pos.b); }

        // ---- ход игрока ----
        function tryMove(from, to) {
            if (locked) return;
            if (L.isPromotionMove(from, to)) { askPromotion(from, to); return; }
            commit(from, to);
        }
        function askPromotion(from, to) {
            locked = true;
            var color = L.playerColor;
            var box = el('div', 'll-promo');
            if (bp.explainPromotion) {
                box.appendChild(el('h4', null, [t('pawnPromotion')]));
                box.appendChild(el('p', null, [t('yourPawnReachedTheEndOfTheBoard') + ' ' + t('itNowPromotesToAStrongerPiece')]));
                box.appendChild(el('p', 'll-promo-hint', [t('selectThePieceYouWant')]));
            }
            var row = el('div', 'll-promo-row');
            ['Q', 'N', 'R', 'B'].forEach(function (role) {
                var b = el('button', 'll-promo-btn');
                b.type = 'button';
                b.style.backgroundImage = 'url("' + pieceUrl(color + role) + '")';
                b.addEventListener('click', function () { overlay.classList.add('hidden'); locked = false; commit(from, to, role.toLowerCase()); });
                row.appendChild(b);
            });
            box.appendChild(row);
            clear(overlay);
            overlay.appendChild(box);
            overlay.classList.remove('hidden');
            promoUi = function () { overlay.classList.add('hidden'); locked = false; selected = null; render(); promoUi = null; };
            overlay.onclick = function (e) { if (e.target === overlay && promoUi) promoUi(); };
        }
        function commit(from, to, promo) {
            selected = null;
            shapes = [];
            var r = L.playerMove(from, to, promo);
            if (!r.ok) { render(); return; }
            syncBoard();
            lastMove = { from: from, to: to };
            checkSq = L.kingSquareInCheck();
            if (r.check) shapes = r.check;
            if (r.scenarioShapes && r.scenarioShapes.length) shapes = r.scenarioShapes;
            sound(r.captured || r.tookApple ? 'capture' : 'move');
            if (r.scoreDelta > 0 && r.status !== 'completed' && (r.tookApple || r.tookPiece || r.inScenario)) {
                pop(to, '+' + (r.tookPiece && bp.showPieceValues ? r.scoreDelta : r.tookApple ? 50 : r.scoreDelta));
            }
            render({ from: from, to: to });

            if (r.status === 'failed') { onFailed(r); return; }
            if (r.status === 'completed') { onCompleted(); return; }
            if (r.inScenario) {
                locked = true;
                render();
                later(function () {
                    var o = L.opponentMove();
                    if (!o) { locked = false; render(); return; }
                    syncBoard();
                    lastMove = { from: o.from, to: o.to };
                    checkSq = L.kingSquareInCheck();
                    shapes = [];
                    sound('move');
                    render({ from: o.from, to: o.to });
                    if (o.shapes && o.shapes.length) later(function () { shapes = o.shapes; drawShapes(); }, 500);
                    locked = false;
                    render({ from: o.from, to: o.to });
                }, 1000);
            }
        }
        function onFailed(r) {
            locked = true;
            sound('fail');
            var f = r.failure || {};
            if (f.kind === 'selfcheck') {
                shapes = f.shapes || [];
                checkSq = f.kingSquare || null;
                render();
            } else if (f.kind === 'capture') {
                var bang = f.capture;
                cells[bang.orig].classList.add('ll-bang');
                later(function () {
                    var vb = Object.assign({}, viewBoard);
                    vb[bang.dest] = vb[bang.orig];
                    delete vb[bang.orig];
                    viewBoard = vb;
                    lastMove = { from: bang.orig, to: bang.dest };
                    render({ from: bang.orig, to: bang.dest });
                }, 600);
            } else {
                render();
            }
            if (r.followUp) {
                later(function () {
                    var m = L.playFollowUp();
                    if (m) { syncBoard(); lastMove = m; render({ from: m.from, to: m.to }); }
                }, 600);
            }
            later(function () {
                msg.textContent = '';
                msg.appendChild(el('div', 'll-fail', [t('puzzleFailed')]));
                msg.appendChild(btn(t('retry'), 'll-primary', function () { startLevel(stage, idx); }));
            }, 700);
        }
        function onCompleted() {
            locked = true;
            sound('start');
            saveScore(stage, idx, L.vm.score);
            render();
            later(function () {
                var rank = levelRank(bp, L.vm.score);
                clear(overlay);
                var box = el('div', 'll-praise');
                box.appendChild(el('div', 'll-stars', [0, 1, 2].map(function (i) { return el('span', 'll-star' + (i < 4 - rank ? ' ll-star-on' : ''), ['★']); })));
                box.appendChild(el('div', 'll-praise-text', [t(PRAISE[Math.floor(Math.random() * PRAISE.length)])]));
                if (bp.nextButton) box.appendChild(btn(t('next'), 'll-primary', function () { startLevel(stage, idx + 1); }));
                overlay.appendChild(box);
                overlay.classList.remove('hidden');
                overlay.onclick = null;
                if (!bp.nextButton) later(function () { startLevel(stage, idx + 1); }, 1200);
            }, 250);
        }

        // ---- ввод: клик/тап + перетаскивание ----
        board.addEventListener('pointerdown', function (e) {
            if (locked || (e.button != null && e.button > 0)) return;
            var s = squareAt(e.clientX, e.clientY);
            if (!s) return;
            var movable = L.dests();
            if (selected && (movable[selected] || []).indexOf(s) >= 0) { tryMove(selected, s); return; }
            if (movable[s]) {
                shapes = (bp.shapes || []).length ? [] : shapes;
                selected = selected === s ? null : s;
                drag = { from: s, x: e.clientX, y: e.clientY, started: false, ghost: null, pointer: e.pointerId };
                render();
                try { board.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
            } else {
                selected = null;
                render();
            }
        });
        board.addEventListener('pointermove', function (e) {
            if (!drag || e.pointerId !== drag.pointer) return;
            if (!drag.started) {
                if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < 6) return;
                drag.started = true;
                selected = drag.from;
                var src = piecesLayer.querySelector('[data-sq="' + drag.from + '"]');
                var rect = board.getBoundingClientRect();
                var g = el('div', 'll-ghost');
                g.style.width = g.style.height = rect.width / 8 + 'px';
                g.style.backgroundImage = src ? src.style.backgroundImage : '';
                document.body.appendChild(g);
                drag.ghost = g;
                if (src) src.style.opacity = '0.25';
                render();
                var again = piecesLayer.querySelector('[data-sq="' + drag.from + '"]');
                if (again) again.style.opacity = '0.25';
            }
            var sz = drag.ghost.offsetWidth;
            drag.ghost.style.left = e.clientX - sz / 2 + 'px';
            drag.ghost.style.top = e.clientY - sz / 2 + 'px';
        });
        function endDrag(e, cancel) {
            if (!drag || (e && e.pointerId !== drag.pointer)) return;
            var d = drag;
            drag = null;
            if (d.ghost && d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
            if (!d.started) return;
            var s = cancel ? null : squareAt(e.clientX, e.clientY);
            var movable = L.dests();
            if (s && (movable[d.from] || []).indexOf(s) >= 0) tryMove(d.from, s);
            else { selected = d.from; render(); }
        }
        board.addEventListener('pointerup', function (e) { endDrag(e, false); });
        board.addEventListener('pointercancel', function (e) { endDrag(e, true); });
        board.addEventListener('contextmenu', function (e) { e.preventDefault(); });

        show(wrap, function () {
            if (drag && drag.ghost && drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
            drag = null;
        });
        sound('start');
        render();
        if (L.needsOpponentFirst()) {
            locked = true;
            later(function () {
                var o = L.opponentMove();
                if (o) { syncBoard(); lastMove = { from: o.from, to: o.to }; checkSq = L.kingSquareInCheck(); }
                locked = false;
                render(o ? { from: o.from, to: o.to } : null);
            }, 1000);
        }
    }

    // -------------------------------------------------------------------
    // Старт
    // -------------------------------------------------------------------
    var ready = Promise.all([loadLearnData(dataUrl), Promise.resolve(store.load())]).then(function (res) {
        if (destroyed) return;
        data = res[0];
        progress = res[1] && res[1].stages ? res[1] : { stages: {} };
        showMenu();
    }).catch(function (e) {
        clear(root);
        root.appendChild(el('div', 'll-loading', ['Не удалось загрузить уроки']));
        if (window.console) console.error('[lichess-learn]', e);
    });

    return {
        ready: ready,
        showMenu: function () { if (data) showMenu(); },
        openStage: function (keyOrId) {
            return ready.then(function () {
                var s = allStages().filter(function (x) { return x.key === keyOrId || x.id === keyOrId; })[0];
                if (s) showIntro(s);
            });
        },
        setLang: function (l) { lang = l; if (data) showMenu(); },
        destroy: function () {
            destroyed = true;
            clearTimers();
            cleanupView();
            clear(root);
            root.classList.remove('ll-root');
        },
    };
}

// ---------------------------------------------------------------------------
// Стили (тёмная тема сайта по умолчанию; переменные сайта с запасными значениями)
// ---------------------------------------------------------------------------
var CSS = [
    '.ll-root{--ll-bg:var(--bg-surface,#1e293b);--ll-bg2:var(--bg-dark,#0f172a);--ll-text:var(--text-main,#fff);--ll-muted:var(--text-muted,#94a3b8);--ll-border:var(--border-color,#334155);--ll-accent:var(--accent-green,#10b981);--ll-accent2:var(--accent-blue,#2563eb);--ll-red:var(--accent-red,#ef4444);color:var(--ll-text);font-family:inherit;max-width:980px;margin:0 auto;padding:12px;container-type:inline-size}',
    'html[data-theme="light"] .ll-root{--ll-bg:#fff;--ll-bg2:#f1f5f9;--ll-text:#0f172a;--ll-muted:#64748b;--ll-border:#cbd5e1}',
    '.ll-root .hidden{display:none!important}',
    '.ll-loading{padding:40px;text-align:center;color:var(--ll-muted)}',
    '.ll-title{margin:0;font-size:1.5rem}.ll-sub{color:var(--ll-muted);font-size:.95rem;margin-top:2px}',
    '.ll-menu-head{display:flex;align-items:center;gap:12px;margin-bottom:8px}',
    '.ll-back{background:var(--ll-bg);color:var(--ll-text);border:1px solid var(--ll-border);border-radius:10px;padding:8px 14px;font-size:1.05rem;cursor:pointer}',
    '.ll-categ{margin:22px 0 10px;font-size:1.05rem;color:var(--ll-muted);text-transform:uppercase;letter-spacing:.04em}',
    '.ll-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}',
    '.ll-card{position:relative;display:flex;gap:12px;align-items:center;text-align:left;background:var(--ll-bg);color:var(--ll-text);border:1px solid var(--ll-border);border-radius:14px;padding:12px;cursor:pointer;font:inherit;transition:transform .12s,border-color .12s}',
    '.ll-card:hover,.ll-card:focus-visible{transform:translateY(-2px);border-color:var(--ll-accent);outline:none}',
    '.ll-card-done{border-color:var(--ll-accent)}',
    '.ll-card-img{width:52px;height:52px;flex:none;box-sizing:border-box;padding:8px;border-radius:50%;background:#475569}',
    '.ll-card-title{font-weight:700}.ll-card-sub{color:var(--ll-muted);font-size:.85rem;margin-bottom:6px}',
    '.ll-card-id{position:absolute;top:8px;right:12px;color:var(--ll-muted);font-size:.8rem}',
    '.ll-dots{display:flex;gap:5px;flex-wrap:wrap}.ll-dot{width:9px;height:9px;border-radius:50%;background:var(--ll-border)}.ll-dot-on{background:var(--ll-accent)}',
    '.ll-dots-lg .ll-dot{width:13px;height:13px}.ll-dot-cur{outline:2px solid var(--ll-text);outline-offset:2px}',
    '.ll-link{margin:28px auto 0;display:block;background:none;border:0;color:var(--ll-muted);text-decoration:underline;cursor:pointer;font:inherit}',
    '.ll-intro{display:flex;flex-direction:column;align-items:center;text-align:center;gap:10px;padding:24px 8px;position:relative}',
    '.ll-intro>.ll-back{position:absolute;left:0;top:8px}',
    '.ll-ill{width:130px;height:130px;display:flex;align-items:center;justify-content:center}',
    '.ll-ill{background:#475569;border-radius:50%}.ll-ill-img{width:68%;height:68%}',
    '.ll-intro-text{max-width:460px;line-height:1.5;color:var(--ll-text);margin:6px 0 10px;white-space:pre-line}',
    '.ll-primary,.ll-secondary{border:0;border-radius:12px;padding:12px 26px;font:inherit;font-weight:700;cursor:pointer}',
    '.ll-primary{background:var(--ll-accent);color:#fff}.ll-primary:hover{filter:brightness(1.08)}',
    '.ll-secondary{background:var(--ll-bg);color:var(--ll-text);border:1px solid var(--ll-border)}',
    '.ll-row{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}',
    '.ll-stars{display:flex;gap:6px;justify-content:center}.ll-star{font-size:2rem;color:var(--ll-border)}.ll-star-on{color:#f6c343}',
    '.ll-level{display:flex;flex-direction:column;align-items:center;gap:14px}',
    '.ll-board-wrap{position:relative;flex:none;width:min(100%,640px,calc(100dvh - 180px));min-width:min(100%,280px)}',
    '.ll-board{position:relative;display:grid;grid-template-columns:repeat(8,1fr);aspect-ratio:1/1;width:100%;border-radius:6px;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;box-shadow:0 6px 24px rgba(0,0,0,.35)}',
    '.ll-sq{position:relative}.ll-light{background:#f0d9b5}.ll-dark{background:#b58863}',
    '.ll-coord{position:absolute;font-size:clamp(8px,1.6vw,12px);font-weight:700;opacity:.75;pointer-events:none}',
    '.ll-light .ll-coord{color:#b58863}.ll-dark .ll-coord{color:#f0d9b5}.ll-coord-r{top:2px;left:3px}.ll-coord-f{bottom:1px;right:3px}',
    '.ll-last{box-shadow:inset 0 0 0 100px rgba(155,199,0,.41)}.ll-sel{box-shadow:inset 0 0 0 100px rgba(20,85,30,.5)}',
    '.ll-rank-hl{box-shadow:inset 0 0 0 100px rgba(255,214,10,.28)}',
    '.ll-dest::after{content:"";position:absolute;inset:36%;border-radius:50%;background:rgba(20,85,0,.5)}',
    '.ll-dest-cap::after{content:"";position:absolute;inset:4%;border-radius:50%;box-shadow:inset 0 0 0 5px rgba(20,85,0,.5)}',
    '.ll-check{background:radial-gradient(circle,rgba(255,0,0,1) 0%,rgba(231,0,0,1) 25%,rgba(169,0,0,0) 89%)!important}',
    '.ll-bang::before{content:"!";position:absolute;z-index:5;top:2px;right:4px;width:22px;height:22px;border-radius:50%;background:#af0000;color:#fff;font-weight:700;display:flex;align-items:center;justify-content:center}',
    '.ll-pieces,.ll-shapes{position:absolute;inset:0;pointer-events:none}.ll-shapes{width:100%;height:100%}',
    '.ll-piece{position:absolute;width:12.5%;height:12.5%;background-size:100% 100%;background-repeat:no-repeat;will-change:transform}',
    '.ll-movable{cursor:grab}',
    '.ll-ghost{position:fixed;z-index:9999;pointer-events:none;background-size:100% 100%;transform:scale(1.15)}',
    '.ll-pop{position:absolute;width:12.5%;height:12.5%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;text-shadow:0 1px 3px #000;pointer-events:none;animation:ll-up .9s ease-out forwards;z-index:6}',
    '@keyframes ll-up{from{transform:translateY(0);opacity:1}to{transform:translateY(-70%);opacity:0}}',
    '.ll-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);border-radius:6px;z-index:10}',
    '.ll-praise,.ll-promo{background:var(--ll-bg);border:1px solid var(--ll-border);border-radius:16px;padding:18px 22px;text-align:center;max-width:86%}',
    '.ll-praise-text{font-size:1.5rem;font-weight:800;margin:6px 0 12px}',
    '.ll-promo h4{margin:0 0 6px}.ll-promo p{margin:0 0 8px;font-size:.9rem;line-height:1.4}.ll-promo-hint{color:var(--ll-muted)}',
    '.ll-promo-row{display:flex;gap:8px;justify-content:center}',
    '.ll-promo-btn{width:clamp(48px,12vw,68px);height:clamp(48px,12vw,68px);border-radius:12px;border:1px solid var(--ll-border);background-color:#f0d9b5;background-size:100% 100%;cursor:pointer}',
    '.ll-promo-btn:hover{background-color:#fff}',
    '.ll-side{order:-1;flex:none;width:min(100%,640px);display:flex;flex-direction:column;gap:10px}',
    '.ll-side-top{display:flex;align-items:center;gap:10px}.ll-stage-name{font-weight:700}',
    '.ll-goal{background:var(--ll-bg);border:1px solid var(--ll-border);border-radius:14px;padding:14px 16px;font-size:1.1rem;line-height:1.45;font-weight:600}',
    '.ll-score{color:#f6c343;font-weight:700}',
    '.ll-fail{color:var(--ll-red);font-weight:700;margin-bottom:8px}',
    '@media(prefers-reduced-motion:reduce){.ll-piece,.ll-pop,.ll-card{transition:none!important;animation:none!important}}',
    '@container (min-width:900px){.ll-level{flex-direction:row;align-items:flex-start;justify-content:center;gap:24px}.ll-side{order:0;width:300px}}',
    '@media(max-width:620px){.ll-root{padding:0}}',
].join('\n');

export { levelRank, stageRank, colorWord };
