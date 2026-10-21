module.exports = {
  allBrands() {
    return Core.db.query('select * from brands')
  },
}
