// lib/financeiro/acoes-lancamento.ts
// ============================================================================
// FONTE ÚNICA das AÇÕES DISPONÍVEIS de um lançamento financeiro.
//
// Regra do projeto: nenhuma ação é exibida só porque existe tecnicamente. Toda
// ação é RESOLVIDA a partir do estado real (status, parcelas, recebimentos,
// supressão, cancelamento, estorno), do que o BACKEND já autorizou no payload
// /detalhe e das PERMISSÕES do usuário.
//
// Precedência (a mais restritiva vence):
//   1. permissão do usuário  → some da UI (o backend continua validando)
//   2. autorização do backend (`acoes` do /detalhe) → autoridade final
//   3. estado do lançamento / da parcela
//
// Módulo PURO: sem React, sem fetch, sem Prisma. A UI apenas renderiza o que
// esta função devolve; nenhuma condicional de ação vive nos componentes.
// ============================================================================

import {
  type LancamentoView,
  type ParcelaView,
  type StatusLancamento,
  parcelaEmAberto,
  parcelaQuitada,
  parcelaVencida,
  statusDoLancamento,
  totaisDoLancamento,
} from './apresentacao-lancamento'

/** Espelha o bloco `acoes` devolvido por GET /receitas/[id]/detalhe. */
export interface AcoesBackend {
  podeCancelar: boolean
  exigeSupressao: boolean
  podeEstornar: boolean
  podeEditarParcelas: boolean
  podeRegistrarRecebimento: boolean
  podeRevogarSupressao: boolean
  motivoBloqueioCancelamento: string | null
  motivoBloqueioParcelas: string | null
}

/**
 * Permissões do usuário, na semântica já existente em src/lib/permissoes.ts.
 * O frontend usa exatamente as mesmas chaves que o backend valida.
 */
export interface PermissoesFinanceiras {
  /** financeiro.ver */
  ver: boolean
  /** financeiro.pagamento_criar */
  criarRecebimento: boolean
  /** financeiro.pagamento_editar */
  editarRecebimento: boolean
  /** financeiro.pagamento_excluir */
  excluirRecebimento: boolean
  isAdmin: boolean
}

export interface ContextoAcoes {
  lancamento: LancamentoView
  backend: AcoesBackend
  supressaoAtiva: boolean
  cancelado: boolean
  estornado: boolean
  permissoes: PermissoesFinanceiras
  agora?: Date
}

/** Ação resolvida: aparece ou não; quando não aparece, guarda o porquê. */
export interface Acao {
  disponivel: boolean
  motivo: string | null
}

export interface AcoesDoLancamento {
  registrarRecebimento: Acao
  alterarParcelamento: Acao
  alterarVencimento: Acao
  editarObservacoes: Acao
  exportar: Acao
  imprimir: Acao
  copiarReferencia: Acao
  copiarId: Acao
  cancelar: Acao
  estornar: Acao
  revogarSupressao: Acao
}

export interface AcoesDaParcela {
  abrirDetalhes: Acao
  alterarVencimento: Acao
  registrarRecebimento: Acao
  editarRecebimento: Acao
  verComprovante: Acao
  baixarComprovante: Acao
  substituirComprovante: Acao
  excluirComprovante: Acao
  estornar: Acao
  excluir: Acao
}

export interface AcoesEmLote {
  selecionar: Acao
  alterarVencimentos: Acao
  registrarRecebimentos: Acao
  exportarSelecionadas: Acao
}

export interface ResultadoAcoes {
  status: StatusLancamento
  /** Saldo zerado e lançamento vivo — a UI troca o CTA por "Lançamento quitado". */
  quitado: boolean
  /** Nenhuma operação financeira é possível (cancelado, estornado ou suprimido). */
  somenteLeitura: boolean
  motivoSomenteLeitura: string | null
  lancamento: AcoesDoLancamento
  lote: AcoesEmLote
  /** Resolve as ações de UMA parcela dentro do mesmo contexto. */
  parcela: (p: ParcelaView) => AcoesDaParcela
}

const SIM: Acao = { disponivel: true, motivo: null }
const nao = (motivo: string): Acao => ({ disponivel: false, motivo })

/** Aplica a precedência: a primeira restrição encontrada é a que explica. */
function permitir(...restricoes: Array<string | null>): Acao {
  for (const r of restricoes) if (r) return nao(r)
  return SIM
}

/**
 * Recebimento CONCILIADO = tem conta/banco registrado. Conciliado nunca é
 * excluído direto: só pelo fluxo oficial de estorno, com motivo.
 */
export function recebimentoConciliado(p: ParcelaView): boolean {
  return parcelaQuitada(p) && !!p.banco
}

export function temComprovante(p: ParcelaView): boolean {
  return !!p.comprovanteUrl
}

