// F6 — Segregação de permissões de custo (função pura podeOperarCusto). Criar≠Aprovar≠Pagar≠Conciliar.
import { podeOperarCusto, CHAVE_CUSTO, OPERACOES_CUSTO } from '@/lib/financeiro/permissoes-custo'
let ok=0,fail=0; const chk=(c:boolean,m:string)=>{if(c){ok++;console.log('  ✅',m)}else{fail++;console.log('  ❌',m)}}
const mapa=(...chaves:string[])=>{const m:any={};for(const k of chaves)m[k]=true;return m}
const admin=()=>{const m:any={};for(const op of OPERACOES_CUSTO)m[CHAVE_CUSTO[op]]=true;m['financeiro.ver']=true;return m}
async function main(){
  // ESTRITO: só a chave específica vale
  chk(podeOperarCusto(mapa('financeiro.custo_pagar'),'pagar',true)===true,'estrito: quem tem custo_pagar PODE pagar')
  chk(podeOperarCusto(mapa('financeiro.custo_pagar'),'aprovar',true)===false,'estrito: quem só paga NÃO aprova (segregação)')
  chk(podeOperarCusto(mapa('financeiro.custo_aprovar'),'aprovar',true)===true,'estrito: quem tem custo_aprovar aprova')
  chk(podeOperarCusto(mapa('financeiro.custo_aprovar'),'conciliar',true)===false,'estrito: aprovador NÃO concilia')
  chk(podeOperarCusto(mapa('financeiro.ver'),'pagar',true)===false,'estrito: financeiro.ver NÃO concede pagar (só ver)')
  // RETROCOMPAT (não-estrito): financeiro.ver concede as operações durante a migração
  chk(podeOperarCusto(mapa('financeiro.ver'),'pagar',false)===true,'retrocompat: financeiro.ver concede pagar durante a migração')
  chk(podeOperarCusto(mapa('financeiro.ver'),'aprovar',false)===true,'retrocompat: financeiro.ver concede aprovar')
  chk(podeOperarCusto(mapa(),'pagar',false)===false,'sem permissão nenhuma → NÃO pode')
  chk(podeOperarCusto(null,'pagar',false)===false,'usuário sem mapa → NÃO pode')
  // ADMIN (todas as chaves)
  for(const op of OPERACOES_CUSTO) if(!podeOperarCusto(admin(),op,true)){chk(false,`admin pode ${op}`)}
  chk(OPERACOES_CUSTO.every(op=>podeOperarCusto(admin(),op,true)),'admin (todas as chaves) pode TODAS as operações, mesmo estrito')
  chk(OPERACOES_CUSTO.length===10,`10 operações segregadas (${OPERACOES_CUSTO.length})`)
  console.log(`\n${ok} passaram, ${fail} falharam`); process.exit(fail?1:0)
}
main().catch(e=>{console.error(e);process.exit(1)})
