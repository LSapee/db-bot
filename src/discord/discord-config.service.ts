련import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class DiscordConfigService {
  constructor(private readonly configService: ConfigService) {}

  get token() {
    return this.configService.get<string>('DISCORD_BOT_TOKEN');
  }
}
