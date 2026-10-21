const legacy = require('./legacy')

export function listBrands() {
  return legacy.allBrands()
}

export function renameBrand(id: string, name: string) {
  return { id, name }
}
