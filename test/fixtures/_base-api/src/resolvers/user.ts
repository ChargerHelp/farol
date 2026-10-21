import { getUser } from '../services/users'
import { maskEmail } from '../lib/format'

export const userResolvers = {
  Query: {
    me: (_: unknown, __: unknown, ctx: { userId: string }) => getUser(ctx.userId),
  },
  User: {
    email: (user: { email: string }) => maskEmail(user.email),
  },
}
