# Diagram preview harness

Renders every diagram `repo-wiki` draws, through the **real** client bundle, and
measures the result for the defects that make diagrams look broken: edges cutting
across text, labels clipped by their box, arrows that miss the box they point at,
and diagrams too wide to read in the panel they live in.

This exists because mermaid diagrams in the Wiki are drawn by a hand-written
renderer inside `lib/client.js`, and a renderer that is wrong is wrong
*silently* — the SVG is valid, it just looks bad. Nothing here is a test of
intent; every finding is measured geometry.

## Build

```sh
node tools/preview/build.mjs
```

Then open `tools/preview/preview.html` in a browser. Append `?dark=1` for the
dark theme:

```
tools/preview/preview.html
tools/preview/preview.html?dark=1
```

No dependencies: node builtins only, so it runs in a fresh checkout with no
`npm install`.

### Options

| flag | meaning |
| --- | --- |
| `--wiki <path>` | read diagram sources from this `wiki.json` (default: the plugin's own cache, see below) |
| `--client <path>` | render with this bundle (default: `lib/client.js`) |
| `--out <path>` | write the page elsewhere (default: `tools/preview/preview.html`) |
| `--json` | print the findings as JSON instead of a text report |
| `--quiet` | print only the one-line summary |
| `--verbose` | print every individual finding instead of aggregating per rule |
| `--strict` | exit 2 when any `error`-severity finding exists |

Exit code is `0` for a successful build regardless of what the diagrams look
like — finding bad diagrams is the point — `1` if the bundle cannot be loaded,
and `2` only with `--strict`.

### Where the real diagrams come from

By default the corpus reads the plugin's own Wiki cache under
`$DSH_HOME/repo-wiki/`. The cache directory is named after a hash of the analysed
workspace, so the tool walks that tree and takes the most recently written
`wiki.json`; `$DSH_HOME` defaults to `~/.dsh`.

Override it with `--wiki`. If nothing is found, the build still runs with the
synthetic corpus only — it never fails because a cache is absent.

## What the page shows

For every case:

- the **Mermaid source**, so a defect can be traced back to the diagram that
  caused it;
- the diagram at **420px**, the width of the right sidebar it normally renders in;
- the diagram at **900px**, the width of the lightbox;
- the measured `viewBox`, the content-box width, the resulting scale factor, and
  the element counts;
- every finding, with the coordinates that produced it.

The two widths matter because the same diagram can be fine in the lightbox and
illegible in the sidebar: the SVG is laid out at a fixed `viewBox` and scaled to
fit with `width="100%"`, so a wide diagram does not overflow — it *shrinks*. A
long LR chain that scales to 20% has 2px text, which is worse than overflowing,
because nothing looks wrong at a glance.

Each frame is clipped exactly like the real container, so an overflow shows up as
a cut-off diagram rather than a page-layout accident.

Both themes are served from one file. The `?dark=1` query sets
`data-ds-dark-theme` on `<body>`, the same attribute the app's theme system uses,
so the diagram is styled by the *real* dark tokens rather than a mock palette.

## What is measured

The checks run on the **emitted element tree**, before serialisation, in
`viewBox` units — a defect belongs to the drawing, not to the window. See
`analyze.mjs`.

| rule | severity | meaning |
| --- | --- | --- |
| `container-overflow` | error / info | the drawing is wider than the content box and does not scale, or scales so far down that its text is illegible |
| `unreadable-at-sidebar-width` | warn | the scale factor puts node labels below ~7px |
| `text-clipped` | error | a label overflows the box it is drawn in |
| `text-outside-viewBox` | error | a label extends past the drawing and will be cut off |
| `node-label-overlap` | error | two node labels occupy the same area |
| `node-box-overlap` | error | two node boxes occupy the same area |
| `pill-overlaps-node` | error | an edge label sits on top of a node |
| `pill-overlap-pill` | error | two edge labels collide |
| `edge-label-clipped` | error | edge-label text overflows its background |
| `edge-label-unpilled` | warn | edge-label text has no background, so its own line runs through it |
| `arrowhead-detached` | error | an arrow ends more than 4px from any box border |
| `arrow-direction-wrong` | error | an arrow points into the box it starts from, or is aimed away from the box it ends at |
| `edge-without-arrowhead` | warn | an edge is drawn with no arrowhead |
| `edge-crosses-node` | warn | an edge runs through a box it is not attached to |
| `edge-covers-text` | error | an edge runs across text that is not its own label |
| `no-nodes`, `degenerate-viewBox`, `node-outside-viewBox` | error | the drawing is structurally broken |

### Text measurement is an estimate, and says so

There is no headless browser here, so exact font metrics are unavailable. Text
widths are estimated per character (`measureText` in `analyze.mjs`): CJK is
full-width, Latin is narrower, and the factors are set slightly *generous* so a
"fits" verdict is conservative and a "clipped" verdict is not a false alarm.

Consequences to keep in mind when reading a report:

- A finding is only as exact as the estimate. Overlap verdicts are reliable when
  the numbers are far apart and should be re-checked by eye when they are close.
- Font *sizes* are not estimated: they are read from the plugin's own stylesheet
  (`11.5px` node labels, `10px` edge labels).
- Nothing here measures colour, contrast, or stroke widths. Those need eyes, and
  `preview.html` exists so they can be used.

### Why the serializer is not optional

The bundle returns React elements, whose props are camelCase. SVG attributes are
not. Writing props straight out as attributes produces markup that looks
plausible and is wrong in every arrow:

```
markerEnd="url(#rw-arrow)"   →   marker-end="url(#rw-arrow)"    (correct)
textAnchor="middle"          →   text-anchor="middle"           (correct)
refX="9"                     →   refX="9"       (case is preserved!)
```

`load.mjs` maps the three kinds of prop separately — case-preserved SVG
attributes, hyphenated presentation attributes, and DOM renames like
`className`→`class` — converts a `style` object to a declaration string, and
emits numbers unquoted. It also passes `refX`/`markerWidth` through unchanged;
hyphenating those yields a marker that silently renders at the wrong size.

## Layout of this directory

| file | role |
| --- | --- |
| `build.mjs` | entry point: loads the bundle, renders the corpus, writes `preview.html`, prints the report |
| `corpus.mjs` | the cases: real diagrams parsed from `wiki.json` plus the synthetic tricky corpus |
| `load.mjs` | loads `lib/client.js` in a `vm` sandbox (same pattern as `test/client-bundle.test.mjs`) and serialises React trees to SVG/HTML |
| `analyze.mjs` | the geometry checks and the text-width estimate |
| `theme.mjs` | extracts the live `--dsw-*` tokens from the installed `dsh-client-ui-theme` bundle |
| `preview.html` | **generated** — do not edit by hand |

`preview.html` is generated output; it is committed so the page can be opened
without running anything, but it is rewritten on every build.

## The corpus

25 cases, all rendered at both widths:

- **8 real diagrams**, parsed out of the plugin's own `wiki.json` with
  `/```mermaid[ \t]*\r?\n([\s\S]*?)```/g`. These are the diagrams users actually
  see, including the `-- onPage -->` and `-->|label|` label styles, `<br/>`
  multi-line labels, Chinese labels, and back-edges that form a cycle.
- **17 synthetic cases**, named `tricky-*`, each pinning one thing the layout
  engine has to get right: a TD chain, a TD branch, LR chains of 9 and 12, a
  dense graph with a label on every edge, both edge-label syntaxes, `<br/>`
  multi-line labels, unwrapped Chinese, a cycle, a single node, 25 nodes, an edge
  that must cross another box, a self-loop, the four node shapes, `RL`, a very
  long label, and a graph with comments and blank lines.

A `tricky-*` case failing is a layout bug; a `real-*` case failing is a bug users
are looking at right now.

## Adding a case

Append to `TRICKY` in `corpus.mjs`:

```js
{
  id: 'tricky-my-case',
  note: 'what this case is for, in one line',
  source: 'flowchart TD\n  A[Alpha] --> B[Beta]',
}
```

Then rebuild. Prefer a case that fails for exactly one reason, so the report
points at one defect instead of a pile.
