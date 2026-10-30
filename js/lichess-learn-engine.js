// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Часть проекта chess-kg-lichess-learn (https://github.com/Takeboshi-Programmer/chess-kg-lichess-learn).
// Основано на материалах Lichess — https://github.com/lichess-org/lila (ui/learn),
// © 2012–2026 the lila authors, GNU Affero General Public License v3.0 или новее.
// ИЗМЕНЕНО относительно оригинала: переписан на JavaScript (порт ui/learn/src/{chess,levelCtrl,scenario,score,assert}.ts: правила ходов без chess.js, очки, сценарии); данные уровней читаются из JSON.
// Дата изменения: 30 октября 2026 г. Подробности — в NOTICE.md.
// Этот файл — свободное ПО: вы можете распространять и/или изменять его на условиях
// GNU AGPL версии 3 или (по вашему выбору) любой более поздней. Файл распространяется
// БЕЗ КАКИХ-ЛИБО ГАРАНТИЙ. Текст лицензии — в файле LICENSE.
//
// js/lichess-learn-engine.js
//
// ЛОГИКА уровней Lichess Learn (без DOM, без chess.js) — порт того, что делают
// ui/learn/src/{chess,levelCtrl,scenario,score,assert}.ts из lila.
//
// Почему не chess.js: в уроках Lichess полно позиций БЕЗ королей («8/8/8/8/8/8/4R3/8 w»)
// и «яблок» (звёзд) на пустых клетках. chess.js такие позиции не принимает, а Lichess
// для них переключается на «античесс»-правила без шахов. Здесь то же правило:
//   • у стороны, чей ход, ЕСТЬ король и level.offerIllegalMove не включён → обычные
//     шахматные правила (нельзя оставлять короля под боем, есть рокировка);
//   • иначе → псевдолегальные ходы (без проверки шаха, без рокировки).
// Яблоко — это «вражеская пешка» на клетке (как в lila): фигура её «берёт».
//
// Модуль чистый: подходит и для Node-тестов (tests/lichess-learn.test.mjs).
//
// Поток одного хода игрока (как LevelCtrl.makeSendMove в lila):
//   var r = level.playerMove('e2', 'e7');
//   r.status   — 'playing' | 'completed' | 'failed'
//   r.inScenario — true: через ~1 с вызвать level.opponentMove() (ответ сценария)
//   r.failure  — { kind: 'selfcheck'|'capture'|'rule', shapes?, capture? }
//   r.followUp — true: после проигрыша можно через ~0,6 с вызвать level.playFollowUp()

var FILES = 'abcdefgh';
var KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
var KING = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
var ROOK = [[1, 0], [-1, 0], [0, 1], [0, -1]];
var BISHOP = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

// Очки (score.ts)
export var SCORE_APPLE = 50;
export var SCORE_CAPTURE = 50;
export var SCORE_SCENARIO = 50;
var LEVEL_BONUS = { 1: 500, 2: 300, 3: 100 };
var PIECE_VALUE = { Q: 90, R: 50, B: 30, N: 30, P: 10 };

// ---------------------------------------------------------------------------
// Геометрия
// ---------------------------------------------------------------------------
function X(sq) { return FILES.indexOf(sq.charAt(0)); }
function Y(sq) { return parseInt(sq.charAt(1), 10) - 1; }
function sq(x, y) { return FILES.charAt(x) + (y + 1); }
function onBoard(x, y) { return x >= 0 && x < 8 && y >= 0 && y < 8; }
function opp(c) { return c === 'w' ? 'b' : 'w'; }
export function colorWord(c) { return c === 'w' ? 'white' : 'black'; }
function colorChar(word) { return word === 'black' ? 'b' : 'w'; }

