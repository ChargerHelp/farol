export const postLoaders = () => ({ Post: { byBrand: (id: string) => [{ id: `${id}-1`, title: 'p' }] } })
