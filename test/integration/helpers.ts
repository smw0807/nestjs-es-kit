import { Client } from '@elastic/elasticsearch';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

const ES_VERSION = process.env['ES_VERSION'] ?? '8.18.2';
export const ES_IMAGE = `docker.elastic.co/elasticsearch/elasticsearch:${ES_VERSION}`;

export interface EsTestContext {
  container: StartedTestContainer | null;
  client: Client;
  esNode: string;
}

const ES_ENV = {
  'discovery.type': 'single-node',
  'xpack.security.enabled': 'false',
  ES_JAVA_OPTS: '-Xms512m -Xmx512m',
} as const;

const ES_WAIT = Wait.forHttp('/_cluster/health?wait_for_status=yellow&timeout=60s', 9200)
  .forStatusCode(200)
  .withStartupTimeout(120_000);

const startContainer = async (base: GenericContainer): Promise<EsTestContext> => {
  const container = await base
    .withEnvironment(ES_ENV)
    .withExposedPorts(9200)
    .withWaitStrategy(ES_WAIT)
    .start();

  const esNode = `http://${container.getHost()}:${String(container.getMappedPort(9200))}`;
  const client = new Client({ node: esNode });

  return { container, client, esNode };
};

/**
 * Connect to a pre-existing ES instance via ES_NODE / ES_USERNAME / ES_PASSWORD env vars,
 * or spin up a fresh testcontainers container if those vars are absent.
 */
export const startEsContainer = async (): Promise<EsTestContext> => {
  const esNode = process.env['ES_NODE'];
  if (esNode !== undefined) {
    const username = process.env['ES_USERNAME'];
    const password = process.env['ES_PASSWORD'];
    const client = new Client({
      node: esNode,
      ...(username !== undefined && password !== undefined
        ? { auth: { username, password } }
        : {}),
      tls: { rejectUnauthorized: false },
    });
    return { container: null, client, esNode };
  }

  return startContainer(new GenericContainer(ES_IMAGE));
};

export const startNoriContainer = async (): Promise<EsTestContext> => {
  const esNode = process.env['ES_NODE'];
  if (esNode !== undefined) {
    // Use the pre-existing local instance; caller should verify nori is installed
    return startEsContainer();
  }

  const imageTag = `es-nori-test:${ES_VERSION}`;
  const built = await GenericContainer.fromDockerfile('./test/docker', 'Dockerfile.es-nori')
    .withBuildArgs({ ES_VERSION })
    .build(imageTag, { deleteOnExit: false });

  return startContainer(built);
};

export const stopContainer = async (container: StartedTestContainer | null): Promise<void> => {
  if (container !== null) {
    await container.stop();
  }
};

export const isNoriAvailable = async (client: Client): Promise<boolean> => {
  try {
    await client.indices.analyze({ body: { tokenizer: 'nori_tokenizer', text: '테스트' } });
    return true;
  } catch {
    return false;
  }
};

export const cleanupIndices = async (client: Client, ...indices: string[]): Promise<void> => {
  for (const index of indices) {
    await client.indices.delete({ index, ignore_unavailable: true }).catch(() => {});
  }
};
