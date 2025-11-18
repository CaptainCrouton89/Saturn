import natural from 'natural';
import crypto from 'crypto';

/**
 * Normalizes entity names for consistent entity_key generation and matching.
 * Handles:
 * - Case normalization (lowercase)
 * - Lemmatization (plural → singular, gerunds → base form)
 * - Token stemming for consistent hashing
 *
 * Examples:
 * - "Startups" → "startup"
 * - "Running Projects" → "run project"
 * - "Sarah's Ideas" → "sarah idea"
 */
export function normalizeEntityName(name: string): string {
  if (!name || typeof name !== 'string') {
    return '';
  }

  // Step 1: Lowercase and trim
  const cleaned = name.toLowerCase().trim();

  // Step 2: Remove possessives ('s)
  const withoutPossessives = cleaned.replace(/'s\b/g, '');

  // Step 3: Tokenize
  const tokenizer = new natural.WordTokenizer();
  const tokens = tokenizer.tokenize(withoutPossessives) || [];

  // Step 4: Stem each token (plural → singular, gerunds → base)
  const stemmer = natural.PorterStemmer;
  const stemmedTokens = tokens.map(token => stemmer.stem(token));

  // Step 5: Join with space
  return stemmedTokens.join(' ');
}

/**
 * Generates a stable entity_key for idempotent entity resolution.
 *
 * Format: SHA256(normalizedName + userId)
 *
 * This ensures:
 * - "startup" and "startups" generate the same key
 * - Keys are deterministic (same input → same key)
 * - Keys are unique per user
 */
export function generateEntityKey(
  name: string,
  userId: string
): string {
  const normalized = normalizeEntityName(name);
  const input = `${normalized}${userId}`;
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Batch normalizes multiple entity names efficiently.
 * Useful for Entity Extraction where many entities are extracted at once.
 */
export function normalizeEntityNames(names: string[]): string[] {
  return names.map(normalizeEntityName);
}

/**
 * Checks if two entity names are semantically equivalent after normalization.
 *
 * Use this for quick in-memory duplicate detection before database lookups.
 */
export function areNamesEquivalent(name1: string, name2: string): boolean {
  return normalizeEntityName(name1) === normalizeEntityName(name2);
}
