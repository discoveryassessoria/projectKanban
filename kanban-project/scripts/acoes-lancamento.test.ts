// scripts/acoes-lancamento.test.ts
// ============================================================================
// Cobertura por ESTADO da fonte única de ações do lançamento financeiro
// (lib/financeiro/acoes-lancamento). Puro: não precisa de banco.
//
// Cada bloco espelha uma linha da matriz obrigatória de ações contextuais.
// ============================================================================
import type { LancamentoView, ParcelaView } from '../lib/financeiro/apresentacao-lancamento'
import {
  type AcoesBackend,
  type PermissoesFinanceiras,
  parcelaAlvo,
  recebimentoConciliado,
  resolveAvailableFinancialActions,
} from '../lib/financeiro/acoes-lancamento'

const HOJE = new Date('2026-07-21T12:00:00Z')
const FUTURO = '2026-08-21'
const PASSADO = '2026-06-21'

let passou = 0
let falhou = 0

function ok(nome: string, cond: boolean) {
  if (cond) { passou++; console.log(`  ✓ ${nome}`) }
  else { falhou++; console.log(`  ✗ ${nome}`) }
}
function secao(t: string) { console.log(`\n${t}`) }

// ── fixtures ────────────────────────────────────────────────────────────────

const PERM_TOTAL: PermissoesFinanceiras = {
  ver: true, criarRecebimento: true, editarRecebimento: true, excluirRecebimento: true, isAdmin: true,
}
const PERM_LEITURA: PermissoesFinanceiras = {
  ver: true, criarRecebimento: false, editarRecebimento: false, excluirRecebimento: false, isAdmin: false,
}

const BACKEND_ABERTO: AcoesBackend = {
  podeCancelar: true,
  exigeSupressao: false,
  podeEstornar: false,
  podeEditarParcelas: true,
  podeRegistrarRecebimento: true,
  podeRevogarSupressao: false,
  motivoBloqueioCancelamento: null,
  motivoBloqueioParcelas: null,
}

function parcela(over: Partial<ParcelaView> = {}): ParcelaView {
  return { id: 1, numero: 1, vencimento: FUTURO, valor: 6290, status: 'PENDENTE', ...over }
}

function lancamento(over: Partial<LancamentoView> = {}): LancamentoView {
  return {
    id: 1, codigo: 'REC-1', categoria: 'HONORARIOS',
    descricao: 'Honorários Contratuais — Cidadania Italiana',
    moeda: 'EUR', valor: 6290, fxEstimado: 6.2, origem: 'motor', phaseKey: 'genealogia',
    parcelas: [parcela()],
    ...over,
  }
}

function resolver(over: Partial<Parameters<typeof resolveAvailableFinancialActions>[0]> = {}) {
  return resolveAvailableFinancialActions({
    lancamento: lancamento(),
    backend: BACKEND_ABERTO,
    supressaoAtiva: false,
    cancelado: false,
    estornado: false,
    permissoes: PERM_TOTAL,
    agora: HOJE,
    ...over,
  })
}

// ── 1 · saldo aberto ────────────────────────────────────────────────────────
secao('Estado — lançamento com saldo aberto')
{
  const a = resolver()
  ok('mostra Registrar recebimento', a.lancamento.registrarRecebimento.disponivel)
  ok('mostra Alterar vencimento', a.lancamento.alterarVencimento.disponivel)
  ok('mostra Alterar parcelamento', a.lancamento.alterarParcelamento.disponivel)
  ok('mostra Cancelar lançamento', a.lancamento.cancelar.disponivel)
  ok('não mostra Estornar (sem recebimento)', !a.lancamento.estornar.disponivel)
  ok('não está quitado', !a.quitado)
  ok('não é somente leitura', !a.somenteLeitura)
}

