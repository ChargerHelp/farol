/** The Details page of an HTML report (the full analysis, kept as JSON inside the workbench page). */
export function detailsOf(html: string): string {
  const json = /<script type="application\/json" id="farol-details">(.*?)<\/script>/s.exec(html)?.[1]
  if (json === undefined) throw new Error('no details in the report')
  return JSON.parse(json) as string
}

/** The view model and texts the workbench page renders in the browser (window.FAROL). */
export function workbenchOf(html: string): { D: Record<string, unknown>; T: Record<string, unknown> } {
  const json = /<script>window\.FAROL = (.*?)<\/script>/s.exec(html)?.[1]
  if (json === undefined) throw new Error('no workbench data in the report')
  return JSON.parse(json) as { D: Record<string, unknown>; T: Record<string, unknown> }
}
