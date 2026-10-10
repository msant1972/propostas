import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';

/** Respostas de erro no formato application/problem+json (RFC 9457). */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly log = new Logger('Problem');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<{ originalUrl: string }>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let detail = 'Erro interno';
    let errors: unknown;
    let extra: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') detail = body;
      else {
        const b = body as { message?: string | string[] };
        extra = Object.fromEntries(Object.entries(body).filter(([k]) => !['message', 'statusCode', 'error'].includes(k))); // ex.: violations, code
        if (Array.isArray(b.message)) {
          detail = 'Pedido inválido';
          errors = b.message;
        } else detail = b.message ?? exception.message;
      }
    } else {
      this.log.error(exception instanceof Error ? exception.stack : String(exception));
    }

    res
      .status(status)
      .type('application/problem+json')
      .json({ type: 'about:blank', title: HttpStatus[status] ?? 'Erro', status, detail, instance: req.originalUrl, ...extra, ...(errors ? { errors } : {}) });
  }
}
