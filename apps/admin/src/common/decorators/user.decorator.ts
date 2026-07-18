import { createParamDecorator, ExecutionContext } from '@nestjs/common';
export interface AuthUser {
  id: string;
  email: string;
  role: string;
  roleName?: string;
  permissions?: string[];
}

export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext): AuthUser => {
    return context.switchToHttp().getRequest<{ user: AuthUser }>().user;
  },
);
