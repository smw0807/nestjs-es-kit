export interface KoreanAnalysisOptions {
  decompound?: 'none' | 'discard' | 'mixed';
  stoptags?: string[];
  synonyms?: string[];
}

// ES 8.x used aggregated tags (E, J). ES 9.x (Lucene 10) uses fine-grained Sejong tags.
// Default is empty for ES 8/9 compatibility. Pass stoptags explicitly when needed.
const defaultStopTags: string[] = [];

export const koreanAnalysis = (options: KoreanAnalysisOptions = {}): Record<string, unknown> => {
  const filters: Record<string, unknown> = {
    nori_posfilter: {
      type: 'nori_part_of_speech',
      stoptags: options.stoptags ?? defaultStopTags,
    },
  };

  const baseFilters = ['nori_posfilter', 'lowercase'];

  const result: Record<string, unknown> = {
    tokenizer: {
      nori_tokenizer: {
        type: 'nori_tokenizer',
        decompound_mode: options.decompound ?? 'mixed',
      },
    },
    filter: filters,
    analyzer: {
      nori_analyzer: {
        type: 'custom',
        tokenizer: 'nori_tokenizer',
        filter: baseFilters,
      },
    },
  };

  // synonym_graph is search-time only — wire it into a dedicated search analyzer.
  if (options.synonyms !== undefined && options.synonyms.length > 0) {
    // Normalize 'A, B' → 'A,B' to avoid whitespace-tokenizer producing 'A,' as an invalid token.
    // lenient: true silently skips rules that fail to parse (e.g. Korean rules on ES 9.x nori).
    const normalizedSynonyms = options.synonyms.map((rule) => rule.replace(/\s*,\s*/g, ','));
    filters.nori_synonym = {
      type: 'synonym_graph',
      synonyms: normalizedSynonyms,
      lenient: true,
    };

    (result['analyzer'] as Record<string, unknown>)['nori_search_analyzer'] = {
      type: 'custom',
      tokenizer: 'nori_tokenizer',
      filter: ['nori_synonym', ...baseFilters],
    };
  }

  return result;
};
