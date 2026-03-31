import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { FileLogger } from './logging/file-logger';

async function bootstrap() {
  const port = Number(process.env.PORT ?? 3000);
  const logger = new FileLogger('Bootstrap', {
    logLevels: ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'],
  });
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(logger);
  app.enableShutdownHooks();

  process.on('unhandledRejection', (reason) => {
    const stack = reason instanceof Error ? reason.stack : undefined;
    logger.error('Unhandled promise rejection', stack, 'Process');
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', error.stack, 'Process');
  });

  await app.listen(port);
  logger.log(`Application started on port ${port}`, 'Bootstrap');
}
bootstrap();
