// scripts/fluxo-recebimento-selo-datas.test.ts
// ============================================================================
// FLUXO ÚNICO DO RECEBIMENTO, SELO DE PASSO E DATAS dd/mm/aaaa (07/10/2026). Caso: Maria del Consuelo Perez Alvarez (família Antão).
//   1) a linha do Aguardando só tem «Abrir»; o passo 2 só tem «Iniciar →» (que abre «Registrar recebimento»); nenhum atalho conclui passo 2/3 fora do modal;
//   2) o selo de subtarefa bloqueada nunca aparece «Disponível» (lógica única), e o servidor recusa fora de ordem / dependência pendente;
//   3) toda data é dd/mm/aaaa: máscara, validação real (31/02, ano bissexto), e NENHUM `type="date"` / `datetime-local` nas telas;
//   4) o cabeçalho do Aguardando não sobrepõe títulos.
//   npx tsx scripts/fluxo-recebimento-selo-datas.test.ts   (banco de teste)
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("fluxo-recebimento-selo-datas.test.ts")

import { readFileSync } from "node:fs"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { prisma } from "../lib/prisma"
import { montarCenario } from "./_fixture-torre-gh"
import { arquivos, semComentarios } from "./_regras-do-marco-codigo"
import { subtarefasDaEtapa, concluirSubtarefaCorrentePeloPasso } from "../src/services/subtarefas-da-etapa"
import { mascararData, brParaIso, isoParaBr, brHoraParaIso, isoHoraParaBr, dataReal, motivoDaDataInvalida } from "../src/lib/datas-br"
import { CampoDataTexto, CampoDataHoraTexto } from "../src/components/ui/campo-data-texto"
import { problemasDeOrdemDaEmissao } from "../lib/saude/verificacoes/regras-do-marco"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const ler = (p: string) => readFileSync(p, "utf8")
const MARCA = "FRSD"

