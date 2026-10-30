# chess-kg-lichess-learn

Materials from **Lichess** used by the "Learn by playing" section of chess.kg: data for 18 stages / 110 levels
(Lichess Learn), stage icons, the **lesson engine and UI**, and the script used to fetch the data. Everything taken
from Lichess is published here under the **GNU AGPL-3.0-or-later**.

> **Modified** relative to the original — 30 October 2026.
> Source: [lichess-org/lila @ `a5780c2`](https://github.com/lichess-org/lila/tree/a5780c24c1c77234d62e82c936043da6bb8a3e3e)
> (`ui/learn/src/stage` and `translation`). See [`NOTICE.md`](NOTICE.md) for details.

## Contents

```
data/lichess-learn-data.json     stages, levels, texts (ru, en) — AGPL-3.0-or-later
js/lichess-learn-engine.js       level engine (port of ui/learn from lila) — AGPL-3.0-or-later
js/lichess-learn.js              lesson UI (menu, levels, results) — AGPL-3.0-or-later
images/learn/*.svg               stage icons — CC BY 3.0 (game-icons.net) and GPL-2.0-or-later (pieces)
tools/fetch-lichess-learn.mjs    script that downloads and converts the Lichess sources
licenses/GPL-2.0.txt             GPL-2.0 text (for the cburnett pieces)
LICENSE                          AGPL-3.0 text
NOTICE.md                        source, date, list of changes, icon authors
```

## Licenses

| What | License |
|---|---|
| Data, lesson engine and UI (`js/`), script | [AGPL-3.0-or-later](LICENSE) |
| `images/learn/pieces-*.svg` (Thibault Duplessis, Colin M.L. Burnett) | [GPL-2.0-or-later](licenses/GPL-2.0.txt) |
| The other 12 icons (Lorc, Delapouite — game-icons.net) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) — **attribution required** |

The file → author table is in [`NOTICE.md`](NOTICE.md).

## How chess.kg uses it

The chess.kg site serves the files of this repository as they are: `/open/lichess-learn/data/…`,
`/open/lichess-learn/images/learn/…`, `/open/lichess-learn/js/…`. The data is loaded with a separate HTTP request
(`fetch`). The rest of the chess.kg application is not part of this repository; it mounts the module like this:

```js
import('/open/lichess-learn/js/lichess-learn.js').then(function (m) {
    var learn = m.mountLichessLearn(document.getElementById('lichess-learn-root'), {
        lang: 'en',                                                  // 'ru' | 'en'
        baseUrl: '/open/lichess-learn/images/learn/',                // stage icons
        dataUrl: '/open/lichess-learn/data/lichess-learn-data.json', // data file
        pieceUrl: function (code) { return '/pieces/' + code + '.svg'; },
        onProgress: function (p) { /* save progress */ },
        sound: function (name) { /* 'move'|'capture'|'fail'|'start'|'win' */ },
    });
    // call learn.destroy() when leaving the section
});
```

Progress is stored in `localStorage` by default (`chessKgLichessLearn.v1`). The site's "Licenses" page
(`/legal/licenses.html`) links to this repository.

## Updating the data

```bash
npm install
node tools/fetch-lichess-learn.mjs --ref=<full lila commit SHA>   # always pin the version
node tools/fetch-lichess-learn.mjs --ref=<sha> --langs=ru,en
```

After updating, change the date and SHA in this README and in `NOTICE.md`, then copy `data/`, `images/` and `js/` to
`public/open/lichess-learn/` in the chess.kg project.

## Summary

This repository contains data (Lichess Learn stages and levels, `ru`/`en` texts), stage icons, the lesson engine and UI
(`js/`), and the fetch script, all derived from [lichess-org/lila](https://github.com/lichess-org/lila)
(commit `a5780c24c1c77234d62e82c936043da6bb8a3e3e`) and **modified on 2026-10-30** (TypeScript level definitions were
executed and serialised to JSON; see `NOTICE.md`). Licensed under AGPL-3.0-or-later; chess piece icons under
GPL-2.0-or-later (Colin M.L. Burnett, Thibault Duplessis); 12 stage icons under CC BY 3.0 (game-icons.net — Lorc,
Delapouite). The rest of the chess.kg application is not part of this repository.