// ── 2 · parcialmente recebido ───────────────────────────────────────────────
secao('Estado — parcialmente recebido')
{
  const l = lancamento({
    parcelas: [
      parcela({ id: 1, numero: 1, valor: 3145, status: 'RECEBIDA', dataPagamento: PASSADO, cambioAplicado: 6.2, banco: 'Itaú' }),
      parcela({ id: 2, numero: 2, valor: 3145, status: 'PENDENTE' }),
    ],
  })
  const a = resolver({ lancamento: l, backend: { ...BACKEND_ABERTO, podeCancelar: false, podeEstornar: true, podeEditarParcelas: false, motivoBloqueioParcelas: 'já existe recebimento' } })
  ok('mostra Registrar recebimento', a.lancamento.registrarRecebimento.disponivel)
  ok('mostra Estornar', a.lancamento.estornar.disponivel)
  ok('mostra Editar recebimento na parcela quitada', a.parcela(l.parcelas![0]).editarRecebimento.disponivel)
  ok('não mostra Alterar parcelamento', !a.lancamento.alterarParcelamento.disponivel)
  ok('não mostra Cancelar (há recebimento)', !a.lancamento.cancelar.disponivel)
  ok('nunca oferece excluir recebimento', !a.parcela(l.parcelas![0]).excluir.disponivel)
  ok('exclusão explica o estorno como caminho', /estorno/i.test(a.parcela(l.parcelas![0]).excluir.motivo ?? ''))
}

// ── 3 · quitado ─────────────────────────────────────────────────────────────
secao('Estado — quitado')
{
  const l = lancamento({
    parcelas: [parcela({ status: 'RECEBIDA', dataPagamento: PASSADO, cambioAplicado: 6.2, valorBrl: 38998 })],
  })
  const a = resolver({ lancamento: l, backend: { ...BACKEND_ABERTO, podeRegistrarRecebimento: false, podeCancelar: false, podeEstornar: true, podeEditarParcelas: false } })
  ok('marca quitado', a.quitado)
  ok('oculta Registrar recebimento', !a.lancamento.registrarRecebimento.disponivel)
  ok('oculta Alterar parcelamento', !a.lancamento.alterarParcelamento.disponivel)
  ok('mostra Estornar', a.lancamento.estornar.disponivel)
  ok('mantém consulta de comprovante/histórico', a.parcela(l.parcelas![0]).abrirDetalhes.disponivel)
  ok('parcela quitada não recebe de novo', !a.parcela(l.parcelas![0]).registrarRecebimento.disponivel)
  ok('parcela quitada não edita vencimento', !a.parcela(l.parcelas![0]).alterarVencimento.disponivel)
}

// ── 4 · sem recebimentos ────────────────────────────────────────────────────
secao('Estado — sem recebimentos')
{
  const a = resolver()
  ok('oculta Estornar', !a.lancamento.estornar.disponivel)
  ok('oculta Editar recebimento', !a.parcela(parcela()).editarRecebimento.disponivel)
  ok('oculta Excluir recebimento', !a.parcela(parcela()).excluir.disponivel)
}

// ── 5 · cancelado ───────────────────────────────────────────────────────────
secao('Estado — cancelado')
{
  const a = resolver({
    cancelado: true,
    backend: { ...BACKEND_ABERTO, podeCancelar: false, podeRegistrarRecebimento: false, podeEditarParcelas: false, motivoBloqueioCancelamento: 'Este lançamento já está cancelado.' },
  })
  ok('é somente leitura', a.somenteLeitura)
  ok('oculta Registrar recebimento', !a.lancamento.registrarRecebimento.disponivel)
  ok('oculta Alterar vencimento', !a.lancamento.alterarVencimento.disponivel)
  ok('oculta Alterar parcelamento', !a.lancamento.alterarParcelamento.disponivel)
  ok('mantém consulta', a.lancamento.exportar.disponivel && a.lancamento.copiarReferencia.disponivel)
}

