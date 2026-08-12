import { readFileSync } from 'node:fs'
const BASE='http://localhost:3000', PROC=513
const token = readFileSync(process.argv[2],'utf8').trim()
const H = { Authorization:`Bearer ${token}`, 'Content-Type':'application/json' }
let ok=0, bad=0
const t=(n,c,e='')=>{ if(c){ok++;console.log(`  ✅ ${n}${e?` — ${e}`:''}`)}else{bad++;console.log(`  ❌ ${n}${e?` — ${e}`:''}`)} }
const ler=async()=>(await (await fetch(`${BASE}/api/processos/${PROC}/custos`,{headers:H})).json()).planilha
const obrigacoes=async()=>{const d=await (await fetch(`${BASE}/api/processos/${PROC}/custos`,{headers:H})).json();return d.planilha.pessoas.flatMap(p=>p.linhas.flatMap(l=>l.celulas.flatMap(c=>c.obrigacoes??[]))).length}

console.log('PROVA DO TOTAL — processo Abellan (513)\n')
let p = await ler()
const pessoa = p.pessoas[0]
console.log('ESTADO INICIAL')
t('as três linhas somam R$ 731,20 cada', pessoa.linhas.every(l=>l.totalBrl===731.2), pessoa.linhas.map(l=>l.totalBrl).join(' · '))
t('o total do processo é R$ 2.193,60', p.totalGeralBrl===2193.6, String(p.totalGeralBrl))
const obrAntes = await obrigacoes()

const l0 = pessoa.linhas[0], c0 = l0.celulas[0]
const alvo = { pessoaId: pessoa.pessoaId, tipoDocumentoId: l0.tipoDocumentoId, colunaId: c0.colunaId }

console.log('\nEDITAR Nascimento × Certidão Inteiro Teor → R$ 175,00')
await fetch(`${BASE}/api/processos/${PROC}/planilha-override`,{method:'PUT',headers:H,body:JSON.stringify({...alvo,valor:175,motivo:'prova do total'})})
p = await ler()
let l = p.pessoas[0].linhas[0]
t('a linha vai para R$ 759,96', l.totalBrl===759.96, String(l.totalBrl))
t('o total vai para R$ 2.222,36', p.totalGeralBrl===2222.36, String(p.totalGeralBrl))

console.log('\nRELOAD')
p = await ler()
t('o total continua R$ 2.222,36 após reload', p.totalGeralBrl===2222.36, String(p.totalGeralBrl))
t('a célula segue SOBRESCRITO com base visível',
  p.pessoas[0].linhas[0].celulas[0].estado==='SOBRESCRITO' && p.pessoas[0].linhas[0].celulas[0].valorBase===146.24)

console.log('\nRESTAURAR PADRÃO')
await fetch(`${BASE}/api/processos/${PROC}/planilha-override`,{method:'DELETE',headers:H,body:JSON.stringify(alvo)})
p = await ler()
l = p.pessoas[0].linhas[0]
t('a linha volta para R$ 731,20', l.totalBrl===731.2, String(l.totalBrl))
t('o total volta para R$ 2.193,60', p.totalGeralBrl===2193.6, String(p.totalGeralBrl))
p = await ler()
t('e continua R$ 2.193,60 após reload', p.totalGeralBrl===2193.6, String(p.totalGeralBrl))

console.log('\nNENHUM LANÇAMENTO FINANCEIRO')
t('nenhuma obrigação foi criada', (await obrigacoes())===obrAntes, `antes ${obrAntes} · depois ${await obrigacoes()}`)

console.log(`\n${'═'.repeat(60)}\nTotal: ${ok+bad} | ✅ ${ok} | ❌ ${bad}`)
if (bad) process.exit(1)
