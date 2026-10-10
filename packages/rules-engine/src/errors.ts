/** Erro de configuração de dados (listas de preços ambíguas, câmbio em falta…): não é um erro do utilizador. */
export class ConfigurationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
