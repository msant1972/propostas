import { Module } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard.js';
import { ApiKeysController, CrmController } from './integrations.controller.js';
import { IntegrationsService } from './integrations.service.js';

@Module({ controllers: [ApiKeysController, CrmController], providers: [IntegrationsService, ApiKeyGuard] })
export class IntegrationsModule {}
