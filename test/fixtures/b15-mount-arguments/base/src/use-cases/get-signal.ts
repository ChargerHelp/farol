export class GetSignal {
  async execute(id: number): Promise<string> {
    return `signal ${id}`
  }
}