// ── 6 · estornado ───────────────────────────────────────────────────────────
secao('Estado — estornado')
{
  const l = lancamento({
    estornadoEm: '2026-07-20T00:00:00Z',
    parcelas: [parcela({ status: 'RECEBIDA', dataPagamento: PASSADO, cambioAplicado: 6.2 })],
  })
  const a = resolver({ lancamento: l, estornado: true, backend: { ...BACKEND_ABERTO, podeEstornar: false, podeRegistrarRecebimento: false, podeCancelar: false, podeEditarParcelas: false } })
  ok('status ESTORNADO', a.status === 'ESTORNADO')
  ok('impede estorno duplicado', !a.lancamento.estornar.disponivel)
  ok('oculta operações financeiras', !a.lancamento.registrarRecebimento.disponivel && !a.lancamento.alterarVencimento.disponivel)
  ok('mantém consulta', a.lancamento.imprimir.disponivel)
}

// ── 7 · suprimido ───────────────────────────────────────────────────────────
secao('Estado — suprimido')
{
  const a = resolver({
    supressaoAtiva: true,
    backend: { ...BACKEND_ABERTO, podeRevogarSupressao: true },
  })
  ok('é somente leitura', a.somenteLeitura)
  ok('oculta todas as operações financeiras',
    !a.lancamento.registrarRecebimento.disponivel &&
    !a.lancamento.alterarVencimento.disponivel &&
    !a.lancamento.alterarParcelamento.disponivel)
  ok('oculta Cancelar', !a.lancamento.cancelar.disponivel)
  ok('mostra Revogar supressão', a.lancamento.revogarSupressao.disponivel)
  ok('permite consulta', a.lancamento.exportar.disponivel)
}

// ── 8 · parcela vencida ─────────────────────────────────────────────────────
secao('Estado — parcela vencida')
{
  const p = parcela({ vencimento: PASSADO })
  const l = lancamento({ parcelas: [p] })
  const a = resolver({ lancamento: l })
  ok('status VENCIDO', a.status === 'VENCIDO')
  ok('mostra Registrar recebimento', a.parcela(p).registrarRecebimento.disponivel)
  ok('mostra Alterar vencimento', a.parcela(p).alterarVencimento.disponivel)
  ok('alvo do CTA é a parcela vencida', parcelaAlvo(l)?.id === p.id)
}

// ── 9 · parcela cancelada ───────────────────────────────────────────────────
secao('Estado — parcela cancelada')
{
  const p = parcela({ id: 9, numero: 2, status: 'CANCELADA' })
  const a = resolver({ lancamento: lancamento({ parcelas: [parcela(), p] }) })
  ok('não permite recebimento', !a.parcela(p).registrarRecebimento.disponivel)
  ok('não permite editar vencimento', !a.parcela(p).alterarVencimento.disponivel)
  ok('não permite editar recebimento', !a.parcela(p).editarRecebimento.disponivel)
  ok('mantém leitura', a.parcela(p).abrirDetalhes.disponivel)
}

// ── 10 · conciliação do recebimento ─────────────────────────────────────────
secao('Estado — recebimento conciliado x não conciliado')
{
  const conciliada = parcela({ status: 'RECEBIDA', dataPagamento: PASSADO, banco: 'Itaú' })
  const solta = parcela({ id: 2, numero: 2, status: 'RECEBIDA', dataPagamento: PASSADO, banco: null })
  ok('conciliado é detectado', recebimentoConciliado(conciliada))
  ok('sem conta não é conciliado', !recebimentoConciliado(solta))

  const a = resolver({
    lancamento: lancamento({ parcelas: [conciliada, solta] }),
    backend: { ...BACKEND_ABERTO, podeEstornar: true, podeRegistrarRecebimento: false, podeCancelar: false, podeEditarParcelas: false },
  })
  ok('conciliado não pode ser excluído', !a.parcela(conciliada).excluir.disponivel)
  ok('mensagem cita conciliação', /conciliado/i.test(a.parcela(conciliada).excluir.motivo ?? ''))
  ok('estorno oficial disponível', a.parcela(conciliada).estornar.disponivel)
}

