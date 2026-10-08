// scripts/regras-fixas-integridade.test.ts
// ============================================================================
// AS REGRAS FIXAS DE 06/10/2026 (caso Fogli) — cada uma com trava no ponto de escrita E com o VIGIA (INT-002) que a varre:
//   R1 certidão só anda na Emissão com o registro localizado · R2 fase concluída sem passo obrigatório aberto · R3 certidão já andada nunca sai da
//   lista sem decisão humana registrada (e o aviso não se repete) · R4 certidão exigida com tarefa na fase certa · R5 tarefa aberta atribuível
//   (pendência de fase anterior visível) · R6 barra/Central/Torre no mesmo estado · R7 lista da pessoa × necessidades.
// Mais: a lista da Torre é do PROCESSO (todas as fases, a mais antiga primeiro, §38 dentro) e a SUGESTÃO nunca atribui sem confirmação.
//
//   node scripts/ci/gate-build.mjs --so regras-fixas-integridade
// ============================================================================
import { readFileSync } from "node:fs"
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { criarPalco } from "./_fixture-arvore-fonte"
import { filtrarEOrdenar, tituloDaTabela, type LinhaDaTabela } from "../lib/operacional/torre-processo-puro"
import { montarCaminho, textosDaFase } from "../lib/operacional/torre-caminho"
import { cartoesDaFase } from "../lib/operacional/torre-processo-puro"
import { proximaAcaoDoProcesso } from "../lib/operacional/torre-proxima-acao"

const MARCA = "RFIX"
let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const ler = (p: string) => readFileSync(p, "utf8")

