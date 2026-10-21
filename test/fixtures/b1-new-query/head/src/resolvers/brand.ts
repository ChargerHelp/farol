import { listBrands, renameBrand } from '../services/brands'
import { topBrands } from '../services/top'

export const brandResolvers = {
  Query: {
    brand: (_: unknown, { id }: { id: string }, { loaders }: any) => loaders.Brand.byId(id),
    brands: () => listBrands(),
    topBrands: (_: unknown, { limit }: { limit?: number }) => topBrands(limit ?? 10),
  },
  Mutation: {
    renameBrand: async (_: unknown, args: { id: string; name: string }) => renameBrand(args.id, args.name),
  },
  Brand: {
    posts: (brand: { id: string }, _: unknown, { loaders }: any) => loaders.Post.byBrand(brand.id),
  },
}
