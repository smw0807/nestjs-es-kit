// Symbol.for() uses the global symbol registry so the same token is returned
// across separate bundle chunks (e.g. index.cjs vs health.cjs in tsup output).
export const ES_KIT_OPTIONS = Symbol.for('nestjs-es-kit/ES_KIT_OPTIONS');
export const ES_KIT_CLIENT = Symbol.for('nestjs-es-kit/ES_KIT_CLIENT');

export const getIndexServiceToken = (target: { readonly name: string }): string => `${target.name}EsIndexService`;
