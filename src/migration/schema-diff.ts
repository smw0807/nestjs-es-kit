import type { EsFieldMapping, SchemaDiff, SettingChange } from '../types.js';

/**
 * 재인덱싱 없이는 변경할 수 없는 ES 정적 설정 키.
 * 이 키가 변경되면 `isBreaking: true`로 처리합니다.
 */
export const STATIC_SETTING_KEYS = new Set(['number_of_shards', 'analysis']);

/**
 * ES는 숫자 설정값을 문자열로 반환하므로(`"3"` vs `3`) 비교 전 정규화합니다.
 * 객체는 JSON.stringify로 직렬화하여 비교합니다.
 */
const normalizeSettingValue = (val: unknown): string => {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') return JSON.stringify(val);
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return JSON.stringify(val);
};

/**
 * 선언된 인덱스 설정과 ES 실제 설정을 비교하여 변경된 항목을 반환합니다.
 *
 * - `number_of_shards`, `analysis`는 정적 설정 → `isBreaking: true`
 * - `number_of_replicas`, `refresh_interval` 등은 동적 설정 → `PUT /{index}/_settings`로 반영 가능
 *
 * @param declared - `@EsIndex` 스키마에서 빌드된 snake_case 설정 객체
 * @param actual   - ES `GET /{index}/_settings` 응답의 `settings.index`
 */
export const diffSettings = (
  declared: Record<string, unknown>,
  actual: Record<string, unknown>,
): { changes: SettingChange[]; isBreaking: boolean } => {
  const changes: SettingChange[] = [];
  let isBreaking = false;

  for (const key of Object.keys(declared)) {
    if (normalizeSettingValue(declared[key]) !== normalizeSettingValue(actual[key])) {
      changes.push({ setting: key, before: actual[key], after: declared[key] });
      if (STATIC_SETTING_KEYS.has(key)) {
        isBreaking = true;
      }
    }
  }

  return { changes, isBreaking };
};

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
  const result: SchemaDiff = {
    addedFields: [],
    changedFields: [],
    removedFields: [],
    settingsChanges: [],
    isBreaking: false,
  };

  collectMappingDiff('', declared, actual, result);

  return {
    ...result,
    isBreaking: result.changedFields.length > 0,
  };
};

const collectMappingDiff = (
  prefix: string,
  declared: Record<string, EsFieldMapping>,
  actual: Record<string, EsFieldMapping>,
  result: SchemaDiff,
): void => {
  const declaredKeys = Object.keys(declared);
  const actualKeys = Object.keys(actual);

  for (const field of declaredKeys) {
    const path = joinPath(prefix, field);
    const declaredMapping = declared[field];
    const actualMapping = actual[field];

    if (declaredMapping === undefined) {
      continue;
    }

    if (actualMapping === undefined) {
      result.addedFields.push(path);
      continue;
    }

    if (JSON.stringify(withoutProperties(declaredMapping)) !== JSON.stringify(withoutProperties(actualMapping))) {
      result.changedFields.push({
        field: path,
        before: actualMapping,
        after: declaredMapping,
      });
      continue;
    }

    if (declaredMapping.properties !== undefined || actualMapping.properties !== undefined) {
      collectMappingDiff(path, declaredMapping.properties ?? {}, actualMapping.properties ?? {}, result);
    }
  }

  for (const field of actualKeys) {
    if (!(field in declared)) {
      result.removedFields.push(joinPath(prefix, field));
    }
  }
};

const joinPath = (prefix: string, field: string): string => (prefix.length === 0 ? field : `${prefix}.${field}`);

const withoutProperties = (mapping: EsFieldMapping): Omit<EsFieldMapping, 'properties'> => {
  const rest: EsFieldMapping = { ...mapping };
  delete rest.properties;
  return rest;
};
