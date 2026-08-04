/**
 * BASELINE ARQUITETURAL — a suíte que congela a arquitetura do Discovery.
 *
 * Rodar: npm run test:arquitetura-baseline
 *        npm run test:arquitetura-baseline -- --banco   (+ verificação no cadastro real)
 *
 * NENHUMA implementação está concluída se esta suíte falhar.
 *
 * Ela não repete o que as suítes específicas já provam — verifica que as DECISÕES
 * continuam valendo no código: que a instância continua sendo por fase/ciclo, que
 * o arquivo continua sendo uma linha só, que o runtime continua sem citar nome de
 * documento, que não nasceu alias nem fallback nem segunda fonte.
 *
 * O documento correspondente é docs/architecture/01-baseline-arquitetural.md. Os dois mudam juntos.
 */
import { readFileSync, existsSync } from "node:fs"
import { execSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const ler = (rel: string) => readFileSync(join(ROOT, rel), "utf8")
const existe = (rel: string) => existsSync(join(ROOT, rel))
const COM_BANCO = process.argv.includes("--banco")

let passed = 0, failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}
/** Código sem comentários: a regra proíbe o CÓDIGO depender de texto, não explicá-lo. */
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")

function grepSrc(padrao: string): string[] {
  try {
    const out = execSync(`grep -rlE ${JSON.stringify(padrao)} ${JSON.stringify(join(ROOT, "src"))} 2>/dev/null || true`,
      { encoding: "utf8" })
    return out.split("\n").filter(Boolean)
  } catch { return [] }
}

console.log("BASELINE ARQUITETURAL — arquitetura congelada em 04/08/2026\n")

// ════════════════════════════════════════════════════════════════
// 1. CONTRATO DOCUMENTAL
// ════════════════════════════════════════════════════════════════
console.log("(1) Contrato documental:")

const schema = ler("prisma/schema.prisma")
/** Bloco de UM model. `[\s\S]*?` solto atravessa o fim e acha campo do vizinho. */
function bloco(nome: string): string {
  const i = schema.indexOf(`model ${nome} {`)
  if (i < 0) return ""
  return schema.slice(i, schema.indexOf("\n}", i) + 2)
}
ok(["model FamiliaDocumental", "model NaturezaOperacionalDocumento", "model PerfilOperacionalDocumento"]
     .every((m) => schema.includes(m)),
  "1.1 os três cadastros mestres do contrato existem")
ok(schema.includes("enum EscopoExecucao"),
  "1.2 o escopo é dimensão fechada (enum), não um cadastro rival")
ok(bloco("TipoDocumentoCadastro").includes("perfilOperacionalId"),
  "1.3 o Tipo de Documento aponta para o perfil operacional")
ok(bloco("PhaseInternalWorkflow").includes("exigeDocumento"),
  "1.4 o Workflow Interno declara exigeDocumento")
ok(existe("src/lib/documentos/contrato-documental.ts"),
  "1.5 os guards do contrato existem num módulo só")

// ════════════════════════════════════════════════════════════════
// 2. MATERIALIZAÇÃO
// ════════════════════════════════════════════════════════════════
console.log("\n(2) Materialização:")

const motor = ler("src/services/phase-workflow.ts")
ok(motor.includes("exigirDocumentoNoPasso("),
  "2.1 o motor cobra a invariante documental")
ok(motor.indexOf("exigirDocumentoNoPasso(") < motor.indexOf("tx.phaseWorkflowStepInstance.create"),
  "2.2 a invariante roda ANTES do create — sem estado parcial")
ok((motor.match(/exigeDocumento: workflow\.exigeDocumento === true/g) || []).length === 2,
  "2.3 os dois caminhos (instância nova e convergência) passam o contrato")
ok(motor.includes("chaveIdempotencia: chavePasso"),
  "2.4 a materialização continua idempotente por chave")

// D1 — a instância continua sendo por fase/ciclo
ok(!/\bdocumentoId\b/.test(bloco("PhaseWorkflowInstance")),
  "2.5 D1: PhaseWorkflowInstance NÃO tem documentoId — instância é por fase/ciclo")
ok(bloco("PhaseWorkflowInstance").includes("previousInstanceId") && bloco("PhaseWorkflowInstance").includes("ciclo"),
  "2.6 D1: ciclo e supersessão da instância permanecem intactos")

