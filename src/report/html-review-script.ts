/**
 * Review state of the page: files ticked as reviewed (or matched by the regular expression), and pages marked as
 * behind a feature flag, whose files only flagged pages use leave the review too. A page row disappears when every
 * changed file behind it is out of the review (flagged pages stay, to be undone); module counts, the title and the
 * score follow (event "farol-reviewed"). Kept per commit.
 */
export const REVIEW_SCRIPT = `<script>
(() => {
  const panel = document.getElementById('review')
  if (!panel) return
  const storageKey = 'farol-reviewed:' + panel.dataset.key
  // The panel starts collapsed: links to it open it.
  for (const link of document.querySelectorAll('a[href="#review"]')) link.addEventListener('click', () => { panel.open = true })
  const regexInput = document.getElementById('review-regex')
  const error = document.getElementById('review-error')
  const status = document.getElementById('review-status')
  const boxes = [...panel.querySelectorAll('input[data-file]')]
  const rows = [...document.querySelectorAll('.view details.route')]
  const pages = new Set(rows.map((r) => r.querySelector('summary').title))
  // Pages behind a feature flag (the same page has a toggle in the list and in the tree).
  const flagButtons = [...document.querySelectorAll('button.flag-toggle')]
  const flagged = new Set()
  // Checks on security findings, vulnerable dependencies and contract changes (recorded in the Result tab).
  const ackBoxes = [...document.querySelectorAll('input[data-ack]')]
  const keysOf = new Map()
  for (const row of rows) {
    const key = row.querySelector('summary').title
    for (const file of row.dataset.files ? row.dataset.files.split('|') : []) keysOf.set(file, (keysOf.get(file) || new Set()).add(key))
  }
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null')
    if (saved) {
      for (const box of boxes) box.checked = saved.files.includes(box.dataset.file)
      regexInput.value = saved.regex || ''
      for (const key of saved.flags || []) if (pages.has(key)) flagged.add(key)
      for (const box of ackBoxes) box.checked = (saved.acks || []).includes(box.dataset.ack)
    }
  } catch {}
  for (const button of flagButtons) {
    button.addEventListener('click', (event) => {
      // Inside a <summary>: toggle the flag, not the row.
      event.preventDefault()
      event.stopPropagation()
      const key = button.dataset.flagKey
      if (flagged.has(key)) flagged.delete(key)
      else flagged.add(key)
      apply()
    })
  }
  const apply = () => {
    let regex = null
    error.hidden = true
    if (regexInput.value.trim() !== '') {
      try {
        regex = new RegExp(regexInput.value)
      } catch {
        error.hidden = false
      }
    }
    const acks = new Set(ackBoxes.filter((b) => b.checked).map((b) => b.dataset.ack))
    const ticked = new Set(boxes.filter((b) => b.checked || (regex && regex.test(b.dataset.file))).map((b) => b.dataset.file))
    // Files that only flagged pages use are out of the review, like reviewed ones (but labeled as flagged).
    const covered = new Set([...keysOf].filter(([, keys]) => [...keys].every((k) => flagged.has(k))).map(([file]) => file))
    const reviewed = new Set([...ticked, ...covered])
    for (const button of flagButtons) {
      const on = flagged.has(button.dataset.flagKey)
      button.setAttribute('aria-pressed', String(on))
      const row = button.closest('details.route') || button.closest('.flag-item')
      if (row) row.classList.toggle('is-flagged', on)
    }
    const note = (el, file) => {
      const span = el.querySelector('.flag-note')
      const on = covered.has(file) && !ticked.has(file)
      el.classList.toggle('is-flagged', on)
      if (span) {
        span.textContent = on ? panel.dataset.flagNote : ''
        span.title = on ? panel.dataset.flagTitle : ''
      }
    }
    for (const box of boxes) {
      box.closest('label').classList.toggle('is-reviewed', reviewed.has(box.dataset.file))
      note(box.closest('label'), box.dataset.file)
    }
    for (const row of document.querySelectorAll('.file-row[data-file]')) note(row, row.dataset.file)
    const left = new Set()
    for (const row of rows) {
      const files = row.dataset.files ? row.dataset.files.split('|') : []
      const remaining = files.filter((f) => !reviewed.has(f)).length
      const key = row.querySelector('summary').title
      // Flagged pages stay listed, so the flag can be undone.
      row.hidden = files.length > 0 && remaining === 0 && !flagged.has(key)
      if (!row.hidden && !flagged.has(key)) left.add(key)
      const label = row.querySelector('.route-files')
      if (label && files.length > 0) label.textContent = remaining === files.length ? files.length + ' changed file' + (files.length === 1 ? '' : 's') : remaining + ' of ' + files.length + ' changed files left'
    }
    for (const node of [...document.querySelectorAll('details.tree-node')].reverse()) {
      const visible = new Set([...node.querySelectorAll('details.route:not([hidden])')].map((r) => r.querySelector('summary').title)).size
      node.hidden = visible === 0
      const count = node.querySelector(':scope > summary .tree-count')
      if (count) count.textContent = visible + ' ' + (visible === 1 ? count.dataset.one : count.dataset.many)
    }
    const affected = document.getElementById('routes-affected')
    if (affected) affected.textContent = String(left.size)
    const parts = []
    if (reviewed.size > 0) parts.push(panel.dataset.template.replace('{left}', left.size).replace('{total}', pages.size))
    if (ticked.size > 0) parts.push(panel.dataset.marked.replace('{files}', ticked.size))
    if (flagged.size > 0) parts.push(panel.dataset.flagStatus.replace('{n}', flagged.size).replace('{files}', [...covered].filter((f) => !ticked.has(f)).length))
    status.textContent = parts.join(' ')
    try {
      localStorage.setItem(storageKey, JSON.stringify({ files: boxes.filter((b) => b.checked).map((b) => b.dataset.file), regex: regexInput.value, flags: [...flagged], acks: [...acks] }))
    } catch {}
    const flagsStatus = document.getElementById('flags-status')
    if (flagsStatus) flagsStatus.textContent = flagged.size === 0 ? '' : panel.dataset.flagStatus.replace('{n}', flagged.size).replace('{files}', [...covered].filter((f) => !ticked.has(f)).length)
    // The Result tab reads this when the change is announced.
    window.farolState = { ticked: [...ticked].sort(), covered: [...covered].sort(), flagged: [...flagged].sort(), acks: [...acks].sort(), left: left.size, total: pages.size, files: boxes.length }
    document.dispatchEvent(new CustomEvent('farol-reviewed', { detail: [...reviewed] }))
  }
  // Search only narrows the list; "Mark shown" / "Unmark shown" act on what it shows.
  const search = document.getElementById('review-search')
  const hideDone = document.getElementById('review-hide-done')
  const shownLabel = document.getElementById('review-shown')
  const visibleBoxes = () => boxes.filter((b) => !b.closest('label').hidden)
  const filter = () => {
    const words = search.value.toLowerCase().split(/\\s+/).filter((w) => w !== '')
    for (const box of boxes) {
      const label = box.closest('label')
      const file = box.dataset.file.toLowerCase()
      label.hidden = !words.every((w) => file.includes(w)) || (hideDone.checked && label.classList.contains('is-reviewed'))
    }
    const shown = visibleBoxes().length
    shownLabel.textContent = shown === boxes.length ? '' : panel.dataset.shown.replace('{shown}', shown).replace('{total}', boxes.length)
  }
  const mark = (value) => {
    for (const box of visibleBoxes()) box.checked = value
    apply()
  }
  document.getElementById('review-mark-shown').addEventListener('click', () => mark(true))
  document.getElementById('review-unmark-shown').addEventListener('click', () => mark(false))
  search.addEventListener('input', filter)
  hideDone.addEventListener('change', filter)
  document.addEventListener('farol-reviewed', filter)
  panel.addEventListener('change', (event) => { if (event.target.dataset.file !== undefined) apply() })
  regexInput.addEventListener('input', apply)
  for (const box of ackBoxes) box.addEventListener('change', apply)
  const flagSearch = document.getElementById('flags-search')
  if (flagSearch) {
    flagSearch.addEventListener('input', () => {
      const words = flagSearch.value.toLowerCase().split(/\\s+/).filter((w) => w !== '')
      for (const item of document.querySelectorAll('.flag-item')) item.hidden = !words.every((w) => item.dataset.search.includes(w))
    })
  }
  document.getElementById('review-clear').addEventListener('click', () => {
    for (const box of boxes) box.checked = false
    flagged.clear()
    regexInput.value = ''
    search.value = ''
    apply()
  })
  apply()
})()
</script>`

