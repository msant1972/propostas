import { Global, Module } from '@nestjs/common';
import { UsersAdminController } from './users-admin.controller.js';
import { UsersAdminService } from './users-admin.service.js';
import { UsersService } from './users.service.js';

@Global()
@Module({ controllers: [UsersAdminController], providers: [UsersService, UsersAdminService], exports: [UsersService] })
export class UsersModule {}
