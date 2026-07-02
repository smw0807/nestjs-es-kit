export const ES_KIT_OPTIONS = Symbol('ES_KIT_OPTIONS');
export const ES_KIT_CLIENT = Symbol('ES_KIT_CLIENT');

export const getIndexServiceToken = (target: { readonly name: string }): string => `${target.name}EsIndexService`;
