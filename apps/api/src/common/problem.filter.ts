import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';

const isClientError = (e: unknown): e is { status?: number; statusCode?: number } => {
  const c = e as { status?: unknown; statusCode?: unknown; type?: unknown } | null;
  const code = typeof c?.status === 'number' ? c.status : typeof c?.statusCode === 'number' ? c.statusCode : 0;
  return code >= 400 && code < 500 && typeof c?.type === 'string';
};

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
    } else if (isClientError(exception)) {
      // Erros dos analisadores de corpo (ex.: demasiado grande, JSON inválido): 4xx do cliente, não falhas do servidor.
      status = exception.status ?? exception.statusCode ?? 400;
      detail = status === 413 ? 'Pedido demasiado grande' : 'Pedido inválido';
    } else {
      this.log.error(exception instanceof Error ? exception.stack : String(exception));
    }

    res
      .status(status)
      .type('application/problem+json')
      .json({ type: 'about:blank', title: HttpStatus[status] ?? 'Erro', status, detail, instance: req.originalUrl, ...extra, ...(errors ? { errors } : {}) });
  }
}