async function main() {
  secao("1) Um só caminho: linha do Aguardando → Abrir → passo 2 «Iniciar →» → «Registrar recebimento»")
  const abas = semComentarios(ler("src/components/operacao/operacao-v3-abas.tsx"))
  const grupo = abas.slice(abas.indexOf("function GrupoAguardando"), abas.indexOf("// ACOMPANHAMENTO") > 0 ? abas.indexOf("// ACOMPANHAMENTO") : undefined)
  const acoes = grupo.slice(grupo.indexOf('<div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>'))
  const blocoDaLinha = acoes.slice(0, acoes.indexOf("</div>"))
  ok("a linha do Aguardando tem UM botão só: «Abrir»", (blocoDaLinha.match(/<button/g) ?? []).length === 1 && />Abrir<\/button>/.test(blocoDaLinha), blocoDaLinha.replace(/\s+/g, " ").slice(0, 160))
  const tudo = arquivos("src", /\.(tsx|ts)$/).map((f) => [f, semComentarios(ler(f))] as const)
  ok("nenhum «Confirmado ✓» / «Recebi ✓» / concluirLabelDe em lugar nenhum", !tudo.some(([, c]) => /Confirmado ✓|Recebi ✓|concluirLabelDe/.test(c)))
  ok("nenhum botão «Registrar recebimento» fora do modal (nem na linha, nem na gaveta)", !tudo.some(([f, c]) => !/RegistrarRecebimentoModal\.tsx$/.test(f) && />\s*Registrar recebimento\s*</.test(c)))
  const wf = semComentarios(ler("src/components/kanban/workflow/WorkflowTab.tsx"))
  ok("no passo 3 o botão é «Registrar recebimento →» e ele abre o modal (onRegistrarRecebimento); o passo 2 abre a Central", /data-testid="registrar-recebimento-passo"[\s\S]{0,400}Registrar recebimento →/.test(wf) && /onClick=\{onRegistrarRecebimento\}/.test(wf) && /onClick=\{\(\) => onOpenCentral\(s\.key\)\}/.test(wf))
  const quemChamaARota = tudo.filter(([f, c]) => /\/registrar-recebimento`/.test(c) && !/registrar-recebimento\/route\.ts$/.test(f)).map(([f]) => f)
  ok("a rota de recebimento só é chamada pelo modal (e o modal só abre pelo «Iniciar →» do passo 2)", JSON.stringify(quemChamaARota) === JSON.stringify(["src/components/operacao/RegistrarRecebimentoModal.tsx"]) && tudo.filter(([f, c]) => /<RegistrarRecebimentoModal/.test(c)).map(([f]) => f).join() === "src/components/kanban/workflow/WorkflowTab.tsx", quemChamaARota.join(", "))
  const chamadores = tudo.filter(([f, c]) => /concluirSubtarefaCorrentePeloPasso\(/.test(c) && !/subtarefas-da-etapa\.ts$/.test(f)).map(([f]) => f).sort()
  ok("só 4 serviços chamam o motor de subtarefa: gaveta (documento-operacao, solicitação), iniciar (passo 1) e o recebimento (2 e 3)", JSON.stringify(chamadores) === JSON.stringify(["src/services/documento-operacao.ts", "src/services/iniciar-envio.ts", "src/services/registrar-recebimento.ts", "src/services/solicitacao-documento.ts"]), chamadores.join(", "))
  const ini = semComentarios(ler("src/services/iniciar-envio.ts"))
  ok("o «Iniciar» (lote e por linha) conclui UMA subtarefa por tarefa (sem laço)", (ini.match(/concluirSubtarefaCorrentePeloPasso\(/g) ?? []).length === 1 && !/for \(const [^)]*\) \{[^}]*concluirSubtarefaCorrentePeloPasso/.test(ini))
  const rec = semComentarios(ler("src/services/registrar-recebimento.ts"))
  ok("o recebimento conclui SÓ o passo 3 (o 2 é a tela de confirmação do pedido) e só depois do 2", !/for \(const key of \[SUBTAREFA_CONFIRMACAO/.test(rec) && /subtarefaKeyEsperada: SUBTAREFA_CERTIDAO_RECEBIDA/.test(rec) && /CONFIRMACAO_PENDENTE/.test(rec))

  secao("2) O selo nunca mente; o servidor recusa fora de ordem")
  const c = await montarCenario(MARCA, {
    slaDays: 10, regraDeConclusao: "TODAS_SUBTAREFAS_OBRIGATORIAS",
    subs: [
      { key: "enviar_requerimento_cartorio", label: "Enviar requerimento ao cartório", ordem: 1, espera: false, dependeDe: [] },
      { key: "receber_confirmacao_pedido", label: "Receber confirmação do pedido", ordem: 2, espera: true, dependeDe: ["enviar_requerimento_cartorio"] },
      { key: "receber_certidao", label: "Receber certidão", ordem: 3, espera: true, dependeDe: ["receber_confirmacao_pedido"] },
      { key: "conferir_validar_certidao", label: "Conferir e validar certidão", ordem: 4, espera: false, dependeDe: ["receber_certidao"] },
    ],
  })
  try {
    const o = await c.novaObrigacao({ responsavelId: null })
    await concluirSubtarefaCorrentePeloPasso({ stepInstanceId: o.stepInstanceId, executadoPorId: null, payload: {}, resultado: "enviado", subtarefaKeyEsperada: "enviar_requerimento_cartorio" })
    // O defeito real: a execução do passo 4 ficou gravada DISPONIVEL (materializada cedo), mas ele depende do 3, que não foi concluído.
    await prisma.subtaskExecution.upsert({
      where: { stepInstanceId_subtaskKey_sequencia: { stepInstanceId: o.stepInstanceId, subtaskKey: "conferir_validar_certidao", sequencia: 1 } } as never,
      update: { status: "DISPONIVEL" }, create: { stepInstanceId: o.stepInstanceId, subtaskKey: "conferir_validar_certidao", sequencia: 1, status: "DISPONIVEL" } as never,
    }).catch(async () => { await prisma.subtaskExecution.updateMany({ where: { stepInstanceId: o.stepInstanceId, subtaskKey: "conferir_validar_certidao" }, data: { status: "DISPONIVEL" } }) })
    const gravado = await prisma.subtaskExecution.findFirst({ where: { stepInstanceId: o.stepInstanceId, subtaskKey: "conferir_validar_certidao", supersededAt: null }, select: { status: true } })
    ok("pré: o banco tem o passo 4 gravado DISPONIVEL (o defeito)", gravado?.status === "DISPONIVEL", String(gravado?.status))
    const subs = await subtarefasDaEtapa({ stepInstanceId: o.stepInstanceId })
    const s4 = subs.find((s) => s.key === "conferir_validar_certidao")!
    ok("o selo do passo 4 é BLOQUEADO (nunca «Disponível»), sem ação", s4.status === "BLOQUEADO" && s4.disponivel === false && /Depende de/.test(s4.bloqueioTexto ?? ""), `${s4.status} · ${s4.bloqueioTexto}`)
    const s3 = subs.find((s) => s.key === "receber_certidao")!
    ok("e o passo 3 também (mesma lógica)", s3.status === "BLOQUEADO" && s3.disponivel === false, s3.status)
    ok("nenhuma subtarefa com dependência pendente aparece «Disponível»", subs.every((s) => !(s.bloqueioCodigo && s.status === "DISPONIVEL")))
    ok("o passo 2 (corrente) continua com o estado que o banco diz (aguardando o cartório)", ["AGUARDANDO_EXTERNO", "DISPONIVEL"].includes(subs.find((s) => s.key === "receber_confirmacao_pedido")!.status))
    const pular = await concluirSubtarefaCorrentePeloPasso({ stepInstanceId: o.stepInstanceId, executadoPorId: null, payload: {}, subtarefaKeyEsperada: "conferir_validar_certidao" })
    ok("SERVIDOR: concluir o passo 4 fora de ordem é recusado", pular.aplicavel === false && pular.motivo === "SUBTAREFA_INCORRETA", JSON.stringify(pular))
    const pular3 = await concluirSubtarefaCorrentePeloPasso({ stepInstanceId: o.stepInstanceId, executadoPorId: null, payload: {}, subtarefaKeyEsperada: "receber_certidao" })
    ok("SERVIDOR: concluir o passo 3 antes do 2 também", pular3.aplicavel === false)
    const st = Object.fromEntries((await prisma.subtaskExecution.findMany({ where: { stepInstanceId: o.stepInstanceId, supersededAt: null }, select: { subtaskKey: true, status: true } })).map((e) => [e.subtaskKey, e.status]))
    ok("nada foi concluído nas recusas", st.receber_certidao !== "CONCLUIDO" && st.conferir_validar_certidao !== "CONCLUIDO", JSON.stringify(st))

    // Corrente com dependência pendente (a dependência vem DEPOIS na ordem): recusa por DEPENDENCIA_PENDENTE.
    const c2 = await montarCenario(`${MARCA}2`, { subs: [{ key: "a", label: "A", ordem: 1, espera: false, dependeDe: ["b"] }, { key: "b", label: "B", ordem: 2, espera: false, dependeDe: [] }] })
    try {
      const o2 = await c2.novaObrigacao({ responsavelId: null })
      const r = await concluirSubtarefaCorrentePeloPasso({ stepInstanceId: o2.stepInstanceId, executadoPorId: null, payload: {} })
      ok("SERVIDOR: subtarefa corrente que depende de outra não concluída é recusada (DEPENDENCIA_PENDENTE)", r.aplicavel === false && r.motivo === "DEPENDENCIA_PENDENTE" && /Depende de/.test(r.mensagem ?? ""), JSON.stringify(r))
    } finally { await c2.limpar() }

    ok("o vigia (regra j) acusa passo pulado e selo mentiroso; fica quieto no estado certo", problemasDeOrdemDaEmissao({ enviar_requerimento_cartorio: "CONCLUIDO", receber_confirmacao_pedido: "AGUARDANDO_EXTERNO", receber_certidao: "BLOQUEADO", conferir_validar_certidao: "DISPONIVEL" }).length === 1 && problemasDeOrdemDaEmissao({ enviar_requerimento_cartorio: "CONCLUIDO", receber_confirmacao_pedido: "PENDENTE", receber_certidao: "CONCLUIDO" }).length >= 1 && problemasDeOrdemDaEmissao({ enviar_requerimento_cartorio: "CONCLUIDO", receber_confirmacao_pedido: "AGUARDANDO_EXTERNO", receber_certidao: "BLOQUEADO", conferir_validar_certidao: "BLOQUEADO" }).length === 0)
    ok("a gaveta imprime o estado que o servidor devolve (BLOQUEADO → «Bloqueada»)", /BLOQUEADO: "Bloqueada"/.test(ler("src/components/kanban/workflow/WorkflowTab.tsx")))
  } finally {
    await c.limpar()
  }

  secao("3) Datas dd/mm/aaaa — máscara e validação real")
  ok("máscara: 07102026 → 07/10/2026; só dígitos; corta no 10º caractere", mascararData("07102026") === "07/10/2026" && mascararData("07/10/20269999") === "07/10/2026" && mascararData("ab0710") === "07/10")
  ok("dd/mm/aaaa → ISO e de volta", brParaIso("07/10/2026") === "2026-10-07" && isoParaBr("2026-10-07") === "07/10/2026" && isoParaBr("2026-10-07T15:30:00Z") === "07/10/2026")
  ok("dia/mês/ano REAIS: 31/02 e 29/02/2025 não existem; 29/02/2024 sim; mês 13 não", brParaIso("31/02/2026") === null && brParaIso("29/02/2025") === null && brParaIso("29/02/2024") === "2024-02-29" && brParaIso("10/13/2026") === null && brParaIso("00/10/2026") === null && dataReal(31, 4, 2026) === false && dataReal(30, 4, 2026) === true)
  ok("incompleta não vale", brParaIso("07/10/20") === null && brParaIso("") === null)
  ok("data e hora: dd/mm/aaaa hh:mm (23:59 vale, 24:00 não)", brHoraParaIso("07/10/2026 15:30") === "2026-10-07T15:30" && brHoraParaIso("07/10/2026 24:00") === null && isoHoraParaBr("2026-10-07T15:30") === "07/10/2026 15:30" && mascararData("071020261530", true) === "07/10/2026 15:30")
  ok("mensagem de erro em português", /dia, mês e ano reais/.test(motivoDaDataInvalida("31/02/2026") ?? "") && motivoDaDataInvalida("07/10/2026") === null && motivoDaDataInvalida("") === null)
  const html = renderToStaticMarkup(createElement(CampoDataTexto, { value: "2026-10-07", onChange: () => {} }))
  ok("o campo mostra 07/10/2026 (e NÃO 10/07/2026), é de texto e tem o placeholder dd/mm/aaaa", /value="07\/10\/2026"/.test(html) && /type="text"/.test(html) && /placeholder="dd\/mm\/aaaa"/.test(html) && !/type="date"/.test(html), html.slice(0, 120))
  const htmlHora = renderToStaticMarkup(createElement(CampoDataHoraTexto, { value: "2026-10-07T15:30", onChange: () => {} }))
  ok("o campo com hora mostra 07/10/2026 15:30", /value="07\/10\/2026 15:30"/.test(htmlHora))
  ok("vazio mostra o placeholder", /value=""/.test(renderToStaticMarkup(createElement(CampoDataTexto, { value: "", onChange: () => {} }))))

  secao("3b) Nenhuma tela usa input de data nativo")
  const nativos = tudo.filter(([f, cod]) => /type="date"|type='date'|type="datetime-local"|type="month"|type=\{[^}]*["'](date|datetime-local|month)["']/.test(cod.replace(/\/\/.*$/gm, "")) && !/EditorRegistralModal\.tsx$/.test(f)).map(([f]) => f)
  ok("nenhum <input type=\"date\"> / datetime-local em src (o campo é CampoDataTexto)", nativos.length === 0, nativos.join(", "))
  const editor = ler("src/components/kanban/workflow/EditorRegistralModal.tsx")
  ok("o Editor Registral usa o seletor com calendário em dd/mm/aaaa (Field type=\"date\" → CampoData, nunca <input type=date>)", /type === "date" \? \(\s*<CampoData/.test(editor))
  const calendario = ler("src/components/ui/campo-data.tsx")
  ok("o componente com calendário também exibe dd/mm/aaaa", /\/\$\{String\(p\.mes \+ 1\)\.padStart\(2, "0"\)\}\/\$\{p\.ano\}/.test(calendario) && /"dd\/mm\/aaaa"/.test(calendario))
  const modal = ler("src/components/operacao/RegistrarRecebimentoModal.tsx")
  ok("o modal «Registrar recebimento» usa o campo dd/mm/aaaa (aceita data passada, recusa futura)", /<CampoDataTexto max=\{hojeSP\(\)\}/.test(modal) && /disabled=\{enviando \|\| !dia\}/.test(modal))

  secao("4) Cabeçalho do Aguardando legível")
  const css = ler("src/components/operacao/operacao-v3.css")
  ok("os títulos quebram linha em vez de se sobrepor (overflow-wrap) e a coluna Ação é estreita", /\.opv3-hd > \* \{[^}]*overflow-wrap: anywhere/.test(css) && /\.opv3-gA \{ grid-template-columns:[^;]*84px;/.test(css))

  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
