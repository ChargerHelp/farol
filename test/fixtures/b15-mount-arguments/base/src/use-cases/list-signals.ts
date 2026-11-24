export class ListSignals {
  async execute(page: number): Promise<string[]> {
    return [`signal page ${page}`]
  }
}
