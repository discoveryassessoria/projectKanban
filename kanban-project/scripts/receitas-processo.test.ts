// scripts/receitas-processo.test.ts
// ============================================================================
// Cenários 1–12 da subaba RECEITAS do Financeiro do Processo.
//
// Testa a FONTE ÚNICA de apresentação (lib/financeiro/apresentacao-lancamento)
// + guardas de código (escapes literais, criação manual, agrupamento).
// Puro: não precisa de banco.
// ============================================================================
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  type LancamentoView,
  agruparPorFase,
  cambioEfetivo,
  estaInadimplente,
  redistribuirParcelas,
  resumoReceitas,
  statusDoLancamento,
  subgrupoDoLancamento,
  totaisDoLancamento,
  totaisPorMoeda,
  STATUS_LABEL,
} from '../lib/financeiro/apresentacao-lancamento'

const RAIZ = join(__dirname, '..')
let passou = 0
let falhou = 0

function ok(nome: string, cond: boolean, detalhe = '') {
  if (cond) { passou++; console.log(`  ✓ ${nome}`) }
  else { falhou++; console.error(`  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ''}`) }
}
function eq<T>(nome: string, real: T, esperado: T) {
  ok(nome, Object.is(real, esperado) || JSON.stringify(real) === JSON.stringify(esperado), `esperado ${JSON.stringify(esperado)}, recebido ${JSON.stringify(real)}`)
}
function secao(t: string) { console.log(`\n${t}`) }

// ── fixtures ────────────────────────────────────────────────────────────────

const HOJE = new Date('2026-07-21T12:00:00Z')
const FUTURO = '2026-07-31'
const PASSADO = '2026-06-30'

/** Honorários italianos: EUR 6.290,00, câmbio 6,20 → BRL 38.998,00. */
function honorarios(over: Partial<LancamentoView> = {}): LancamentoView {
  return {
    id: 1,
    codigo: 'REC-1',
    categoria: 'HONORARIOS',
    descricao: 'Honorários Contratuais — Cidadania Italiana',
    moeda: 'EUR',
    valor: 6290,
    fxEstimado: 6.2,
    fxRule: 'VARIAVEL',
    nParcelas: 1,
    phaseKey: 'genealogia',
    origem: 'motor',
    documentoId: null,
    status: 'ATIVA',
    parcelas: [{ id: 10, numero: 1, vencimento: FUTURO, valor: 6290, status: 'PENDENTE' }],
    ...over,
  }
}

/** Custo/receita documental: vinculado a DOCUMENTO concreto. */
function documental(over: Partial<LancamentoView> = {}): LancamentoView {
  return {
    id: 2,
    codigo: 'REC-2',
    categoria: 'OUTROS',
    descricao: 'Emissão de certidão',
    moeda: 'BRL',
    valor: 500,
    fxEstimado: 1,
    fxRule: 'VARIAVEL',
    phaseKey: 'genealogia',
    origem: 'motor',
    documentoId: 77,
    status: 'ATIVA',
    parcelas: [{ id: 20, numero: 1, vencimento: FUTURO, valor: 500, status: 'PENDENTE' }],
    ...over,
  }
}

// ── CENÁRIO 1 — processo italiano com 1 requerente ──────────────────────────
secao('Cenário 1 — processo italiano, 1 requerente')
{
  const r = honorarios()
  const t = totaisDoLancamento(r, HOJE)
  eq('moeda principal é EUR', t.moeda, 'EUR')
  eq('valor contratual € 6.290,00', t.contratado, 6290)
  eq('conversão R$ 38.998,00', t.contratadoBrl, 38998)
  eq('câmbio aplicado 6,20', t.cambio, 6.2)
  ok('conversão marcada como estimada', t.conversaoEstimada)
  eq('uma única receita', resumoReceitas([r], HOJE).quantidade, 1)
  eq('status A vencer', statusDoLancamento(r, HOJE), 'A_VENCER')
  eq('NÃO cai em Pasta Documental', subgrupoDoLancamento(r), 'HONORARIOS')

  const g = agruparPorFase([r], { genealogia: 'Genealogia' })
  eq('grupo pai é a fase Genealogia', g[0].faseLabel, 'Genealogia')
  eq('subgrupo é Honorários Contratuais', g[0].subgrupos[0].label, 'Honorários Contratuais')
  eq('um subgrupo só', g[0].subgrupos.length, 1)
}

