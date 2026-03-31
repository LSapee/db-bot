import { ConsoleLogger, LogLevel } from '@nestjs/common';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export class FileLogger extends ConsoleLogger {
  private readonly logsDir = join(process.cwd(), 'logs');

  constructor(context?: string, options?: { logLevels?: LogLevel[] }) {
    super(context, options);
    mkdirSync(this.logsDir, { recursive: true });
  }

  override log(message: unknown, context?: string) {
    super.log(message, context);
    this.writeLog('log', message, context);
  }

  override error(message: unknown, stack?: string, context?: string) {
    super.error(message, stack, context);
    this.writeLog('error', message, context, stack);
  }

  override warn(message: unknown, context?: string) {
    super.warn(message, context);
    this.writeLog('warn', message, context);
  }

  override debug(message: unknown, context?: string) {
    super.debug(message, context);
    this.writeLog('debug', message, context);
  }

  override verbose(message: unknown, context?: string) {
    super.verbose(message, context);
    this.writeLog('verbose', message, context);
  }

  override fatal(message: unknown, stack?: string, context?: string) {
    super.fatal(message, stack, context);
    this.writeLog('fatal', message, context, stack);
  }

  private writeLog(
    level: 'log' | 'error' | 'warn' | 'debug' | 'verbose' | 'fatal',
    message: unknown,
    context?: string,
    stack?: string,
  ) {
    const now = new Date();
    const dateText = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate(),
    ).padStart(2, '0')}`;
    const timestamp = now.toISOString();
    const normalizedMessage = this.formatMessageText(message);
    const contextText = context ?? this.context ?? 'App';
    const logLine = [
      `[${timestamp}]`,
      `[${level.toUpperCase()}]`,
      `[${contextText}]`,
      normalizedMessage,
      stack?.trim() ? `\n${stack.trim()}` : '',
      '\n',
    ].join(' ');

    appendFileSync(join(this.logsDir, `app-${dateText}.log`), logLine, 'utf8');

    if (level === 'error' || level === 'fatal') {
      appendFileSync(join(this.logsDir, `error-${dateText}.log`), logLine, 'utf8');
    }
  }

  private formatMessageText(message: unknown) {
    if (typeof message === 'string') {
      return message;
    }

    if (message instanceof Error) {
      return message.message;
    }

    try {
      return JSON.stringify(message);
    } catch {
      return String(message);
    }
  }
}
