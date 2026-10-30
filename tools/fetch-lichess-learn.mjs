#!/usr/bin/env node
// tools/fetch-lichess-learn.mjs
//
// Copyright (C) chess.kg authors. Файл содержит заглушки и фрагменты логики, согласованные
// с исходным кодом Lichess (lila, https://github.com/lichess-org/lila), поэтому распространяется
// на условиях GNU AGPL-3.0-or-later (см. LICENSE в корне репозитория).
// Изменено относительно оригиналов Lichess: данные преобразуются в JSON-формат chess.kg (см. NOTICE.md).
//
// Вытягивает уроки https://lichess.org/learn в формат chess.kg.
//
// ВАЖНО: у Lichess НЕТ API для раздела «Learn» (api.lichess.org его не отдаёт).
// Уроки — это исходный код фронтенда lila (ui/learn/src/stage/*.ts, AGPL-3.0),
// а тексты — переводы translation/dest/learn/<lang>.xml. Поэтому скрипт берёт
// их с raw.githubusercontent.com (то же, что видит браузер на lichess.org/learn):
//
//   1. скачивает stage/list.ts и все stage/*.ts, которые он импортирует
//      (список этапов НЕ зашит в скрипт — если Lichess добавит этап, подтянется сам);
//   2. собирает их esbuild-ом с заглушками util/assert и исполняет в vm:
//      получает те же объекты уровней, что строит Lichess;
//      функции success/failure превращаются в JSON-«правила» ({t:'mate'}, {t:'and',a:[…]} …),
//      которые исполняет движок lichess-learn-engine.js;
//   3. скачивает переводы (по умолчанию ru, en) и картинки этапов (SVG);
//   4. пишет data/lichess-learn-data.json (отдаётся сайтом отдельным запросом, не в бандле).
//
// Запуск (из корня репозитория, Node ≥ 18, нужен esbuild — `npm install`):
//   node tools/fetch-lichess-learn.mjs
//   node tools/fetch-lichess-learn.mjs --ref=<sha-или-тег>   # зафиксировать версию
//   node tools/fetch-lichess-learn.mjs --langs=ru,en,de
//   node tools/fetch-lichess-learn.mjs --no-images
// Опционально GITHUB_TOKEN в окружении — только чтобы узнать SHA коммита (не обязателен).
//
// Запускается РАЗРАБОТЧИКОМ при обновлении контента, а не на устройстве
// пользователя: результат коммитится в репозиторий (CSP/офлайн/стабильность).
// Для воспроизводимости ВСЕГДА фиксируйте версию: --ref=<полный SHA коммита lila>.
// Переменная LILA_RAW (необязательно) — база URL зеркала/локальной копии lila вместо raw.githubusercontent.com.

import { build } from 'esbuild';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); // корень репозитория
const args = Object.fromEntries(
    process.argv.slice(2).map(function (a) {
        var m = a.match(/^--([^=]+)(?:=(.*))?$/);
        return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
    })
);
const REF = String(args.ref || 'master');
const LANGS = String(args.langs || 'ru,en').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
const OUT_DATA = path.resolve(ROOT, String(args.out || 'data/lichess-learn-data.json'));
const RAW = process.env.LILA_RAW || ('https://raw.githubusercontent.com/lichess-org/lila/' + REF);

