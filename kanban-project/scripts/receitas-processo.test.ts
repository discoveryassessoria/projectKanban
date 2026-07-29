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
// Sucessores V3: a lista de Receitas + o shell financeiro do processo + o
// detalhe da Receita substituem as subabas V1 (Receitas/Custos/Extrato) e o
// modal V1 (receita-modal/**), removidos na migração.
secao('Cenário 8 — caracteres especiais na interface (sucessores V3)')
{
  const alvos = [
    'src/components/financeiro/v3/ReceitasTab.tsx',
    'src/components/financeiro/v3/ProcessoFinanceiroShell.tsx',
    'src/components/financeiro/v3/ReceitaDetalheView.tsx',
  ]
  // Escape unicode literal em POSIÇÃO DE TEXTO JSX (fora de string) renderiza cru.
  const escapeEmTextoJsx = />[^<>{}\n]*\\u[0-9a-fA-F]{4}/
  for (const rel of alvos) {
    const p = join(RAIZ, rel)
    if (!existsSync(p)) { ok(`${rel} existe`, false); continue }
    const src = readFileSync(p, 'utf8')
    ok(`${rel} sem escape \\uXXXX renderizável`, !escapeEmTextoJsx.test(src))
  }
  const receitas = readFileSync(join(RAIZ, 'src/components/financeiro/v3/ReceitasTab.tsx'), 'utf8')
  ok('travessão — literal presente', receitas.includes('—'))
  ok('sem sequência de surrogate literal', !receitas.includes('\\ud83d'))
  const detalhe = readFileSync(join(RAIZ, 'src/components/financeiro/v3/ReceitaDetalheView.tsx'), 'utf8')
  ok('acentuação correta (Cobrança/Cobranças)', detalhe.includes('Cobranças'))
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

// ── CENÁRIO 10 — criação manual é disciplinada pelo Catálogo Mestre ────────
// SUPERSEDIDO: a arquitetura V1 proibia QUALQUER criação manual (o botão
// "Nova Receita" era só informativo). A arquitetura V3 introduziu um
// lançamento manual DELIBERADO (LancamentoFinanceiroModal → POST
// /api/financeiro/v3/receitas), mas disciplinado: exige item do Catálogo
// Mestre (nunca valor livre) e override de preço exige permissão dedicada.
// O invariante que sobrevive é "nada bypassa o motor/catálogo", não "nada é
// manual". A página de dossiê V1 foi removida — o detalhe abre inline
// (ReceitaDetalheView), sem navegar para outra rota.
secao('Cenário 10 — lançamento manual V3 é disciplinado pelo Catálogo Mestre')
{
  const tab = readFileSync(join(RAIZ, 'src/components/financeiro/v3/ReceitasTab.tsx'), 'utf8')
  ok('lista abre o detalhe inline (sem navegar para dossiê separado)', /onAbrirDetalhe \? onAbrirDetalhe\(id\) : router\.push/.test(tab))
  ok('página de dossiê V1 não existe mais', !existsSync(join(RAIZ, 'src/app/processos/[processoId]/financeiro/receitas/[receitaId]/page.tsx')))
  ok('drawer lateral V1 não existe mais', !existsSync(join(RAIZ, 'src/components/financeiro/ReceitaDrawer.tsx')))

  const rota = readFileSync(join(RAIZ, 'src/app/api/financeiro/v3/receitas/route.ts'), 'utf8')
  ok('POST manual exige item do Catálogo Mestre (nunca valor livre)', /Selecione um item do Cadastro Mestre/.test(rota) && /itemCatalogoId/.test(rota))
  ok('override de preço exige permissão dedicada (não é livre para qualquer um)', /podeOverridePreco/.test(rota) && /financeiro\.custos_editar/.test(rota))
  ok('criação delega ao serviço canônico (não bypassa o motor)', /criarReceitaManualCanonica/.test(rota) && !/prisma\.receita\.create/.test(rota))
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
// As rotas V1 de PATCH de parcela e reparcelamento foram removidas. O mesmo
// invariante (total não pode ser reescrito livremente; nada abaixo do já
// recebido; pagamento confirmado nunca é reescrito) migrou para o serviço de
// redistribuição/edição da Receita no V3 (ver editar-distribuicao-financeira,
// detalhe-receita-rico).
secao('Campos calculados bloqueados (sucessor V3: redistribuição/edição da Receita)')
{
  const redistribuir = readFileSync(join(RAIZ, 'lib/financeiro/distribuicao/redistribuir-service.ts'), 'utf8')
  ok('redistribuição mantém o total da Receita invariante', /deve ser igual ao total da Receita/.test(redistribuir))
  ok('redistribuição bloqueia valor abaixo do já recebido', /não pode ser menor que o já recebido/.test(redistribuir))

  const editar = readFileSync(join(RAIZ, 'lib/financeiro/acoes/editar-receita.ts'), 'utf8')
  ok('edição nunca reescreve pagamento confirmado', /NUNCA reescreve pagamento confirmado/.test(editar))
  ok('mudança de valor posta ajuste balanceado no Ledger (append-only)', /Ledger append-only/.test(editar) && /AJUSTE balanceado/.test(editar))
}

// ── Guarda: DETALHE DA RECEITA V3 (sucessor do modal financeiro central) ───
// O modal monolítico V1 (receita-modal/**, role="dialog", abas rfm-*) foi
// substituído por ReceitaDetalheView (embutido no shell do processo) +
// modais de ação dedicados (RegistrarPagamentoModal/EstornoModal/
// AcaoReceitaModal/EditarDistribuicaoView/EditarReceitaView). Os invariantes
// que sobrevivem à mudança de forma (não ao pixel): nenhum cálculo de câmbio
// no cliente, cada ação recarrega o detalhe, e a apresentação em BRL é uma
// fonte única (não cada tela decide sozinha como converter).
secao('Detalhe da Receita V3 — fonte única de apresentação e recarga pós-ação')
{
  const detalhe = readFileSync(join(RAIZ, 'src/components/financeiro/v3/ReceitaDetalheView.tsx'), 'utf8')
  ok('cada ação recarrega o detalhe (sem estado otimista desalinhado)', (detalhe.match(/carregar\(\)/g) || []).length >= 5)
  ok('usa a fonte única de apresentação de BRL (ValorBrl)', detalhe.includes('textoBrlOuOrigem'))
  ok('sem window.prompt (formulários próprios, não prompt nativo)', !detalhe.includes('window.prompt'))
  ok('sem reload de página', !detalhe.includes('location.reload'))

  const valorBrl = readFileSync(join(RAIZ, 'src/components/financeiro/v3/ValorBrl.tsx'), 'utf8')
  ok('ValorBrl é só apresentação — não calcula câmbio nem decide política', /não calcula câmbio, não decide política/.test(valorBrl))
  ok('ValorBrl é a mesma fonte usada no Shell/Detalhe/Receitas (documentado)', /Shell, no[\s\S]{0,20}Detalhe da Receita e na aba Receitas/.test(valorBrl))

  ok('Shell do processo usa o mesmo componente <ValorBrl>', readFileSync(join(RAIZ, 'src/components/financeiro/v3/ProcessoFinanceiroShell.tsx'), 'utf8').includes('<ValorBrl'))
  ok('lista de Receitas usa o mesmo componente <ValorBrl>', readFileSync(join(RAIZ, 'src/components/financeiro/v3/ReceitasTab.tsx'), 'utf8').includes('<ValorBrl'))
}

// ── resultado ───────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(60)}`)
console.log(`Receitas do Processo: ${passou} passaram, ${falhou} falharam`)
console.log('='.repeat(60))
if (falhou > 0) process.exit(1)
