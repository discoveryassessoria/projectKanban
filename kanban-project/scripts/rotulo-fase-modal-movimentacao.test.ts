// scripts/rotulo-fase-modal-movimentacao.test.ts
// "DE a_iniciar" no modal "Confirmar movimentação manual": a tela mostra o NOME da fase, nunca a chave do cadastro.
import { readFileSync } from 'node:fs'
import { labelDaFasePorPhaseKey } from '../src/lib/process-stage/fases-catalog'
import { rotuloDaFasePreContrato } from '../src/lib/process-stage/fase-pre-contrato'

let passou = 0, falhou = 0
const ok = (n: string, c: boolean, extra = '') => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ''}`) } else { falhou++; console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ''}`) } }

const rota = readFileSync('src/app/api/processos/[processoId]/phase/move/route.ts', 'utf8')
ok('a fase "a_iniciar" (Aguardando fechamento) tem nome publicado — o mesmo da fonte única', labelDaFasePorPhaseKey('a_iniciar') === rotuloDaFasePreContrato('a_iniciar') && !!labelDaFasePorPhaseKey('a_iniciar') && labelDaFasePorPhaseKey('a_iniciar') !== 'a_iniciar')
ok('uma fase do enum segue com o próprio nome', labelDaFasePorPhaseKey('genealogia') === 'Genealogia')
ok('o contexto do modal resolve o nome da fase atual pelo cadastro (e só em último caso cai na chave)', /faseAtualLabel: await resolverRotuloDaFase\(processo\.faseAtualKey\) \?\? processo\.faseAtualKey/.test(rota))
ok('a lista de destinos usa o nome do catálogo antes da chave', /label: labelDaFasePorPhaseKey\(f\.phaseKey\) \?\? f\.label \?\? f\.phaseKey/.test(rota))
ok('as mensagens "Processo movido para …" não mostram a chave de fase fora do enum', /return labelDaFasePorPhaseKey\(phaseKey\) \?\? phaseKey/.test(rota))
console.log(`\n${falhou === 0 ? '✅ PASSOU' : '❌ FALHOU'}: ${passou} ok, ${falhou} falhas`)
process.exit(falhou ? 1 : 0)
