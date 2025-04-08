import { Logger } from '@nestjs/common';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { z } from 'zod';

export type JellyfinUser = {
  id: string;
  name: string;
  password: string;
};

export type JellyfinApiUser = {
  Id: string;
  Name: string;
};

export const jellyfinConfigSchema = z
  .object({
    url: z.string(),
    token: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
  })
  .refine((config) => config.token || (config.username && config.password), {
    message: 'Authentication required, either token or username and password must be provided',
    path: ['token', 'username', 'password'],
  });

type JellyfinConfig = z.infer<typeof jellyfinConfigSchema>;

export type ExternalIds = {
  Imdb?: string;
  Tvdb?: string;
  Tmdb?: string;
  TmdbCollection?: string;
};

export type JellyfinMedia = {
  Id: string;
  Name: string;
  ProductionYear: number;
  Type: 'Movie' | 'Series' | 'Episode';
  SeriesName?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  ProviderIds: ExternalIds;
  SeriesPrimaryImage?: string;
  ChannelImage?: string;
};

export type JellyfinPlugin = {
  Id: string;
  Name: string;
  Version: string;
  ConfigurationFileName: string;
};

export class JellyfinMediaService {
  private static readonly logger: Logger = new Logger(JellyfinMediaService.name);

  private static async authenticate(config: JellyfinConfig): Promise<string> {
    this.logger.log(`Authenticate user ${config.username} on ${config.url}`);
    this.logger.debug(`Using password: ${config.password}`);
    const response = await axios.post(`${config.url}/Users/AuthenticateByName`, {
      Username: config.username,
      Pw: config.password,
    });

    return response.data.AccessToken;
  }

  static async create(config: JellyfinConfig): Promise<JellyfinMediaService> {
    try {
      const token = config.token ?? (await this.authenticate(config));

      return new JellyfinMediaService(config, token);
    } catch (error) {
      if (error instanceof AxiosError) {
        throw new Error(`Authentification échouée : ${error.message} - ${error.response?.data}`);
      } else {
        throw new Error(`Authentification échouée : ${error}`);
      }
    }
  }

  private readonly api: AxiosInstance;

  private constructor(
    readonly config: JellyfinConfig,
    readonly token: string,
  ) {
    this.api = axios.create({
      baseURL: config.url,
      headers: {
        'Content-Type': 'application/json',
        'X-Emby-Token': token,
        Authorization: `MediaBrowser Token="${token}"`,
      },
    });
  }

  get url(): string {
    return this.config.url;
  }

  async registerUser(userName: string, password: string): Promise<string> {
    const response = await this.api
      .post('/Users/New', { Name: userName, Password: password })
      .catch((error: AxiosError) => {
        if (error.response?.status === 400) {
          throw new Error('User already exists');
        }
        throw error;
      });
    return response.data.Id;
  }

  async resetUserPassword(userId: string, password: string): Promise<void> {
    await this.api.post(`/Users/${userId}/Password`, {
      resetPassword: true,
    });
    await this.api.post(`/Users/${userId}/Password`, {
      CurrentPw: '',
      NewPw: password,
    });
  }

  async listAssets(): Promise<JellyfinMedia[]> {
    try {
      const itemsResponse = await this.api.get<{ Items: JellyfinMedia[] }>(`/Items`, {
        params: {
          Recursive: true,
          Fields: 'Id,Name,Type,OriginalTitle,ExternalSeriesId,ProviderIds,ExtraIds',
          hasImdbId: true,
          includeItemTypes: 'Movie,Episode',
        },
      });

      return itemsResponse.data.Items;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Erreur lors de la récupération des médias : ${error.message}`);
      } else {
        throw new Error(`Erreur inconnue lors de la récupération des médias: ${error}`);
      }
    }
  }

  async listEntries(): Promise<JellyfinMedia[]> {
    const response = await this.api.get<{ Items: JellyfinMedia[] }>(`/Items`, {
      params: {
        Recursive: true,
        includeItemTypes: 'Movie,Series',
      },
    });
    return response.data.Items;
  }

  async listPlugins(): Promise<JellyfinPlugin[]> {
    const response = await this.api.get<JellyfinPlugin[]>(`/Plugins`);
    return response.data;
  }

  async getPluginConfiguration(pluginId: string): Promise<unknown> {
    const response = await this.api.get<unknown>(`/Plugins/${pluginId}/Configuration`);
    return response.data;
  }

  async setPluginConfiguration(pluginId: string, configuration: unknown): Promise<void> {
    await this.api.post(`/Plugins/${pluginId}/Configuration`, configuration);
  }

  async getUser(userId: string): Promise<JellyfinUser> {
    const response = await this.api.get<JellyfinApiUser>(`/Users/${userId}`);
    return {
      id: response.data.Id,
      name: response.data.Name,
      password: '',
    };
  }
}
