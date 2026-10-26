import { THEME_STYLE } from './html-style-theme.js'

/** Inline stylesheet of the HTML report: no external fonts or scripts, light and dark themes. */
export const HTML_STYLE = `
:root {
  --bg: #ffffff; --panel: #ffffff; --text: #1c1c1e; --muted: #8e8e95; --line: #e8e6e3; --code: #f2f1ef;
  --high: #b42318; --high-bg: #fcefed; --medium: #9a5b00; --medium-bg: #fbf3e6; --low: #8e8e95; --low-bg: #f2f1ef;
  --global: #6b4fbb; --unknown: #9a5b00; --touches: #b4501b; --isolated: #2e7d4f; --accent: #3056c9; --accent-bg: #eef1fb;
  --shadow: none; --ring: rgba(48, 86, 201, .35);
}
/* Dark tokens: follow the system unless the viewer picked a theme (data-theme on <html>). */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #121214; --panel: #18181b; --text: #ececee; --muted: #7d7d86; --line: #2a2a2f; --code: #222226;
    --high: #f4796b; --high-bg: #2a1715; --medium: #e0a54b; --medium-bg: #2a2010; --low: #7d7d86; --low-bg: #222226;
    --global: #b39cf5; --unknown: #e0a54b; --touches: #f0965b; --isolated: #6cc495; --accent: #91a9ff; --accent-bg: #1d2238;
    --shadow: none; --ring: rgba(145, 169, 255, .45);
  }
}
:root[data-theme="dark"] {
    --bg: #121214; --panel: #18181b; --text: #ececee; --muted: #7d7d86; --line: #2a2a2f; --code: #222226;
    --high: #f4796b; --high-bg: #2a1715; --medium: #e0a54b; --medium-bg: #2a2010; --low: #7d7d86; --low-bg: #222226;
    --global: #b39cf5; --unknown: #e0a54b; --touches: #f0965b; --isolated: #6cc495; --accent: #91a9ff; --accent-bg: #1d2238;
    --shadow: none; --ring: rgba(145, 169, 255, .45);
}
.theme-toggle { border: 1px solid var(--line); background: var(--panel); color: var(--text); border-radius: 999px; padding: 4px 12px; font: inherit; font-size: 13px; cursor: pointer; }
.theme-toggle:hover { border-color: var(--accent); }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 1180px; margin: 0 auto; padding: 24px 16px 48px; }
header.top { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; align-items: baseline; }
h1 { font-size: 22px; margin: 0; }
h2 { font-size: 18px; margin: 0 0 12px; }
h3 { font-size: 15px; margin: 18px 0 8px; }
.muted { color: var(--muted); }
.small { font-size: 13px; }
code, .path { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; }
.path { background: var(--code); border-radius: 4px; padding: 1px 5px; word-break: break-all; }
section.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 18px 20px; margin-top: 18px; }
.hero { display: grid; grid-template-columns: minmax(220px, 1fr) 2fr; gap: 18px; align-items: center; }
@media (max-width: 760px) { .hero { grid-template-columns: 1fr; } }
.badge { display: inline-block; border-radius: 999px; padding: 6px 14px; font-weight: 700; font-size: 16px; color: #fff; }
.badge.global { background: var(--global); } .badge.unknown { background: var(--unknown); }
.badge.touches-existing { background: var(--touches); } .badge.isolated { background: var(--isolated); }
.score-card { display: grid; grid-template-columns: minmax(240px, 1fr) 2fr; gap: 22px; border-width: 2px; }
@media (max-width: 760px) { .score-card { grid-template-columns: 1fr; } }
.score-value { font-size: 64px; font-weight: 800; line-height: 1.05; margin: 4px 0 6px; color: var(--isolated); }
.score-value.medium { color: var(--medium); } .score-value.high { color: var(--high); }
.score-max { font-size: 22px; font-weight: 600; color: var(--muted); margin-left: 4px; }
.score-bar { margin: 10px 0 8px; }
ol.score-drivers { list-style: none; margin: 6px 0 0; padding: 0; }
ol.score-drivers li { padding: 5px 0; border-bottom: 1px solid var(--line); }
.score-points { display: inline-block; min-width: 42px; font-weight: 700; color: var(--high); font-variant-numeric: tabular-nums; }
.plan { border-width: 2px; border-left-width: 8px; }
.plan-pass { border-left-color: var(--isolated); } .plan-quick { border-left-color: var(--medium); } .plan-careful { border-left-color: var(--high); }
.plan-head { display: grid; grid-template-columns: 1fr minmax(220px, 280px); gap: 24px; align-items: start; }
@media (max-width: 760px) { .plan-head { grid-template-columns: 1fr; } }
.plan-title { font-size: 30px; font-weight: 800; margin: 2px 0 4px; }
.plan-pass .plan-title { color: var(--isolated); } .plan-quick .plan-title { color: var(--medium); } .plan-careful .plan-title { color: var(--high); }
.plan-advice { margin: 0 0 8px; font-weight: 600; }
.plan-reasons { margin: 0; padding-left: 18px; font-size: 13.5px; color: var(--muted); }
.score-box { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; background: var(--bg); }
.score-box .score-value { font-size: 44px; }
.score-details summary { cursor: pointer; color: var(--accent); margin-top: 4px; }
.facts { display: flex; flex-wrap: wrap; gap: 6px; margin: 16px 0 4px; align-items: center; }
.fact { border: 1px solid var(--line); border-radius: 999px; padding: 3px 10px; font-size: 13px; text-decoration: none; color: var(--text); background: var(--bg); }
.fact:hover { border-color: var(--accent); }
.fact.bad { border-color: var(--high); color: var(--high); } .fact.warn { border-color: var(--medium); color: var(--medium); } .fact.good { border-color: var(--isolated); color: var(--isolated); }
.small-badge { font-size: 12px; padding: 3px 10px; }
ol.file-list { list-style: none; margin: 8px 0 0; padding: 0; counter-reset: file; }
.file-row { display: grid; grid-template-columns: 22px 1fr auto 52px; gap: 10px; align-items: center; padding: 9px 10px; border: 1px solid var(--line); border-radius: 8px; margin-bottom: 6px; background: var(--bg); }
.file-row.is-reviewed { opacity: .45; }
.file-row.is-reviewed .file-main { text-decoration: line-through; }
.file-row input { width: 16px; height: 16px; cursor: pointer; }
.file-list.compact .file-row { padding: 5px 10px; }
.file-pills { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; }
@media (max-width: 760px) { .file-row { grid-template-columns: 22px 1fr 44px; } .file-pills { grid-column: 2 / 4; justify-content: flex-start; } }
.pill { display: inline-block; border-radius: 999px; padding: 1px 8px; font-size: 12px; border: 1px solid var(--line); color: var(--muted); white-space: nowrap; }
.pill.bad { border-color: var(--high); color: var(--high); background: var(--high-bg); }
.pill.warn { border-color: var(--medium); color: var(--medium); background: var(--medium-bg); }
.pill.good { border-color: var(--isolated); color: var(--isolated); }
.file-points { font-size: 20px; font-weight: 800; text-align: right; font-variant-numeric: tabular-nums; color: var(--low); }
.file-points.high { color: var(--high); } .file-points.medium { color: var(--medium); }
.file-points.inline { font-size: 15px; }
.plan-more { margin-top: 10px; }
.plan-more > summary { cursor: pointer; font-weight: 600; }
.other-group { margin-top: 8px; }
ol.findings li details > summary { cursor: pointer; list-style: none; }
ol.findings li details > summary::-webkit-details-marker { display: none; }
ol.findings li { padding: 7px 12px; margin-bottom: 6px; }
.test-group { margin: 6px 0; } .test-group > summary { cursor: pointer; }
ul.test-list { list-style: none; margin: 4px 0 8px; padding-left: 18px; }
ul.test-list li { padding: 3px 0; } ul.test-list label { cursor: pointer; }
ul.test-list input:checked ~ code { text-decoration: line-through; opacity: .6; }
.incremental { margin: 0 0 12px; padding: 6px 10px; border-radius: 6px; background: var(--medium-bg); color: var(--medium); font-weight: 600; font-size: 13.5px; }
.reviewers { margin: 8px 0 0; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.file-row > details.inline-diff { grid-column: 1 / -1; }
.inline-diff > summary { cursor: pointer; font-size: 12.5px; color: var(--accent); }
.diff { overflow: auto; max-height: 560px; border: 1px solid var(--line); border-radius: 6px; margin-top: 6px; background: var(--panel); }
.diff table { border-collapse: collapse; width: 100%; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
.diff td { border: 0; padding: 0 8px; white-space: pre; vertical-align: top; }
.diff td.ln { width: 1%; color: var(--muted); text-align: right; user-select: none; }
.diff tr.hunk td { color: var(--accent); background: var(--code); padding: 2px 8px; }
.diff tr.add td.code { background: rgba(46, 160, 67, .15); } .diff tr.del td.code { background: rgba(248, 81, 73, .15); }
.diff tr.add.untested td.code { box-shadow: inset 3px 0 var(--medium); }
.diff tr.flagged td.code { box-shadow: inset 3px 0 var(--high); }
.diff-flag { display: inline-block; width: 14px; margin-left: -4px; color: var(--high); cursor: help; } .diff-flag.untested { color: var(--medium); }
.file-row.filtered-out { display: none; }
.entry-filter { display: flex; gap: 8px; align-items: center; margin: 4px 0 8px; flex-wrap: wrap; }
.entry-filter input { flex: 1; min-width: 240px; font: inherit; font-size: 13px; padding: 5px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); color: var(--text); }
.entry-filter button, button.fullscreen { font: inherit; font-size: 12.5px; padding: 3px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); color: var(--text); cursor: pointer; }
.fs-target { position: relative; }
button.fullscreen { position: absolute; top: 6px; right: 6px; z-index: 2; opacity: .85; }
.fs-target:fullscreen { background: var(--bg); padding: 44px 16px 16px; overflow: auto; }
.fs-target:fullscreen .diff { max-height: none; height: 100%; }
.fs-target:fullscreen .diff table { font-size: 13.5px; }
.graph-wrap:fullscreen { display: flex; align-items: center; justify-content: center; }
.graph-wrap:fullscreen pre.mermaid { width: 100%; height: 100%; margin: 0; }
.graph-wrap:fullscreen svg { max-width: none !important; width: 100%; height: 100%; }
.diff .mark { color: var(--muted); user-select: none; }
.hljs-keyword, .hljs-selector-tag, .hljs-built_in, .hljs-type { color: #cf222e; }
.hljs-string, .hljs-regexp, .hljs-template-string { color: #0a3069; }
.hljs-number, .hljs-literal, .hljs-symbol { color: #0550ae; }
.hljs-comment, .hljs-quote { color: #6e7781; font-style: italic; }
.hljs-title, .hljs-title.function_, .hljs-section { color: #8250df; }
.hljs-attr, .hljs-attribute, .hljs-property, .hljs-variable, .hljs-params { color: #953800; }
.hljs-meta, .hljs-tag, .hljs-name { color: #116329; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .hljs-keyword, :root:not([data-theme="light"]) .hljs-selector-tag, :root:not([data-theme="light"]) .hljs-built_in, :root:not([data-theme="light"]) .hljs-type { color: #ff7b72; }
  :root:not([data-theme="light"]) .hljs-string, :root:not([data-theme="light"]) .hljs-regexp, :root:not([data-theme="light"]) .hljs-template-string { color: #a5d6ff; }
  :root:not([data-theme="light"]) .hljs-number, :root:not([data-theme="light"]) .hljs-literal, :root:not([data-theme="light"]) .hljs-symbol { color: #79c0ff; }
  :root:not([data-theme="light"]) .hljs-comment, :root:not([data-theme="light"]) .hljs-quote { color: #8b949e; }
  :root:not([data-theme="light"]) .hljs-title, :root:not([data-theme="light"]) .hljs-section { color: #d2a8ff; }
  :root:not([data-theme="light"]) .hljs-attr, :root:not([data-theme="light"]) .hljs-attribute, :root:not([data-theme="light"]) .hljs-property, :root:not([data-theme="light"]) .hljs-variable, :root:not([data-theme="light"]) .hljs-params { color: #ffa657; }
  :root:not([data-theme="light"]) .hljs-meta, :root:not([data-theme="light"]) .hljs-tag, :root:not([data-theme="light"]) .hljs-name { color: #7ee787; }
}
:root[data-theme="dark"] .hljs-keyword, :root[data-theme="dark"] .hljs-selector-tag, :root[data-theme="dark"] .hljs-built_in, :root[data-theme="dark"] .hljs-type { color: #ff7b72; }
:root[data-theme="dark"] .hljs-string, :root[data-theme="dark"] .hljs-regexp, :root[data-theme="dark"] .hljs-template-string { color: #a5d6ff; }
:root[data-theme="dark"] .hljs-number, :root[data-theme="dark"] .hljs-literal, :root[data-theme="dark"] .hljs-symbol { color: #79c0ff; }
:root[data-theme="dark"] .hljs-comment, :root[data-theme="dark"] .hljs-quote { color: #8b949e; }
:root[data-theme="dark"] .hljs-title, :root[data-theme="dark"] .hljs-section { color: #d2a8ff; }
:root[data-theme="dark"] .hljs-attr, :root[data-theme="dark"] .hljs-attribute, :root[data-theme="dark"] .hljs-property, :root[data-theme="dark"] .hljs-variable, :root[data-theme="dark"] .hljs-params { color: #ffa657; }
:root[data-theme="dark"] .hljs-meta, :root[data-theme="dark"] .hljs-tag, :root[data-theme="dark"] .hljs-name { color: #7ee787; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.stat { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
.stat .value { font-size: 22px; font-weight: 700; }
.stat .label { font-size: 12.5px; color: var(--muted); }
.stat.bad .value { color: var(--high); } .stat.warn .value { color: var(--medium); } .stat.good .value { color: var(--isolated); }
ol.findings { list-style: none; margin: 0; padding: 0; }
ol.findings li { border-left: 4px solid var(--low); background: var(--low-bg); border-radius: 6px; padding: 10px 14px; margin-bottom: 8px; }
ol.findings li.high { border-color: var(--high); background: var(--high-bg); }
ol.findings li.medium { border-color: var(--medium); background: var(--medium-bg); }
.chip { display: inline-block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; border-radius: 4px; padding: 1px 6px; margin-right: 8px; color: #fff; background: var(--low); vertical-align: 1px; }
.chip.high { background: var(--high); } .chip.medium { background: var(--medium); }
.chip.traffic { background: transparent; color: var(--muted); border: 1px solid var(--line); text-transform: none; letter-spacing: 0; font-weight: 600; }
.pill.traffic { border-style: dashed; }
a.dd-link { color: inherit; text-decoration: underline dotted; }
a.pill-link { text-decoration: none; }
details.contract { border: 1px solid var(--line); border-radius: 8px; margin: 6px 0; background: var(--panel); }
details.contract > summary { cursor: pointer; padding: 8px 10px; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
details.contract .contract-callers { margin-left: auto; color: var(--muted); }
.contract-body { padding: 0 10px 10px; overflow-x: auto; }
table.contract-table { width: 100%; border-collapse: collapse; font-size: 13px; }
table.contract-table th, table.contract-table td { text-align: left; padding: 4px 6px; border-top: 1px solid var(--line); vertical-align: top; }
.finding-title { font-weight: 600; }
.finding-files { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px; }
a { color: var(--accent); }
table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; font-size: 12.5px; }
td.num, th.num { text-align: right; white-space: nowrap; }
.bar { height: 10px; background: var(--code); border-radius: 999px; overflow: hidden; margin: 6px 0 12px; }
.bar > span { display: block; height: 100%; background: var(--isolated); }
.bar.warn > span { background: var(--medium); } .bar.bad > span { background: var(--high); }
.big { font-size: 28px; font-weight: 700; }
.chain { display: inline-flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.chain .arrow { color: var(--muted); }
.tag { display: inline-block; border-radius: 4px; padding: 0 6px; font-size: 12px; border: 1px solid var(--line); }
.tag.yes { color: var(--isolated); border-color: var(--isolated); } .tag.no { color: var(--high); border-color: var(--high); }
.tag.added { color: var(--isolated); } .tag.deleted { color: var(--high); } .tag.renamed { color: var(--medium); }
tr.effect-global td:first-child { border-left: 3px solid var(--global); }
tr.effect-unknown td:first-child { border-left: 3px solid var(--unknown); }
tr.effect-touches-existing td:first-child { border-left: 3px solid var(--touches); }
tr.effect-info td:first-child { border-left: 3px solid var(--line); }
details > summary { cursor: pointer; font-weight: 600; margin: 10px 0 6px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
@media (max-width: 900px) { .grid2 { grid-template-columns: 1fr; } }
/* One page: a sticky bar links to the sections. */
.sectionbar { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; gap: 4px; margin-top: 18px; padding: 8px 0; background: var(--bg); border-bottom: 1px solid var(--line); }
.sectionbar a { padding: 6px 12px; border-radius: 6px; color: var(--muted); font-weight: 600; text-decoration: none; }
.sectionbar a:hover { color: var(--text); background: var(--panel); }
.section { scroll-margin-top: 56px; margin-top: 26px; }
.section-title { font-size: 20px; margin: 0 0 4px; }
.count { display: inline-block; margin-left: 6px; min-width: 20px; padding: 0 6px; border-radius: 999px; background: var(--low-bg); color: var(--muted); font-size: 12px; text-align: center; }
.count.bad { background: var(--high); color: #fff; }
a.path { color: var(--text); text-decoration: none; border-bottom: 1px dotted var(--accent); }
a.path:hover { color: var(--accent); }
a.range { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; }
td.ranges { line-height: 1.8; }
tr.critical td { background: var(--high-bg); }
details.route { border: 1px solid var(--line); border-radius: 8px; margin-bottom: 6px; background: var(--panel); }
details.route > summary { display: flex; flex-wrap: wrap; gap: 10px; align-items: baseline; padding: 8px 12px; margin: 0; font-weight: 400; }
details.route[open] > summary { border-bottom: 1px solid var(--line); }
.route-path { font-weight: 700; }
.route-files { margin-left: auto; color: var(--muted); }
.route-body { padding: 10px 14px 14px; overflow-x: auto; }
.route-body h4 { margin: 12px 0 6px; font-size: 13px; color: var(--muted); }
.chain-row { margin-bottom: 4px; }
details.layouts { margin-top: 16px; border-top: 1px solid var(--line); padding-top: 6px; }
details.layouts > summary { color: var(--muted); }
.mini-bar { height: 5px; background: var(--code); border-radius: 999px; overflow: hidden; margin-top: 4px; min-width: 80px; }
.mini-bar > span { display: block; height: 100%; background: var(--touches); }
.filters { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; margin: 14px 0 8px; }
.filter-label { font-weight: 600; font-size: 13px; margin-left: 6px; }
.filter { display: inline-flex; gap: 4px; align-items: center; border: 1px solid var(--line); border-radius: 999px; padding: 2px 10px; font-size: 13px; cursor: pointer; user-select: none; }
.filter:has(input:not(:checked)) { opacity: .45; }
.filter input { margin: 0; }
#risk-count { margin-left: auto; }
.legend { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; margin: 8px 0 12px; font-size: 12.5px; }
.lg { display: inline-flex; align-items: center; gap: 6px; }
.lg::before { content: ''; display: inline-block; width: 16px; height: 12px; border-radius: 3px; border: 1px solid transparent; }
.lg-route::before { background: #2457c5; border-radius: 999px; }
.lg-module::before { background: transparent; border: 1px dashed #9aa4b1; }
.lg-changed::before { background: #5c3317; border-color: #a8642a; }
.lg-added::before { background: #14532d; border-color: #2f8f55; }
.lg-high::before { background: #5c3317; border: 4px solid #ff2d2d; }
.lg-medium::before { background: #5c3317; border: 3px solid #ffd60a; }
details.route > summary .chip { margin: 0; }
.view-input { position: absolute; opacity: 0; pointer-events: none; }
.view-switch { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; margin: 4px 0 12px; }
.view-switch label { padding: 5px 14px; cursor: pointer; font-size: 13px; font-weight: 600; color: var(--muted); }
#routes-view-list:checked ~ .view-switch label[for="routes-view-list"], #routes-view-tree:checked ~ .view-switch label[for="routes-view-tree"] { background: var(--accent); color: #fff; }
.view { display: none; }
#routes-view-list:checked ~ .view-list, #routes-view-tree:checked ~ .view-tree { display: block; }
details.tree-node { border-left: 2px solid var(--line); margin: 4px 0 4px 6px; padding-left: 10px; }
details.tree-node > summary { display: flex; gap: 10px; align-items: baseline; margin: 4px 0; font-weight: 400; }
.tree-label { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-weight: 700; }
.tree-children { margin-left: 4px; }
details.review { border: 1px solid var(--line); border-radius: 10px; padding: 8px 16px; margin: 18px 0 0; background: var(--panel); }
details.review > summary { font-weight: 600; }
.review-tools { display: flex; gap: 8px; align-items: center; margin: 6px 0 10px; flex-wrap: wrap; }
.review-tools input[type="text"], .review-tools input[type="search"] { flex: 1; min-width: 240px; font: inherit; font-size: 13px; padding: 5px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); color: var(--text); }
.review-tools button { font: inherit; font-size: 13px; padding: 5px 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); color: var(--text); cursor: pointer; }
#review-error { color: var(--high); }
.review-files { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 4px 12px; max-height: 320px; overflow: auto; padding-bottom: 8px; }
.review-file { display: flex; gap: 6px; align-items: baseline; font-size: 13px; cursor: pointer; }
.review-file.is-reviewed { opacity: .5; text-decoration: line-through; }
.test-item.is-reviewed > label { opacity: .5; }
.test-item.is-reviewed code { text-decoration: line-through; }
.test-item.is-flagged > label { opacity: .7; }
.test-item.is-reviewed .flag-note:not(:empty) { color: var(--isolated); background: color-mix(in srgb, var(--isolated) 12%, var(--panel)); }
.review-file[hidden] { display: none; }
pre.mermaid { margin: 0; background: transparent; }
pre.mermaid:not([data-processed]) { display: none; }
.tag.affected { color: var(--touches); border-color: var(--touches); }
.tag.added { color: var(--isolated); border-color: var(--isolated); }
footer { margin-top: 28px; text-align: center; font-size: 12.5px; color: var(--muted); }
${THEME_STYLE}`