// ── CENÁRIO 3 — alterar vencimento ──────────────────────────────────────────
secao('Cenário 3 — alterar vencimento')
{
  const antes = honorarios()
  const depois = honorarios({ parcelas: [{ id: 10, numero: 1, vencimento: '2026-09-15', valor: 6290, status: 'PENDENTE' }] })
  eq('valor contratual inalterado', totaisDoLancamento(depois, HOJE).contratado, totaisDoLancamento(antes, HOJE).contratado)
  eq('novo vencimento refletido', totaisDoLancamento(depois, HOJE).proximoVencimento, '2026-09-15')
  eq('segue A vencer', statusDoLancamento(depois, HOJE), 'A_VENCER')
  eq('não duplicou lançamento', resumoReceitas([depois], HOJE).quantidade, 1)
}

// ── CENÁRIO 4 — reparcelamento 1 → 3 ────────────────────────────────────────
secao('Cenário 4 — alterar parcelamento (1 → 3)')
{
  const plano = redistribuirParcelas(6290, 3, new Date('2026-07-31T00:00:00Z'))
  const soma = Number(plano.reduce((s, p) => s + p.valor, 0).toFixed(2))
  eq('3 parcelas geradas', plano.length, 3)
  eq('soma das parcelas = € 6.290,00', soma, 6290)

  const r = honorarios({
    nParcelas: 3,
    parcelas: plano.map((p, i) => ({ id: 100 + i, numero: p.numero, vencimento: p.vencimento.toISOString(), valor: p.valor, status: 'PENDENTE' as const })),
  })
  eq('valor contratual permanece € 6.290,00', totaisDoLancamento(r, HOJE).contratado, 6290)
  eq('nenhuma receita nova criada', resumoReceitas([r], HOJE).quantidade, 1)

  // arredondamento: valor indivisível fecha exato na última parcela
  const q = redistribuirParcelas(100, 3, new Date('2026-01-31T00:00:00Z'))
  eq('arredondamento tratado (100 em 3×)', Number(q.reduce((s, p) => s + p.valor, 0).toFixed(2)), 100)
  eq('última parcela absorve o resto', q[2].valor, 33.34)
}

// ── CENÁRIO 5 — recebimento parcial ─────────────────────────────────────────
secao('Cenário 5 — registrar recebimento parcial')
{
  const r = honorarios({
    nParcelas: 2,
    parcelas: [
      { id: 1, numero: 1, vencimento: PASSADO, valor: 3145, status: 'RECEBIDA', dataPagamento: PASSADO, cambioAplicado: 6.2, valorBrl: 19499 },
      { id: 2, numero: 2, vencimento: FUTURO, valor: 3145, status: 'PENDENTE' },
    ],
  })
  const t = totaisDoLancamento(r, HOJE)
  eq('recebido € 3.145,00', t.recebido, 3145)
  eq('saldo € 3.145,00', t.saldo, 3145)
  eq('50% recebido', Math.round(t.percentualRecebido), 50)
  eq('status parcialmente recebido', statusDoLancamento(r, HOJE), 'PARCIALMENTE_RECEBIDO')
  eq('recebido em BRL usa o câmbio do recebimento', t.recebidoBrl, 19499)
  ok('parcela paga no passado não gera inadimplência', !estaInadimplente(r, HOJE))
}

// ── CENÁRIO 6/7 — cancelamento e estorno preservam estado ───────────────────
secao('Cenários 6 e 7 — cancelamento e estorno')
{
  const cancelado = honorarios({ cancelada: true, canceladoEm: '2026-07-20T00:00:00Z', status: 'CANCELADA' })
  eq('cancelado exibe Cancelado', statusDoLancamento(cancelado, HOJE), 'CANCELADO')
  ok('cancelado nunca é inadimplente', !estaInadimplente(cancelado, HOJE))
  eq('cancelado sai do resumo ativo', resumoReceitas([cancelado], HOJE).quantidade, 0)

  const estornado = honorarios({ estornadoEm: '2026-07-20T00:00:00Z' })
  eq('estornado exibe Estornado', statusDoLancamento(estornado, HOJE), 'ESTORNADO')
  ok('estornado nunca é inadimplente', !estaInadimplente(estornado, HOJE))
}

