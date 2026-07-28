// F7.4 — GUARDA: o Detalhe COMPARTILHADO fala a língua do domínio certo.
// O mesmo componente serve Receita (a receber) e Custo (a pagar). Sem guarda, a linguagem
// de Receita volta a vazar no modo custo ("Cancelar Receita", "Saldo a receber",
// "Participantes"). Aqui provamos: vocabulário único + natureza propagada + aba de
// participantes (conceito de Receita) fora do modo custo.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { vocabularioFinanceiro } from '@/lib/financeiro/vocabulario'

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }
const RAIZ = join(__dirname, '..')
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8')

async function main() {
  // ── vocabulário (fonte única) ──
  const c = vocabularioFinanceiro('CUSTO'), r = vocabularioFinanceiro('RECEITA')
  chk(c.custo === true && r.custo === false, 'natureza reconhecida')
  chk(c.saldo === 'Saldo a pagar' && r.saldo === 'Saldo a receber', 'saldo por natureza')
  chk(c.liquidado === 'Pago' && r.liquidado === 'Recebido', 'total liquidado por natureza')
  chk(c.contraparte === 'Fornecedor' && r.contraparte === 'Cliente', 'contraparte por natureza')
  chk(c.cronograma === 'Parcelas' && r.cronograma === 'Cobranças', 'cronograma por natureza')
  chk(vocabularioFinanceiro(null).custo === false, 'sem natureza → trata como receita (retrocompat)')

  // ── o Detalhe propaga a natureza para TODOS os modais compartilhados ──
  const detalhe = ler('src/components/financeiro/v3/ReceitaDetalheView.tsx')
  for (const comp of ['CancelamentoAvancadoModal', 'DuplicarReceitaModal', 'ExcluirReceitaModal', 'AcaoReceitaModal', 'EditarReceitaView']) {
    const bloco = detalhe.split(`<${comp}`)[1]?.split('/>')[0] ?? ''
    chk(bloco.includes('natureza='), `${comp} recebe a natureza do lançamento`)
  }

  // ── componentes compartilhados aceitam natureza e usam o vocabulário único ──
  for (const arq of ['CancelamentoAvancadoModal', 'DuplicarReceitaModal', 'ExcluirReceitaModal']) {
    const src = ler(`src/components/financeiro/v3/${arq}.tsx`)
    chk(src.includes('natureza?: string'), `${arq} declara a prop natureza`)
    chk(src.includes('vocabularioFinanceiro('), `${arq} usa o vocabulário único (não texto solto)`)
  }

  // ── a CustosTab também declara a natureza nos modais compartilhados ──
  const shell = ler('src/components/financeiro/v3/ProcessoFinanceiroShell.tsx')
  for (const comp of ['CancelamentoAvancadoModal', 'DuplicarReceitaModal', 'ExcluirReceitaModal']) {
    const bloco = shell.split(`<${comp}`)[1]?.split('/>')[0] ?? ''
    chk(bloco.includes('natureza="CUSTO"'), `CustosTab abre ${comp} em modo custo`)
  }

  // ── títulos de Receita não podem estar cravados nos compartilhados ──
  const cravados: string[] = []
  const proibidos = ['Excluir Receita<', 'Duplicar Receita<', 'Cancelamento da Receita<']
  for (const arq of ['CancelamentoAvancadoModal', 'DuplicarReceitaModal', 'ExcluirReceitaModal', 'AcaoReceitaModal']) {
    const src = ler(`src/components/financeiro/v3/${arq}.tsx`)
    for (const p of proibidos) if (src.includes(p)) cravados.push(`${arq}: ${p}`)
  }
  chk(cravados.length === 0, `nenhum título de Receita cravado nos modais compartilhados (${cravados.join(' | ') || 'nenhum'})`)

  // ── "Saldo a receber" não pode voltar cravado no Detalhe ──
  chk(!detalhe.includes('rotulo="Saldo a receber"'), 'Detalhe não crava "Saldo a receber" (usa o vocabulário)')

  // ── aba Participantes (rateio entre pagadores) é conceito de RECEITA ──
  chk(/isCusto \? \[\] : \[\["participantes"/.test(detalhe), 'aba Participantes Financeiros não aparece no modo custo')

  console.log(`\n${ok} passaram, ${fail} falharam`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
