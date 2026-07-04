import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import type { HealthIndicatorResult } from '@nestjs/terminus';

import { ES_KIT_CLIENT } from './constants.js';
import type { EsClient } from './types.js';

@Injectable()
export class EsHealthIndicator {
  constructor(
    @Inject(ES_KIT_CLIENT) private readonly client: EsClient,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

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
