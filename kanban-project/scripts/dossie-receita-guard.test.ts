// scripts/dossie-receita-guard.test.ts
// ============================================================================
// GUARDA — Dossiê da Receita (PÁGINA CENTRAL, sem modal/drawer de detalhe).
// Estrutural: rota, página, endpoint agregador, navegação, abas, estados,
// validação de vínculo processo↔receita, reuso do modal de operação.
// ============================================================================
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = join(__dirname, '..')
let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✓ ${n}`) } else { falhou++; console.log(`  ✗ ${n}`) } }
const sec = (t: string) => console.log(`\n${t}`)

const PAGE = join(RAIZ, 'src/app/processos/[processoId]/financeiro/receitas/[receitaId]/page.tsx')
const API = join(RAIZ, 'src/app/api/financeiro/receitas/[id]/dossie/route.ts')
const LISTA = join(RAIZ, 'src/components/financeiro/subabas/Receitas.tsx')

sec('1 — rota e navegação (sem modal/drawer)')
{
  ok('página do dossiê existe na árvore de rotas', existsSync(PAGE))
  const lista = readFileSync(LISTA, 'utf8')
  ok('lista NAVEGA para o dossiê (router.push)', lista.includes('router.push') && lista.includes('/financeiro/receitas/'))
  ok('lista não abre modal/drawer de detalhe', !lista.includes('ReceitaCobrancaModal') && !lista.includes('ReceitaDrawer'))
  ok('botão renomeado para "Ver dossiê"', lista.includes('Ver dossiê'))
}

sec('2 — página: guard, layout, abas, estados')
{
  const p = readFileSync(PAGE, 'utf8')
  ok('client + shell global (HeaderBar)', p.includes("'use client'") && p.includes('HeaderBar'))
  ok('guard de permissão financeiro.ver', p.includes("pode('financeiro.ver')"))
  ok('consome o agregador /dossie', p.includes('/dossie?processoId='))
  ok('botão Voltar para receitas', p.includes('Voltar para receitas'))
  for (const aba of ['Parcelas', 'Pagamentos', 'Histórico', 'Comunicações', 'Anexos', 'Auditoria']) ok(`aba "${aba}"`, p.includes(`'${aba}'`))
  ok('estado sem cobrança (empty útil)', p.includes('ainda não possui cobrança'))
  ok('bloco de cobrança com runtime (valor base/taxa/líquido)', p.includes('Valor base') && p.includes('Líquido previsto'))
  ok('memória de cálculo exibida', p.includes('Memória de cálculo'))
  ok('ações rápidas contextuais (disabled por estado)', p.includes('acoes') && p.includes('disabled'))
  ok('reusa ReceitaCobrancaModal como modal de OPERAÇÃO', p.includes('ReceitaCobrancaModal'))
  ok('card de anexos (upload real)', p.includes('Arraste arquivos'))
}

sec('3 — endpoint agregador (uma composição, ownership, sem N+1)')
{
  const a = readFileSync(API, 'utf8')
  ok('valida vínculo receita↔processo', a.includes('não pertence a este processo') && a.includes('403'))
  ok('permissão financeiro.ver', a.includes("verificarPermissao(req, 'financeiro.ver')"))
  ok('reusa view model puro (totais/status)', a.includes('montarReceitasView'))
  ok('ações via matriz pura', a.includes('acoesReceita'))
  ok('auditoria real (historicoDe)', a.includes("historicoDe('Receita'"))
  ok('timeline via eventos financeiros', a.includes('receita.eventos'))
  ok('composição em Promise.all (sem N+1)', a.includes('Promise.all'))
  ok('não cria tabela/anexo paralelo', !a.includes('prisma.anexoReceita') && !a.includes('AnexoReceita'))
}

console.log(`\n${'='.repeat(60)}`)
console.log(`Dossiê da Receita: ${passou} passaram, ${falhou} falharam`)
console.log('='.repeat(60))
if (falhou > 0) process.exit(1)