// ════════════════════════════════════════════════════════════════
// 3. WORKFLOW INTERNO
// ════════════════════════════════════════════════════════════════
console.log("\n(3) Workflow interno:")

const catalogo = ler("src/lib/process-stage/fases-catalog.ts")
const CINCO = ["solicitar_certidao", "aguardar_retorno_do_cartorio", "receber_certidao",
               "conferir_certidao", "validar_certidao"]
ok(CINCO.every((k) => catalogo.includes(k)),
  "3.1 os cinco passos canônicos seguem no catálogo")
const registry = ler("src/lib/process-stage/step-editor-registry.ts")
ok(CINCO.every((k) => registry.includes(k)),
  "3.2 os cinco passos têm editor registrado — nenhuma etapa sem interface")
ok(!semComentarios(registry).includes("não disponível") && registry.includes('"padrao"'),
  "3.3 ausência de editor específico resolve para o padrão, nunca para erro")

// ════════════════════════════════════════════════════════════════
// 4. CENTRAL OPERACIONAL
// ════════════════════════════════════════════════════════════════
console.log("\n(4) Central Operacional:")

const drawerDoc = ler("src/components/kanban/DocumentoOperationalDrawer.tsx")
const drawerEtapa = ler("src/components/kanban/workflow/CentralDaEtapaDrawer.tsx")
const ordemDoc = [...drawerDoc.matchAll(/\{ id: "(\w+)", label: "([^"]+)" \}/g)].map((m) => m[2])
ok(JSON.stringify(ordemDoc) === JSON.stringify(
     ["Operação", "Workflow", "Dados Registrais", "Histórico", "Anexos", "Observações"]),
  `4.1 D11: as seis abas do documento na ordem congelada (${ordemDoc.join(" · ")})`)
ok(/type TabId = "anexos" \| "comentarios" \| "timeline"/.test(drawerEtapa),
  "4.2 D11: a etapa tem exatamente três abas")
ok(!/display:\s*none|featureFlag|FEATURE_/.test(drawerDoc + drawerEtapa),
  "4.3 nenhuma aba escondida por CSS ou flag — removidas, não ocultadas")
ok(!/function Placeholder/.test(drawerDoc + drawerEtapa),
  "4.4 nenhum placeholder técnico sobrou")

// ════════════════════════════════════════════════════════════════
// 5. SINCRONISMO Documento ↔ Step ↔ Task
// ════════════════════════════════════════════════════════════════
console.log("\n(5) Documento ↔ Step ↔ Task:")

const invariante = ler("src/services/invariante-documental.ts")
ok(invariante.includes("PASSO_DOCUMENTAL_SEM_DOCUMENTO"),
  "5.1 passo documental sem documento é recusado")
ok(invariante.includes("TAREFA_DOCUMENTAL_SEM_DOCUMENTO"),
  "5.2 tarefa documental sem documento é recusada")
ok(invariante.includes("TAREFA_E_PASSO_DIVERGEM"),
  "5.3 tarefa e passo apontando para documentos diferentes é erro")
ok(invariante.includes("TAREFA_DE_WORKFLOW_SEM_PASSO"),
  "5.4 tarefa de origem workflow precisa do passo")
ok(bloco("PhaseWorkflowStepInstance").includes("documentoId") && bloco("Tarefa").includes("documentoId"),
  "5.5 Step e Task carregam documentoId no schema")

// ════════════════════════════════════════════════════════════════
// 6. ANEXOS
// ════════════════════════════════════════════════════════════════
console.log("\n(6) Anexos:")

const blocoArquivo = schema.slice(schema.indexOf("model DocumentoArquivo"),
                                 schema.indexOf("model ExigenciaEvidenciaEtapa"))
ok(["documentoId", "solicitacaoId", "stepInstanceId", "protocoloId", "documentTypeId"]
     .every((c) => blocoArquivo.includes(c)),
  "6.1 D7: os cinco vínculos vivem na MESMA linha")
ok(!/model (StepAttachment|RequestAttachment|ProtocolAttachment|DocumentAttachment)\b/.test(schema),
  "6.2 D7: nenhuma tabela de junção paralela nasceu")
ok(blocoArquivo.includes("@@unique([documentoId, url])"),
  "6.3 um upload = uma linha (dedup estrutural)")
ok(["vigente", "substituiId", "substituidoEm"].every((c) => blocoArquivo.includes(c)),
  "6.4 substituição versiona — a anterior nunca é apagada")
const migDoc21 = ler("prisma/migrations/20260804b_requerimento_doc21_vinculo/migration.sql")
ok(/CREATE UNIQUE INDEX[\s\S]{0,200}"solicitacaoId", "documentTypeId"[\s\S]{0,120}WHERE "vigente"/.test(migDoc21),
  "6.5 o BANCO garante uma única versão vigente por (solicitação, tipo mestre)")

// ════════════════════════════════════════════════════════════════
// 7. AUSÊNCIA DE DUPLICAÇÃO / SEGUNDA FONTE
// ════════════════════════════════════════════════════════════════
console.log("\n(7) Fonte única:")

const escritoresDeArquivo = grepSrc("documentoArquivo\\.(create|createMany)")
  .filter((f) => !f.includes("documento-arquivos.ts"))
ok(escritoresDeArquivo.length === 0,
  `7.1 só UMA implementação grava arquivo${escritoresDeArquivo.length ? " — vazou: " + escritoresDeArquivo.join(", ") : ""}`)

const runtime = semComentarios([
  "src/services/solicitacao-documento.ts",
  "src/services/documento-arquivos.ts",
  "src/services/exigencia-evidencia.ts",
  "src/services/invariante-documental.ts",
  "src/components/kanban/documento/AbasDocumentais.tsx",
].map(ler).join("\n"))
ok(!/DOC21|Requerimento inteiro teor/.test(runtime),
  "7.2 D6: o runtime nunca cita DOC21 nem o nome do documento como chave")

const canais = ler("src/components/kanban/workflow/StepEditors.tsx")
ok(canais.includes("CANAIS_SOLICITACAO.map"),
  "7.3 a lista de canais da tela DERIVA da config oficial — sem segunda lista")

// ════════════════════════════════════════════════════════════════
// 8. AUSÊNCIA DE LEGADO
// ════════════════════════════════════════════════════════════════
console.log("\n(8) Zero legado:")

const telas = [drawerDoc, drawerEtapa, ler("src/components/kanban/documento/AbasDocumentais.tsx")].join("\n")
ok(!/Requer modelo \w+ no schema|tabela de junção|requer modelo/i.test(semComentarios(telas)),
  "8.1 nenhuma mensagem de 'modelo ausente' nas telas")
ok(!/fallbackPor(Nome|Titulo)|aliasDe|POR_NOME\s*=/.test(semComentarios(motor + invariante)),
  "8.2 nenhum fallback ou alias por nome no motor")
const guardEnv = ler("scripts/guard-env-producao.mjs")
ok(guardEnv.includes("VERCEL_ENV") && guardEnv.includes("process.exit(1)"),
  "8.3 D12: produção não sobe sem o banco certo")

// ════════════════════════════════════════════════════════════════
// 9. DOCUMENTO DA BASELINE
// ════════════════════════════════════════════════════════════════
console.log("\n(9) Documento da baseline:")

ok(existe("docs/architecture/01-baseline-arquitetural.md"), "9.1 a baseline está versionada em docs/architecture/")
const doc = ler("docs/architecture/01-baseline-arquitetural.md")
for (const secao of ["Modelo de domínio", "Fluxo operacional", "Relações entre entidades",
                     "Regras invariantes", "Decisões arquiteturais", "Diagramas",
                     "Checklist de regressão", "Testes obrigatórios"]) {
  ok(doc.includes(secao), `9.2 a baseline documenta "${secao}"`)
}
ok(/D1[\s\S]*D12/.test(doc), "9.3 as doze decisões arquiteturais estão registradas")
ok(doc.includes("pendências declaradas"),
  "9.4 as pendências estão declaradas — não são dívida oculta")

console.log(`\n${passed} passaram, ${failed} falharam`)
if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }

// ════════════════════════════════════════════════════════════════
// 10. PROCESSO 505 E CADASTRO REAL
// ════════════════════════════════════════════════════════════════
if (!COM_BANCO) {
  console.log("\n(10) Banco: pulado (use --banco).")
  console.log("\nBASELINE ARQUITETURAL ✅ — arquitetura íntegra.")
  process.exit(0)
}

async function noBanco() {
  const { prisma } = await import("../src/lib/prisma")
  console.log("\n(10) Cadastro real e processo 505:")
  try {
    const tipos = await prisma.tipoDocumentoCadastro.findMany({
      where: { publicCode: { in: ["DOC1", "DOC2", "DOC3", "DOC21"] } },
      select: { publicCode: true, perfilOperacional: { select: { code: true } } },
    })
    ok(["DOC1", "DOC2", "DOC3"].every((c) =>
        tipos.find((t) => t.publicCode === c)?.perfilOperacional?.code === "EMISSAO_CERTIDAO"),
      "10.1 D5: DOC1/DOC2/DOC3 compartilham o perfil EMISSAO_CERTIDAO")
    ok(tipos.find((t) => t.publicCode === "DOC21")?.perfilOperacional == null,
      "10.2 D6: DOC21 permanece sem perfil — é evidência, não emissão")

    const wf = await prisma.phaseInternalWorkflow.findFirst({
      where: { phaseKey: "emissao_documental", tipoProcessoId: null, active: true },
      select: { escopoExecucao: true, exigeDocumento: true,
                passos: { select: { key: true, cardinalidade: true }, orderBy: { ordem: "asc" } } },
    })
    ok(wf?.escopoExecucao === "DOCUMENTO" && wf?.exigeDocumento === true,
      "10.3 o workflow vigente declara escopo DOCUMENTO e exige documento")
    ok(JSON.stringify(wf?.passos.map((p) => p.key)) === JSON.stringify(CINCO),
      "10.4 a ordem dos cinco passos está congelada")
    ok(wf?.passos.every((p) => p.cardinalidade === "DOCUMENTO") === true,
      "10.5 D4: os cinco passos declaram cardinalidade DOCUMENTO")

    // INTEGRIDADE DOS PROCESSOS — e não a existência de um id específico.
    // O processo 505 foi excluído pelo operador em 04/08 e outros nasceram no
    // lugar: prender a baseline a um id transformaria uso normal do sistema em
    // falha de arquitetura. O que se congela é a INVARIANTE, não a linha.
    const processos = await prisma.processo.findMany({
      select: { id: true, faseAtualKey: true, workflowRuntime: true },
    })
    ok(processos.length > 0 && processos.every((p) => p.workflowRuntime === "v2"),
      `10.6 todos os ${processos.length} processos estão no runtime v2 (zero legado)`)
    const { FASES, phaseKeyToFaseCode } = await import("../src/lib/process-stage/fases-catalog")
    const foraDoCatalogo = processos.filter((p) => !p.faseAtualKey || !phaseKeyToFaseCode(p.faseAtualKey))
    ok(foraDoCatalogo.length === 0 && Object.keys(FASES).length > 0,
      `10.7 toda fase atual é phaseKey canônica${foraDoCatalogo.length ? " — fora: " + foraDoCatalogo.map((p) => `${p.id}:${p.faseAtualKey}`).join(", ") : ""}`)

    // Zero duplicação: um arquivo, uma linha.
    const dupArquivos = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `select count(*)::int as n from (
         select "documentoId", url from "DocumentoArquivo" group by 1,2 having count(*) > 1
       ) x`)
    ok(Number(dupArquivos[0]?.n ?? 0) === 0, "10.8 zero arquivo duplicado (documento, url)")

    const dupPassos = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `select count(*)::int as n from (
         select "chaveIdempotencia" from "PhaseWorkflowStepInstance" group by 1 having count(*) > 1
       ) x`)
    ok(Number(dupPassos[0]?.n ?? 0) === 0, "10.9 zero passo duplicado por chave de idempotência")
  } catch (e) {
    failed++
    console.log(`  ❌ verificação no banco falhou: ${String(e).slice(0, 160)}`)
  } finally {
    await prisma.$disconnect()
  }
}

void noBanco().then(() => {
  console.log(`\n${passed} passaram, ${failed} falharam`)
  if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
  console.log("\nBASELINE ARQUITETURAL ✅ — arquitetura íntegra.")
})
