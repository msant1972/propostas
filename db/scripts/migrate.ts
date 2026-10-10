import 'dotenv/config';
import { migrate } from '../src/migrate.js';

const direction = process.argv[2] === 'down' ? 'down' : 'up';
const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL em falta');
const done = await migrate(url, direction);
console.log(done.length ? `${direction}: ${done.join(', ')}` : 'nada a fazer');