const limpoComTarefaSemDono = (v: Array<{ regra: string }>) => v.some((x) => x.regra === "R5")
async function main() {
  exigirBancoDeTeste("regras-fixas-integridade.test.ts")
  const P = criarPalco(MARCA)
  await P.montar()
  await P.montarMacroDuasFases()
  console.log("REGRAS FIXAS DE INTEGRIDADE\n")

  const { reconciliarMotorDeFases } = await import("../src/lib/motor/reconciliar-motor-fases")
  const { transicionarPassoTx } = await import("../src/services/task-step-sync")
  const { detectarViolacoesDeIntegridade } = await import("../lib/saude/verificacoes/integridade-invariantes")
  const vigia = async (processoId: number) => (await detectarViolacoesDeIntegridade()).violacoes.filter((v) => v.processoId === processoId)
  const so = (vs: Awaited<ReturnType<typeof vigia>>, r: string) => vs.filter((v) => v.regra === r)

  // ── cenário: processo já na Emissão, com a Genealogia concluída ─────────────────────────────────────────────────────────
  const c = await P.novoCenario("inv", { conjuge: true })
  await P.putPessoa(c.titularId, { casado: true })
  await P.postUniao(c.titularId, c.conjugeId!)
  let f = await P.foto(c.processoId)
  for (const p of f.passos.filter((x) => x.stepKey === "localizar_registro")) {
    await prisma.phaseWorkflowStepInstance.update({ where: { id: p.id }, data: { status: "CONCLUIDO", completedAt: new Date() } })
    await prisma.tarefa.updateMany({ where: { workflowStepInstanceId: p.id }, data: { statusTarefa: "CONCLUIDO_RECEBIDO" } })
  }
  await reconciliarMotorDeFases(c.processoId, { origem: "teste-avanco" })
  // o macro de teste tem só duas fases: a Emissão é terminal e marca o processo como concluído; o vigia varre processos ATIVOS (como em produção).
  await prisma.processo.update({ where: { id: c.processoId }, data: { dataConclusao: null } })
  ok("pré: processo na Emissão", (await prisma.processo.findUniqueOrThrow({ where: { id: c.processoId }, select: { faseAtualKey: true } })).faseAtualKey === "emissao_documental")
  const limpo = await vigia(c.processoId)
  ok("pré: processo saudável sem violação de R1/R2/R3/R4/R6/R7", limpo.length === 0, JSON.stringify(limpo.map((v) => `${v.regra}:${v.detalhe}`)))

  // ── R1: trava no ponto de escrita ──────────────────────────────────────────────────────────────────────────────────────
  secao("R1 — a certidão não anda na Emissão com 'Localizar registro' aberto (trava no ponto de escrita)")
  const r = await P.postPessoa({ nome: "Rodolfo", sobrenome: `${MARCA}-pai`, arvoreId: c.arvoreId, linhaReta: true, documentacao: true, paiId: c.titularId })
  const rodolfoId = (await r.json()).id as number
  f = await P.foto(c.processoId)
  const nascR = f.necDe("NAS", { pessoaId: rodolfoId })[0]
  const emR = f.passos.find((p) => p.stepKey === "solicitar_certidao" && f.docs.find((d) => d.id === p.documentoId)?.necessidadeId === nascR.id)!
  const tentar = (alvo: string) => prisma.$transaction((tx) => transicionarPassoTx(tx, emR.id, alvo, { correlationId: `rfix|${alvo}`, operacao: "teste", ciclo: 1, processoId: c.processoId, workflowInstanceId: null, ignorarDependencias: true }))
  for (const alvo of ["DISPONIVEL", "EM_ANDAMENTO", "CONCLUIDO"]) {
    const t = await tentar(alvo)
    ok(`recusa ${alvo} (DEPENDENCIA_PENDENTE) e o passo continua BLOQUEADO`, t.changed === false && t.code === "DEPENDENCIA_PENDENTE" && (await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: emR.id } })).status === "BLOQUEADO", `${alvo}: ${t.code}`)
  }
  const v0 = await vigia(c.processoId)
  ok("vigia: R1/R2/R6 vazios depois da regra aplicada", ["R1", "R2", "R6"].every((x) => so(v0, x).length === 0), JSON.stringify(v0.map((v) => v.regra)))
  ok("tarefa SEM responsável nunca é violação: o vigia não tem regra para isso (aguardando distribuição é pendência do gestor, em HOJE)", !limpoComTarefaSemDono(v0), "")

  // ── vigia: cada regra acusa o que viola (sementes) ─────────────────────────────────────────────────────────────────────
  secao("VIGIA — cada regra acusa o que viola, por nome (certidão + pessoa + família)")
  await prisma.phaseWorkflowStepInstance.update({ where: { id: emR.id }, data: { status: "DISPONIVEL", motivo: null } }) // viola R1 de propósito (bypass)
  let v = await vigia(c.processoId)
  ok("R1: certidão em Emissão sem Localizar registro concluído → acusa com certidão + pessoa + família", so(v, "R1").some((x) => /Rodolfo/.test(x.pessoa ?? "") && !!x.certidao && !!x.familia), JSON.stringify(so(v, "R1").map((x) => `${x.certidao}|${x.pessoa}|${x.familia}`)))
  await prisma.phaseWorkflowStepInstance.update({ where: { id: emR.id }, data: { status: "BLOQUEADO", motivo: "Aguardando Genealogia" } })

  const loc = await prisma.phaseWorkflowStepInstance.findFirstOrThrow({ where: { processoId: c.processoId, stepKey: "localizar_registro", necessidadeId: nascR.id } })
  await prisma.phaseWorkflowInstance.update({ where: { id: loc.workflowInstanceId }, data: { status: "CONCLUIDO" } }) // viola R2/R6 de propósito
  v = await vigia(c.processoId)
  ok("R2: fase concluída com passo obrigatório aberto → acusa", so(v, "R2").some((x) => /Rodolfo/.test(x.pessoa ?? "")), JSON.stringify(so(v, "R2").map((x) => x.detalhe)))
  ok("R6: tarefa aberta presa à instância concluída (barra × Central × Torre divergem) → acusa", so(v, "R6").length >= 1)
  await prisma.phaseWorkflowInstance.update({ where: { id: loc.workflowInstanceId }, data: { status: "ATIVO", completedAt: null } })

  const tarefasR = await prisma.tarefa.findMany({ where: { necessidadeId: nascR.id }, select: { id: true } })
  await prisma.tarefa.deleteMany({ where: { id: { in: tarefasR.map((t) => t.id) } } }) // viola R4 de propósito
  v = await vigia(c.processoId)
  ok("R4: certidão exigida sem tarefa viva → acusa", so(v, "R4").some((x) => /Rodolfo/.test(x.pessoa ?? "")), JSON.stringify(so(v, "R4").map((x) => x.detalhe)))

  // ── R3 e R7: a lista da pessoa ─────────────────────────────────────────────────────────────────────────────────────────
  secao("R3/R7 — a lista de certidões da pessoa: confirmação explícita, aviso único, vigia")
  await P.putPessoa(c.titularId, { vivo: false })
  f = await P.foto(c.processoId)
  const obiT = f.necDe("OBI", { pessoaId: c.titularId })[0]
  ok("pré: nasceu o óbito do titular (falecido)", !!obiT)
  await prisma.necessidadeDocumental.update({ where: { id: obiT.id }, data: { status: "ATENDIDA" } })
  const rSem = await P.putPessoa(c.titularId, { documentosExigidos: ["NAS", "CAS"] })
  const corpoSem = await rSem.json()
  ok("tirar o Óbito (já atendido) SEM confirmação → 409 REMOCAO_DE_CERTIDAO_JA_ANDADA e nada gravado", rSem.status === 409 && corpoSem.code === "REMOCAO_DE_CERTIDAO_JA_ANDADA" && (await prisma.pessoa.findUniqueOrThrow({ where: { id: c.titularId }, select: { documentosExigidos: true } })).documentosExigidos == null, `${rSem.status} ${corpoSem.code}`)
  const rCurto = await P.putPessoa(c.titularId, { documentosExigidos: ["NAS", "CAS"], confirmarRemocaoDeCertidao: true, motivoRemocaoDeCertidao: "curto" })
  ok("confirmar com motivo curto demais → recusa", rCurto.status === 409)
  const rCom = await P.putPessoa(c.titularId, { documentosExigidos: ["NAS", "CAS"], confirmarRemocaoDeCertidao: true, motivoRemocaoDeCertidao: "decisão do operador: certidão dispensada pelo cliente" })
  ok("com confirmação + motivo → 200", rCom.status === 200, String(rCom.status))
  const logD = await prisma.logAuditoria.findMany({ where: { acao: "PESSOA_DOCUMENTOS_EXIGIDOS_ALTERADOS", entidade: "Pessoa", entidadeId: c.titularId } })
  ok("a decisão humana fica registrada (decisaoHumana + motivo)", logD.length === 1 && (logD[0].detalhes as { decisaoHumana?: boolean; motivo?: string })?.decisaoHumana === true && /dispensada pelo cliente/.test(String((logD[0].detalhes as { motivo?: string }).motivo)))
  for (let i = 0; i < 3; i++) await P.putPessoa(c.titularId, { comentario: `edição ${i}` })
  const avisos = await prisma.logAuditoria.count({ where: { acao: "NECESSIDADE_ATENDIDA_SEM_CAUSA", entidade: "NecessidadeDocumental", entidadeId: obiT.id } })
  ok("o aviso 'já andou, pede decisão humana' é UM só, mesmo com várias edições seguidas", avisos <= 1, `avisos=${avisos}`)
  v = await vigia(c.processoId)
  ok("R3: com decisão humana registrada o vigia NÃO acusa", so(v, "R3").length === 0, JSON.stringify(so(v, "R3").map((x) => x.detalhe)))
  await prisma.logAuditoria.deleteMany({ where: { id: { in: logD.map((l) => l.id) } } })
  v = await vigia(c.processoId)
  ok("R3: sem decisão registrada (lista sem OBI, óbito já atendido) o vigia ACUSA por nome", so(v, "R3").some((x) => /Óbito|bito/i.test(x.certidao ?? "") && !!x.pessoa && !!x.familia), JSON.stringify(so(v, "R3").map((x) => `${x.certidao}|${x.pessoa}`)))
  await prisma.necessidadeDocumental.update({ where: { id: obiT.id }, data: { status: "PENDENTE" } })
  v = await vigia(c.processoId)
  ok("R7: lista gravada sem OBI e necessidade do óbito ainda ativa → acusa", so(v, "R7").some((x) => /bito/i.test(x.certidao ?? "")), JSON.stringify(so(v, "R7").map((x) => x.detalhe)))

  // ── a lista da Torre é do PROCESSO ─────────────────────────────────────────────────────────────────────────────────────
  secao("A Torre — UMA lista com as tarefas abertas de TODAS as fases, a mais antiga primeiro, §38 dentro de cada grupo")
  const base = (o: Partial<LinhaDaTabela>): LinhaDaTabela => ({
    chave: "x", tarefaId: 1, documentoId: 1, tipo: "ABERTA", titulo: "Certidão de nascimento", pessoaId: 1, pessoa: "A", geracao: null, geracaoNum: 1, linhaReta: true, pessoaNascimento: "1900-01-01T00:00:00Z",
    passo: null, status: "A_INICIAR", statusRotulo: "A iniciar", responsavelId: null, responsavelNome: null, iniciouEm: null, concluidaEm: null, dataPrazo: null, rotuloDoPrazo: "", risco: null,
    atrasada: false, bola: null, encerramentoTexto: null, motivoTexto: null, reabrivel: false, podeAtribuir: true, fase: { key: "emissao_documental", label: "Emissão Documental", ordem: 2 }, ...o,
  })
  const gen = (id: number, titulo: string) => base({ chave: `g${id}`, tarefaId: id, titulo, pessoaId: 7, pessoa: "Rodolfo", fase: { key: "genealogia", label: "Genealogia", ordem: 1 } })
  const lista = filtrarEOrdenar([
    base({ chave: "e1", tarefaId: 11, titulo: "Certidão de óbito", pessoaId: 1 }), base({ chave: "e2", tarefaId: 12, titulo: "Certidão de nascimento", pessoaId: 1 }),
    gen(3, "Certidão de óbito"), gen(1, "Certidão de nascimento"), gen(2, "Certidão de casamento"),
  ], { pessoaId: null, status: "ATIVAS" })
  ok("a fase mais antiga (Genealogia) vem primeiro", lista.slice(0, 3).every((l) => l.fase.key === "genealogia") && lista.slice(3).every((l) => l.fase.key === "emissao_documental"), lista.map((l) => l.chave).join())
  ok("dentro do grupo: Nascimento, Casamento, Óbito (§38)", lista.slice(0, 3).map((l) => l.titulo).join("|") === "Certidão de nascimento|Certidão de casamento|Certidão de óbito", lista.slice(0, 3).map((l) => l.titulo).join("|"))
  ok("o título diz que a lista é do processo", /abertas do processo · 5/.test(tituloDaTabela(lista, () => true, lista)), tituloDaTabela(lista, () => true, lista))
  const foco = ler("lib/operacional/torre-foco.ts"), puro = ler("lib/operacional/torre-proxima-acao.ts"), proc = ler("lib/operacional/torre-processos.ts")
  ok("a tabela do processo lê TODAS as abertas (não só a fase atual) e a próxima ação conta o mesmo conjunto", /foco\.tarefas\.map\(\(l\) => linhaAberta/.test(foco) && /proximaAcaoDoProcesso\(foco\.tarefas, null, ordemDaFase/.test(foco) && /proximaAcaoDoProcesso\(ls, null/.test(proc) && /faseOrd\(a\) - faseOrd\(b\)/.test(puro))
  ok("o cabeçalho do grupo na aba Tarefas (abertas / sem responsável) conta o processo inteiro", /todasAbertas \?\? linhasDaFase/.test(proc))
  ok("a página mostra a coluna Fase e o cabeçalho por grupo", /<div>Fase<\/div>/.test(ler("src/components/torre/ProcessoCertidoes.tsx")) && /data-testid="grupo-fase"/.test(ler("src/components/torre/ProcessoCertidoes.tsx")))


  // ── complemento 06/10: caminho do processo = fonte única de fase; próxima ação; passo atual ─────────────────────────────
  secao("Caminho do processo (fonte única de fase), Próxima ação e Passo atual")
  const fasesC = [{ phaseKey: "genealogia", ordem: 1, label: "Genealogia", conditional: false, required: true }, { phaseKey: "emissao_documental", ordem: 2, label: "Emissão Documental", conditional: false, required: true }]
  const passagens = new Map([["genealogia", { entradaEm: "2026-10-06T15:00:00Z", saidaEm: "2026-10-06T15:20:00Z" }], ["emissao_documental", { entradaEm: "2026-10-06T15:20:00Z", saidaEm: null }]])
  const cam = montarCaminho({ fases: fasesC, faseAtualKey: "emissao_documental", requerRetificacao: null, passagens, tarefas: new Map(), reabertas: new Map([["genealogia", { em: "2026-10-06T19:57:00Z", progresso: 82 }]]) })
  const tg = textosDaFase(cam[0], new Date("2026-10-06T21:00:00Z"))
  ok("fase com instância ATIVA e anterior à atual aparece 'em andamento · 82% · reaberta …' (nunca 'concluída ✓')", cam[0].estado === "reaberta" && /em andamento/.test(tg.l1) && !/✓/.test(tg.l1) && /82%/.test(tg.l2) && /reaberta/.test(tg.l2), JSON.stringify(tg))
  const camConcl = montarCaminho({ fases: fasesC, faseAtualKey: "emissao_documental", requerRetificacao: null, passagens, tarefas: new Map() })
  ok("sem reabertura continua 'concluída ✓'", camConcl[0].estado === "concluida")
  const L = (id: number, fase: string, resp: number | null) => ({ taskId: id, titulo: "Certidão de óbito", statusTarefa: "NAO_INICIADA", faseMacroKey: fase, responsavelId: resp, responsavelNome: null, dataPrazo: null, atrasada: false, diasParaPrazo: null, estadoOperacao: "FILA" as const, esperandoDe: null, acompanhamentoVencido: false, terceiroNome: null })
  const prox = proximaAcaoDoProcesso([L(1, "genealogia", null), ...Array.from({ length: 14 }, (_, i) => L(10 + i, "emissao_documental", null))] as never, null, new Map([["genealogia", 1], ["emissao_documental", 2]]), { rotuloDaFase: (k) => (k === "genealogia" ? "Genealogia" : "Emissão"), faseAtualLabel: "Emissão" })
  ok("próxima ação: 'Atribuir 1 de Genealogia (trava a Emissão) e 14 de Emissão' (fase mais antiga primeiro)", prox?.texto === "Atribuir 1 de Genealogia (trava a Emissão) e 14 de Emissão" && prox.quantas === 15, prox?.texto)
  ok("os cartões laterais leem a MESMA lista da tabela (todas as abertas do processo)", /cartoesDaFase\(\{\s*linhas: foco\.tarefas,/.test(foco))
  ok("'Passo atual' de passo único (sem subtarefa) mostra o nome do passo, nunca '—'", /PASSO ÚNICO, SEM SUBTAREFA/.test(ler("lib/operacional/tarefa-projecoes.ts")))
  ok("o registro consolidado é AÇÃO DO SISTEMA (sem 'pede decisão humana')", /NECESSIDADE_ATENDIDA_SEM_CAUSA_CONSOLIDADO': \{[\s\S]*atomoDoSistema/.test(ler("lib/operacional/historico-processo.ts")))


  // ── complemento 06/10 (2): "Aguardando fechamento" nunca é fase reaberta; o card das canceladas = a lista ─────────────────
  secao("Fase 'Aguardando fechamento' fica concluída; o número do card é o tamanho da lista que ele abre (L3)")
  ok("Caminho: 'Aguardando fechamento' é excluída da regra de fase reaberta (só a Genealogia reabre)", /ehFaseAguardandoFechamento\(key\)/.test(ler("lib/operacional/torre-caminho-leitura.ts")))
  ok("Barra de fases: 'Aguardando fechamento' depois de deixada é COMPLETED (mesma fonte do Caminho)", /ehFaseAguardandoFechamento\(f\.phaseKey\) && f\.phaseKey !== faseAtualKey/.test(ler("src/app/api/processos/[processoId]/phases/route.ts")))
  const enc = [
    base({ chave: "c1", tipo: "CANCELADA", status: "CANCELADA", podeAtribuir: false, fase: { key: "genealogia", label: "Genealogia", ordem: 1 } }), base({ chave: "c2", tipo: "CANCELADA", status: "CANCELADA", podeAtribuir: false, fase: { key: "genealogia", label: "Genealogia", ordem: 1 } }),
    base({ chave: "n1", tipo: "NAO_EXIGIDA", status: "NAO_EXIGIDA", podeAtribuir: false, fase: { key: "genealogia", label: "Genealogia", ordem: 1 } }),
  ]
  const cards = cartoesDaFase({ linhas: [], encerradas: { canceladas: enc.filter((l) => l.tipo === "CANCELADA").length, naoExigidas: enc.filter((l) => l.tipo === "NAO_EXIGIDA").length }, riscoDe: () => "ritmo" })
  const fora = cards.find((c) => /Cancelada/.test(c.rotulo))!
  const aberta = filtrarEOrdenar(enc, { pessoaId: null, status: "ENCERRADAS" })
  ok("card 'Cancelada / não exigida' = tamanho da lista que ele abre (nunca 'Nenhuma' com linhas na lista)", fora.titulo.startsWith(String(aberta.length)) && aberta.length === 3, `${fora.titulo} | ${fora.sub}`)
  ok("a lista do processo lê as canceladas/não exigidas de TODAS as fases (sem recorte pela fase atual) e inclui as tarefas canceladas sem Documento", !/e\.faseMacroKey === faseAtualKey : faseEhDocumental/.test(foco) && /soTarefa/.test(foco))

  // ── sugestão nunca atribui sozinha ─────────────────────────────────────────────────────────────────────────────────────
  secao("SUGESTÃO — nunca atribui sem confirmação explícita (servidor e tela); origem no histórico")
  for (const rota of ["src/app/api/torre/tarefas/[tarefaId]/atribuir-sugerido/route.ts", "src/app/api/torre/precisa-de-voce/acao/route.ts", "src/app/api/torre/processos/[processoId]/distribuir/route.ts", "src/app/api/torre/equipe/distribuir-sem-responsavel/route.ts"]) {
    const t = ler(rota)
    ok(`${rota.replace("src/app/api/torre/", "")}: sem confirmação devolve a prévia (428) e não grava`, /pedirConfirmacao\(/.test(t) && /confirmacaoDoCorpo\(/.test(t))
  }
  for (const tela of ["acoes-do-item", "TorreProcessoPagina", "TorreEquipe"]) {
    ok(`${tela}: passa pelo modal 'Atribuir X a Y?'`, /useConfirmarAtribuicao\(\)/.test(ler(`src/components/torre/${tela}.tsx`)) && /\{modal(Confirmacao)?\}/.test(ler(`src/components/torre/${tela}.tsx`)))
  }
  ok("a assinatura da prévia é conferida de novo na execução (sugestão que mudou é recusada)", /assinaturaConfirmada/.test(ler("src/services/precisa-de-voce-acoes.ts")) && /SUGESTAO_MUDOU/.test(ler("src/app/api/torre/processos/[processoId]/distribuir/route.ts")))
  ok("o histórico registra a origem: 'via sugestão do Precisa de você (confirmada…)' × 'manual'", /via sugestão do Precisa de você \(confirmada/.test(ler("src/services/precisa-de-voce-acoes.ts")) && /Origem: manual/.test(ler("lib/operacional/tarefa-comandos.ts")))

  await P.limpar()
  console.log(`\n${falhou === 0 ? "✅" : "❌"} REGRAS FIXAS — ${passou} ok, ${falhou} falhas`)
  if (falhou) { console.log("Falhas: " + falhas.join("; ")); process.exit(1) }
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
