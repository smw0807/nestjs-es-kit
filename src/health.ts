import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import type { HealthIndicatorResult } from '@nestjs/terminus';

import { ES_KIT_CLIENT } from './constants.js';
import type { EsClient } from './types.js';

/**
 * `@nestjs/terminus` HealthCheck 연동용 Elasticsearch 헬스 인디케이터.
 * `nestjs-es-kit/health` 서브패스로 임포트하며, `TerminusModule`과 함께 등록해야 합니다.
 *
 * @example
 * ```ts
 * // health.controller.ts
 * import { EsHealthIndicator } from 'nestjs-es-kit/health';
 *
 * @Controller('health')
 * export class HealthController {
 *   constructor(
 *     private readonly health: HealthCheckService,
 *     private readonly es: EsHealthIndicator,
 *   ) {}
 *
 *   @Get()
 *   @HealthCheck()
 *   check() {
 *     return this.health.check([() => this.es.isHealthy('elasticsearch')]);
 *   }
 * }
 * ```
 */
@Injectable()
export class EsHealthIndicator {
  constructor(
    @Inject(ES_KIT_CLIENT) private readonly client: EsClient,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  /**
   * Elasticsearch 클러스터 상태를 확인합니다.
   * 클러스터 상태가 `red`이거나 연결에 실패하면 `down` 상태를 반환합니다.
   *
   * @param key - 헬스체크 결과에 표시될 인디케이터 키 (예: `'elasticsearch'`)
   * @returns `HealthIndicatorResult` — terminus가 집계하는 헬스체크 결과 객체
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const response = await this.client.cluster.health();
      const data = {
        clusterStatus: response.status,
        numberOfNodes: response.number_of_nodes,
        activeShards: response.active_shards,
      };

      if (response.status === 'red') {
        return this.healthIndicatorService.check(key).down(data);
      }

      return this.healthIndicatorService.check(key).up(data);
    } catch (error) {
      return this.healthIndicatorService.check(key).down({
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
