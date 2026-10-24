// Errore applicativo con lo status HTTP da restituire al client.
export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
