import { Module } from '@nestjs/common';
import { CpqModule } from '../cpq/cpq.module.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

@Module({ imports: [CpqModule], controllers: [AdminController], providers: [AdminService] })
export class AdminModule {}