// ── 11 · comprovantes ───────────────────────────────────────────────────────
secao('Comprovantes')
{
  const com = parcela({ status: 'RECEBIDA', dataPagamento: PASSADO, comprovanteUrl: 'https://x/y.pdf', comprovanteNome: 'y.pdf' })
  const sem = parcela({ id: 2, numero: 2, status: 'RECEBIDA', dataPagamento: PASSADO })
  const a = resolver({ lancamento: lancamento({ parcelas: [com, sem] }), backend: { ...BACKEND_ABERTO, podeRegistrarRecebimento: false, podeCancelar: false, podeEditarParcelas: false, podeEstornar: true } })
  ok('com arquivo: ver', a.parcela(com).verComprovante.disponivel)
  ok('com arquivo: baixar', a.parcela(com).baixarComprovante.disponivel)
  ok('com arquivo: excluir', a.parcela(com).excluirComprovante.disponivel)
  ok('sem arquivo: não mostra ver', !a.parcela(sem).verComprovante.disponivel)
  ok('sem arquivo: não mostra excluir', !a.parcela(sem).excluirComprovante.disponivel)
  ok('sem arquivo: ainda permite anexar', a.parcela(sem).substituirComprovante.disponivel)
}

// ── 12 · permissões ─────────────────────────────────────────────────────────
secao('Permissões do usuário')
{
  const a = resolver({ permissoes: PERM_LEITURA })
  ok('oculta Registrar recebimento', !a.lancamento.registrarRecebimento.disponivel)
  ok('oculta Alterar parcelamento', !a.lancamento.alterarParcelamento.disponivel)
  ok('oculta Alterar vencimento', !a.lancamento.alterarVencimento.disponivel)
  ok('oculta Cancelar', !a.lancamento.cancelar.disponivel)
  ok('oculta Estornar', !a.lancamento.estornar.disponivel)
  ok('mantém consulta e exportação', a.lancamento.exportar.disponivel)
  ok('motivo é de permissão, não de estado', /permiss/i.test(a.lancamento.registrarRecebimento.motivo ?? ''))

  const semVer = resolver({ permissoes: { ...PERM_TOTAL, ver: false } })
  ok('sem financeiro.ver nada aparece',
    !semVer.lancamento.exportar.disponivel && !semVer.lancamento.registrarRecebimento.disponivel)
}

// ── 13 · lote ───────────────────────────────────────────────────────────────
secao('Ações em lote')
{
  const uma = resolver()
  ok('uma parcela: sem seleção em lote', !uma.lote.selecionar.disponivel)

  const varias = resolver({
    lancamento: lancamento({
      parcelas: [parcela({ id: 1, numero: 1, valor: 3145 }), parcela({ id: 2, numero: 2, valor: 3145 })],
    }),
  })
  ok('múltiplas parcelas: seleção disponível', varias.lote.selecionar.disponivel)
  ok('vencimentos em lote', varias.lote.alterarVencimentos.disponivel)
  ok('recebimentos em lote', varias.lote.registrarRecebimentos.disponivel)
  ok('exportar selecionadas', varias.lote.exportarSelecionadas.disponivel)

  const cancelado = resolver({
    cancelado: true,
    lancamento: lancamento({ parcelas: [parcela({ id: 1 }), parcela({ id: 2, numero: 2 })] }),
    backend: { ...BACKEND_ABERTO, podeRegistrarRecebimento: false, podeEditarParcelas: false, podeCancelar: false },
  })
  ok('cancelado bloqueia lote operacional',
    !cancelado.lote.alterarVencimentos.disponivel && !cancelado.lote.registrarRecebimentos.disponivel)
}

// ── 14 · backend é a autoridade final ───────────────────────────────────────
secao('Backend é a autoridade final')
{
  const a = resolver({ backend: { ...BACKEND_ABERTO, podeRegistrarRecebimento: false } })
  ok('estado permitiria, backend nega → ação some', !a.lancamento.registrarRecebimento.disponivel)

  const b = resolver({ backend: { ...BACKEND_ABERTO, podeEstornar: true } })
  ok('backend permite mas não há recebimento → ação some', !b.lancamento.estornar.disponivel)
}

// ── resultado ───────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(60)}`)
console.log(`Ações do lançamento: ${passou} passaram, ${falhou} falharam`)
console.log('='.repeat(60))
if (falhou > 0) process.exit(1)
