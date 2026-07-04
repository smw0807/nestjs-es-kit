export class EsKitError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class IndexNotFoundError extends EsKitError {}

export class IndexAlreadyExistsError extends EsKitError {}

export class BreakingSchemaChangeError extends EsKitError {}

export class BulkPartialFailureError extends EsKitError {}

export class SchemaMetadataError extends EsKitError {}

export class UnsupportedEsVersionError extends EsKitError {}

export class MigrationError extends EsKitError {}
