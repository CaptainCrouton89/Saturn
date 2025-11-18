/**
 * Reciprocal Rank Fusion (RRF) Scoring Utility
 *
 * Combines multiple ranking signals using RRF algorithm with signal-aware boosting.
 * Used for entity resolution and multi-signal retrieval.
 *
 * References:
 * - Cormack et al. (2009) - "Reciprocal Rank Fusion outperforms Condorcet and individual Rank Learning Methods"
 * - https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf
 */

/**
 * Result from a single ranking signal
 */
export interface RankedResult<T = unknown> {
  /** Unique identifier for deduplication across signals */
  id: string;
  /** Metadata payload (e.g., entity_key, name, description) */
  data: T;
  /** Optional raw score from this signal (for debugging) */
  score?: number;
}

/**
 * Named ranking signal with results
 */
export interface RankingSignal<T = unknown> {
  /** Signal name for debugging/logging */
  name: string;
  /** Ranked results from this signal (order matters: rank 1 = index 0) */
  results: RankedResult<T>[];
}

/**
 * Configuration for RRF scoring
 */
export interface RRFConfig {
  /** RRF constant k (default: 60, standard value) */
  k?: number;
  /** Maximum number of candidates to return (default: 10) */
  topK?: number;
  /** Signal-aware boosts for interpretability (default: none) */
  boosts?: SignalBoost[];
}

/**
 * Signal-aware boost configuration
 * Applies minimum similarity score based on which signals matched
 */
export interface SignalBoost {
  /** Signal names that must ALL match (AND logic) */
  requiredSignals: readonly string[];
  /** Minimum similarity score to apply (0-1) */
  minSimilarity: number;
  /** Description for logging/debugging */
  description: string;
}

/**
 * RRF-scored result with combined ranking
 */
export interface RRFResult<T = unknown> {
  /** Unique identifier */
  id: string;
  /** Metadata payload */
  data: T;
  /** Raw RRF score (sum of reciprocal ranks) */
  rrfScore: number;
  /** Normalized similarity score (0-1) */
  similarity: number;
  /** Which signals matched this result */
  matchedSignals: string[];
  /** Rank in each signal (for debugging) */
  signalRanks: Record<string, number>;
}

/**
 * Default RRF configuration
 */
const DEFAULT_CONFIG: Required<RRFConfig> = {
  k: 60,
  topK: 10,
  boosts: [],
};

/**
 * Combines multiple ranking signals using Reciprocal Rank Fusion
 *
 * RRF Formula: score = Σ 1/(k + rank_i) for all signals i
 * where k=60 (standard constant) and rank starts at 1
 *
 * @param signals - Array of ranking signals to combine
 * @param config - RRF configuration (k, topK, boosts)
 * @returns Top-K results sorted by RRF score DESC
 *
 * @example
 * ```typescript
 * const results = combineRankings([
 *   { name: 'embedding', results: [...] },
 *   { name: 'exact_match', results: [...] },
 *   { name: 'fuzzy_match', results: [...] }
 * ], {
 *   k: 60,
 *   topK: 10,
 *   boosts: [
 *     { requiredSignals: ['exact_match'], minSimilarity: 0.9, description: 'Exact match boost' }
 *   ]
 * });
 * ```
 */
