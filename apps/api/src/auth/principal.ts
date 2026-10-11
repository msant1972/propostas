/** O que o token prova: quem é (id do utilizador) e a versão da sessão (muda ao trocar a palavra-passe, os papéis ou desativar). */
export interface Principal {
  userId: string;
  tokenVersion: number;
}
