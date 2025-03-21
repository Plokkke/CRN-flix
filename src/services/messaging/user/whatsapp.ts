import { Client } from 'whatsapp-web.js';

import { AuthDevicePublicCtxt } from '@/modules/trakt/types';
import { MediaRequestEntity } from '@/services/database/mediaRequests';

import { UserMessaging } from '.';

export class WhatsAppUserMessaging extends UserMessaging<string> {
  private client: Client;

  constructor() {
    super();
    this.client = new Client({});
  }

  async error(phoneNumber: string, message: string): Promise<void> {
    await this.client.sendMessage(phoneNumber, `Error: ${message}`);
  }

  async welcome(phoneNumber: string): Promise<void> {
    await this.client.sendMessage(phoneNumber, 'Welcome to TraktSync!');
  }

  async registered(phoneNumber: string): Promise<void> {
    await this.client.sendMessage(phoneNumber, 'Registration completed successfully!');
  }

  async traktLinkRequest(phoneNumber: string, authCtxt: AuthDevicePublicCtxt): Promise<void> {
    const url = `${authCtxt.verification_url}/${authCtxt.user_code}`;
    await this.client.sendMessage(phoneNumber, `Please link your Trakt account: ${url}`);
  }

  async mediaRequestUpdated(phoneNumber: string, request: MediaRequestEntity): Promise<void> {
    await this.client.sendMessage(phoneNumber, `Media update: ${request.title} - Status: ${request.status}`);
  }

  onJoin(handler: (id: string) => void): void {
    this.client.on('message', (message) => {
      handler(message.from);
    });
  }

  onRegisterRequest(handler: (id: string, username: string) => void): void {
    this.client.on('message', (message) => {
      if (message.body.startsWith('!register')) {
        const username = message.body.split(' ')[1];
        if (!username) {
          this.client.sendMessage(message.from, 'Please provide a username to register.');
          return;
        }
        handler(message.from, username);
      }
    });
  }

  onTraktLinkRequest(handler: (id: string) => void): void {
    this.client.on('message', (message) => {
      if (message.body === '!trakt-link') {
        handler(message.from);
      }
    });
  }
}
