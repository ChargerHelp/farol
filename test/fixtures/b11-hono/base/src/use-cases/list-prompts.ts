export class ListPrompts {
  async execute(): Promise<string[]> {
    return ['triage', 'summary']
  }
}
