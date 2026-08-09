// F5 (UI) — o read-model do DETALHE expõe o cronograma do custo (aba Parcelas). Receita = vazio.
import { prisma } from '@/lib/prisma'
import { criarObrigacaoEconomicaComLedger } from '@/lib/financeiro/ledger/ledger-service'
import { definirCronogramaPagavel } from '@/lib/financeiro/pagavel/cronograma-pagavel'
import { carregarReceitaDetalhe } from '@/lib/financeiro/leitura/receita-detalhe'

import { exigirBancoDeTeste } from "./_banco-de-teste"

// TRAVA DE AMBIENTE: este arquivo ESCREVE. Sem banco de teste local, não roda.
exigirBancoDeTeste()
let ok=0,fail=0; const chk=(c:boolean,m:string)=>{if(c){ok++;console.log('  ✅',m)}else{fail++;console.log('  ❌',m)}}
const dias=(n:number)=>new Date(Date.now()+n*86400000).toISOString()
async function main(){
  const {obrigacaoId:c}=await criarObrigacaoEconomicaComLedger({natureza:'CUSTO',valorContratado:900,moedaContratual:'BRL',processoId:16,origemTipo:'nativo',origemId:null})
  await definirCronogramaPagavel(c,[{vencimento:dias(30),valor:300},{vencimento:dias(60),valor:300},{vencimento:dias(90),valor:300}],{usuarioId:1})
  const det=await carregarReceitaDetalhe(String(c)) as any
  chk(det?.natureza==='CUSTO','detalhe do custo carregado')
  chk(Array.isArray(det?.cronogramaPagavel)&&det.cronogramaPagavel.length===3,`cronograma no detalhe (3 parcelas) (${det?.cronogramaPagavel?.length})`)
  chk(det.cronogramaPagavel[0].status==='PENDENTE'&&det.cronogramaPagavel[0].valor===300,'parcela com valor+status derivado')
  const {obrigacaoId:r}=await criarObrigacaoEconomicaComLedger({natureza:'RECEITA',valorContratado:100,moedaContratual:'BRL',processoId:16,origemTipo:'nativo',origemId:null})
  const detR=await carregarReceitaDetalhe(String(r)) as any
  chk((detR?.cronogramaPagavel?.length??0)===0,'Receita: cronograma vazio (só pagáveis)')
  await prisma.parcelaPagavel.deleteMany({where:{obrigacaoId:c}}); await prisma.logAuditoria.deleteMany({where:{entidade:'ObrigacaoEconomica',entidadeId:c}}).catch(()=>{})
  for(const id of [c,r]){await prisma.$executeRawUnsafe(`DELETE FROM "LedgerEntry" WHERE "ledgerId" IN (SELECT id FROM "LedgerFinanceiro" WHERE "obrigacaoId"=$1)`,id).catch(()=>{});await prisma.ocorrenciaFinanceira.deleteMany({where:{obrigacaoId:id}}).catch(()=>{});await prisma.saldoProjecao.deleteMany({where:{obrigacaoId:id}});await prisma.ledgerFinanceiro.deleteMany({where:{obrigacaoId:id}});await prisma.domainOutbox.deleteMany({where:{aggregateType:'ObrigacaoEconomica',aggregateId:id}});await prisma.obrigacaoEconomica.delete({where:{id}}).catch(()=>{})}
  console.log(`\n${ok} passaram, ${fail} falharam`); await prisma.$disconnect(); process.exit(fail?1:0)
}
main().catch(e=>{console.error(e);process.exit(1)})
