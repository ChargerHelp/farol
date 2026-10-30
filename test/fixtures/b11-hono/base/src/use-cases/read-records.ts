export class ReadRecords {
  constructor(private readonly table: string) {}

  async list(page: number): Promise<{ table: string; page: number }> {
    return { table: this.table, page }
  }

  async get(id: number): Promise<{ table: string; id: number }> {
    return { table: this.table, id }
  }
}