// ── CENÁRIO 8 — caracteres especiais ────────────────────────────────────────
secao('Cenário 8 — caracteres especiais na interface')
{
  const alvos = [
    'src/components/financeiro/subabas/Receitas.tsx',
    'src/components/financeiro/subabas/Custos.tsx',
    'src/components/financeiro/subabas/Extrato.tsx',
    'src/components/financeiro/receita-modal/ReceitaFinanceiraModal.tsx',
    'src/components/financeiro/receita-modal/ReceitaResumoExecutivo.tsx',
    'src/components/financeiro/receita-modal/ReceitaVisaoGeral.tsx',
  ]
  // Escape unicode literal em POSIÇÃO DE TEXTO JSX (fora de string) renderiza cru.
  const escapeEmTextoJsx = />[^<>{}\n]*\\u[0-9a-fA-F]{4}/
  for (const rel of alvos) {
    const p = join(RAIZ, rel)
    if (!existsSync(p)) { ok(`${rel} existe`, false); continue }
    const src = readFileSync(p, 'utf8')
    ok(`${rel} sem escape \\uXXXX renderizável`, !escapeEmTextoJsx.test(src))
  }
  const receitas = readFileSync(join(RAIZ, 'src/components/financeiro/subabas/Receitas.tsx'), 'utf8')
  ok('travessão — literal presente', receitas.includes('—'))
  ok('acentuação correta (Honorários)', receitas.includes('Honorários'))
  ok('sem sequência de surrogate literal', !receitas.includes('\\ud83d'))
}

// ── CENÁRIO 9 — múltiplas moedas ────────────────────────────────────────────
secao('Cenário 9 — múltiplas moedas')
{
  const eur = honorarios()
  const usd = honorarios({ id: 3, codigo: 'REC-3', moeda: 'USD', valor: 1000, fxEstimado: 5.4, parcelas: [{ id: 30, numero: 1, vencimento: FUTURO, valor: 1000, status: 'PENDENTE' }] })
  const brl = honorarios({ id: 4, codigo: 'REC-4', moeda: 'BRL', valor: 500, fxEstimado: 1, parcelas: [{ id: 40, numero: 1, vencimento: FUTURO, valor: 500, status: 'PENDENTE' }] })

  const t = totaisPorMoeda([eur, usd, brl], HOJE)
  eq('três moedas separadas', t.length, 3)
  eq('EUR preservado', t.find((x) => x.moeda === 'EUR')!.contratado, 6290)
  eq('USD preservado', t.find((x) => x.moeda === 'USD')!.contratado, 1000)
  eq('BRL preservado', t.find((x) => x.moeda === 'BRL')!.contratado, 500)

  const res = resumoReceitas([eur, usd, brl], HOJE)
  ok('marca multiMoeda', res.multiMoeda)
  eq('BRL estimado é soma auxiliar', res.totalEstimadoBrl, Number((38998 + 5400 + 500).toFixed(2)))
  ok('nenhum total único substitui as moedas originais', res.porMoeda.length === 3)
}

// ── CENÁRIO 10 — nenhuma criação manual ─────────────────────────────────────
secao('Cenário 10 — nenhuma criação manual reintroduzida')
{
  const src = readFileSync(join(RAIZ, 'src/components/financeiro/subabas/Receitas.tsx'), 'utf8')
  const proibidos = ['Nova Receita', 'Novo Custo', 'Adicionar Receita', 'Criar Receita', 'Lançamento Manual', 'NovaReceitaPagina', 'LancarParcelaPagina']
  for (const p of proibidos) ok(`sem "${p}"`, !src.includes(p))
  ok('sem POST de criação de receita na tela', !/method:\s*['"]POST['"][\s\S]{0,200}\/api\/financeiro\/receitas['"]/.test(src))
  ok('modal central é o caminho de operação', src.includes('ReceitaFinanceiraModal'))
  ok('drawer lateral removido da tela', !src.includes('ReceitaDrawer'))
  ok('drawer lateral removido do repositório', !existsSync(join(RAIZ, 'src/components/financeiro/ReceitaDrawer.tsx')))
}

