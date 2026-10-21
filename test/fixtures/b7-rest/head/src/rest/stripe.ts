export async function handleStripe(request: { body: unknown }) {
  return { received: request.body !== undefined }
}
