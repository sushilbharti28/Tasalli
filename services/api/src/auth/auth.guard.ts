import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC } from '../common/decorators';
import { Db } from '../db/db.service';
import { SessionService } from './session.service';

/** Global guard: every route needs a valid session unless marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly db: Db,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
    const userId = token ? this.sessions.verify(token) : null;
    if (!userId) throw new UnauthorizedException();
    const user = await this.db.one<{ id: string; phone_e164: string }>(
      this.db,
      'select id, phone_e164 from users where id = $1 and deleted_at is null',
      [userId],
    );
    if (!user) throw new UnauthorizedException();
    req.user = { id: user.id, phone: user.phone_e164 };
    return true;
  }
}
