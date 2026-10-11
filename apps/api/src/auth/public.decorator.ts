import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';
/** Rota sem autenticação (login, saúde, portal do cliente). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ALLOW_PASSWORD_CHANGE = 'allowPasswordChange';
/** Rota que um utilizador com "mudar palavra-passe" pendente pode usar (mudá-la e ver quem é). */
export const AllowPasswordChange = () => SetMetadata(ALLOW_PASSWORD_CHANGE, true);
