// Tem de correr antes de qualquer importação da aplicação: o limite do login é lido ao carregar o controlador.
process.env['LOGIN_RATE_PER_MINUTE'] = '100000'; // o limite por IP tem teste próprio
process.env['THROTTLE_LIMIT'] = '100000';
