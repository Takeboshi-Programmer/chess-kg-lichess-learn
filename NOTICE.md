# NOTICE — origin of materials, licenses, changes

This repository contains materials derived from the **Lichess** project (source code:
[lichess-org/lila](https://github.com/lichess-org/lila)) and has been **modified** relative to the original.

| | |
|---|---|
| Source | https://github.com/lichess-org/lila |
| Source version (commit) | [`a5780c24c1c77234d62e82c936043da6bb8a3e3e`](https://github.com/lichess-org/lila/tree/a5780c24c1c77234d62e82c936043da6bb8a3e3e) of 30 Oct 2026 |
| Date obtained and modified | **30 October 2026** |
| lila license | GNU Affero General Public License v3.0 or later (file `LICENSE`) |
| lila copyright | © 2012–2026 the lila authors ([list of authors](https://github.com/lichess-org/lila/graphs/contributors)) |
| lila license exceptions | [`COPYING.md`](https://github.com/lichess-org/lila/blob/a5780c24c1c77234d62e82c936043da6bb8a3e3e/COPYING.md) |

## What was changed ("Modified")

1. **`data/lichess-learn-data.json`** — derived from `ui/learn/src/stage/*.ts` (stages and levels)
   and `translation/` (`ru` and `en` texts). Changes: the TypeScript stage code was executed and serialised to JSON;
   the `success` / `failure` check functions were replaced with declarative rules (`{"t":"mate"}`, `{"t":"and",…}`);
   a `source` field naming the source and noting the modification was added; icon file names were flattened
   (`pieces/R.svg` → `pieces-R.svg`). Level content (positions, arrows, number of moves) and texts were not edited.
2. **`tools/fetch-lichess-learn.mjs`** — the script that performs this conversion. It contains stubs of Lichess helper
   modules (`util`, `assert`) and is therefore distributed under AGPL-3.0-or-later.
3. **`js/lichess-learn-engine.js`** — a JavaScript port of the level logic from `ui/learn/src/{chess,levelCtrl,scenario,score,assert}.ts`
   (move rules without chess.js, "apples", opponent scenarios, scoring). Changes: ported from TypeScript to JavaScript, declarative
   `success`/`failure` rules from JSON instead of functions, simplifications (see below). Distributed under AGPL-3.0-or-later.
4. **`js/lichess-learn.js`** — the lesson UI (stage menu, intro, levels with hint arrows, stage summary), modelled on `ui/learn`;
   it uses the Lichess texts and translation keys from the data file. Distributed under AGPL-3.0-or-later.
5. **`images/learn/*.svg`** — copied **unchanged** from `public/images/learn/` in the lila repository (Lichess has already
   converted the game-icons.net icons there to a white fill and transparent background — see `bin/svg-fix` in lila).

Behavioural differences from the original Lichess: no Lichess sounds or animations (smooth movement is a CSS animation); the
`no-go-home` stage class is not used; `lastMoveSan` only compares castling; all 110 levels can be solved in the number of
moves set by Lichess.

## Licenses by file

| Files | Author(s) | License |
|---|---|---|
| `data/lichess-learn-data.json` | the lila authors and Lichess translation contributors | AGPL-3.0-or-later (`LICENSE`) |
| `tools/fetch-lichess-learn.mjs` | chess.kg, based on lila | AGPL-3.0-or-later (`LICENSE`) |
| `js/lichess-learn-engine.js`, `js/lichess-learn.js` | chess.kg, based on lila (`ui/learn`) | AGPL-3.0-or-later (`LICENSE`) |
| `images/learn/pieces-{P,N,B,R,Q,K}.svg` | Thibault Duplessis and [Colin M.L. Burnett](https://en.wikipedia.org/wiki/User:Cburnett) | GPL-2.0-or-later (`licenses/GPL-2.0.txt`) |
| `images/learn/*.svg` — the other 12 (table below) | see table | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |

### Stage icons — game-icons.net (CC BY 3.0)

The icons come from [game-icons.net](https://game-icons.net) and are distributed under the
[Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/) license. *Icons made by Lorc and Delapouite.*

| File | Author | Icon page |
|---|---|---|
| `battle-gear.svg` | Lorc | https://game-icons.net/1x1/lorc/battle-gear.html |
| `bolt-shield.svg` | Lorc | https://game-icons.net/1x1/lorc/bolt-shield.html |
| `bowman.svg` | Lorc | https://game-icons.net/1x1/lorc/bowman.html |
| `crossed-swords.svg` | Lorc | https://game-icons.net/1x1/lorc/crossed-swords.html |
| `guillotine.svg` | Lorc | https://game-icons.net/1x1/lorc/guillotine.html |
| `rally-the-troops.svg` | Lorc | https://game-icons.net/1x1/lorc/rally-the-troops.html |
| `scales.svg` | Lorc | https://game-icons.net/1x1/lorc/scales.html |
| `spinning-blades.svg` | Lorc | https://game-icons.net/1x1/lorc/spinning-blades.html |
| `sprint.svg` | Lorc | https://game-icons.net/1x1/lorc/sprint.html |
| `winged-sword.svg` | Lorc | https://game-icons.net/1x1/lorc/winged-sword.html |
| `castle.svg` | Delapouite | https://game-icons.net/1x1/delapouite/castle.html |
| `guards.svg` | Delapouite | https://game-icons.net/1x1/delapouite/guards.html |

Authorship was established by comparison with the official [game-icons/icons](https://github.com/game-icons/icons)
archive (each file was found in the author's directory and the geometry matches; Lichess's copy of `rally-the-troops.svg`
is a slightly older revision of the same Lorc icon). Lichess's `COPYING.md` explicitly names game-icons.net as the source
of the icons in neighbouring sections (`practice`, `puzzle-themes`), and its `bin/svg-fix` script treats `public/images/learn/`
as "game-icons SVGs".
