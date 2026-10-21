export async function handleStripe(request: { body: unknown }) {
  return { received: Boolean(request.body) }
}
