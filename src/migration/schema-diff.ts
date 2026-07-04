import type { EsFieldMapping, SchemaDiff } from '../types.js';

/**
 * 선언된 매핑(코드)과 실제 ES 인덱스 매핑을 비교하여 차이를 반환합니다.
 *
 * - `addedFields`: 코드에는 있지만 ES에 없는 필드 → `PUT /{index}/_mapping`으로 추가 가능
 * - `changedFields`: 타입·분석기가 변경된 필드 → 재인덱싱 필요 (breaking change)
 * - `removedFields`: ES에는 있지만 코드에서 제거된 필드 → ES는 필드를 삭제하지 않음(정보성)
 *
 * @param declared - `@EsField` 데코레이터로 선언된 매핑
 * @param actual   - ES `GET /{index}/_mapping` 응답의 properties
 */
export const diffMappings = (
  declared: Record<string, EsFieldMapping>,
  actual: Record<string, EsFieldMapping>,
): SchemaDiff => {
  const declaredKeys = Object.keys(declared);
  const actualKeys = Object.keys(actual);
  const addedFields = declaredKeys.filter((field) => !(field in actual));
  const removedFields = actualKeys.filter((field) => !(field in declared));
  const changedFields = declaredKeys
    .filter((field) => field in actual)
    .filter((field) => JSON.stringify(declared[field]) !== JSON.stringify(actual[field]))
    .map((field) => ({
      field,
      before: actual[field],
      after: declared[field],
    }));

  return {
    addedFields,
    changedFields,
    removedFields,
    settingsChanges: [],
    isBreaking: changedFields.length > 0,
  };
};