/**
 * Resolve TODAS as ações válidas do lançamento no momento atual.
 * A UI renderiza somente `disponivel === true`; `motivo` explica o bloqueio
 * quando faz sentido mostrá-lo (nunca para falta de permissão — nesse caso a
 * ação simplesmente não existe para o usuário).
 */
export function resolveAvailableFinancialActions(ctx: ContextoAcoes): ResultadoAcoes {
  const agora = ctx.agora ?? new Date()
  const l = ctx.lancamento
  const b = ctx.backend
  const p = ctx.permissoes

  const status = statusDoLancamento(l, agora)
  const t = totaisDoLancamento(l, agora)
  const parcelas = (l.parcelas ?? []).filter((x) => x.status !== 'CANCELADA')
  const temRecebimento = parcelas.some(parcelaQuitada)
  const temAberta = parcelas.some(parcelaEmAberto)
  const quitado = parcelas.length > 0 && t.saldo <= 0.004 && !ctx.cancelado && !ctx.estornado

  // ── travas de estado ────────────────────────────────────────────────────
  const semPermissaoVer = p.ver ? null : 'Sem permissão para ver o financeiro.'
  const travaCancelado = ctx.cancelado ? 'Lançamento cancelado — operações financeiras bloqueadas.' : null
  const travaEstornado = ctx.estornado ? 'Lançamento estornado — operações financeiras bloqueadas.' : null
  const travaSupressao = ctx.supressaoAtiva ? 'Lançamento suprimido — somente consulta.' : null
  const travaEstado = travaCancelado ?? travaEstornado ?? travaSupressao
  const somenteLeitura = travaEstado != null

  const travaQuitado = quitado ? 'Lançamento quitado.' : null
  const travaSemSaldo = t.saldo > 0.004 ? null : 'Sem saldo em aberto.'
  const travaSemParcelaAberta = temAberta ? null : 'Nenhuma parcela em aberto.'
  const travaSemRecebimento = temRecebimento ? null : 'Nenhum recebimento registrado.'

  // ── ações do lançamento ─────────────────────────────────────────────────
  const registrarRecebimento = permitir(
    semPermissaoVer,
    p.criarRecebimento ? null : 'Sem permissão para registrar recebimentos.',
    travaEstado,
    travaQuitado,
    travaSemSaldo,
    travaSemParcelaAberta,
    b.podeRegistrarRecebimento ? null : 'O lançamento não aceita recebimento neste estado.',
  )

  const alterarParcelamento = permitir(
    semPermissaoVer,
    p.editarRecebimento ? null : 'Sem permissão para alterar o parcelamento.',
    travaEstado,
    travaQuitado,
    temRecebimento ? 'O parcelamento não pode ser alterado porque já existe recebimento registrado.' : null,
    b.podeEditarParcelas ? null : (b.motivoBloqueioParcelas ?? 'Parcelamento bloqueado.'),
  )

  const alterarVencimento = permitir(
    semPermissaoVer,
    p.editarRecebimento ? null : 'Sem permissão para alterar vencimentos.',
    travaEstado,
    travaSemParcelaAberta,
    b.podeEditarParcelas ? null : (b.motivoBloqueioParcelas ?? 'Vencimento bloqueado.'),
  )

  const editarObservacoes = permitir(
    semPermissaoVer,
    p.editarRecebimento ? null : 'Sem permissão para editar o lançamento.',
    travaCancelado,
    travaEstornado,
  )

  const cancelar = permitir(
    semPermissaoVer,
    p.excluirRecebimento || p.isAdmin ? null : 'Sem permissão para cancelar lançamentos.',
    travaSupressao,
    temRecebimento ? 'Este lançamento possui recebimento registrado. Use o estorno.' : null,
    b.podeCancelar ? null : (b.motivoBloqueioCancelamento ?? 'Cancelamento indisponível.'),
  )

  // Estornar exige recebimento e nunca duplica: o backend zera podeEstornar
  // assim que o estorno é registrado.
  const estornar = permitir(
    semPermissaoVer,
    p.editarRecebimento ? null : 'Sem permissão para estornar.',
    travaSemRecebimento,
    ctx.estornado ? 'Este lançamento já foi estornado.' : null,
    b.podeEstornar ? null : 'Estorno indisponível para este lançamento.',
  )

  const revogarSupressao = permitir(
    semPermissaoVer,
    p.editarRecebimento || p.isAdmin ? null : 'Sem permissão para revogar supressões.',
    b.podeRevogarSupressao ? null : 'Não há supressão registrada.',
  )

  // Consulta pura — vale em qualquer estado, inclusive cancelado/suprimido.
  const consulta = permitir(semPermissaoVer)

  // ── ações em lote ───────────────────────────────────────────────────────
  const multiplas = parcelas.length > 1 ? null : 'Disponível apenas com múltiplas parcelas.'
  const lote: AcoesEmLote = {
    selecionar: permitir(semPermissaoVer, multiplas),
    alterarVencimentos: permitir(semPermissaoVer, multiplas, alterarVencimento.motivo),
    registrarRecebimentos: permitir(semPermissaoVer, multiplas, registrarRecebimento.motivo),
    exportarSelecionadas: permitir(semPermissaoVer, multiplas),
  }

  // ── ações por parcela ───────────────────────────────────────────────────
  function parcela(x: ParcelaView): AcoesDaParcela {
    const cancelada = x.status === 'CANCELADA' ? 'Parcela cancelada — somente leitura.' : null
    const quitadaP = parcelaQuitada(x)
    const conciliado = recebimentoConciliado(x)
    const comComprovante = temComprovante(x)

    return {
      abrirDetalhes: consulta,

      alterarVencimento: permitir(
        semPermissaoVer,
        p.editarRecebimento ? null : 'Sem permissão para alterar vencimentos.',
        travaEstado,
        cancelada,
        quitadaP ? 'Parcela recebida — vencimento não é mais editável.' : null,
        b.podeEditarParcelas ? null : (b.motivoBloqueioParcelas ?? 'Vencimento bloqueado.'),
      ),

      registrarRecebimento: permitir(
        semPermissaoVer,
        p.criarRecebimento ? null : 'Sem permissão para registrar recebimentos.',
        travaEstado,
        cancelada,
        quitadaP ? 'Parcela já recebida.' : null,
        b.podeRegistrarRecebimento ? null : 'O lançamento não aceita recebimento neste estado.',
      ),

      // Edição do recebimento cobre APENAS os campos operacionais que o
      // endpoint existente aceita (forma, conta, observações, comprovante).
      editarRecebimento: permitir(
        semPermissaoVer,
        p.editarRecebimento ? null : 'Sem permissão para editar recebimentos.',
        travaEstado,
        cancelada,
        quitadaP ? null : 'A parcela ainda não possui recebimento.',
      ),

      verComprovante: permitir(semPermissaoVer, comComprovante ? null : 'Sem comprovante anexado.'),
      baixarComprovante: permitir(semPermissaoVer, comComprovante ? null : 'Sem comprovante anexado.'),

      substituirComprovante: permitir(
        semPermissaoVer,
        p.editarRecebimento ? null : 'Sem permissão para alterar comprovantes.',
        travaEstado,
        cancelada,
      ),

      excluirComprovante: permitir(
        semPermissaoVer,
        p.excluirRecebimento ? null : 'Sem permissão para excluir comprovantes.',
        travaEstado,
        cancelada,
        comComprovante ? null : 'Sem comprovante anexado.',
      ),

      estornar: permitir(
        semPermissaoVer,
        p.editarRecebimento ? null : 'Sem permissão para estornar.',
        quitadaP ? null : 'A parcela não possui recebimento para estornar.',
        ctx.estornado ? 'Este lançamento já foi estornado.' : null,
        b.podeEstornar ? null : 'Estorno indisponível para este lançamento.',
      ),

      // Exclusão de recebimento não existe como fluxo: conciliado ou não, a
      // reversão oficial é o estorno, que preserva o histórico financeiro.
      excluir: nao(
        conciliado
          ? 'Recebimento conciliado não pode ser excluído. Use o estorno, com motivo.'
          : 'A exclusão de recebimento não é um fluxo autorizado. Use o estorno.',
      ),
    }
  }

  return {
    status,
    quitado,
    somenteLeitura,
    motivoSomenteLeitura: travaEstado,
    lancamento: {
      registrarRecebimento,
      alterarParcelamento,
      alterarVencimento,
      editarObservacoes,
      exportar: consulta,
      imprimir: consulta,
      copiarReferencia: consulta,
      copiarId: consulta,
      cancelar,
      estornar,
      revogarSupressao,
    },
    lote,
    parcela,
  }
}

/** Parcela em aberto mais próxima do vencimento — alvo padrão do CTA. */
export function parcelaAlvo(l: LancamentoView): ParcelaView | null {
  const abertas = (l.parcelas ?? []).filter((x) => x.status !== 'CANCELADA').filter(parcelaEmAberto)
  if (abertas.length === 0) return null
  const vencidas = abertas.filter((x) => parcelaVencida(x))
  const pool = vencidas.length > 0 ? vencidas : abertas
  const comData = pool.filter((x) => x.vencimento)
  if (comData.length === 0) return pool[0]
  return comData.reduce((a, x) => (String(a.vencimento) <= String(x.vencimento) ? a : x))
}
