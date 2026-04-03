export interface DiscordWired<T> {
  getByDiscordMessageId(discordMessageId: string): Promise<T | null>;
}
