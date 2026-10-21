/**
 * The visual layer of the HTML report, on top of the layout rules of html-style.ts: typography, cards with soft
 * shadows, the glass section bar, softer chips and pills, hover and focus states. Tokens come from html-style.ts.
 */
export const THEME_STYLE = `
body { font: 14.5px/1.55 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing: antialiased; background: radial-gradient(1100px 420px at 0% -8%, var(--accent-bg), transparent 62%), var(--bg); background-attachment: fixed; }
main { max-width: 1240px; padding: 28px 20px 64px; }
h1 { font-size: 20px; letter-spacing: -.01em; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
/* The logo follows the theme: the light variant by default, the dark one under the dark tokens. */
.logo { display: inline-flex; line-height: 0; }
.logo svg { height: 38px; width: auto; display: block; }
.logo-dark { display: none; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .logo-light { display: none; } :root:not([data-theme="light"]) .logo-dark { display: inline-flex; } }
:root[data-theme="dark"] .logo-light { display: none; }
:root[data-theme="dark"] .logo-dark { display: inline-flex; }
.h1-repo { padding-left: 14px; border-left: 1px solid var(--line); font-weight: 600; line-height: 30px; }
h3 { font-size: 14.5px; letter-spacing: -.005em; }
header.top { padding: 16px 22px; border-radius: 16px; background: var(--panel); border: 1px solid var(--line); box-shadow: var(--shadow); align-items: center; }
section.panel { border-radius: 16px; padding: 22px 24px; box-shadow: var(--shadow); }
.section { margin-top: 34px; }
.section-title { display: flex; align-items: center; gap: 10px; font-size: 18px; letter-spacing: -.01em; margin-bottom: 2px; }
.section-title::before { content: ''; width: 4px; height: 18px; border-radius: 4px; background: var(--accent); }
.sectionbar { top: 10px; margin-top: 18px; padding: 6px; gap: 2px; border: 1px solid var(--line); border-radius: 14px; background: color-mix(in srgb, var(--panel) 82%, transparent); backdrop-filter: saturate(1.4) blur(10px); -webkit-backdrop-filter: saturate(1.4) blur(10px); box-shadow: var(--shadow); }
.sectionbar a { border-radius: 10px; padding: 6px 12px; font-size: 13.5px; transition: background .15s, color .15s; }
.sectionbar a:hover { background: var(--accent-bg); color: var(--accent); }
.count { background: var(--code); font-weight: 600; }
.count.bad { background: var(--high); }
.theme-toggle { padding: 5px 12px; transition: border-color .15s, background .15s; }
.theme-toggle:hover { background: var(--accent-bg); }
/* Review plan: a card tinted by the verdict, with an accent stripe. */
.plan { position: relative; overflow: hidden; border: 1px solid var(--line); border-left-width: 1px; padding-left: 30px; }
.plan::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 6px; background: var(--isolated); }
.plan-quick::before { background: var(--medium); } .plan-careful::before { background: var(--high); }
.plan-pass { background: linear-gradient(120deg, color-mix(in srgb, var(--isolated) 8%, var(--panel)), var(--panel) 42%); }
.plan-quick { background: linear-gradient(120deg, color-mix(in srgb, var(--medium) 9%, var(--panel)), var(--panel) 42%); }
.plan-careful { background: linear-gradient(120deg, color-mix(in srgb, var(--high) 8%, var(--panel)), var(--panel) 42%); }
.plan-title { font-size: 28px; letter-spacing: -.02em; }
.plan-advice { font-size: 15px; }
.plan-reasons li { margin: 2px 0; }
.score-box { border-radius: 14px; background: var(--panel); box-shadow: var(--shadow); padding: 14px 16px; }
.score-value { letter-spacing: -.03em; }
.bar { height: 8px; }
.bar > span { border-radius: 999px; }
.badge { box-shadow: 0 1px 2px rgba(0, 0, 0, .12); letter-spacing: .01em; }
/* Facts, pills, chips and tags: soft fills instead of outlines. */
.fact { background: var(--panel); border-color: var(--line); padding: 4px 12px; font-weight: 500; transition: border-color .15s, transform .15s; }
.fact:hover { transform: translateY(-1px); }
.fact.bad { background: var(--high-bg); border-color: color-mix(in srgb, var(--high) 35%, transparent); }
.fact.warn { background: var(--medium-bg); border-color: color-mix(in srgb, var(--medium) 35%, transparent); }
.fact.good { background: color-mix(in srgb, var(--isolated) 10%, var(--panel)); border-color: color-mix(in srgb, var(--isolated) 35%, transparent); }
.pill { background: var(--code); border-color: transparent; padding: 2px 9px; font-weight: 500; }
.pill.bad { border-color: transparent; } .pill.warn { border-color: transparent; }
.pill.good { background: color-mix(in srgb, var(--isolated) 12%, var(--panel)); border-color: transparent; }
.pill.traffic { background: var(--accent-bg); color: var(--accent); border: 0; }
.chip { border-radius: 999px; padding: 2px 8px; font-size: 10.5px; letter-spacing: .05em; }
.chip.high { background: var(--high-bg); color: var(--high); } .chip.medium { background: var(--medium-bg); color: var(--medium); } .chip.low { background: var(--low-bg); color: var(--low); }
.chip.traffic { background: var(--accent-bg); color: var(--accent); border: 0; }
.tag { border-radius: 999px; padding: 0 8px; background: var(--code); border-color: transparent; font-weight: 500; }
.path { background: var(--code); border-radius: 6px; padding: 1px 6px; }
/* Rows and cards. */
.file-row { background: var(--panel); border-radius: 12px; padding: 10px 12px; box-shadow: var(--shadow); transition: border-color .15s, box-shadow .15s; }
.file-row:hover { border-color: color-mix(in srgb, var(--accent) 40%, var(--line)); }
.file-points { font-size: 22px; letter-spacing: -.02em; }
details.route, details.contract { border-radius: 12px; box-shadow: var(--shadow); transition: border-color .15s; }
details.route:hover, details.contract:hover { border-color: color-mix(in srgb, var(--accent) 35%, var(--line)); }
details.route > summary, details.contract > summary { padding: 10px 14px; }
details.review { border-radius: 14px; box-shadow: var(--shadow); padding: 10px 18px; }
ol.findings li { border-radius: 12px; border-left-width: 4px; }
.stat { border-radius: 12px; background: var(--panel); box-shadow: var(--shadow); }
.diff { border-radius: 10px; }
.score-details summary, .inline-diff > summary { font-weight: 600; }
.file-row > details.inline-diff > summary { margin: 2px 0 0; }
.plan::before { width: 5px; }
/* Tables. */
th { text-transform: uppercase; letter-spacing: .05em; font-size: 11px; }
tbody tr:hover td { background: color-mix(in srgb, var(--code) 60%, transparent); }
/* Inputs and buttons. */
.entry-filter input, .review-tools input[type="text"], .review-tools input[type="search"] { border-radius: 10px; padding: 7px 12px; }
.entry-filter button, .review-tools button, button.fullscreen { border-radius: 10px; padding: 6px 12px; transition: background .15s, border-color .15s; }
.entry-filter button:hover, .review-tools button:hover, button.fullscreen:hover { background: var(--accent-bg); border-color: color-mix(in srgb, var(--accent) 40%, var(--line)); }
input:focus-visible, button:focus-visible, a:focus-visible, summary:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
input[type="checkbox"] { accent-color: var(--accent); }
.view-switch { border-radius: 10px; }
footer { margin-top: 40px; }
/* Flag panel, checks and the Result tab. */
details.flags { margin-top: 10px; }
.flag-items { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 6px 12px; max-height: 340px; overflow: auto; padding-bottom: 8px; }
.flag-item { display: flex; gap: 8px; align-items: baseline; font-size: 13px; padding: 4px 6px; border-radius: 8px; }
.flag-item.is-flagged { background: color-mix(in srgb, var(--global) 8%, var(--panel)); }
.flag-item[hidden] { display: none; }
.flag-item button.flag-toggle { opacity: 1; flex: none; }
input.ack { accent-color: var(--isolated); vertical-align: -2px; margin-right: 4px; }
label.ack-label { display: inline-flex; gap: 4px; align-items: center; padding: 1px 8px; border-radius: 999px; border: 1px dashed var(--line); color: var(--muted); cursor: pointer; }
label.ack-label:has(input:checked) { border-style: solid; border-color: color-mix(in srgb, var(--isolated) 45%, transparent); color: var(--isolated); background: color-mix(in srgb, var(--isolated) 10%, var(--panel)); }
.result-tools { display: flex; gap: 10px; align-items: center; margin: 8px 0; }
.result-tools button { font: inherit; font-size: 13px; font-weight: 600; padding: 7px 14px; border-radius: 10px; border: 0; background: var(--accent); color: #fff; cursor: pointer; }
.result-tools button:hover { filter: brightness(1.08); }
#result-copied { color: var(--isolated); font-weight: 600; }
pre.result-text { margin: 0; padding: 14px 16px; border-radius: 12px; border: 1px solid var(--line); background: var(--code); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; white-space: pre-wrap; word-break: break-word; max-height: 520px; overflow: auto; }
/* Suggested reviewers. */
.ownership { margin-top: 14px; }
ol.owners { list-style: none; margin: 6px 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
li.owner { border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; background: var(--panel); box-shadow: var(--shadow); }
.owner-head { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.owner-head .muted { margin-left: auto; }
.bar.owner-bar { height: 6px; margin: 8px 0; }
.bar.owner-bar > span { background: var(--accent); }
.owner-files { display: flex; flex-wrap: wrap; gap: 4px; }
.pill.owner { background: color-mix(in srgb, var(--isolated) 10%, var(--panel)); color: var(--text); }
/* Feature flags. */
button.flag-toggle { font: inherit; font-size: 12px; padding: 2px 10px; border-radius: 999px; border: 1px dashed var(--line); background: transparent; color: var(--muted); cursor: pointer; opacity: .75; transition: opacity .15s, background .15s, color .15s, border-color .15s; }
details.route:hover button.flag-toggle, button.flag-toggle:focus-visible { opacity: 1; }
button.flag-toggle[aria-pressed="true"] { opacity: 1; border-style: solid; border-color: color-mix(in srgb, var(--global) 45%, transparent); background: color-mix(in srgb, var(--global) 12%, var(--panel)); color: var(--global); font-weight: 600; }
details.route.is-flagged { border-style: dashed; border-color: color-mix(in srgb, var(--global) 45%, var(--line)); }
details.route.is-flagged .route-path { opacity: .7; }
.flag-note:not(:empty) { margin-left: 8px; font-size: 11.5px; font-weight: 600; padding: 1px 8px; border-radius: 999px; color: var(--global); background: color-mix(in srgb, var(--global) 12%, var(--panel)); }
.file-row.is-flagged { opacity: .55; }
.file-row.is-flagged .file-main { text-decoration: none; }
.review-file.is-flagged { text-decoration: none; }
`