// ── CENÁRIO 11 — supressão impede recriação ─────────────────────────────────
secao('Cenário 11 — reconciliação após cancelamento válido')
{
  const exec = readFileSync(join(RAIZ, 'src/lib/motor/executor.ts'), 'utf8')
  ok('executor importa a guarda de supressão', exec.includes('artefatoEstaSuprimido'))
  ok('honorários checa supressão antes de recriar', /artefatoEstaSuprimido\(artefato\)/.test(exec))

  const sup = readFileSync(join(RAIZ, 'lib/financeiro/supressao-motor.ts'), 'utf8')
  for (const campo of ['processoId', 'ruleKind', 'targetId', 'motivo', 'usuarioId', 'suprimidoEm', 'revogadoEm']) {
    ok(`supressão registra ${campo}`, sup.includes(campo))
  }
  ok('revogação existe', sup.includes('revogarSupressao'))
  ok('supressão não apaga registro', !/\.delete\(/.test(sup))

  const cancelar = readFileSync(join(RAIZ, 'src/app/api/financeiro/receitas/[id]/cancelar/route.ts'), 'utf8')
  ok('cancelar exige motivo', cancelar.includes('mínimo 3 caracteres'))
  ok('cancelar bloqueia quando a origem segue ativa', cancelar.includes('ORIGEM_ATIVA'))
  ok('cancelar registra supressão', cancelar.includes('suprimirOrigem'))
}

// ── CENÁRIO 12 — vencimento não definido ────────────────────────────────────
secao('Cenário 12 — vencimento não definido')
{
  const r = honorarios({ parcelas: [{ id: 10, numero: 1, vencimento: null, valor: 6290, status: 'PENDENTE' }] })
  eq('status Vencimento não definido', statusDoLancamento(r, HOJE), 'SEM_VENCIMENTO')
  eq('rótulo em português', STATUS_LABEL[statusDoLancamento(r, HOJE)], 'Vencimento não definido')
  ok('não marca como atrasado', totaisDoLancamento(r, HOJE).parcelasVencidas === 0)
  ok('não marca como inadimplente', !estaInadimplente(r, HOJE))

  const res = resumoReceitas([r], HOJE)
  eq('card Situação mostra vencimento não definido', res.situacao, 'SEM_VENCIMENTO')
  eq('1 parcela a configurar', res.parcelasPendentes, 1)
  ok('resumo não acusa inadimplência', !res.inadimplente)
}

// ── Regras de data e inadimplência ──────────────────────────────────────────
secao('Regras de data e inadimplência')
{
  const vencida = honorarios({ parcelas: [{ id: 1, numero: 1, vencimento: PASSADO, valor: 6290, status: 'PENDENTE' }] })
  eq('vencida → Vencido', statusDoLancamento(vencida, HOJE), 'VENCIDO')
  ok('vencida com saldo é inadimplente', estaInadimplente(vencida, HOJE))

  const quitada = honorarios({ parcelas: [{ id: 1, numero: 1, vencimento: PASSADO, valor: 6290, status: 'RECEBIDA', cambioAplicado: 6.2, valorBrl: 38998 }] })
  eq('quitada → Recebido', statusDoLancamento(quitada, HOJE), 'RECEBIDO')
  ok('quitada não é inadimplente', !estaInadimplente(quitada, HOJE))
  eq('saldo zerado', totaisDoLancamento(quitada, HOJE).saldo, 0)

  const semPagar = honorarios()
  ok('sem pagamento e a vencer NÃO é inadimplente', !estaInadimplente(semPagar, HOJE))
}

// ── Agrupamento: Pasta Documental só com documento ──────────────────────────
secao('Agrupamento — Pasta Documental')
{
  eq('lançamento com documentoId → Pasta Documental', subgrupoDoLancamento(documental()), 'PASTA_DOCUMENTAL')
  eq('gerado pelo motor SEM documento não é documental', subgrupoDoLancamento(honorarios()), 'HONORARIOS')
  eq('reembolso vai para Reembolsos', subgrupoDoLancamento(honorarios({ categoria: 'REEMBOLSO' })), 'REEMBOLSOS')

  const g = agruparPorFase([honorarios(), documental()], { genealogia: 'Genealogia' })
  eq('uma fase', g.length, 1)
  eq('dois subgrupos', g[0].subgrupos.length, 2)
  eq('Honorários listado antes', g[0].subgrupos[0].key, 'HONORARIOS')
  eq('Pasta Documental depois', g[0].subgrupos[1].key, 'PASTA_DOCUMENTAL')
  eq('Pasta Documental contém só o doc', g[0].subgrupos[1].itens.length, 1)
  eq('honorário fora da Pasta', g[0].subgrupos[1].itens[0].id, 2)
}

// ── Câmbio nunca altera o valor original ────────────────────────────────────
secao('Câmbio não recalcula o valor contratual')
{
  const a = honorarios()
  const b = honorarios({ fxEstimado: 7.5 }) // câmbio variou
  eq('valor contratual permanece € 6.290,00', totaisDoLancamento(b, HOJE).contratado, totaisDoLancamento(a, HOJE).contratado)
  ok('só a conversão muda', totaisDoLancamento(b, HOJE).contratadoBrl !== totaisDoLancamento(a, HOJE).contratadoBrl)

  const fixo = honorarios({ fxRule: 'FIXO', fxFixo: 6.2 })
  eq('FIXO usa o câmbio congelado', cambioEfetivo(fixo), 6.2)
  ok('FIXO não é estimativa', !totaisDoLancamento(fixo, HOJE).conversaoEstimada)
}

// ── Guarda: campos calculados bloqueados na API ─────────────────────────────
secao('Campos calculados bloqueados')
{
  const parcela = readFileSync(join(RAIZ, 'src/app/api/financeiro/parcelas/[id]/route.ts'), 'utf8')
  ok('PATCH de parcela rejeita valor', parcela.includes('FinanceRuleEngine') && parcela.includes('422'))

  const rep = readFileSync(join(RAIZ, 'src/app/api/financeiro/receitas/[id]/parcelas/route.ts'), 'utf8')
  ok('reparcelamento usa o valor do lançamento como total', rep.includes('Number(receita.valor)'))
  ok('reparcelamento tem guarda de arredondamento', rep.includes('Falha de arredondamento'))
  ok('reparcelamento bloqueia com recebimento', rep.includes('já existe recebimento'))
}

// ── Guarda: MODAL FINANCEIRO CENTRAL (experiência definitiva) ───────────────
secao('Modal financeiro central')
{
  const base = 'src/components/financeiro/receita-modal'
  const componentes = [
    'ReceitaFinanceiraModal',
    'ReceitaModalHeader',
    'ReceitaResumoExecutivo',
    'ReceitaVisaoGeral',
    'ReceitaParcelasTab',
    'ReceitaRecebimentosTab',
    'ReceitaHistoricoTab',
    'ReceitaInformacoesTecnicasTab',
    'ReceitaAcoesMenu',
  ]
  for (const c of componentes) {
    ok(`componente ${c} existe`, existsSync(join(RAIZ, `${base}/${c}.tsx`)))
  }
  ok('folha de estilo própria do modal', existsSync(join(RAIZ, 'src/styles/receita-modal.css')))

  const modal = readFileSync(join(RAIZ, `${base}/ReceitaFinanceiraModal.tsx`), 'utf8')

  // Modal central — nunca drawer, nunca navegação para outra página.
  ok('sem drawer lateral', !/ReceitaDrawer|rdw-|rfm-painel-lateral/.test(modal))
  ok('sem navegação para outra página', !modal.includes('useRouter') && !modal.includes('router.push'))

  // Acessibilidade
  ok('role dialog + aria-modal', modal.includes('role="dialog"') && modal.includes('aria-modal="true"'))
  ok('rotulado pelo título', modal.includes('aria-labelledby="rfm-titulo"'))
  ok('Escape fecha', modal.includes("e.key === 'Escape'"))
  ok('foco preso no modal (Tab)', modal.includes("e.key !== 'Tab'"))
  ok('devolve o foco ao elemento de origem', modal.includes('focoAnterior.current?.focus'))
  ok('trava a rolagem do fundo', modal.includes("document.body.style.overflow = 'hidden'"))
  ok('abas com role tablist/tab/tabpanel',
    modal.includes('role="tablist"') && modal.includes('role="tab"') && modal.includes('role="tabpanel"'))

  // Somente a aba ativa renderiza.
  for (const aba of ['geral', 'parcelas', 'recebimentos', 'historico', 'tecnico']) {
    ok(`aba ${aba} renderiza sob condição`, modal.includes(`aba === '${aba}'`))
  }

  // Reutilização integral dos endpoints já existentes — nenhuma API nova.
  const endpoints = [
    '/detalhe',
    '/api/financeiro/parcelas/${p.id}',
    '/api/financeiro/parcelas/${p.id}/lancamento',
    '/parcelas`',
    '/cancelar`',
    '/estornar`',
    '/supressao`',
  ]
  for (const e of endpoints) ok(`usa endpoint existente ${e}`, modal.includes(e))
  ok('não recalcula composição no cliente', !modal.includes('requerentesAdicionais') && !modal.includes('* valorBase'))
  ok('status e totais vêm da fonte única',
    modal.includes('statusDoLancamento') && modal.includes('totaisDoLancamento'))

  // Ações excepcionais fora do destaque permanente.
  ok('modal não tem botão de perigo fixo no rodapé', !/rfm-rodape[\s\S]{0,400}rfm-btn-perigo/.test(modal))
  const menu = readFileSync(join(RAIZ, `${base}/ReceitaAcoesMenu.tsx`), 'utf8')
  ok('cancelar vive em Mais ações', menu.includes('Cancelar lançamento'))
  ok('estorno vem resolvido do estado', menu.includes('acoes.lancamento.estornar'))
  ok('bloqueio mostra o motivo', menu.includes('item.acao.motivo'))
  ok('menu não decide nada por conta própria', !/podeEstornar|podeCancelar|temRecebimento/.test(menu))

  // Informação técnica fora da leitura principal.
  const visao = readFileSync(join(RAIZ, `${base}/ReceitaVisaoGeral.tsx`), 'utf8')
  for (const termo of ['chaveIdempotencia', 'tecnico', 'ruleSource', 'tabelaPrecos', 'vigencia']) {
    ok(`Visão geral sem "${termo}"`, !visao.includes(termo))
  }
  ok('Visão geral sem cadeado', !visao.includes('🔒'))
  const tecnica = readFileSync(join(RAIZ, `${base}/ReceitaInformacoesTecnicasTab.tsx`), 'utf8')
  for (const termo of ['tecnico', 'tabelaPrecos', 'Vigência', 'eventoOperacional', 'phaseKey']) {
    ok(`aba técnica contém "${termo}"`, tecnica.includes(termo))
  }

  // Moeda original permanece principal.
  const resumo = readFileSync(join(RAIZ, `${base}/ReceitaResumoExecutivo.tsx`), 'utf8')
  ok('valor principal usa a moeda original', resumo.includes('fmtMoeda(totais.contratado, moeda)'))
  ok('BRL aparece como conversão auxiliar', resumo.includes('≈ ') && resumo.includes('fmtBRL'))
  ok('progresso é percentual recebido', resumo.includes('percentualRecebido'))
  ok('sem gráfico decorativo', !/donut|pizza|chart|Chart/.test(resumo))

  // Escapes literais em texto JSX.
  const escapeEmTextoJsx = />[^<>{}\n]*\\u[0-9a-fA-F]{4}/
  for (const c of componentes) {
    const src = readFileSync(join(RAIZ, `${base}/${c}.tsx`), 'utf8')
    ok(`${c} sem escape \\uXXXX renderizável`, !escapeEmTextoJsx.test(src))
  }
}

// ── Guarda: CENTRAL DE OPERAÇÃO (Financeiro V2) ─────────────────────────────
secao('Central de operação do lançamento')
{
  const base = 'src/components/financeiro/receita-modal'
  for (const c of ['ReceitaAcoesRapidas', 'ReceitaRecebimentoForm', 'ReceitaMenuLinha']) {
    ok(`componente ${c} existe`, existsSync(join(RAIZ, `${base}/${c}.tsx`)))
  }
  ok('fonte única de ações existe', existsSync(join(RAIZ, 'lib/financeiro/acoes-lancamento.ts')))

  const modal = readFileSync(join(RAIZ, `${base}/ReceitaFinanceiraModal.tsx`), 'utf8')
  ok('modal consome a fonte única de ações', modal.includes('resolveAvailableFinancialActions'))
  ok('modal lê permissões do usuário', modal.includes('usePermissoes'))
  ok('permissões usam as chaves do backend',
    modal.includes('financeiro.pagamento_criar') &&
    modal.includes('financeiro.pagamento_editar') &&
    modal.includes('financeiro.pagamento_excluir'))
  ok('sem permissão carregada, nada operacional é oferecido', modal.includes('carregandoPerm ? false'))

  // Operações completas dentro do modal, sem sair da tela.
  for (const painel of ['recebimento', 'vencimento', 'vencimento-lote', 'recebimento-lote', 'observacoes', 'cancelamento', 'estorno', 'revogacao']) {
    ok(`painel interno "${painel}"`, modal.includes(`'${painel}'`))
  }
  ok('sem window.prompt', !modal.includes('window.prompt'))
  ok('sem window.confirm', !modal.includes('window.confirm'))
  ok('sem reload de página', !modal.includes('location.reload'))
  ok('recarrega o detalhe após cada ação', modal.includes('await carregar()'))

  // Nenhum endpoint novo: só rotas já existentes.
  const rotasUsadas = modal.match(/\/api\/[a-z0-9/[\]${}.-]+/gi) ?? []
  // A base é derivada da natureza (receitas|custos) — PARIDADE receita/custo.
  // Continuam sendo apenas rotas do módulo financeiro, nenhuma inventada.
  const permitidas = [
    '/api/financeiro/${vocab.recurso}/${receitaId}',
    '/api/financeiro/parcelas/${p.id}',
    '/api/financeiro/parcelas/${p.id}/lancamento',
  ]
  for (const rota of rotasUsadas) {
    ok(`rota existente: ${rota}`, permitidas.includes(rota))
  }
  ok('base derivada cobre receitas e custos', modal.includes("recurso: 'receitas'") && modal.includes("recurso: 'custos'"))
  const form = readFileSync(join(RAIZ, `${base}/ReceitaRecebimentoForm.tsx`), 'utf8')
  ok('comprovante usa o presign existente', form.includes('/api/storage/presign'))
  ok('formulário completo de recebimento',
    ['Data do recebimento', 'Câmbio aplicado', 'Forma de pagamento', 'Conta financeira', 'Observações', 'Comprovante']
      .every((c) => form.includes(c)))
  ok('valor e moeda permanecem do motor', form.includes('rfm-campo-fixo'))

  // Ações contextuais: os componentes não decidem, só renderizam.
  const rapidas = readFileSync(join(RAIZ, `${base}/ReceitaAcoesRapidas.tsx`), 'utf8')
  ok('ações rápidas renderizam do resolvedor', rapidas.includes('acoes.lancamento') && rapidas.includes('.disponivel'))
  ok('ações rápidas sem regra própria', !/podeCancelar|podeEstornar|status ===/.test(rapidas))

  const parcelasTab = readFileSync(join(RAIZ, `${base}/ReceitaParcelasTab.tsx`), 'utf8')
  ok('parcelas usam menu contextual', parcelasTab.includes('ReceitaMenuLinha'))
  ok('parcelas resolvem ação por linha', parcelasTab.includes('acoes.parcela(p)'))
  ok('seleção em lote presente', parcelasTab.includes('rfm-lote') && parcelasTab.includes('selecao'))
  ok('lote só opera parcelas válidas', parcelasTab.includes('acoes.parcela(p).registrarRecebimento.disponivel'))
  ok('parcelas sem condicional de permissão própria', !parcelasTab.includes('detalhe.acoes.'))

  const recebTab = readFileSync(join(RAIZ, `${base}/ReceitaRecebimentosTab.tsx`), 'utf8')
  ok('recebimentos têm menu por linha', recebTab.includes('ReceitaMenuLinha'))
  ok('recebimentos mostram conciliação', recebTab.includes('recebimentoConciliado'))
  ok('recebimentos sem condicional própria', !recebTab.includes('detalhe.acoes.'))

  const hist = readFileSync(join(RAIZ, `${base}/ReceitaHistoricoTab.tsx`), 'utf8')
  ok('histórico expande sob demanda', hist.includes('aria-expanded'))
  ok('histórico mostra responsável', hist.includes('Responsável'))
  ok('histórico não abre tudo por padrão', hist.includes('useState(false)'))

  const tec = readFileSync(join(RAIZ, `${base}/ReceitaInformacoesTecnicasTab.tsx`), 'utf8')
  ok('aba técnica é endereçável', tec.includes('secaoInicial'))
  ok('aba técnica é somente leitura', !/method:\s*['"](POST|PATCH|DELETE)['"]/.test(tec))
}

// ── resultado ───────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(60)}`)
console.log(`Receitas do Processo: ${passou} passaram, ${falhou} falharam`)
console.log('='.repeat(60))
if (falhou > 0) process.exit(1)
