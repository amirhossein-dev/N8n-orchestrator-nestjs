import { CanActivate, Injectable } from '@nestjs/common';
import { fail } from '../identity/core/model';

// The legacy users API has no tenant scope. Deny every route on its controller,
// independently of Express path casing, trailing slashes or a global prefix.
@Injectable()
export class LegacyUsersDisabledGuard implements CanActivate {
  canActivate(): never {
    return fail('LEGACY_USERS_API_DISABLED', 403);
  }
}
