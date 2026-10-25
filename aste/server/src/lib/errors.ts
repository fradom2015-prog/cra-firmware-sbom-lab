export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, msg: string) => new AppError(400, code, msg);
export const unauthorized = (msg = 'Accesso richiesto') => new AppError(401, 'unauthorized', msg);
export const forbidden = (code: string, msg: string) => new AppError(403, code, msg);
export const notFound = (msg = 'Risorsa non trovata') => new AppError(404, 'not_found', msg);
export const conflict = (code: string, msg: string) => new AppError(409, code, msg);
