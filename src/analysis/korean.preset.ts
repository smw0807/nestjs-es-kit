/**
 * `koreanAnalysis()` 함수의 옵션.
 */
export interface KoreanAnalysisOptions {
  /**
   * nori 복합어 분해 모드.
   * - `'none'`: 분해 없이 원형 유지
   * - `'discard'`: 분해 후 복합어 원형 제거 (기본 권장)
   * - `'mixed'`: 원형과 분해 결과 모두 색인
   * @default 'mixed'
   */
  decompound?: 'none' | 'discard' | 'mixed';
  /**
   * 제거할 품사 태그 목록 (Sejong 태그셋).
   * ES 8.x의 집합 태그(`E`, `J`)는 ES 9.x(Lucene 10)에서 제거됨.
   * @default [] — ES 8/9 호환을 위해 기본값은 빈 배열
   */
  stoptags?: string[];
  /**
   * 동의어 규칙 목록 (`'A,B'` 또는 `'A => B'` 형식).
   * 공백이 포함된 경우(`'A, B'`)는 자동으로 정규화됩니다.
   * 동의어가 있으면 별도의 `nori_search_analyzer`가 생성됩니다.
   */
  synonyms?: string[];
  /**
   * 사용자 정의 단어 목록 (인라인 규칙).
   * nori tokenizer의 `user_dictionary_rules`에 직접 전달됩니다.
   * 형식: `'단어'` 또는 `'단어 분해1 분해2'`
   *
   * @example
   * ```ts
   * userDictionaryRules: ['삼성전자', 'LG전자', '카카오 카카오']
   * ```
   */
  userDictionaryRules?: string[];
}

// ES 8.x used aggregated tags (E, J). ES 9.x (Lucene 10) uses fine-grained Sejong tags.
// Default is empty for ES 8/9 compatibility. Pass stoptags explicitly when needed.
const defaultStopTags: string[] = [];

/**
 * nori 플러그인 기반 한국어 분석 설정 객체를 생성합니다.
 * `@EsIndex` 데코레이터의 `settings.analysis`에 스프레드하여 사용합니다.
 *
 * 동의어(`synonyms`)가 주어지면 두 개의 분석기가 생성됩니다:
 * - `nori_analyzer`: 색인용 (동의어 없음)
 * - `nori_search_analyzer`: 검색용 (`synonym_graph` 포함)
 *
 * 필드에 두 분석기를 모두 적용하려면 `search_analyzer: 'nori_search_analyzer'`를 함께 설정하세요.
 *
 * @example
 * ```ts
 * @EsIndex({
 *   name: 'products',
 *   settings: {
 *     analysis: koreanAnalysis({
 *       decompound: 'discard',
 *       synonyms: ['노트북,랩탑', '스마트폰,휴대폰'],
 *     }),
 *   },
 * })
 * class Product {
 *   @EsField({ type: 'text', analyzer: 'nori_analyzer', searchAnalyzer: 'nori_search_analyzer' })
 *   name: string;
 * }
 * ```
 */
export const koreanAnalysis = (options: KoreanAnalysisOptions = {}): Record<string, unknown> => {
  const filters: Record<string, unknown> = {
    nori_posfilter: {
      type: 'nori_part_of_speech',
      stoptags: options.stoptags ?? defaultStopTags,
    },
  };

  const baseFilters = ['nori_posfilter', 'lowercase'];

  const tokenizerConfig: Record<string, unknown> = {
    type: 'nori_tokenizer',
    decompound_mode: options.decompound ?? 'mixed',
  };

  if (options.userDictionaryRules !== undefined && options.userDictionaryRules.length > 0) {
    tokenizerConfig.user_dictionary_rules = options.userDictionaryRules;
  }

  const result: Record<string, unknown> = {
    tokenizer: {
      nori_tokenizer: tokenizerConfig,
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
