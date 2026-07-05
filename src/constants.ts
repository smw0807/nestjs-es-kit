// Symbol.for() uses the global symbol registry so the same token is returned
// across separate bundle chunks (e.g. index.cjs vs health.cjs in tsup output).
export const ES_KIT_OPTIONS = Symbol.for('nestjs-es-kit/ES_KIT_OPTIONS');
export const ES_KIT_CLIENT = Symbol.for('nestjs-es-kit/ES_KIT_CLIENT');

const indexServiceTokens = new WeakMap<object, symbol>();

export const getIndexServiceToken = (target: object & { readonly name?: string }): symbol => {
  const existing = indexServiceTokens.get(target);
  if (existing !== undefined) {
    return existing;
  }

  const token = Symbol(`nestjs-es-kit/${target.name ?? 'Anonymous'}EsIndexService`);
  indexServiceTokens.set(target, token);
  return token;
};