// Коды языков Lichess в translation/dest/learn/*.xml (в репо — «ru-RU», «ky-KG», …).
// Для остальных можно передать полный код: --langs=ru-RU,en-GB
const LANG_FILES = { ru: 'ru-RU', ky: 'ky-KG', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', tr: 'tr-TR', uk: 'uk-UA', kk: 'kk-KZ', uz: 'uz-UZ' };

// ---------------------------------------------------------------------------
// Сеть
// ---------------------------------------------------------------------------
async function get(url, tries) {
    tries = tries || 3;
    for (var i = 1; ; i++) {
        try {
            var r = await fetch(url, { headers: { 'user-agent': 'chess.kg-learn-importer' } });
            if (r.status === 404) return null;
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return Buffer.from(await r.arrayBuffer());
        } catch (e) {
            if (i >= tries) throw new Error(url + ': ' + e.message);
            await new Promise(function (ok) { setTimeout(ok, 500 * i); });
        }
    }
}
async function getText(url) {
    var b = await get(url);
    return b ? b.toString('utf8') : null;
}

// ---------------------------------------------------------------------------
// Заглушки, которые подставляются вместо ui/learn/src/util.ts и assert.ts
// ---------------------------------------------------------------------------
const UTIL_STUB = `
export const assetUrl = '@asset/';
export const fenColor = (fen) => (fen.split(' ')[1] === 'b' ? 'black' : 'white');
// копия toLevel из lila (в т.ч. дописывание ' 0 1' к 4-польным FEN)
export function toLevel(l, it) {
  if (l.fen.split(' ').length === 4) l.fen += ' 0 1';
  return { id: it + 1, apples: [], color: fenColor(l.fen), detectCapture: l.apples ? false : 'unprotected', ...l };
}
export const arrow = (vector, brush) => ({ brush: brush || 'paleGreen', orig: vector.slice(0, 2), dest: vector.slice(2, 4) });
export const circle = (key, brush) => ({ brush: brush || 'green', orig: key });
export const readKeys = (keys) => (typeof keys === 'string' ? keys.split(' ') : keys);
export const pieceImg = (role) => ({ piece: role });
export const roundSvg = (url) => ({ svg: url });
`;

const ASSERT_STUB = `
import { readKeys } from './util';
const R = (t, extra) => Object.assign({ t }, extra);
export const pieceOn = (piece, sq) => R('pieceOn', { piece, sq });
export const pieceNotOn = (piece, sq) => R('pieceNotOn', { piece, sq });
// В lila «noPieceOn(keys)» истинно, если на доске есть фигура ВНЕ списка keys.
export const noPieceOn = (keys) => R('pieceOutside', { keys: readKeys(keys) });
export const whitePawnOnAnyOf = (keys) => R('whitePawnOnAnyOf', { keys: readKeys(keys) });
export const extinct = (color) => R('extinct', { color });
export const check = R('check');
export const mate = R('mate');
export const lastMoveSan = (san) => R('lastMoveSan', { san });
export const checkIn = (n) => R('checkIn', { n });
export const noCheckIn = (n) => R('noCheckIn', { n });
export const not = (a) => R('not', { a });
export const and = (...a) => R('and', { a });
export const or = (...a) => R('or', { a });
export const scenarioComplete = R('scenarioComplete');
export const scenarioFailed = R('scenarioFailed');
`;

// ---------------------------------------------------------------------------
// Переводы: Android-XML Lichess → { key: text }
// ---------------------------------------------------------------------------
function parseStringsXml(xml) {
    var out = {};
    var re = /<string name="([^"]+)">([\s\S]*?)<\/string>/g;
    var m;
    while ((m = re.exec(xml))) {
        out[m[1]] = m[2]
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
            .replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\"/g, '"');
    }
    return out;
}

