import { prisma } from '@/lib/prisma'
import { criarObrigacaoEconomicaComLedger } from '@/lib/financeiro/ledger/ledger-service'
import { registrarRepasse } from '@/lib/financeiro/pagavel/repasse'
import { carregarReceitaDetalhe } from '@/lib/financeiro/leitura/receita-detalhe'
let ok=0,fail=0; const chk=(c:boolean,m:string)=>{if(c){ok++;console.log('  ✅',m)}else{fail++;console.log('  ❌',m)}}
async function main(){
  const {obrigacaoId:c}=await criarObrigacaoEconomicaComLedger({natureza:'CUSTO',valorContratado:400,moedaContratual:'BRL',processoId:16,origemTipo:'nativo',origemId:null})
  const {obrigacaoId:cob}=await criarObrigacaoEconomicaComLedger({natureza:'RECEITA',valorContratado:400,moedaContratual:'BRL',processoId:16,origemTipo:'nativo',origemId:null})
  await registrarRepasse(c,{tipo:'REEMBOLSO',valor:400,receitaObrigacaoId:cob},{usuarioId:1})
  const det=await carregarReceitaDetalhe(String(c)) as any
  chk(Array.isArray(det?.repasses)&&det.repasses.length===1&&det.repasses[0].tipo==='REEMBOLSO','detalhe do custo expõe o repasse')
  const detR=await carregarReceitaDetalhe(String(cob)) as any
  chk((detR?.repasses?.length??0)===0,'Receita: repasses vazio')
  await prisma.repasseCusto.deleteMany({where:{custoObrigacaoId:c}}); await prisma.logAuditoria.deleteMany({where:{entidade:'ObrigacaoEconomica',entidadeId:c}}).catch(()=>{})
  for(const id of [c,cob]){await prisma.$executeRawUnsafe(`DELETE FROM "LedgerEntry" WHERE "ledgerId" IN (SELECT id FROM "LedgerFinanceiro" WHERE "obrigacaoId"=$1)`,id).catch(()=>{});await prisma.ocorrenciaFinanceira.deleteMany({where:{obrigacaoId:id}}).catch(()=>{});await prisma.saldoProjecao.deleteMany({where:{obrigacaoId:id}});await prisma.ledgerFinanceiro.deleteMany({where:{obrigacaoId:id}});await prisma.domainOutbox.deleteMany({where:{aggregateType:'ObrigacaoEconomica',aggregateId:id}});await prisma.obrigacaoEconomica.delete({where:{id}}).catch(()=>{})}
  console.log(`\n${ok} passaram, ${fail} falharam`); await prisma.$disconnect(); process.exit(fail?1:0)
}
main().catch(e=>{console.error(e);process.exit(1)})
