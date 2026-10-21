export function ReportTable({ rows }: { rows: string[] }) {
  return (
    <table>
      <tbody>
        {rows.map((r) => (
          <tr key={r}>
            <td>{r}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
