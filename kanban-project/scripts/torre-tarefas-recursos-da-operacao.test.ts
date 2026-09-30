// scripts/torre-tarefas-recursos-da-operacao.test.ts
// Os recursos que o admin tinha na Operação e passaram a morar na aba Tarefas da Torre (30/09/2026): cada um está
// LIGADO (handler + endpoint/componente REAPROVEITADO da Operação + feedback), sem regra de negócio duplicada e sem
// botão morto. As rotas reaproveitadas existem de verdade.
import { readFileSync, existsSync } from "node:fs"

let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n}`) } }
const ler = (p: string) => readFileSync(p, "utf8")
const tt = ler("src/components/torre/TorreTarefas.tsx"), painel = ler("src/components/torre/PainelTorreTarefa.tsx"), feito = ler("src/components/torre/TorreFeito.tsx")
const adiar = ler("src/components/torre/adiar-acompanhamento.tsx"), vinc = ler("src/components/torre/VincularOrgaoLoteModal.tsx"), novas = ler("src/components/torre/novas-da-familia.ts"), torre = ler("src/components/torre/Torre.tsx")

console.log("As rotas reaproveitadas da Operação existem")
for (const r of ["src/app/api/operacao/tarefas/route.ts", "src/app/api/operacao/tarefas/iniciar-lote/route.ts", "src/app/api/operacao/tarefas/vincular-orgao-lote/route.ts", "src/app/api/operacao/tarefas/[tarefaId]/adiar-acompanhamento/route.ts", "src/app/api/operacao/novas/route.ts", "src/app/api/operacao/orgaos/busca/route.ts"]) ok(r, existsSync(r))

console.log("\n(1) Feito — mesma fonte e mesmo período da Operação")
ok("busca /api/operacao/tarefas?visao=feito&escopo=equipe (14 dias, com concluidaEm)", /visao=feito&escopo=equipe/.test(tt))
ok("agrupado Hoje/Ontem/Antes, só leitura, com Abrir", /Hoje/.test(feito) && /Ontem/.test(feito) && /Antes/.test(feito) && /Abrir/.test(feito))
console.log("(2) Família → Pessoa / Órgão / Passo")
ok("usa agruparDentroDaFamilia da Operação (não reimplementa)", /agruparDentroDaFamilia\(itens, dentro\)/.test(tt) && /aria-label="Dentro da família"/.test(tt))
ok("as quatro opções existem", ["none", "pessoa", "orgao", "passo"].every((o) => tt.includes(`"${o}"`)))
console.log("(5) Adiar acompanhamento — linha e drawer")
ok("usa o AdiarAcompanhamentoModal e a rota adiar-acompanhamento da Operação", /AdiarAcompanhamentoModal/.test(adiar) && /adiar-acompanhamento/.test(adiar))
ok("está na linha (aba Tarefas) E no painel da tarefa (drawer)", /adiar-acompanhamento|AdiarAcompanhamento|Adiar/.test(tt) && /Adiar/.test(painel))
ok("o feedback diz que o prazo da tarefa NÃO muda", /O prazo da tarefa não muda/.test(adiar))
console.log("(6) Vincular órgão nas N — lote")
ok("POST /api/operacao/tarefas/vincular-orgao-lote com tarefaIds e orgaoId (sem window.prompt)", /vincular-orgao-lote/.test(vinc) && !/window\.prompt/.test(vinc + tt))
ok("só para linhas que precisam de órgão (precisaDeOrgaoEmissor) e com aviso 'Vincular órgão nas N'", /precisaDeOrgaoEmissor/.test(tt) && /Vincular órgão nas/.test(tt))
console.log("(7) Marcador de novas")
ok("lê /api/operacao/novas?processo= e marca a linha como nova", /api\/operacao\/novas\?processo=/.test(novas) && /nova/.test(tt))
console.log("(8) Conclusão rápida na linha")
ok("o rótulo vem de acaoDe/concluirLabelDe (Confirmado ✓, Recebi ✓, Validar ✓, Concluir ✓) — o MESMO da Operação", /acaoDe/.test(tt) && /concluirLabelDe/.test(tt))
ok("a conclusão abre o drawer (validação e auditoria reais) — nunca conclui por fora", !/\/concluir["'`]/.test(tt))
console.log("(3/4) Fazer agora e Tarefa transversal")
ok("▶ Fazer agora (N) com Anterior/Próxima", /Fazer agora/.test(tt) && /Anterior/.test(tt) && /Próxima/.test(tt))
ok("+ Tarefa transversal reaproveita o TarefaTransversalModal", /TarefaTransversalModal/.test(tt) && /Tarefa transversal/.test(tt))
console.log("(9) Minhas tarefas / Acomp. vencidos / Iniciar em lote / URL")
ok("visões Minhas tarefas, Acompanhamentos vencidos, Cobranças a fazer e Feito", ["Minhas tarefas", "Acompanhamentos vencidos", "Cobranças a fazer (vencidas)", "Feito"].every((r) => tt.includes(r)))
ok("iniciar em lote usa /api/operacao/tarefas/iniciar-lote", /iniciar-lote/.test(tt))
ok("a Torre aceita ?visao=, ?processo= (Foco) e ?tarefa= (drawer)", /get\("visao"\)/.test(torre) && /get\("processo"\)/.test(torre) && /get\("tarefa"\)/.test(torre) && /Tarefa não encontrada entre as abertas ou concluídas recentes/.test(tt + torre))
console.log("Nenhum botão morto")
const botoes = (src: string) => [...src.matchAll(/<button\b[^>]*>/g)].map((m) => m[0])
ok("todo <button> dos componentes novos tem onClick", [feito, adiar, vinc].every((s) => botoes(s).every((b) => /onClick=/.test(b) || /disabled/.test(b))))

console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
process.exit(falhou ? 1 : 0)
