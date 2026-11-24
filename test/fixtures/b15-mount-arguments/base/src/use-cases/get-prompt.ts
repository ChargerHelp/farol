export class GetPrompt {
  async execute(id: string): Promise<string> {
    return `prompt ${id}`
  }
}
