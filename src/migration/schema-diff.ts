import type { EsFieldMapping, SchemaDiff } from '../types.js';

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
