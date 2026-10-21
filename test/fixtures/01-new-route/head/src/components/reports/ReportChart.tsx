export function ReportChart({ points }: { points: number[] }) {
  return <svg data-points={points.join(',')} />
}