export function combineRankings<T = unknown>(
  signals: RankingSignal<T>[],
  config?: RRFConfig
): RRFResult<T>[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { k, topK, boosts } = cfg;

  // Build rank maps for each signal
  const signalRanks = new Map<string, Map<string, number>>();
  for (const signal of signals) {
    const rankMap = new Map<string, number>();
    signal.results.forEach((result, index) => {
      rankMap.set(result.id, index + 1); // Rank starts at 1
    });
    signalRanks.set(signal.name, rankMap);
  }

  // Collect all unique IDs across signals
  const allIds = new Set<string>();
  for (const signal of signals) {
    for (const result of signal.results) {
      allIds.add(result.id);
    }
  }

  // Calculate RRF score for each candidate
  const rrfResults: RRFResult<T>[] = [];

  for (const id of allIds) {
    let rrfScore = 0;
    const matchedSignals: string[] = [];
    const ranks: Record<string, number> = {};

    // Sum reciprocal ranks across all signals
    for (const signal of signals) {
      const rankMap = signalRanks.get(signal.name)!;
      const rank = rankMap.get(id);

      if (rank !== undefined) {
        rrfScore += 1 / (k + rank);
        matchedSignals.push(signal.name);
        ranks[signal.name] = rank;
      }
    }

    // Get metadata from first matched signal
    const firstSignal = signals.find((s) =>
      s.results.some((r) => r.id === id)
    );
    const data = firstSignal?.results.find((r) => r.id === id)?.data;

    if (!data) {
      console.warn(`⚠️  No data found for ID ${id} - skipping`);
      continue;
    }

    rrfResults.push({
      id,
      data,
      rrfScore,
      similarity: 0, // Will be calculated below
      matchedSignals,
      signalRanks: ranks,
    });
  }

  // Sort by RRF score DESC
  rrfResults.sort((a, b) => b.rrfScore - a.rrfScore);

  // Calculate normalized similarity with interpretable scale
  // We want: exact match = 1.0, fuzzy = 0.7, weak semantic = 0.3-0.5
  // Instead of normalizing to theoretical max, use signal-aware scoring
  for (const result of rrfResults) {
    let similarity = 0;

    // Apply signal-aware boosts (highest boost wins)
    let boosted = false;
    for (const boost of boosts) {
      // Check if all required signals matched
      const hasAllSignals = boost.requiredSignals.every((sig) =>
        result.matchedSignals.includes(sig)
      );

      if (hasAllSignals) {
        similarity = Math.max(similarity, boost.minSimilarity);
        boosted = true;
      }
    }

    // If no boost applied, scale RRF to interpretable range
    if (!boosted) {
      // RRF scores typically range from 0.01 (weak) to 0.05 (strong)
      // Map to 0.3-0.6 range for semantic-only matches
      const minRrf = 0.01; // Weak match threshold
      const maxRrf = 0.05; // Strong match (rank 1 in all signals)

      // Linear interpolation from [minRrf, maxRrf] to [0.3, 0.6]
      const normalized = Math.min(1.0, Math.max(0.0, (result.rrfScore - minRrf) / (maxRrf - minRrf)));
      similarity = 0.3 + (normalized * 0.3); // Maps to [0.3, 0.6]
    }

    // Clamp to [0, 1]
    result.similarity = Math.min(1.0, Math.max(0.0, similarity));
  }

  // Return top-K results
  return rrfResults.slice(0, topK);
}

/**
 * Predefined boost configurations for common use cases
 *
 * Interpretable similarity scale:
 * - 1.0: Perfect exact match
 * - 0.7-0.9: Fuzzy/approximate matches
 * - 0.3-0.6: Semantic-only matches (embedding similarity)
 * - <0.3: Weak/irrelevant matches
 */
export const COMMON_BOOSTS = {
  /** Exact name match gets 90% minimum similarity (very high confidence) */
  exactMatch: {
    requiredSignals: ['exact_match'],
    minSimilarity: 0.9,
    description: 'Exact match boost (90% minimum)',
  },
  /** Fuzzy + embedding match gets 70% minimum similarity (high confidence) */
  fuzzyAndEmbedding: {
    requiredSignals: ['fuzzy_match', 'embedding'],
    minSimilarity: 0.7,
    description: 'Fuzzy + embedding boost (70% minimum)',
  },
  /** Fuzzy match only gets 60% minimum similarity (moderate confidence) */
  fuzzyOnly: {
    requiredSignals: ['fuzzy_match'],
    minSimilarity: 0.6,
    description: 'Fuzzy match only boost (60% minimum)',
  },
} as const;
