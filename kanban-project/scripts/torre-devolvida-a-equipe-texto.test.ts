// scripts/torre-devolvida-a-equipe-texto.test.ts
// ============================================================================
// TORRE — "DEVOLVIDA À FILA DA EQUIPE" VIRA "DEVOLVIDA À EQUIPE (SEM RESPONSÁVEL)" (item C2/C3, 30/09/2026).
//
//   npx tsx scripts/torre-devolvida-a-equipe-texto.test.ts   (banco de teste)
//
// Só o TEXTO mudou: o código da ação continua TAREFA_DEVOLVIDA_A_FILA (o sino e os testes leem esse código).
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-devolvida-a-equipe-texto.test.ts")

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { prisma } from "../lib/prisma"
import { montarCenario } from "./_fixture-torre-gh"
import { devolverAFila } from "../lib/operacional/tarefa-ciclo"
import { redistribuirTarefas } from "../lib/operacional/tarefa-comandos"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "TORREC23"
const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8")
// 06/10/2026 ("Remover responsável"): a descrição gravada diz o que aconteceu com o responsável — "Responsável removido de … (X → ninguém) … Origem: manual".
const TEXTO_NOVO = "→ ninguém"

async function main() {
  secao("TEXTO GRAVADO PELA PORTA (banco): devolverAFila e redistribuição em lote")
  const c = await montarCenario(MARCA)
  try {
    const dono = await prisma.usuario.create({ data: { nome: `${MARCA} Dono`, email: `${MARCA.toLowerCase()}-dono@t.com`, senha: "x", tipo: "assistente", permissoesCustom: { "tarefas.iniciar_concluir": true } } })
    const o1 = await c.novaObrigacao({ responsavelId: dono.id })
    const o2 = await c.novaObrigacao({ responsavelId: dono.id })
    const r = await devolverAFila({ tarefaId: o1.tarefaId, autorId: dono.id, motivo: "teste" })
    ok("devolverAFila deu certo", r.ok === true, JSON.stringify(r))
    const log = await prisma.logAuditoria.findFirst({ where: { acao: "TAREFA_DEVOLVIDA_A_FILA", entidadeId: o1.tarefaId } })
    ok("o CÓDIGO da ação não mudou (TAREFA_DEVOLVIDA_A_FILA)", log != null)
    ok(`a descrição gravada diz 'Responsável removido … ${TEXTO_NOVO}' e a origem`, /Responsável removido de/.test(log?.descricao ?? "") && (log?.descricao ?? "").includes(TEXTO_NOVO) && /Origem: manual/.test(log?.descricao ?? ""), log?.descricao ?? "")
    ok("…e não traz mais 'fila da equipe' nem 'devolvida à fila'", !/fila da equipe|devolvida à fila/.test(log?.descricao ?? ""))
    const de = await devolverAFila({ tarefaId: o1.tarefaId, autorId: dono.id })
    ok("devolver quem já está sem responsável: mensagem sem 'fila'", de.ok === false && !/fila/.test(de.mensagem), JSON.stringify(de))

    const lote = await redistribuirTarefas({ tarefaIds: [o2.tarefaId], novoResponsavelId: null, autorId: dono.id, motivo: "teste" })
    ok("redistribuição em lote para 'ninguém' funcionou", lote.sucesso === 1, JSON.stringify(lote).slice(0, 120))
    const logLote = await prisma.logAuditoria.findFirst({ where: { acao: "TAREFAS_REDISTRIBUIDAS" }, orderBy: { id: "desc" } })
    ok("a descrição do lote diz 'devolvidas à equipe (sem responsável)'", /devolvidas à equipe \(sem responsável\)/.test(logLote?.descricao ?? "") && !/fila da equipe/.test(logLote?.descricao ?? ""), logLote?.descricao ?? "")
  } finally {
    await c.limpar()
  }

  secao("ONDE A PESSOA LÊ: Andamento e fontes das mensagens (varredura estática)")
  const andamento = ler("src/services/andamento-operacional.ts")
  ok("Andamento: título de TAREFA_DEVOLVIDA_A_FILA = 'Devolvida à equipe (sem responsável)'", /TAREFA_DEVOLVIDA_A_FILA: "Devolvida à equipe \(sem responsável\)"/.test(andamento))
  for (const arq of ["lib/operacional/tarefa-ciclo.ts", "lib/operacional/tarefa-comandos.ts", "src/services/andamento-operacional.ts"]) {
    // Só literais de texto (aspas/crase), não comentários: o comentário pode explicar a história.
    const codigo = ler(arq).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    ok(`${arq}: nenhum texto 'devolvida(s) à fila' / 'fila da equipe'`, !/devolvidas? à fila|Devolvida à fila|fila da equipe/.test(codigo))
  }

  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
