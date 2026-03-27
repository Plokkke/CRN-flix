import { Logger } from '@nestjs/common';
import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { z } from 'zod';

import { logAxiosError, logAxiosRequest, logAxiosResponse } from '@/helpers/axios-logger';

export const clickupConfigSchema = z.object({
  apiToken: z.string(),
  teamId: z.string(),
  listId: z.string(),
});

export type ClickUpConfig = z.infer<typeof clickupConfigSchema>;

export type ClickUpCustomField<T> = {
  id: string;
  name: string;
  value: T;
};

export class ClickUpService {
  private static readonly logger = new Logger(ClickUpService.name);
  private readonly api: AxiosInstance;
  private isRateLimited = false;
  private waitingForRateLimitEnd: (() => void)[] = [];

  static async create(config: ClickUpConfig): Promise<ClickUpService> {
    return new ClickUpService(config);
  }

  private constructor(private readonly config: ClickUpConfig) {
    this.api = axios.create({
      baseURL: 'https://api.clickup.com/api/',
      headers: {
        Authorization: config.apiToken,
      },
    });

    this.api.interceptors.request.use(async (conf: InternalAxiosRequestConfig) => {
      await this.notRateLimited();
      logAxiosRequest(ClickUpService.logger, conf);
      return conf;
    });

    this.api.interceptors.response.use(
      (response) => {
        logAxiosResponse(ClickUpService.logger, response);
        return response;
      },
      async (error: AxiosError) => {
        if (error.response?.status === 429) {
          ClickUpService.logger.warn(`Rate limited by ClickUp, waiting for reset`);
          const resetTime = parseInt(error.response.headers['x-ratelimit-reset'] as string, 10);
          this.startRateLimitContext(resetTime);

          return this.api.request(error.config!);
        }
        logAxiosError(ClickUpService.logger, error);
        throw error;
      },
    );
  }

  private startRateLimitContext(until: number) {
    this.isRateLimited = true;
    const waitTime = (until - Math.floor(Date.now() / 1000)) * 1000;
    const rateLimitEnd = new Promise<void>((resolve) => setTimeout(resolve, waitTime));

    rateLimitEnd.then(() => {
      this.waitingForRateLimitEnd.forEach((unlock) => unlock());
      this.waitingForRateLimitEnd = [];
      this.isRateLimited = false;
    });
  }

  private async notRateLimited(): Promise<void> {
    if (!this.isRateLimited) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.waitingForRateLimitEnd.push(resolve);
    });
  }

  async getTask(taskId: string): Promise<{ status: { status: string } }> {
    const response = await this.api.get(`/v2/task/${taskId}`, {
      params: { team_id: this.config.teamId },
    });
    return response.data;
  }

  async createTask(
    name: string,
    description: string,
    tags: string[],
    customFields?: ClickUpCustomField<unknown>[],
  ): Promise<string> {
    try {
      const response = await this.api.post(
        `/v2/list/${this.config.listId}/task`,
        {
          name,
          description,
          status: 'Open',
          tags,
          custom_fields: customFields,
        },
        {
          params: {
            team_id: this.config.teamId,
          },
        },
      );

      return response.data.id;
    } catch (error) {
      ClickUpService.logger.error('Failed to create ClickUp task', error);
      throw error;
    }
  }

  async updateTaskStatus(taskId: string, status: string): Promise<void> {
    try {
      ClickUpService.logger.debug(`Calling ClickUp API to update task ${taskId} to status ${status}`);

      await this.api.put(
        `/v2/task/${taskId}`,
        {
          status,
        },
        {
          params: {
            team_id: this.config.teamId,
          },
        },
      );
    } catch (error) {
      ClickUpService.logger.error(`Failed to update ClickUp task ${taskId} status to ${status}`, {
        taskId,
        status,
        teamId: this.config.teamId,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  async deleteTask(taskId: string): Promise<void> {
    try {
      ClickUpService.logger.debug(`Deleting ClickUp task ${taskId}`);
      await this.api.delete(`/v2/task/${taskId}`, {
        params: { team_id: this.config.teamId },
      });
    } catch (error) {
      ClickUpService.logger.error(`Failed to delete ClickUp task ${taskId}`, {
        taskId,
        teamId: this.config.teamId,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  async updateTaskDescription(taskId: string, description: string): Promise<void> {
    try {
      ClickUpService.logger.debug(`Updating ClickUp task ${taskId} description`);

      const response = await this.api.put(
        `/v2/task/${taskId}`,
        {
          description,
        },
        {
          params: {
            team_id: this.config.teamId,
          },
        },
      );

      ClickUpService.logger.debug(`ClickUp task description updated:`, response.status);
    } catch (error) {
      ClickUpService.logger.error(`Failed to update ClickUp task ${taskId} description`, {
        taskId,
        teamId: this.config.teamId,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }
}