// ---------------------------------------------------------------------------
async function main() {
    var cache = await fs.mkdtemp(path.join(os.tmpdir(), 'lila-learn-'));
    await fs.mkdir(path.join(cache, 'stage'), { recursive: true });

    // 1. list.ts + файлы этапов
    console.log('== 1. Исходники этапов (' + REF + ') ==');
    var listSrc = await getText(RAW + '/ui/learn/src/stage/list.ts');
    if (!listSrc) throw new Error('Не найден ui/learn/src/stage/list.ts — Lichess поменял структуру репозитория, скрипт нужно обновить.');
    await fs.writeFile(path.join(cache, 'stage', 'list.ts'), listSrc);
    var names = [];
    listSrc.replace(/^import\s+\w+\s+from\s+'\.\/(\w+)';/gm, function (_, n) { names.push(n); return ''; });
    if (!names.length) throw new Error('В list.ts не найдено ни одного импорта этапа.');
    for (var n of names) {
        var src = await getText(RAW + '/ui/learn/src/stage/' + n + '.ts');
        if (!src) throw new Error('Нет файла этапа ' + n + '.ts');
        await fs.writeFile(path.join(cache, 'stage', n + '.ts'), src);
        process.stdout.write('  ' + n);
    }
    console.log('\n  файлов этапов: ' + names.length);

    // 2. Сборка и выполнение
    console.log('== 2. Сборка (esbuild) и выполнение ==');
    var res = await build({
        entryPoints: [path.join(cache, 'stage', 'list.ts')],
        bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
        plugins: [{
            name: 'lila-stubs',
            setup: function (b) {
                b.onResolve({ filter: /^\.\.\/(util|assert)$/ }, function (a) { return { path: a.path.slice(3), namespace: 'stub' }; });
                b.onResolve({ filter: /^\.\/util$/ }, function () { return { path: 'util', namespace: 'stub' }; });
                b.onLoad({ filter: /.*/, namespace: 'stub' }, function (a) {
                    return { contents: a.path === 'util' ? UTIL_STUB : ASSERT_STUB, loader: 'js', resolveDir: cache };
                });
            },
        }],
    });
    var code = res.outputFiles[0].text;
    var learn = new Proxy({}, { get: function (_, k) { return typeof k === 'string' ? '@@' + k : undefined; } });
    var mod = { exports: {} };
    vm.runInNewContext(code, { module: mod, exports: mod.exports, i18n: { learn: learn }, console: console });
    var categs = mod.exports.categs;
    if (!Array.isArray(categs) || !categs.length) throw new Error('list.ts не вернул categs');

    // 3. Нормализация в чистый JSON
    var usedKeys = new Set();
    var assets = new Set();
    var assetMap = {};
    function key(v) {
        if (typeof v !== 'string') return v;
        if (v.startsWith('@@')) { usedKeys.add(v.slice(2)); return v.slice(2); }
        return v;
    }
    function asset(v) {
        if (typeof v !== 'string' || !v.startsWith('@asset/')) return v;
        var rel = v.slice('@asset/'.length); // images/learn/pieces/R.svg
        var flat = rel.replace(/^images\/learn\//, '').replace(/\//g, '-'); // pieces-R.svg — всё в одной папке
        assets.add(rel);
        assetMap[rel] = flat;
        return flat;
    }
    function normLevel(l) {
        var o = {
            id: l.id, goal: key(l.goal), fen: l.fen, color: l.color, nbMoves: l.nbMoves,
            apples: Array.isArray(l.apples) ? l.apples : String(l.apples || '').split(' ').filter(Boolean),
            detectCapture: l.detectCapture,
        };
        ['shapes', 'scenario', 'success', 'failure', 'captures', 'cssClass', 'autoCastle', 'emptyApples',
            'explainPromotion', 'nextButton', 'offerIllegalMove', 'pointsForCapture', 'showPieceValues',
            'showFailureFollowUp'].forEach(function (k) { if (l[k] !== undefined) o[k] = l[k]; });
        return o;
    }
    var data = {
        source: {
            repo: 'lichess-org/lila', path: 'ui/learn/src/stage', ref: REF, license: 'AGPL-3.0-or-later',
            url: 'https://github.com/lichess-org/lila/tree/' + REF + '/ui/learn/src/stage', fetchedAt: new Date().toISOString(),
            translations: 'https://github.com/lichess-org/lila/tree/' + REF + '/translation',
            modified: true,
            modifications: 'Уровни Lichess Learn (ui/learn/src/stage/*.ts) исполнены и преобразованы в JSON; функции success/failure заменены декларативными правилами; тексты взяты из translation/*.xml; имена файлов иконок «сплющены» (pieces/R.svg → pieces-R.svg).',
            noticeUrl: 'NOTICE.md',
        },
        categories: categs.map(function (c) {
            return {
                key: c.key, name: key(c.name),
                stages: c.stages.map(function (s) {
                    var ill = s.illustration || {};
                    if (ill.svg) ill = { svg: asset(ill.svg) };
                    return {
                        id: s.id, key: s.key, title: key(s.title), subtitle: key(s.subtitle), intro: key(s.intro),
                        complete: key(s.complete), image: asset(s.image), illustration: ill,
                        cssClass: s.cssClass || undefined, levels: s.levels.map(normLevel),
                    };
                }),
            };
        }),
        messages: {},
    };
    // Проверка: в данных не должно остаться функций (значит, заглушка assert не покрывает новый хелпер).
    var json = JSON.stringify(data, function (k, v) {
        if (typeof v === 'function') throw new Error('Функция в данных (' + k + ') — заглушка assert не покрывает новый хелпер Lichess.');
        return v;
    });
    data = JSON.parse(json);

    // 4. Переводы
    console.log('== 3. Переводы: ' + LANGS.join(', ') + ' ==');
    for (var lang of LANGS) {
        var file = LANG_FILES[lang] || lang;
        var url = lang === 'en' ? RAW + '/translation/source/learn.xml' : RAW + '/translation/dest/learn/' + file + '.xml';
        var xml = await getText(url);
        if (!xml) { console.warn('  [!] ' + lang + ': файл не найден (' + url + ')'); continue; }
        var all = parseStringsXml(xml);
        if (!Object.keys(all).length) { console.warn('  [!] ' + lang + ': у Lichess перевод пуст — язык пропущен (свой перевод можно подключить через setMessages).'); continue; }
        data.messages[lang] = all;
        var missing = Array.from(usedKeys).filter(function (k) { return !(k in all); });
        console.log('  ' + lang + ': ' + Object.keys(all).length + ' строк' + (missing.length ? ', нет перевода для ' + missing.length + ': ' + missing.slice(0, 5).join(', ') : ''));
    }
    if (!data.messages.en) console.warn('  [!] нет en — запасного языка не будет');

    // 5. Картинки
    if (!args['no-images']) {
        console.log('== 4. Картинки (' + assets.size + ') ==');
        for (var rel of assets) {
            var buf = await get(RAW + '/public/' + rel);
            if (!buf) { console.warn('  [!] нет ' + rel); continue; }
            var dst = path.join(ROOT, 'images/learn', assetMap[rel]);
            await fs.mkdir(path.dirname(dst), { recursive: true });
            await fs.writeFile(dst, buf);
        }
        console.log('  → images/learn/');
    }

    // 6. SHA коммита (для воспроизводимости; не критично)
    try {
        var h = { 'user-agent': 'chess.kg-learn-importer' };
        if (process.env.GITHUB_TOKEN) h.authorization = 'Bearer ' + process.env.GITHUB_TOKEN;
        var r = await fetch('https://api.github.com/repos/lichess-org/lila/commits/' + encodeURIComponent(REF), { headers: h });
        if (r.ok) data.source.commit = (await r.json()).sha;
    } catch (e) { /* без SHA тоже работает */ }
    if (!data.source.commit && /^[0-9a-f]{40}$/i.test(REF)) data.source.commit = REF.toLowerCase();
    if (!data.source.commit) console.warn('  [!] SHA коммита не определён — запустите с --ref=<полный SHA> для воспроизводимости');

    // 7. Запись
    await fs.mkdir(path.dirname(OUT_DATA), { recursive: true });
    await fs.writeFile(OUT_DATA, JSON.stringify(data) + '\n');
    var stages = data.categories.reduce(function (n, c) { return n + c.stages.length; }, 0);
    var levels = data.categories.reduce(function (n, c) { return n + c.stages.reduce(function (m, s) { return m + s.levels.length; }, 0); }, 0);
    console.log('\nГотово: ' + stages + ' этапов, ' + levels + ' уровней → ' + path.relative(ROOT, OUT_DATA).replace(/\\/g, '/'));
    await fs.rm(cache, { recursive: true, force: true });
}

main().catch(function (e) { console.error('\nОШИБКА: ' + e.message); process.exit(1); });