// ---------------------------------------------------------------------------
// Позиция: { b: { 'e2': 'wP' }, turn: 'w'|'b', cast: {K,Q,k,q}, ep: 'e3'|null }
// ---------------------------------------------------------------------------
export function parseFen(fen) {
    var parts = fen.trim().split(/\s+/);
    var b = {};
    parts[0].split('/').forEach(function (row, i) {
        var x = 0;
        var y = 7 - i;
        for (var k = 0; k < row.length; k++) {
            var ch = row.charAt(k);
            if (/\d/.test(ch)) { x += parseInt(ch, 10); continue; }
            b[sq(x, y)] = (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase();
            x++;
        }
    });
    var cs = parts[2] || '-';
    return {
        b: b,
        turn: parts[1] === 'b' ? 'b' : 'w',
        cast: { K: cs.indexOf('K') >= 0, Q: cs.indexOf('Q') >= 0, k: cs.indexOf('k') >= 0, q: cs.indexOf('q') >= 0 },
        ep: parts[3] && parts[3] !== '-' ? parts[3] : null,
    };
}

function clonePos(p) {
    return { b: Object.assign({}, p.b), turn: p.turn, cast: Object.assign({}, p.cast), ep: p.ep };
}

export function boardFen(p) {
    var rows = [];
    for (var y = 7; y >= 0; y--) {
        var s = '';
        var empty = 0;
        for (var x = 0; x < 8; x++) {
            var pc = p.b[sq(x, y)];
            if (!pc) { empty++; continue; }
            if (empty) { s += empty; empty = 0; }
            s += pc.charAt(0) === 'w' ? pc.charAt(1) : pc.charAt(1).toLowerCase();
        }
        if (empty) s += empty;
        rows.push(s);
    }
    return rows.join('/');
}

function kingSq(b, color) {
    for (var s in b) if (b[s] === color + 'K') return s;
    return null;
}

// Бьёт ли сторона `by` клетку s (для шахов, рокировки и самошаха).
function attackedBy(b, s, by) {
    var x = X(s);
    var y = Y(s);
    var i, nx, ny, pc;
    var pdir = by === 'w' ? 1 : -1; // пешка стороны by бьёт «вперёд» по своему направлению
    for (i = -1; i <= 1; i += 2) {
        nx = x + i; ny = y - pdir;
        if (onBoard(nx, ny) && b[sq(nx, ny)] === by + 'P') return true;
    }
    for (i = 0; i < 8; i++) {
        nx = x + KNIGHT[i][0]; ny = y + KNIGHT[i][1];
        if (onBoard(nx, ny) && b[sq(nx, ny)] === by + 'N') return true;
        nx = x + KING[i][0]; ny = y + KING[i][1];
        if (onBoard(nx, ny) && b[sq(nx, ny)] === by + 'K') return true;
    }
    for (i = 0; i < 8; i++) {
        var d = i < 4 ? ROOK[i] : BISHOP[i - 4];
        var straight = i < 4;
        nx = x + d[0]; ny = y + d[1];
        while (onBoard(nx, ny)) {
            pc = b[sq(nx, ny)];
            if (pc) {
                if (pc.charAt(0) === by) {
                    var r = pc.charAt(1);
                    if (r === 'Q' || (straight ? r === 'R' : r === 'B')) return true;
                }
                break;
            }
            nx += d[0]; ny += d[1];
        }
    }
    return false;
}

// Псевдолегальные ходы одной фигуры: [{from,to,promo?,ep?}]
function pseudoFrom(p, from) {
    var pc = p.b[from];
    var color = pc.charAt(0);
    var role = pc.charAt(1);
    var x = X(from);
    var y = Y(from);
    var out = [];
    var i, nx, ny, t, tp;
    function push(to, extra) { out.push(Object.assign({ from: from, to: to }, extra || {})); }
    if (role === 'P') {
        var dir = color === 'w' ? 1 : -1;
        var startY = color === 'w' ? 1 : 6;
        var lastY = color === 'w' ? 7 : 0;
        ny = y + dir;
        if (onBoard(x, ny) && !p.b[sq(x, ny)]) {
            push(sq(x, ny), ny === lastY ? { promo: true } : null);
            if (y === startY && !p.b[sq(x, ny + dir)]) push(sq(x, ny + dir), { dbl: true });
        }
        for (i = -1; i <= 1; i += 2) {
            nx = x + i;
            if (!onBoard(nx, ny)) continue;
            t = sq(nx, ny);
            tp = p.b[t];
            if (tp && tp.charAt(0) !== color) push(t, ny === lastY ? { promo: true } : null);
            else if (!tp && p.ep === t) push(t, { ep: true });
        }
        return out;
    }
    if (role === 'N' || role === 'K') {
        var offs = role === 'N' ? KNIGHT : KING;
        for (i = 0; i < 8; i++) {
            nx = x + offs[i][0]; ny = y + offs[i][1];
            if (!onBoard(nx, ny)) continue;
            t = sq(nx, ny);
            tp = p.b[t];
            if (!tp || tp.charAt(0) !== color) push(t);
        }
        return out;
    }
    var dirs = role === 'R' ? ROOK : role === 'B' ? BISHOP : ROOK.concat(BISHOP);
    dirs.forEach(function (d) {
        nx = x + d[0]; ny = y + d[1];
        while (onBoard(nx, ny)) {
            t = sq(nx, ny);
            tp = p.b[t];
            if (!tp) push(t);
            else { if (tp.charAt(0) !== color) push(t); break; }
            nx += d[0]; ny += d[1];
        }
    });
    return out;
}

// Применить ход к копии позиции. Возвращает новую позицию (ход переходит к сопернику).
function applyMove(p, mv, promoRole) {
    var n = clonePos(p);
    var pc = n.b[mv.from];
    var color = pc.charAt(0);
    var role = pc.charAt(1);
    var captured = n.b[mv.to] || null;
    delete n.b[mv.from];
    n.ep = null;
    if (mv.ep) {
        var vsq = sq(X(mv.to), Y(mv.from));
        captured = n.b[vsq];
        delete n.b[vsq];
    }
    if (role === 'P' && mv.promo) role = promoRole || 'Q';
    n.b[mv.to] = color + role;
    if (mv.dbl) n.ep = sq(X(mv.from), (Y(mv.from) + Y(mv.to)) / 2);
    if (mv.castle) {
        var rank = Y(mv.from);
        if (X(mv.to) === 6) { delete n.b[sq(7, rank)]; n.b[sq(5, rank)] = color + 'R'; }
        else { delete n.b[sq(0, rank)]; n.b[sq(3, rank)] = color + 'R'; }
    }
    // права рокировки
    if (pc.charAt(1) === 'K') { if (color === 'w') { n.cast.K = n.cast.Q = false; } else { n.cast.k = n.cast.q = false; } }
    [['a1', 'Q'], ['h1', 'K'], ['a8', 'q'], ['h8', 'k']].forEach(function (c) {
        if (mv.from === c[0] || mv.to === c[0]) n.cast[c[1]] = false;
    });
    n.turn = opp(p.turn);
    n._captured = captured;
    return n;
}

function castlingMoves(p, color) {
    var out = [];
    var rank = color === 'w' ? 0 : 7;
    var e = sq(4, rank);
    if (p.b[e] !== color + 'K') return out;
    var them = opp(color);
    if (attackedBy(p.b, e, them)) return out;
    var kSide = color === 'w' ? p.cast.K : p.cast.k;
    var qSide = color === 'w' ? p.cast.Q : p.cast.q;
    if (kSide && p.b[sq(7, rank)] === color + 'R' && !p.b[sq(5, rank)] && !p.b[sq(6, rank)] &&
        !attackedBy(p.b, sq(5, rank), them) && !attackedBy(p.b, sq(6, rank), them)) {
        out.push({ from: e, to: sq(6, rank), castle: true });
    }
    if (qSide && p.b[sq(0, rank)] === color + 'R' && !p.b[sq(1, rank)] && !p.b[sq(2, rank)] && !p.b[sq(3, rank)] &&
        !attackedBy(p.b, sq(3, rank), them) && !attackedBy(p.b, sq(2, rank), them)) {
        out.push({ from: e, to: sq(2, rank), castle: true });
    }
    return out;
}

// Все ходы стороны p.turn. legal=true → шахматные правила (требует короля у ходящего).
function allMoves(p, legal) {
    var color = p.turn;
    var out = [];
    for (var s in p.b) {
        if (p.b[s].charAt(0) !== color) continue;
        pseudoFrom(p, s).forEach(function (m) { out.push(m); });
    }
    if (!legal) return out;
    castlingMoves(p, color).forEach(function (m) { out.push(m); });
    return out.filter(function (m) {
        var n = applyMove(p, m);
        var k = kingSq(n.b, color);
        return !k || !attackedBy(n.b, k, opp(color));
    });
}

function movesFor(p, illegal) {
    var hasKing = !!kingSq(p.b, p.turn);
    return allMoves(p, hasKing && !illegal);
}

function isCheck(p) {
    var k = kingSq(p.b, p.turn);
    return !!k && attackedBy(p.b, k, opp(p.turn));
}

// «Обычный» мат стороны p.turn (defaultChessMate в lila).
function isMate(p) {
    return isCheck(p) && allMoves(p, true).length === 0;
}

export function destsMap(p, illegal) {
    var d = {};
    movesFor(p, illegal).forEach(function (m) {
        if (!d[m.from]) d[m.from] = [];
        if (d[m.from].indexOf(m.to) < 0) d[m.from].push(m.to);
    });
    return d;
}

// ---------------------------------------------------------------------------
// Правила успеха/провала (JSON-дескрипторы из assert.ts, см. tools/fetch-lichess-learn.mjs)
// ---------------------------------------------------------------------------
function evalRule(r, ctx) {
    if (!r) return false;
    var p = ctx.pos;
    switch (r.t) {
        case 'pieceOn': return p.b[r.sq] === (r.piece === r.piece.toUpperCase() ? 'w' : 'b') + r.piece.toUpperCase();
        case 'pieceNotOn': return p.b[r.sq] !== (r.piece === r.piece.toUpperCase() ? 'w' : 'b') + r.piece.toUpperCase();
        case 'pieceOutside': return Object.keys(p.b).some(function (s) { return r.keys.indexOf(s) < 0; });
        case 'whitePawnOnAnyOf': return r.keys.some(function (s) { return p.b[s] === 'wP'; });
        case 'extinct': {
            // «вымерла» сторона r.color: на доске не осталось её фигур
            var gone = r.color === 'white' ? 'w' : 'b';
            return Object.keys(p.b).every(function (s) { return p.b[s].charAt(0) !== gone; });
        }
        case 'check': return isCheck(p);
        case 'mate': return isMate(p);
        case 'lastMoveSan': return ctx.history[ctx.history.length - 1] === r.san;
        case 'checkIn': return ctx.nbMoves <= r.n && isCheck(p);
        case 'noCheckIn': return ctx.nbMoves >= r.n && !isCheck(p);
        case 'not': return !evalRule(r.a, ctx);
        case 'and': return r.a.every(function (x) { return evalRule(x, ctx); });
        case 'or': return r.a.some(function (x) { return evalRule(x, ctx); });
        case 'scenarioComplete': return ctx.scenario.isComplete();
        case 'scenarioFailed': return ctx.scenario.isFailed();
        default: throw new Error('lichess-learn: неизвестное правило «' + r.t + '» — обновите движок');
    }
}

// ---------------------------------------------------------------------------
// Ранги/звёзды (score.ts)
// ---------------------------------------------------------------------------
function levelBonus(bp, nbMoves) {
    var late = nbMoves - bp.nbMoves;
    return late <= 0 ? LEVEL_BONUS[1] : late <= Math.max(1, bp.nbMoves / 8) ? LEVEL_BONUS[2] : LEVEL_BONUS[3];
}
export function levelMaxScore(bp) {
    return bp.apples.length * SCORE_APPLE + (bp.pointsForCapture ? (bp.captures || 0) * SCORE_CAPTURE : 0) + LEVEL_BONUS[1];
}
// 1 — отлично, 2 — хорошо, 3 — зачтено
export function levelRank(bp, score) {
    var max = levelMaxScore(bp);
    return score >= max ? 1 : score >= max - 200 ? 2 : 3;
}
export function stageRank(stage, scores) {
    var max = stage.levels.reduce(function (s, l) { return s + levelMaxScore(l); }, 0);
    var sum = scores.reduce(function (a, b) { return a + b; }, 0);
    return sum >= max ? 1 : sum >= max - Math.max(200, stage.levels.length * 150) ? 2 : 3;
}

// ---------------------------------------------------------------------------
// Уровень
// ---------------------------------------------------------------------------
function arrowShape(from, to, brush) { return { brush: brush, orig: from, dest: to }; }

export function createLevel(bp) {
    var pos = parseFen(bp.fen);
    var player = colorChar(bp.color);
    var apples = (bp.apples || []).slice();
    if (!bp.emptyApples) apples.forEach(function (s) { pos.b[s] = opp(pos.turn) + 'P'; });
    var history = [];
    var vm = { score: 0, nbMoves: 0, completed: false, failed: false, willComplete: false };
    var lastMove = null;

    // --- сценарий (scenario.ts) ---
    var steps = (bp.scenario || []).map(function (s) { return typeof s === 'string' ? { move: s, shapes: [] } : s; });
    var it = 0;
    var scFailed = false;
    var scenario = {
        isComplete: function () { return it === steps.length; },
        isFailed: function () { return scFailed; },
    };

    function playRaw(from, to, promoChar) {
        var pc = pos.b[from];
        var role = pc ? pc.charAt(1) : null;
        // ищем ход среди псевдолегальных + рокировка (самошах проверяется ниже, как в lila)
        var mv = null;
        var cand = allMoves(pos, false).concat(role === 'K' ? castlingMoves(pos, pos.turn) : []);
        for (var i = 0; i < cand.length; i++) if (cand[i].from === from && cand[i].to === to) { mv = cand[i]; break; }
        if (!mv) return null;
        var promoRole = promoChar ? promoChar.toUpperCase() : null;
        var n = applyMove(pos, mv, promoRole);
        var movedColor = pos.turn;
        var san = mv.castle ? (X(to) === 6 ? 'O-O' : 'O-O-O') : from + to + (promoRole ? promoRole.toLowerCase() : '');
        var capRole = n._captured ? n._captured.charAt(1) : null;
        delete n._captured;
        pos = n; // как pos.play() в lila: состояние меняется даже если ход оказался самошахом
        history.push(san);
        lastMove = { from: from, to: to };
        var k = kingSq(pos.b, movedColor);
        var selfCheck = !!k && attackedBy(pos.b, k, opp(movedColor));
        return { from: from, to: to, promotion: promoRole ? promoRole.toLowerCase() : undefined, san: san, capRole: capRole, selfCheck: selfCheck, color: movedColor, uci: from + to + (promoRole && mv.promo ? promoRole.toLowerCase() : '') };
    }

    // Захваты стороны pos.turn
    function captures(p) {
        return movesFor(p, false).filter(function (m) { return p.b[m.to]; });
    }
    function findCapture() {
        var c = captures(pos);
        return c.length ? { orig: c[0].from, dest: c[0].to } : null;
    }
    function findUnprotectedCapture() {
        var c = captures(pos).filter(function (cap) {
            var n = applyMove(pos, cap);
            return !captures(n).some(function (m) { return m.to === cap.to; });
        });
        return c.length ? { orig: c[0].from, dest: c[0].to } : null;
    }
    function checkArrows() {
        // жёлтые стрелки от шахующих фигур на короля стороны pos.turn
        if (!isCheck(pos)) return null;
        var k = kingSq(pos.b, pos.turn);
        var attackers = [];
        var saved = pos.turn;
        pos.turn = opp(saved);
        allMoves(pos, false).forEach(function (m) { if (m.to === k) attackers.push(arrowShape(m.from, m.to, 'yellow')); });
        pos.turn = saved;
        return attackers.length ? attackers : null;
    }
    function selfCheckArrows(movedColor) {
        var k = kingSq(pos.b, movedColor);
        var saved = pos.turn;
        pos.turn = opp(movedColor);
        var out = [];
        allMoves(pos, false).forEach(function (m) { if (m.to === k) out.push(arrowShape(m.from, m.to, 'red')); });
        pos.turn = saved;
        return out;
    }
    function ctx() { return { pos: pos, history: history, nbMoves: vm.nbMoves, scenario: scenario }; }

    var api = {
        blueprint: bp,
        vm: vm,
        get pos() { return pos; },
        get lastMove() { return lastMove; },
        get apples() { return apples.slice(); },
        get playerColor() { return player; },
        get fen() { return boardFen(pos); },
        isAppleLevel: apples.length > 0,

        // Нужно ли, чтобы ходил соперник первым (через ~1 с вызвать opponentMove()).
        needsOpponentFirst: function () { return pos.turn !== player; },

        dests: function () { return destsMap(pos, !!bp.offerIllegalMove); },
        isCheck: function () { return isCheck(pos); },
        kingSquareInCheck: function () { return isCheck(pos) ? kingSq(pos.b, pos.turn) : null; },
        // Дойдёт ли пешка с from на to до последней горизонтали (нужно меню превращения).
        isPromotionMove: function (from, to) {
            var pc = pos.b[from];
            return !!pc && pc.charAt(1) === 'P' && (Y(to) === (pc.charAt(0) === 'w' ? 7 : 0));
        },

        playerMove: function (from, to, promoChar) {
            var res = { ok: true, status: 'playing', inScenario: false, failure: null, followUp: false, scoreDelta: 0,
                tookApple: false, tookPiece: null, check: null, clearShapes: false, scenarioShapes: null, captured: null };
            vm.nbMoves++;
            var before = vm.score;
            var mv = playRaw(from, to, promoChar);
            if (!mv) { vm.nbMoves--; res.ok = false; res.status = 'playing'; return res; }
            res.move = mv;
            res.captured = mv.capRole;
            if (mv.selfCheck) {
                vm.failed = true;
                res.status = 'failed';
                res.failure = { kind: 'selfcheck', shapes: selfCheckArrows(mv.color), kingSquare: kingSq(pos.b, mv.color) };
                return res;
            }
            var took = false;
            var ai = apples.indexOf(to);
            if (ai >= 0) { apples.splice(ai, 1); vm.score += SCORE_APPLE; took = true; res.tookApple = true; }
            if (!took && mv.capRole && bp.pointsForCapture && mv.capRole !== 'K') {
                vm.score += bp.showPieceValues ? PIECE_VALUE[mv.capRole] : SCORE_CAPTURE;
                took = true; res.tookPiece = mv.capRole;
            }
            res.check = checkArrows();
            // сценарий
            var step = steps[it];
            var inScenario = false;
            if (step) {
                if (step.move !== mv.uci && step.move !== from + to) { scFailed = true; }
                else { it++; inScenario = true; vm.score += SCORE_SCENARIO; res.scenarioShapes = step.shapes || []; }
            }
            var captured = false;
            if (!inScenario) {
                if (bp.detectCapture) {
                    var c = bp.detectCapture === 'unprotected' ? findUnprotectedCapture() : findCapture();
                    if (c) { captured = true; vm.failed = true; res.failure = { kind: 'capture', capture: c }; }
                }
                if (!captured && bp.failure && evalRule(bp.failure, ctx())) { vm.failed = true; res.failure = { kind: 'rule' }; }
            }
            res.inScenario = inScenario;
            if (api.isAppleLevel) res.clearShapes = true;
            if (!vm.failed) {
                var ok = bp.success ? evalRule(bp.success, ctx()) : apples.length === 0;
                if (ok) {
                    vm.willComplete = true;
                    vm.score += levelBonus(bp, vm.nbMoves);
                    vm.completed = true;
                    res.status = 'completed';
                }
            }
            if (vm.failed) {
                res.status = 'failed';
                if (bp.showFailureFollowUp && !captured) res.followUp = true;
            } else if (!inScenario && res.status !== 'completed') {
                // вернуть ход игроку (как chess.setColor(blueprint.color) в lila)
                if (pos.turn !== player) pos.ep = null;
                pos.turn = player;
            }
            res.scoreDelta = vm.score - before;
            return res;
        },

        // Ход соперника по сценарию. null — ходить нечем.
        opponentMove: function () {
            var step = steps[it];
            if (!step) return null;
            var from = step.move.slice(0, 2);
            var to = step.move.slice(2, 4);
            var mv = playRaw(from, to, step.move.slice(4, 5) || undefined);
            if (!mv) { scFailed = true; return null; }
            it++;
            return { from: from, to: to, move: mv, shapes: step.shapes || [], check: checkArrows() };
        },

        // Случайный ход после проигрыша (showFailureFollowUp)
        playFollowUp: function () {
            var all = movesFor(pos, false);
            if (!all.length) return null;
            var m = all[Math.floor(Math.random() * all.length)];
            var mv = playRaw(m.from, m.to, m.promo ? 'q' : undefined);
            return mv ? { from: m.from, to: m.to } : null;
        },

        // Показ мата/шаха в конце
        isMate: function () { return isMate(pos); },
        rank: function () { return levelRank(bp, vm.score); },
    };
    return api;
}
