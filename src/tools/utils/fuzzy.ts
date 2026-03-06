// tools/utils/fuzzy.ts
// --------------------
// Trigram-based fuzzy scorer. No external dependencies.
//
// A trigram is a sliding window of 3 characters over a string.
// Similarity is the Jaccard index of the two trigram sets:
//   score = |intersection| / |union|
//
// Scores range from 0 (no overlap) to 1 (identical).
// An exact substring bonus is added so exact hits always rank above fuzzy ones.

function trigrams(str: string): Set<string> {
  const s = str.toLowerCase();
  const set = new Set<string>();
  for (let i = 0; i <= s.length - 3; i++) {
    set.add(s.slice(i, i + 3));
  }
  return set;
}

export function fuzzyScore(query: string, target: string): number {
  if (!query || !target) return 0;

  const q = query.toLowerCase();
  const t = target.toLowerCase();

  if (t.includes(q)) return 1;

  const qTri = trigrams(q);
  const tTri = trigrams(t);

  if (qTri.size === 0 || tTri.size === 0) {
    return t.includes(q) ? 1 : 0;
  }

  let intersection = 0;
  for (const tri of qTri) {
    if (tTri.has(tri)) intersection++;
  }

  const union = qTri.size + tTri.size - intersection;
  return intersection / union;
}

export function fuzzyMatch(query: string, target: string, threshold = 0.2): boolean {
  return fuzzyScore(query, target) >= threshold;
}
