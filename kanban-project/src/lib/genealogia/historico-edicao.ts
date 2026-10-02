// src/lib/genealogia/historico-edicao.ts
// ============================================================================
// HISTÓRICO DE DESFAZER/REFAZER DA ÁRVORE — módulo PURO (sem React, sem fetch).
//
// Uma pilha de COMANDOS. Cada comando sabe aplicar e desfazer a si mesmo, e os
// dois caminhos passam pelas MESMAS portas oficiais de escrita (as rotas que
// chamam `aplicarMudancaNaArvore`): o desfazer NUNCA restaura direto no banco
// (§37 — criar/remover vínculo propaga para documentos e tarefas).
//
// Regras:
//   • Só entra na pilha o que JÁ deu certo (`registrar` é chamado após o sucesso).
//   • Registrar uma ação nova limpa o "refazer" (histórico linear).
//   • Pilha limitada: ao passar do limite o mais antigo sai.
//   • Falha ao desfazer/refazer NÃO corrompe a pilha: o comando fica onde estava
//     (falha transitória: rede/5xx — dá para tentar de novo) ou é DESCARTADO
//     quando a falha é definitiva (4xx: o servidor recusou, tentar de novo não
//     adianta e travaria a pilha). Nunca aplica pela metade.
//   • Uma operação por vez: chamadas concorrentes devolvem `ocupado`.
// ============================================================================

export type ResultadoComando = { ok: true } | { ok: false; erro: string; definitivo?: boolean }

export interface ComandoEdicao {
  /** Frase curta, no passado, para o aviso ("remover vínculo de Ana com João"). */
  rotulo: string
  /**
   * `false` = só layout (mover cartão): a tela não precisa recarregar a árvore.
   * Ausente/`true` = mexeu em dados da árvore: a tela recarrega e invalida os fatos operacionais.
   */
  afetaDados?: boolean
  aplicar: () => Promise<ResultadoComando>
  desfazer: () => Promise<ResultadoComando>
}

export type ResultadoHistorico =
  | { status: "vazio" }
  | { status: "ocupado" }
  | { status: "ok"; rotulo: string; afetaDados: boolean }
  | { status: "falhou"; rotulo: string; erro: string; descartado: boolean; afetaDados: boolean }

export const LIMITE_HISTORICO_PADRAO = 50

export interface HistoricoEdicao {
  registrar: (cmd: ComandoEdicao) => void
  desfazer: () => Promise<ResultadoHistorico>
  refazer: () => Promise<ResultadoHistorico>
  limpar: () => void
  podeDesfazer: () => boolean
  podeRefazer: () => boolean
  tamanho: () => { desfazer: number; refazer: number }
}

export function criarHistorico(limite: number = LIMITE_HISTORICO_PADRAO): HistoricoEdicao {
  const max = Math.max(1, Math.floor(limite))
  let passado: ComandoEdicao[] = []
  let futuro: ComandoEdicao[] = []
  let ocupado = false
  // Incrementa em `limpar`: uma operação em voo que termina depois de a pilha
  // ter sido limpa (troca de árvore) não pode empurrar comando da árvore antiga.
  let geracao = 0

  const rodar = async (
    origem: "passado" | "futuro",
  ): Promise<ResultadoHistorico> => {
    const pilha = origem === "passado" ? passado : futuro
    if (pilha.length === 0) return { status: "vazio" }
    if (ocupado) return { status: "ocupado" }
    ocupado = true
    const minha = geracao
    const cmd = pilha[pilha.length - 1]
    const afetaDados = cmd.afetaDados !== false
    try {
      let r: ResultadoComando
      try {
        r = origem === "passado" ? await cmd.desfazer() : await cmd.aplicar()
      } catch (e) {
        r = { ok: false, erro: e instanceof Error ? e.message : "Falha inesperada." }
      }
      if (minha !== geracao) return { status: "ok", rotulo: cmd.rotulo, afetaDados }
      // Relê a pilha viva (um `registrar` pode ter trocado o array no meio do voo)
      // e só mexe nela se o comando ainda for o topo.
      const viva = origem === "passado" ? passado : futuro
      const aindaTopo = viva[viva.length - 1] === cmd
      if (!r.ok) {
        const descartado = r.definitivo === true
        if (descartado && aindaTopo) viva.pop()
        return { status: "falhou", rotulo: cmd.rotulo, erro: r.erro, descartado, afetaDados }
      }
      if (aindaTopo) viva.pop()
      if (origem === "passado") {
        if (aindaTopo) futuro.push(cmd)
      } else if (aindaTopo) {
        passado.push(cmd)
        if (passado.length > max) passado = passado.slice(passado.length - max)
      }
      return { status: "ok", rotulo: cmd.rotulo, afetaDados }
    } finally {
      ocupado = false
    }
  }

  return {
    registrar(cmd) {
      passado.push(cmd)
      if (passado.length > max) passado = passado.slice(passado.length - max)
      futuro = []
    },
    desfazer: () => rodar("passado"),
    refazer: () => rodar("futuro"),
    limpar() {
      passado = []
      futuro = []
      geracao++
    },
    podeDesfazer: () => passado.length > 0,
    podeRefazer: () => futuro.length > 0,
    tamanho: () => ({ desfazer: passado.length, refazer: futuro.length }),
  }
}
