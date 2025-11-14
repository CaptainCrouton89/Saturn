/**
 * Attitude/Proximity semantic mapping utilities
 * 
 * Provides bidirectional mapping between numeric scores (1-5) and semantic words
 * for relationship attitude and proximity across different relationship types.
 * 
 * Used for generating semantic embeddings and displaying relationship semantics.
 */

/**
 * Mapping of relationship types to their attitude/proximity word arrays
 */
export interface AttitudeProximityMapping {
  readonly has_relationship_with: { attitude: readonly string[]; proximity: readonly string[] };
  readonly engages_with: { attitude: readonly string[]; proximity: readonly string[] };
  readonly associated_with: { attitude: readonly string[]; proximity: readonly string[] };
  readonly relates_to: { attitude: readonly string[]; proximity: readonly string[] };
  readonly involves: { attitude: readonly string[]; proximity: readonly string[] };
  readonly connected_to: { attitude: readonly string[]; proximity: readonly string[] };
}

export type CypherRelationshipType = keyof AttitudeProximityMapping;

/**
 * Word mappings for attitude/proximity scores (1-5)
 * Used to generate relation_embedding for semantic relationship search
 */
export const WORD_MAPPINGS: AttitudeProximityMapping = {
  has_relationship_with: {
    // Person → Person
    attitude: ['hostile', 'unfriendly', 'neutral', 'friendly', 'close'],
    proximity: ['stranger', 'acquaintance', 'familiar', 'known-well', 'intimate-knowledge'],
  },
  engages_with: {
    // Person → Concept
    attitude: ['dislikes', 'skeptical', 'neutral', 'interested', 'passionate'],
    proximity: ['unfamiliar', 'aware', 'understands', 'experienced', 'expert'],
  },
  associated_with: {
    // Person → Entity
    attitude: ['negative-view', 'unfavorable', 'neutral', 'favorable', 'strongly-positive'],
    proximity: ['distant', 'aware-of', 'familiar-with', 'involved-with', 'deeply-connected'],
  },
  relates_to: {
    // Concept → Concept
    attitude: ['contradicts', 'conflicts', 'independent', 'complementary', 'integral'],
    proximity: ['loosely-related', 'somewhat-related', 'related', 'closely-related', 'inseparable'],
  },
  involves: {
    // Concept → Entity
    attitude: ['peripheral', 'minor', 'relevant', 'important', 'central'],
    proximity: ['tangential', 'mentioned', 'involved', 'key-component', 'essential'],
  },
  connected_to: {
    // Entity → Entity
    attitude: ['adversarial', 'competing', 'independent', 'cooperative', 'integrated'],
    proximity: ['distantly-connected', 'indirectly-connected', 'connected', 'closely-linked', 'tightly-coupled'],
  },
} as const;

/**
 * Forward mapping: Convert numeric attitude/proximity scores (1-5) to semantic words
 * 
 * @param cypherRelType - The Cypher relationship type
 * @param attitude - Attitude score (1-5)
 * @param proximity - Proximity score (1-5)
 * @returns Object with attitudeWord and proximityWord
 * @throws Error if relationship type is unsupported or scores are out of range
 */
export function getAttitudeProximityWords(
  cypherRelType: CypherRelationshipType,
  attitude: number,
  proximity: number
): { attitudeWord: string; proximityWord: string } {
  const mapping = WORD_MAPPINGS[cypherRelType];
  
  if (!mapping) {
    throw new Error(`Unsupported relationship type: ${cypherRelType}`);
  }
  
  if (!isValidAttitudeProximity(attitude, proximity)) {
    throw new Error('Attitude/proximity must be 1-5');
  }
  
  // Convert 1-indexed to 0-indexed array access
  const attitudeWord = mapping.attitude[attitude - 1];
  const proximityWord = mapping.proximity[proximity - 1];
  
  if (!attitudeWord || !proximityWord) {
    throw new Error(`Invalid attitude/proximity scores: ${attitude}, ${proximity}`);
  }
  
  return { attitudeWord, proximityWord };
}

/**
 * Reverse mapping: Convert semantic words to numeric attitude/proximity scores (1-5)
 * 
 * @param cypherRelType - The Cypher relationship type
 * @param attitudeWord - Attitude word (case-insensitive)
 * @param proximityWord - Proximity word (case-insensitive)
 * @returns Object with attitude and proximity scores (1-5)
 * @throws Error if relationship type is unsupported or words are invalid
 */
export function getAttitudeProximityNumbers(
  cypherRelType: CypherRelationshipType,
  attitudeWord: string,
  proximityWord: string
): { attitude: number; proximity: number } {
  const mapping = WORD_MAPPINGS[cypherRelType];
  
  if (!mapping) {
    throw new Error(`Unsupported relationship type: ${cypherRelType}`);
  }
  
  // Case-insensitive matching
  const attitudeLower = attitudeWord.toLowerCase();
  const proximityLower = proximityWord.toLowerCase();
  
  const attitudeIndex = mapping.attitude.findIndex(
    (word) => word.toLowerCase() === attitudeLower
  );
  const proximityIndex = mapping.proximity.findIndex(
    (word) => word.toLowerCase() === proximityLower
  );
  
  if (attitudeIndex === -1) {
    throw new Error(`Invalid word "${attitudeWord}" for relationship type "${cypherRelType}"`);
  }
  
  if (proximityIndex === -1) {
    throw new Error(`Invalid word "${proximityWord}" for relationship type "${cypherRelType}"`);
  }
  
  // Convert 0-indexed to 1-indexed
  return {
    attitude: attitudeIndex + 1,
    proximity: proximityIndex + 1,
  };
}

/**
 * Get all valid words for a relationship type
 * 
 * @param cypherRelType - The Cypher relationship type
 * @returns Object with attitude and proximity word arrays
 * @throws Error if relationship type is unsupported
 */
export function getValidWords(
  cypherRelType: CypherRelationshipType
): { attitude: readonly string[]; proximity: readonly string[] } {
  const mapping = WORD_MAPPINGS[cypherRelType];
  
  if (!mapping) {
    throw new Error(`Unsupported relationship type: ${cypherRelType}`);
  }
  
  return {
    attitude: mapping.attitude,
    proximity: mapping.proximity,
  };
}

/**
 * Validate attitude/proximity numeric scores
 * 
 * @param attitude - Attitude score to validate
 * @param proximity - Proximity score to validate
 * @returns True if both scores are valid (1-5), false otherwise
 */
export function isValidAttitudeProximity(attitude: number, proximity: number): boolean {
  return (
    Number.isInteger(attitude) &&
    Number.isInteger(proximity) &&
    attitude >= 1 &&
    attitude <= 5 &&
    proximity >= 1 &&
    proximity <= 5
  );
}

/**
 * Validate words for a relationship type
 * 
 * @param cypherRelType - The Cypher relationship type
 * @param attitudeWord - Attitude word to validate (case-insensitive)
 * @param proximityWord - Proximity word to validate (case-insensitive)
 * @returns True if both words are valid for the relationship type, false otherwise
 */
export function isValidWords(
  cypherRelType: CypherRelationshipType,
  attitudeWord: string,
  proximityWord: string
): boolean {
  try {
    getAttitudeProximityNumbers(cypherRelType, attitudeWord, proximityWord);
    return true;
  } catch {
    return false;
  }
}
