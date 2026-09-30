// src/lib/seguranca/usuario-publico.ts
//
// FONTE ÚNICA do que uma resposta de API pode dizer sobre um usuário embutido em outro objeto
// (responsável da tarefa, autor do histórico, etc.).
//
// Incidente 30/09/2026: `GET /api/processos/{id}` devolvia `tarefas[].responsavel` com o registro
// INTEIRO do Usuario (`include: { responsavel: true }`) — inclusive `senha` (hash bcrypt) e
// `permissoesCustom`. Um `true` numa relação traz TODAS as colunas escalares da tabela.
//
// REGRA: nenhuma rota embute Usuario com `true`. Use `USUARIO_PUBLICO_SELECT` (ou um select
// explícito e menor). E-mail/tipo só onde a tela já exige e o requisitante pode ver usuários.
// Guarda estática: scripts/usuario-publico-sem-segredo-estatico.test.ts.

/** O mínimo público de um usuário embutido. Nunca inclui e-mail, tipo, senha nem permissões. */
export const USUARIO_PUBLICO_SELECT = {
  id: true,
  nome: true,
  publicCode: true,
} as const

export type UsuarioPublico = { id: number; nome: string; publicCode: string | null }

/** Chaves que NUNCA saem numa resposta, em qualquer profundidade. */
const CHAVES_SEMPRE_PROIBIDAS: ReadonlySet<string> = new Set([
  "senha", "senhaHash", "password", "passwordHash",
  "permissoesCustom", "refreshToken", "tokenVersion",
])

/** Só proibidas em objeto com cara de usuário (tem `email` e `nome`): `hash`/`token` existem legitimamente em outros domínios (checksum de arquivo, etc.). */
const CHAVES_PROIBIDAS_EM_USUARIO: ReadonlySet<string> = new Set(["hash", "token", "accessToken", "secret"])

const ehObjetoPlano = (v: unknown): v is Record<string, unknown> => {
  if (v === null || typeof v !== "object") return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/**
 * DEFESA EM PROFUNDIDADE — devolve uma cópia sem as chaves proibidas, em qualquer profundidade.
 * Não substitui o `select` restrito (que é a correção); é a rede caso alguém reintroduza um `true`.
 * Datas, Decimal e outros objetos não-planos passam intactos.
 */
export function removerSegredosDeUsuario<T>(valor: T): T {
  if (Array.isArray(valor)) return valor.map((x) => removerSegredosDeUsuario(x)) as unknown as T
  if (!ehObjetoPlano(valor)) return valor
  const pareceUsuario = "email" in valor && "nome" in valor
  const saida: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(valor)) {
    if (CHAVES_SEMPRE_PROIBIDAS.has(k)) continue
    if (pareceUsuario && CHAVES_PROIBIDAS_EM_USUARIO.has(k)) continue
    saida[k] = removerSegredosDeUsuario(v)
  }
  return saida as T
}
