import { Module } from '@nestjs/common';
import { PrivacyController } from './privacy.controller.js';
import { PrivacyService } from './privacy.service.js';

@Module({ controllers: [PrivacyController], providers: [PrivacyService] })
export class PrivacyModule {}
