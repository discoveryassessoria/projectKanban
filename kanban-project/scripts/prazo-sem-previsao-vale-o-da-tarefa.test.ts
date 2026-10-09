// scripts/prazo-sem-previsao-vale-o-da-tarefa.test.ts
//
// ANTES DO PEDIDO, O PRAZO É O DA TAREFA (08/10/2026): a projeção da certidão devolve `prazo: null` quando o órgão ainda não deu previsão de retorno.
// Isso NÃO é «sem prazo»: vale o prazo da própria Tarefa (entrada na fase + SLA). A Carlota Salvarani (prazo 16/10) era acusada de divergência (CERT-001).
// Com previsão, ela manda. Puro: sem banco.
import { statusEPrazoEfetivos, type ProjecaoCertidao } from "../src/lib/process-stage/projecao-certidao"
let n = 0, falhou = 0
const ok = (nome: string, c: boolean, d = "") => { n++; if (c) console.log(`  ✅ ${nome}`); else { falhou++; console.log(`  ❌ ${nome}${d ? ` — ${d}` : ""}`) } }
const prazoTarefa = new Date("2026-10-16T17:29:13.648Z"), previsao = new Date("2026-10-30T12:00:00.000Z")
const tarefa = { necessidadeId: 638, tipo: "NORMAL", statusTarefa: "NAO_INICIADA", dataPrazo: prazoTarefa, faseMacroKey: "emissao_documental" }
const proj = (prazo: Date | null) => new Map<number, ProjecaoCertidao>([[638, { prazo, statusTarefaEquivalente: null } as unknown as ProjecaoCertidao]])
ok("sem previsão do órgão, vale o prazo da tarefa (16/10)", statusEPrazoEfetivos(tarefa, proj(null)).dataPrazo?.getTime() === prazoTarefa.getTime())
ok("com previsão do órgão, a previsão manda", statusEPrazoEfetivos(tarefa, proj(previsao)).dataPrazo?.getTime() === previsao.getTime())
ok("sem previsão e sem prazo na tarefa continua sem prazo (nada é inventado)", statusEPrazoEfetivos({ ...tarefa, dataPrazo: null }, proj(null)).dataPrazo === null)
console.log(`\n${n - falhou}/${n} verificações`)
if (falhou) process.exit(1)
