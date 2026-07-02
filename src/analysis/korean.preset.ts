export interface KoreanAnalysisOptions {
  decompound?: 'none' | 'discard' | 'mixed';
  stoptags?: string[];
  synonyms?: string[];
}

const defaultStopTags = [
  'E',
  'IC',
  'J',
  'MAG',
  'MAJ',
  'MM',
  'SP',
  'SSC',
  'SSO',
  'SC',
  'SE',
  'XPN',
  'XSA',
  'XSN',
  'XSV',
  'UNA',
  'NA',
  'VSV',
];

export const koreanAnalysis = (options: KoreanAnalysisOptions = {}): Record<string, unknown> => {
  const filters: Record<string, unknown> = {
    nori_posfilter: {
      type: 'nori_part_of_speech',
      stoptags: options.stoptags ?? defaultStopTags,
    },
  };

  const analyzerFilters = ['nori_posfilter', 'lowercase'];

  if (options.synonyms !== undefined && options.synonyms.length > 0) {
    filters.nori_synonym = {
      type: 'synonym',
      synonyms: options.synonyms,
    };
    analyzerFilters.unshift('nori_synonym');
  }

  return {
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
        filter: analyzerFilters,
      },
    },
  };
};
