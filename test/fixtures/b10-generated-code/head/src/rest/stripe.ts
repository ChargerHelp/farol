import { Prisma } from '../generated/prisma/client.js'

export async function handleStripe(request: { body: unknown }) {
  return { received: Boolean(request.body), sqlState: Prisma.PrismaClientKnownRequestError.name }
}
