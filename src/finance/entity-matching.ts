export type MatchCandidate = {
  id: string;
  type: "recurring_expense" | "planned_expense";
  name: string;
  amountMinor: number;
  currency: string;
  status?: string;
};

export type RankedMatchCandidate = MatchCandidate & {
  score: number;
  reason: string;
};

const stopWords = new Set([
  "the",
  "a",
  "an",
  "and",
  "for",
  "of",
  "was",
  "were",
  "charged",
  "paid",
  "went",
  "through",
  "bill",
  "payment",
  "за",
  "на",
  "и",
  "по",
  "списалось",
  "списали",
  "оплатил",
  "оплатилась",
  "заплатил",
  "заплатилась",
]);

export const normalizeEntityName = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokensFor = (value: string) =>
  normalizeEntityName(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !stopWords.has(token));

const diceCoefficient = (left: string, right: string) => {
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return 0;

  const bigrams = new Map<string, number>();
  for (let index = 0; index < left.length - 1; index += 1) {
    const bigram = left.slice(index, index + 2);
    bigrams.set(bigram, (bigrams.get(bigram) ?? 0) + 1);
  }

  let matches = 0;
  for (let index = 0; index < right.length - 1; index += 1) {
    const bigram = right.slice(index, index + 2);
    const count = bigrams.get(bigram) ?? 0;
    if (count <= 0) continue;
    matches += 1;
    bigrams.set(bigram, count - 1);
  }

  return (2 * matches) / (left.length + right.length - 2);
};

export const scoreEntityNameMatch = (query: string, candidate: string) => {
  const normalizedQuery = normalizeEntityName(query);
  const normalizedCandidate = normalizeEntityName(candidate);
  if (!normalizedQuery || !normalizedCandidate) return 0;
  if (normalizedQuery === normalizedCandidate) return 1;

  const queryTokens = tokensFor(query);
  const candidateTokens = tokensFor(candidate);
  const queryTokenSet = new Set(queryTokens);
  const candidateTokenSet = new Set(candidateTokens);
  const intersectionSize = queryTokens.filter((token) =>
    candidateTokenSet.has(token),
  ).length;
  const unionSize = new Set([...queryTokens, ...candidateTokens]).size;
  const tokenScore = unionSize > 0 ? intersectionSize / unionSize : 0;

  const containmentScore =
    normalizedCandidate.includes(normalizedQuery) ||
    normalizedQuery.includes(normalizedCandidate)
      ? 0.92
      : 0;

  const prefixScore =
    queryTokens.some((queryToken) =>
      candidateTokens.some(
        (candidateToken) =>
          queryToken.length >= 4 &&
          candidateToken.length >= 4 &&
          (queryToken.startsWith(candidateToken) ||
            candidateToken.startsWith(queryToken)),
      ),
    )
      ? 0.78
      : 0;

  return Math.max(
    tokenScore,
    containmentScore,
    prefixScore,
    diceCoefficient(normalizedQuery, normalizedCandidate),
  );
};

export const rankEntityCandidates = ({
  query,
  candidates,
}: {
  query: string;
  candidates: MatchCandidate[];
}): RankedMatchCandidate[] =>
  candidates
    .map((candidate) => ({
      ...candidate,
      score: scoreEntityNameMatch(query, candidate.name),
      reason:
        candidate.type === "recurring_expense"
          ? "matched active recurring expense"
          : "matched active planned expense",
    }))
    .filter((candidate) => candidate.score >= 0.35)
    .sort((left, right) => right.score - left.score);
