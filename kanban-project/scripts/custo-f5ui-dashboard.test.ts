import { prisma } from '@/lib/prisma'
import { criarObrigacaoEconomicaComLedger } from '@/lib/financeiro/ledger/ledger-service'
import { listarContasAPagar } from '@/lib/financeiro/leitura/contas-a-pagar'
let ok=0,fail=0; const chk=(c:boolean,m:string)=>{if(c){ok++;console.log('  ✅',m)}else{fail++;console.log('  ❌',m)}}
const dias=(n:number)=>new Date(Date.now()+n*86400000)
async function main(){
  const a=await criarObrigacaoEconomicaComLedger({natureza:'CUSTO',valorContratado:700,moedaContratual:'BRL',processoId:16,origemTipo:'nativo',origemId:null,vencimento:dias(-3)})
  const d=await listarContasAPagar({processoId:16})
  chk(typeof d.kpis.aPagarBrl==='number'&&d.kpis.total>=1,'dashboard: KPIs presentes')
  chk(Array.isArray(d.porFornecedor)&&Array.isArray(d.porMoeda)&&d.porMoeda.some(m=>m.nome==='BRL'),'dashboard: agrupamentos (fornecedor/moeda)')
  chk(d.baldes.vencidas.totalBrl>=700,'dashboard: balde vencidas soma o custo vencido')
  chk(d.itens.some(o=>o.obrigacaoId===a.obrigacaoId&&o.balde==='VENCIDA'),'dashboard: item classificado (export/relatório)')
  await prisma.$executeRawUnsafe(`DELETE FROM "LedgerEntry" WHERE "ledgerId" IN (SELECT id FROM "LedgerFinanceiro" WHERE "obrigacaoId"=$1)`,a.obrigacaoId).catch(()=>{});await prisma.saldoProjecao.deleteMany({where:{obrigacaoId:a.obrigacaoId}});await prisma.ledgerFinanceiro.deleteMany({where:{obrigacaoId:a.obrigacaoId}});await prisma.domainOutbox.deleteMany({where:{aggregateType:'ObrigacaoEconomica',aggregateId:a.obrigacaoId}});await prisma.obrigacaoEconomica.delete({where:{id:a.obrigacaoId}}).catch(()=>{})
  console.log(`\n${ok} passaram, ${fail} falharam`); await prisma.$disconnect(); process.exit(fail?1:0)
}
main().catch(e=>{console.error(e);process.exit(1)})
