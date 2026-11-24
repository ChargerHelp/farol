import { Prisma } from '../generated/prisma/client.js'

export async function handleStripe(request: { body: unknown }) {
  try {
    return { received: Boolean(request.body) }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) return { received: false }
    throw error
  }
}
