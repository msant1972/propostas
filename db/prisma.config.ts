import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: { url: process.env['DATABASE_URL'] ?? 'mysql://cpq:cpq@127.0.0.1:3306/cpq_dev' },
});
