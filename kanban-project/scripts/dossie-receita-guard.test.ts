// scripts/dossie-receita-guard.test.ts
// ============================================================================
// GUARDA — Dossiê da Receita na arquitetura ATUAL (Motor V3).
//
// O dossiê deixou de ser uma página dentro do processo e virou um COMPONENTE
// reutilizável (ReceitaDetalheView), servido em dois hospedeiros: a rota
// dedicada /financeiro/v3/receita/[ref] (URL direta, refresh, compartilhar) e,
// embutido, o modal do processo (ProcessoFinanceiroShell). O que este guard
// protege é o mesmo de antes, traduzido para essa forma:
//
//   • existe UMA superfície de detalhe — não duas implementações divergentes;
//   • a lista NAVEGA/delega para ela, não abre drawer de detalhe;
//   • o dossiê é rico: abas, estados vazios úteis, ações contextuais, anexos
//     com upload real, timeline sob demanda;
//   • os dados vêm de UM agregador gated, que reusa o view model puro e não
//     inventa consulta solta nem tabela paralela;
//   • toda AÇÃO vive em rota própria e é autorizada no servidor;
//   • Custo e Receita compartilham a superfície sem se confundirem.
//
// Anti-regressão explícito: a página e a subaba antigas não podem voltar.
// ============================================================================
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = join(__dirname, '..')
let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✓ ${n}`) } else { falhou++; console.log(`  ✗ ${n}`) } }
const sec = (t: string) => console.log(`\n${t}`)
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8')

const P_ROTA = 'src/app/financeiro/v3/receita/[ref]/page.tsx'
const P_VIEW = 'src/components/financeiro/v3/ReceitaDetalheView.tsx'
const P_SHELL = 'src/components/financeiro/v3/ProcessoFinanceiroShell.tsx'
const P_LISTA = 'src/components/financeiro/v3/ReceitasTab.tsx'
const P_API = 'src/app/api/financeiro/v3/receita/[ref]/route.ts'
const P_LEITURA = 'lib/financeiro/leitura/receita-detalhe.ts'

// Superfícies que a arquitetura anterior usava e que NÃO podem ressuscitar.
const LEGADO_PAGINA = 'src/app/processos/[processoId]/financeiro/receitas/[receitaId]/page.tsx'
const LEGADO_SUBABA = 'src/components/financeiro/subabas/Receitas.tsx'
const LEGADO_API = 'src/app/api/financeiro/receitas/[id]/dossie/route.ts'

sec('1 — superfície única de detalhe (rota dedicada + embutido no processo)')
{
  ok('rota dedicada do dossiê existe', existsSync(join(RAIZ, P_ROTA)))
  ok('componente do dossiê existe', existsSync(join(RAIZ, P_VIEW)))

  const rota = ler(P_ROTA)
  ok('rota é wrapper FINO sobre o componente (não duplica o dossiê)', rota.includes('ReceitaDetalheView') && rota.split('\n').length < 40)
  ok('rota entrega saída de volta (onVoltar)', rota.includes('onVoltar'))

  const shell = ler(P_SHELL)
  ok('processo EMBUTE o mesmo componente (fonte única do dossiê)', shell.includes('ReceitaDetalheView'))
  // Dentro do processo o detalhe abre EMBUTIDO; a rota dedicada é só o caminho de
  // quando não há hospedeiro. Navegar tem de ser sempre o `else` da delegação —
  // nunca incondicional, senão o dossiê saltaria para fora do processo.
  const aberturas = [...shell.matchAll(/router\.push\(`\/financeiro\/v3\/receita\//g)]
  const delegadas = [...shell.matchAll(/onAbrirDetalhe \? onAbrirDetalhe\([^)]*\) : router\.push\(`\/financeiro\/v3\/receita\//g)]
  ok('no processo, navegar é sempre FALLBACK de embutir (nunca incondicional)',
    aberturas.length > 0 && aberturas.length === delegadas.length)
}

sec('2 — lista de Receitas: navega/delega, nunca drawer de detalhe')
{
  const lista = ler(P_LISTA)
  ok('lista abre o detalhe por delegação ou navegação', lista.includes('onAbrirDetalhe') && lista.includes('router.push'))
  ok('navegação aponta para a rota oficial do dossiê', lista.includes('/financeiro/v3/receita/'))
  ok('lista NÃO abre drawer/modal de detalhe', !lista.includes('ReceitaCobrancaModal') && !lista.includes('ReceitaDrawer'))
  ok('modais da lista são de AÇÃO, não de leitura do dossiê',
    lista.includes('RegistrarPagamentoModal') && lista.includes('ExcluirReceitaModal'))
}

sec('3 — dossiê: abas, estados, ações e anexos')
{
  const v = ler(P_VIEW)
  ok('componente client', v.includes('"use client"'))
  ok('consome o agregador oficial do V3', v.includes('/api/financeiro/v3/receita/'))
  ok('botão Voltar', v.includes('onVoltar') && v.includes('Voltar para'))

  for (const [id, rotulo] of [
    ['cobrancas', 'Cobranças/Parcelas'], ['participantes', 'Participantes'], ['pagamentos', 'Pagamentos'],
    ['documentos', 'Documentos'], ['repasses', 'Repasses'], ['timeline', 'Timeline'], ['observacoes', 'Observações'],
  ]) ok(`aba "${rotulo}"`, new RegExp(`\\["${id}",`).test(v) || new RegExp(`tab === "${id}"`).test(v))

  ok('Custo e Receita compartilham a superfície sem se confundir (isCusto)', v.includes('isCusto'))
  ok('aba de Repasses é exclusiva de Custo', /isCusto \? \[\["repasses"/.test(v))
  ok('estado vazio útil em cobranças', v.includes('Nenhuma cobrança/parcela para esta receita'))
  ok('estado vazio útil em documentos', v.includes('Nenhum documento vinculado'))
  ok('timeline carregada sob demanda (não no primeiro render)', /tab !== "timeline" \|\| timelineGeral != null/.test(v))
  ok('anexos com upload REAL (storage), não placeholder', v.includes('uploadFiles') && v.includes('Anexar documento'))
  ok('anexo vincula na obrigação (sem tabela paralela)', v.includes('/documentos') && !v.includes('AnexoReceita'))
  ok('ações indisponíveis ficam desabilitadas COM motivo', /disabled=\{!temProcesso\}[\s\S]{0,120}title=/.test(v))
  ok('reusa a view de operação de pagamento (não reimplementa)', v.includes('RegistrarPagamentoView'))
  ok('excluir volta para a lista em vez de deixar tela órfã', /onDone=\{\(\) => \{ setExcluirOpen\(false\); onVoltar\(\) \}\}/.test(v))
}

sec('4 — agregador: um payload, gated, view model puro, sem escrita')
{
  const a = ler(P_API)
  ok('permissão financeiro.ver', a.includes("verificarPermissao(req, 'financeiro.ver')"))
  ok('gated pela flag do Motor V3 (posicaoRead)', a.includes("flagAtiva('posicaoRead'"))
  ok('reusa view model puro (não faz query solta na rota)', a.includes('carregarReceitaConsolidada') && !a.includes('prisma.'))
  ok('404 quando a receita não existe', a.includes('status: 404'))
  ok('distingue visão CONSOLIDADA e de UM participante', a.includes('carregarReceitaDetalhe') && a.includes("searchParams.get('obrigacao')"))
  ok('rota de leitura NÃO escreve (só GET)', !/export async function (POST|PUT|PATCH|DELETE)/.test(a))
  ok('não cria tabela/anexo paralelo', !a.includes('AnexoReceita') && !a.includes('prisma.anexoReceita'))

  const leitura = ler(P_LEITURA)
  ok('view model do dossiê existe e é reutilizável', leitura.includes('export async function carregarReceitaConsolidada'))
  ok('view model resolve a referência (código ou id)', leitura.includes('export async function resolverId'))
}

sec('5 — ações do dossiê: rota própria e autorização no servidor')
{
  const ACOES = ['cancelar', 'editar', 'excluir', 'arquivar', 'duplicar', 'registrar-pagamento', 'redistribuir', 'renegociar']
  for (const acao of ACOES) {
    const p = `src/app/api/financeiro/v3/receita/[ref]/${acao}/route.ts`
    const existe = existsSync(join(RAIZ, p))
    ok(`ação "${acao}" tem rota própria e é autorizada no servidor`, existe && ler(p).includes('verificarPermissao'))
  }
  ok('nenhuma ação é decidida só no cliente (o dossiê chama rotas, não o Prisma)',
    !ler(P_VIEW).includes('@/lib/prisma'))
}

sec('6 — anti-regressão: o legado não volta')
{
  ok('página antiga do dossiê no processo NÃO existe', !existsSync(join(RAIZ, LEGADO_PAGINA)))
  ok('subaba antiga de Receitas NÃO existe', !existsSync(join(RAIZ, LEGADO_SUBABA)))
  ok('endpoint /dossie antigo NÃO existe', !existsSync(join(RAIZ, LEGADO_API)))
  const alvos = [P_ROTA, P_VIEW, P_SHELL, P_LISTA, P_API]
  ok('nenhum arquivo vivo referencia a subaba antiga', !alvos.some((f) => ler(f).includes('subabas/Receitas')))
  ok('nenhum arquivo vivo referencia a rota antiga do dossiê',
    !alvos.some((f) => /\/processos\/[^'"`]*\/financeiro\/receitas\//.test(ler(f))))
}

console.log(`\n${'='.repeat(60)}`)
console.log(`Dossiê da Receita: ${passou} passaram, ${falhou} falharam`)
console.log('='.repeat(60))
if (falhou > 0) process.exit(1)
