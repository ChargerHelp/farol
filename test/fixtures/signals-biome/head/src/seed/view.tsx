export function View({ html }: { html: string }) {
  return (
    <div>
      <a href="https://example.com" target="_blank">x</a>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}
