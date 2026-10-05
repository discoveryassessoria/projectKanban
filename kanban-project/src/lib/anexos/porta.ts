// src/lib/anexos/porta.ts
// ============================================================================
// A PORTA ÚNICA DE ABRIR ANEXO — a regra (servidor). `autorizarAbertura` decide; `urlAssinadaDoAnexo` assina DEPOIS de autorizar (assinar antes
// de autorizar seria entregar a chave e conferir a fechadura depois). Validade de 5 minutos: o link não vira cópia.
// ============================================================================
import { alvoDaChave, ehChaveDeAnexo, PERMISSAO_DO_DOMINIO, type AlvoDoAnexo } from "./chave"

export const VALIDADE_DA_URL_DE_ANEXO_SEGUNDOS = 300

export interface UsuarioDaPorta {
  userId: number
  tipo: string
  /** Mapa de permissões já calculado pelo sistema (`extrairUsuarioComPermissoes`). */
  permissoes: Record<string, boolean>
}

export type DecisaoDaPorta =
  | { ok: true; alvo: AlvoDoAnexo }
  | { ok: false; status: 400 | 401 | 403; erro: string }

/** PURA — quem pode abrir/gravar anexo de qual domínio. Sem usuário = 401; sem a permissão do módulo = 403; chave inválida = 400. */
export function autorizarAbertura(usuario: UsuarioDaPorta | null, chave: unknown): DecisaoDaPorta {
  if (!usuario) return { ok: false, status: 401, erro: "Não autorizado" }
  if (typeof chave !== "string" || !ehChaveDeAnexo(chave)) return { ok: false, status: 400, erro: "Chave de anexo inválida" }
  const alvo = alvoDaChave(chave)
  if (!alvo) return { ok: false, status: 400, erro: "Chave de anexo inválida" }
  return autorizarAcessoAoAlvo(usuario, alvo)
}

/** PURA — acesso a um alvo (usada também ao GRAVAR: quem não pode ver o domínio não gera URL de envio para ele). */
export function autorizarAcessoAoAlvo(usuario: UsuarioDaPorta | null, alvo: AlvoDoAnexo): DecisaoDaPorta {
  if (!usuario) return { ok: false, status: 401, erro: "Não autorizado" }
  const permissao = PERMISSAO_DO_DOMINIO[alvo.dominio]
  if (permissao === null) {
    // Rascunho (cliente ainda não salvo): só quem enviou — o id na chave é o do usuário que gerou o envio.
    return alvo.id === usuario.userId ? { ok: true, alvo } : { ok: false, status: 403, erro: "Acesso negado a este anexo" }
  }
  return usuario.permissoes[permissao] === true ? { ok: true, alvo } : { ok: false, status: 403, erro: "Acesso negado a este anexo" }
}
