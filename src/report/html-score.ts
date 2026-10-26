import type { Output } from '../output/schema.js'
import { mergeScore, scoreGroups } from './merge-score.js'

/** Merge risk points of every file that adds to the score (the Risk table, and reviewers weighed by risk). */
export function scoreByFile(o: Output): Map<string, number> {
  return new Map(scoreGroups(mergeScore(o).items).flatMap((g) => (g.file === null ? [] : [[g.file, g.points] as const])))
}
