import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { SessionUser } from '../users/users.service.js';
import type { AuthedRequest } from './auth.guard.js';

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): SessionUser => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().user!;
});
