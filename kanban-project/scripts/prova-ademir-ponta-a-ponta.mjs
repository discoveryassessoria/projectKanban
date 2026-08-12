// Prova §20 — o mesmo taskId nas duas telas, atribuição sem duplicidade.
import { readFileSync } from 'node:fs'
const BASE='http://localhost:3000', PROC=523, TASK=3358, DANIELA=12
const token=readFileSync(process.argv[2],'utf8').trim()
const H={Authorization:`Bearer ${token}`,'Content-Type':'application/json'}
let ok=0,bad=0
const t=(n,c,e='')=>{if(c){ok++;console.log(`  ✅ ${n}${e?` — ${e}`:''}`)}else{bad++;console.log(`  ❌ ${n}${e?` — ${e}`:''}`)}}
const j=async(u,i={})=>{const r=await fetch(`${BASE}${u}`,{...i,headers:{...H,...(i.headers||{})}});return{s:r.status,b:await r.json().catch(()=>null)}}

console.log('CASO ADEMIR — ponta a ponta\n')
const central=await j(`/api/processos/${PROC}/central-operacional`)
const linhas=JSON.stringify(central.b)
const achouCentral=(central.b?.grupos??central.b?.linhas??[]).length>0||/taskId/.test(linhas)
t('Central Operacional responde', central.s===200, `HTTP ${central.s}`)
const m=linhas.match(/"taskId":(\d+)/)
t('Central Operacional expõe o taskId', !!m, m? m[1] : 'ausente')
t('e é o taskId 3358', m?.[1]===String(TASK), m?.[1])

const tarefas=await j(`/api/tarefas?processoId=${PROC}`)
const lista=Array.isArray(tarefas.b)?tarefas.b:(tarefas.b?.tarefas??[])
t('Tarefas e Projetos responde', tarefas.s===200)
t('mostra UMA tarefa', lista.length===1, `${lista.length}`)
t('com o MESMO taskId 3358', lista[0]?.id===TASK, String(lista[0]?.id))

const antes=lista[0]
t('equipe = equipe_documental', antes?.equipeKey==='equipe_documental', String(antes?.equipeKey))

// A PROVA SE ADAPTA AO ESTADO. Escrita só para "tarefa na fila", ela só valeria
// uma vez — e uma prova que não pode ser repetida não serve para validar nada
// depois da primeira execução.
const jaAtribuida = antes?.responsavelId != null
console.log(jaAtribuida ? '\nJÁ ATRIBUÍDA — validando o invariante da reatribuição' : '\nATRIBUIR à Daniela')
const a=await j(`/api/tarefas/${TASK}/atribuir`,{method:'POST',body:JSON.stringify({responsavelId:DANIELA})})
if (jaAtribuida) {
  t('reatribuir para a MESMA pessoa é recusado', a.s===422 && a.b?.codigo==='MESMO_RESPONSAVEL', `HTTP ${a.s}`)
  t('e a tarefa continua sendo a mesma', antes?.id===TASK)
  const ns=await j(`/api/tarefas?processoId=${PROC}`)
  const l=Array.isArray(ns.b)?ns.b:(ns.b?.tarefas??[])
  t('sem duplicar', l.length===1, `${l.length}`)
} else {
  t('a porta canônica aceitou', a.s===200, `HTTP ${a.s} ${JSON.stringify(a.b).slice(0,120)}`)
  t('mesmo taskId', a.b?.tarefaId===TASK)
  t('criou UMA notificação', Number.isInteger(a.b?.notificacaoId))
}

const dep=await j(`/api/tarefas?processoId=${PROC}`)
const l2=Array.isArray(dep.b)?dep.b:(dep.b?.tarefas??[])
t('continua UMA tarefa', l2.length===1, `${l2.length}`)
t('taskId inalterado', l2[0]?.id===TASK)
t('responsável agora é a Daniela', l2[0]?.responsavelId===DANIELA, String(l2[0]?.responsavelId))

const c2=await j(`/api/processos/${PROC}/central-operacional`)
const s2=JSON.stringify(c2.b)
t('Central reflete o responsável', /"responsavelId":12/.test(s2))
t('e segue com o mesmo taskId', /"taskId":3358/.test(s2))

console.log('\nRETRY da mesma atribuição')
const retry=await j(`/api/tarefas/${TASK}/atribuir`,{method:'POST',body:JSON.stringify({responsavelId:DANIELA})})
t('recusa reatribuir para a mesma pessoa', retry.s===422, `HTTP ${retry.s}`)

console.log('\nINICIAR')
const ini=await j(`/api/tarefas/${TASK}/atribuir`,{method:'PATCH',body:JSON.stringify({acao:'iniciar'})})
t('gestor inicia (admin)', ini.s===200, `HTTP ${ini.s} ${JSON.stringify(ini.b).slice(0,100)}`)

console.log(`\n${'═'.repeat(60)}\nTotal: ${ok+bad} | ✅ ${ok} | ❌ ${bad}`)
if(bad) process.exit(1)
