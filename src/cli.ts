import 'reflect-metadata';

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { BreakingSchemaChangeError } from './errors/index.js';
import { EsStandaloneManager } from './standalone.js';
import type { EsDocumentClass, EsKitModuleOptions, MigrateOptions, SchemaDiff } from './types.js';

export interface EsKitCliConfig extends EsKitModuleOptions {
  /** 처리할 스키마 클래스 목록 */
  schemas: EsDocumentClass[];
  /** migrate 커맨드 기본 옵션 */
  migrateOptions?: MigrateOptions;
}

const USAGE = `
Usage: es-kit <command> [options]

Commands:
  migrate   Zero-downtime alias-swap reindex (requires useAlias: true)
  sync      Sync mappings and settings with the declared schema
  diff      Show differences between schema declaration and ES index
  create    Create indices for schemas that do not exist yet

Options:
  --config, -c   Path to config file  (default: ./es-kit.config.js)
  --delete-old   Delete old index after migration  (migrate only)
  --help, -h     Show this help message

Config file format (es-kit.config.js):
  export default {
    node: 'http://localhost:9200',
    auth: { username: 'elastic', password: 'secret' },
    schemas: [ProductV2, OrderV2],
  };
`.trim();

async function loadConfig(configPath: string): Promise<EsKitCliConfig> {
  const absPath = resolve(process.cwd(), configPath);
  const fileUrl = pathToFileURL(absPath).href;
  // dynamic import returns `any` — we validate shape manually
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const mod = await import(fileUrl);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const config: unknown = (mod.default as unknown) ?? mod;
  if (typeof config !== 'object' || config === null || !('node' in config)) {
    throw new Error(`Config file must export an object with at least a 'node' field.`);
  }
  return config as EsKitCliConfig;
}

function formatDiff(name: string, diff: SchemaDiff): string {
  const lines: string[] = [`\nSchema: ${name}`];

  if (diff.addedFields.length > 0) {
    lines.push('  Mapping:');
    for (const f of diff.addedFields) lines.push(`    + ${f}  (new field)`);
  }
  if (diff.changedFields.length > 0) {
    if (diff.addedFields.length === 0) lines.push('  Mapping:');
    for (const f of diff.changedFields) {
      lines.push(`    ~ ${f.field}  [BREAKING] ${JSON.stringify(f.before)} → ${JSON.stringify(f.after)}`);
    }
  }
  if (diff.removedFields.length > 0) {
    for (const f of diff.removedFields) lines.push(`    - ${f}  (removed from code, ES retains)`);
  }

  if (diff.settingsChanges.length > 0) {
    lines.push('  Settings:');
    for (const s of diff.settingsChanges) {
      const tag = ['number_of_shards', 'analysis'].includes(s.setting) ? '  [BREAKING]' : '';
      lines.push(`    ~ ${s.setting}${tag}  ${JSON.stringify(s.before)} → ${JSON.stringify(s.after)}`);
    }
  }

  if (diff.addedFields.length === 0 && diff.changedFields.length === 0 && diff.settingsChanges.length === 0) {
    lines.push('  No differences detected.');
  } else if (diff.isBreaking) {
    lines.push('\n  Breaking changes detected. Run "es-kit migrate" to proceed.');
  }

  return lines.join('\n');
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      config: { type: 'string', short: 'c', default: './es-kit.config.js' },
      'delete-old': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help || positionals.length === 0) {
    console.log(USAGE);
    process.exit(0);
  }

  const command = positionals[0];
  const configPath = values.config;

  const config = await loadConfig(configPath);
  const schemas = config.schemas;

  if (schemas.length === 0) {
    console.error('Error: config.schemas is empty. Add at least one schema class.');
    process.exit(1);
  }

  const manager = new EsStandaloneManager(config);

  switch (command) {
    case 'migrate': {
      for (const schema of schemas) {
        const result = await manager.migrate(schema, {
          ...config.migrateOptions,
          deleteOldIndex: values['delete-old'],
        });
        console.log(
          `[migrate] ${result.fromIndex} → ${result.toIndex}  (${String(result.documentsReindexed)} docs reindexed)`,
        );
      }
      break;
    }

    case 'sync': {
      for (const schema of schemas) {
        try {
          await manager.sync(schema);
          console.log(`[sync] ${schema.name}: OK`);
        } catch (error) {
          if (error instanceof BreakingSchemaChangeError) {
            console.error(`[sync] ${schema.name}: ${error.message}`);
            process.exit(1);
          }
          throw error;
        }
      }
      break;
    }

    case 'diff': {
      let hasBreaking = false;
      for (const schema of schemas) {
        const diff = await manager.diff(schema);
        console.log(formatDiff(schema.name, diff));
        if (diff.isBreaking) hasBreaking = true;
      }
      if (hasBreaking) process.exit(1);
      break;
    }

    case 'create': {
      for (const schema of schemas) {
        await manager.create(schema);
        console.log(`[create] ${schema.name}: OK`);
      }
      break;
    }

    default:
      console.error(`Unknown command: ${String(command)}\n`);
      console.log(USAGE);
      process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error('Error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
