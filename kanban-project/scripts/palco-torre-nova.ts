// scripts/palco-torre-nova.ts
// ============================================================================
// PALCO DE DADOS DA NOVA TORRE DE CONTROLE (branch `torre-nova`).
//
//   Rodado por `node scripts/dev-torre-nova.mjs` (banco efêmero NOVO, com as migrations reais).
//   Direto:  PRISMA_DATABASE_URL=postgresql://postgres@127.0.0.1:PORTA/discovery_test_x \
//            DIRECT_DATABASE_URL=$PRISMA_DATABASE_URL npx tsx scripts/palco-torre-nova.ts
//
// O QUE É: um seed REALISTA e DETERMINÍSTICO para conferir a Torre lado a lado com o protótipo
// (prototipo-torre/torre-de-controle.html). ~28 famílias/processos nas fases do protótipo, com árvore,
// uniões, requerentes, necessidades -> documentos -> passos -> tarefas (certidões por pessoa) em todos os
// estados que as telas mostram. Nomes de famílias PLAUSÍVEIS e FICTÍCIOS: nenhum dado real de cliente.
//
// COMO É FEITO: o estado nasce pelas PORTAS OFICIAIS do sistema (criarProcessoV2, materializarGenealogia,
// movePhaseManual, atribuirTarefa, registrarCobranca, pausarProcesso, criarComentario…) para ser coerente
// com o que o motor produziria. Só DATAS PASSADAS (entrada em fase, createdAt, dataEnvio, prazos) são
// forçadas por UPDATE — e SÓ neste banco efêmero (a trava `exigirBancoDeTeste` recusa qualquer outro).
//
// IDEMPOTÊNCIA: feito para BANCO NOVO e DESCARTÁVEL. Não apaga nada (nem pessoas): rodar duas vezes no
// mesmo banco recusa-se a duplicar (detecta a marca PALCO e sai). Para recomeçar, suba um banco novo.
//
// RELÓGIO: `PALCO_AGORA=2026-10-01T12:00:00-03:00` fixa o "agora" usado para calcular as DATAS DO SEED
// (prazos, entradas em fase, fotos diárias). O servidor `next dev` continua usando o relógio real —
// por isso, para comparar números dia a dia, prefira rodar o seed no mesmo dia em que for usá-lo.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("palco-torre-nova.ts")

import { prisma } from "../lib/prisma"
import { publicarWorkflow } from "../src/services/publicacao-de-workflow"
import { criarProcessoV2 } from "../src/services/criar-processo"
import { materializarGenealogia } from "../src/services/genealogia/materializar-genealogia"
import { reconciliarTarefas } from "../lib/operacional/reconciliar-tarefas"
import { movePhaseManual } from "../src/lib/motor/phase-advance"
import { recalcularNumerosLinhagemDaArvore } from "../src/services/genealogia/numero-linhagem"
import { atribuirTarefa } from "../lib/operacional/tarefa-comandos"
import { bloquearTarefa, cancelarTarefa, aguardarTerceiro } from "../lib/operacional/tarefa-ciclo"
import { iniciarTarefa as iniciarTarefaSync, concluirTarefa as concluirTarefaSync, concluirPasso } from "../src/services/task-step-sync"
import { concluirSubtarefaCorrentePeloPasso, registrarCobranca } from "../src/services/subtarefas-da-etapa"
import { listarTarefasDaTorre } from "../src/services/torre-tarefas"
import { cargaPorPessoa } from "../lib/operacional/torre-predicados"
import { definirMeta } from "../lib/operacional/torre-metas"
import { limparSpec } from "../lib/operacional/torre-visoes"
import { calcularIndicadoresDoDia, gravarIndicadoresDoDia } from "../lib/operacional/indicadores-diarios"
import { criarComentario } from "../src/services/comentario-tarefa"
import { pausarProcesso } from "../src/services/processo-pausa"
import { aplicarMudancaNaArvore } from "../src/services/genealogia/propagar-arvore"
import { definirAptidoes, definirAptidoesPais, definirCapacidade, abrirIndisponibilidade } from "../lib/operacional/organizacao"

// ── relógio e PRNG determinísticos ──────────────────────────────────────────
const AGORA = process.env.PALCO_AGORA ? new Date(process.env.PALCO_AGORA) : new Date()
if (Number.isNaN(AGORA.getTime())) throw new Error("PALCO_AGORA inválido")
const DIA = 86_400_000
/** Data relativa ao "agora" do palco (n dias; negativo = passado). */
const em = (n: number, hora?: number): Date => {
  const d = new Date(AGORA.getTime() + n * DIA)
  if (hora != null) d.setUTCHours(hora, 0, 0, 0)
  return d
}
let semente = 20261001
const rnd = (): number => { semente |= 0; semente = (semente + 0x6d2b79f5) | 0; let t = Math.imul(semente ^ (semente >>> 15), 1 | semente); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const sorteia = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]
const T0 = Date.now()
const log = (m: string) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0).padStart(3)}s] ${m}`)

// o motor imprime uma linha enorme de diagnóstico a cada reconciliação; aqui só interessa o progresso do palco
for (const nivel of ["log", "info", "warn"] as const) {
  const original = console[nivel].bind(console)
  console[nivel] = (...a: unknown[]) => { if (typeof a[0] === "string" && a[0].startsWith("[motor:")) return; original(...a) }
}

const MARCA = "PALCO"
const MOTIVO = "palco da nova Torre (banco efêmero)"

async function main() {
  if (await prisma.processo.count({ where: { nome: { startsWith: "Família " } } }) > 0) {
    console.error("⛔ O palco já foi montado neste banco (há processos 'Família …'). Suba um banco NOVO — o seed não apaga nada."); process.exit(1)
  }
  const cad = await cadastro()
  await equipe(cad)
  await orgaos(cad)
  const feitas = await familias(cad)
  await metas(cad)
  await comentarios(cad, feitas)
  await visoes(cad)
  await ajustarCarga(cad)
  await ausencias(cad)
  await fotosDiarias()
  await espalharHistorico()
  await resumoFinal(cad, feitas)
  log(`cadastro ok: ${JSON.stringify({ paises: cad.paises, tipos: cad.tipos })}`)
}

// ============================================================================
// A. CADASTRO (países, tipos, macro de 10 fases, workflows internos, regras documentais, equipe, órgãos)
// ============================================================================
interface Cad {
  adminId: number
  paises: { IT: number; ES: number }
  tipos: { IT: number; ES: number }
  modalidades: { IT: number; ES: number }
  /** unidade operacional (PerfilOperacionalDocumento) */
  perfis: { civil: number; requerente: number }
  usuarios: Record<string, number>
  orgaos: Record<string, number>
}

/** Fases do macro, na ordem do protótipo (chaves REAIS do CatalogoFase). Retificação e Emissão retificada são condicionais. */
const FASES: Array<{ key: string; label: string; condicional?: boolean }> = [
  { key: "genealogia", label: "Genealogia" },
  { key: "emissao_documental", label: "Emissão Documental" },
  { key: "analise_documental", label: "Análise Documental" },
  { key: "retificacao_registros", label: "Retificação de Registros", condicional: true },
  { key: "emissao_documental_retificada", label: "Emissão Documental Retificada", condicional: true },
  { key: "traducao_juramentada", label: "Tradução Juramentada" },
  { key: "apostilamento", label: "Apostilamento" },
  { key: "aguardando_protocolo", label: "Aguardando Protocolo" },
  { key: "protocolado", label: "Protocolado" },
  { key: "finalizado", label: "Finalizado" },
]

/** Passos do Workflow Interno de cada fase (rótulos do pipeline do protótipo, §3.4 do inventário). `card` = cardinalidade do passo. */
const PASSOS: Record<string, Array<{ key: string; label: string; card?: "PROCESSO" | "DOCUMENTO" | "NECESSIDADE" }>> = {
  genealogia: [
    { key: "montar_arvore", label: "Montar árvore" },
    { key: "esperar_cliente", label: "Esperando cliente" },
    { key: "validar_registro", label: "Validar certidão" },
  ],
  emissao_documental: [
    { key: "solicitar_certidao", label: "Solicitar certidão" },
    { key: "receber_certidao", label: "Receber certidão" },
    { key: "conferir_certidao", label: "Conferir e validar certidão" },
  ],
  analise_documental: [
    { key: "conferir_nomes_datas", label: "Conferir nomes e datas" },
    { key: "registrar_divergencias", label: "Registrar divergências" },
    { key: "concluir_analise", label: "Concluir análise" },
  ],
  retificacao_registros: [
    { key: "peticionar_retificacao", label: "Petição a protocolar", card: "PROCESSO" },
    { key: "aguardar_juizo", label: "Aguardando terceiros", card: "PROCESSO" },
    { key: "receber_sentenca", label: "Sentença recebida", card: "PROCESSO" },
    { key: "averbar", label: "Averbada", card: "PROCESSO" },
  ],
  emissao_documental_retificada: [
    { key: "solicitar_segunda_via", label: "Solicitar 2ª via", card: "PROCESSO" },
    { key: "receber_segunda_via", label: "Recebida · conferir", card: "PROCESSO" },
    { key: "validar_segunda_via", label: "Pronta", card: "PROCESSO" },
  ],
  traducao_juramentada: [
    { key: "enviar_tradutora", label: "Enviar à tradutora" },
    { key: "receber_traducao", label: "Recebida · conferir" },
    { key: "validar_traducao", label: "Traduzida" },
  ],
  apostilamento: [
    { key: "levar_apostilador", label: "Levar ao cartório" },
    { key: "receber_apostila", label: "Recebida · conferir" },
    { key: "validar_apostila", label: "Apostilada" },
  ],
  aguardando_protocolo: [
    { key: "montar_pasta_final", label: "Montar pasta final", card: "PROCESSO" },
    { key: "aguardar_vaga", label: "Esperando vaga", card: "PROCESSO" },
  ],
  protocolado: [
    { key: "acompanhar_consulado", label: "No consulado", card: "PROCESSO" },
    { key: "registrar_reconhecimento", label: "Reconhecido", card: "PROCESSO" },
  ],
  finalizado: [
    { key: "encerrar_processo", label: "Encerrar processo", card: "PROCESSO" },
  ],
}

async function cadastro(): Promise<Cad> {
  log("cadastro: países, tipos, macro, workflows…")
  await prisma.motorConfig.upsert({ where: { id: 1 }, update: { runtimeV2Habilitado: true }, create: { id: 1, runtimeV2Habilitado: true } })

  // Admin do palco (o da fixture mínima do banco de teste ganha o nome do dono, como no protótipo).
  const adminBase = await prisma.usuario.findFirstOrThrow({ where: { tipo: "admin" }, orderBy: { id: "asc" } })
  await prisma.usuario.update({ where: { id: adminBase.id }, data: { nome: "Marco Rovatti" } })

  const it = await prisma.catalogoPais.upsert({
    where: { countryKey: "ITALIA" }, update: { flag: "🇮🇹" },
    create: { countryKey: "ITALIA", countryLabel: "Itália", nationalityKey: "ITALIANA", nationalityLabel: "Italiana", defaultCurrency: "EUR", flag: "🇮🇹", language: "it", ativo: true },
  })
  const es = await prisma.catalogoPais.upsert({
    where: { countryKey: "ESPANHA" }, update: {},
    create: { countryKey: "ESPANHA", countryLabel: "Espanha", nationalityKey: "ESPANHOLA", nationalityLabel: "Espanhola", defaultCurrency: "EUR", flag: "🇪🇸", language: "es", ativo: true },
  })
  // Modalidades: IT = judicial (a da fixture mínima); ES = administrativa.
  const modIt = (await prisma.modalidadePais.findFirst({ where: { paisId: it.id, ativo: true }, orderBy: { id: "asc" } }))
    ?? await prisma.modalidadePais.create({ data: { paisId: it.id, modalityKey: "judicial", modalityLabel: "Judicial", ordem: 1, ativo: true } })
  const modEs = await prisma.modalidadePais.upsert({
    where: { paisId_modalityKey: { paisId: es.id, modalityKey: "administrativa" } }, update: {},
    create: { paisId: es.id, modalityKey: "administrativa", modalityLabel: "Administrativa", ordem: 1, ativo: true },
  })
  const tipoIt = await prisma.tipoProcessoNacionalidade.create({ data: { code: "CIDADANIA-ITALIANA", name: "Cidadania italiana", paisId: it.id, processFamily: "cidadania", serviceNature: "main_process" } })
  const tipoEs = await prisma.tipoProcessoNacionalidade.create({ data: { code: "CIDADANIA-ESPANHOLA", name: "Cidadania espanhola (Lei de Memória Democrática)", paisId: es.id, processFamily: "cidadania", serviceNature: "main_process" } })
  await prisma.tipoProcessoModalidadeHabilitada.create({ data: { tipoProcessoId: tipoIt.id, modalidadeId: modIt.id, ativo: true } })
  await prisma.tipoProcessoModalidadeHabilitada.create({ data: { tipoProcessoId: tipoEs.id, modalidadeId: modEs.id, ativo: true } })

  // Macro de 10 fases por tipo+modalidade (as chaves vêm do CatalogoFase real carregado no banco de teste).
  for (const [tipoId, modalidadeId, nome] of [[tipoIt.id, modIt.id, "Cidadania italiana"], [tipoEs.id, modEs.id, "Cidadania espanhola"]] as const) {
    const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipoId, modalidadeId, name: `${nome} — macro`, cardinalidadeRequerimento: tipoId === tipoIt.id ? "COLETIVO" : "INDIVIDUAL" } })
    for (const [i, f] of FASES.entries()) {
      await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: f.key, label: f.label, ordem: i, conditional: !!f.condicional, required: !f.condicional } })
    }
  }

  // CADASTRO DOCUMENTAL: natureza -> itens -> perfil operacional (a UNIDADE de trabalho) -> tipos -> regras publicadas.
  const natureza = await prisma.naturezaOperacionalDocumento.create({ data: { code: `${MARCA}_CERT`, name: "Certidão de registro civil", exigeWorkflow: true } })
  const perfilCivil = await prisma.perfilOperacionalDocumento.create({ data: { code: `${MARCA}_CIVIL`, name: "Certidões de registro civil (nascimento, casamento, óbito)", ativo: true } })
  const perfilReq = await prisma.perfilOperacionalDocumento.create({ data: { code: `${MARCA}_REQ`, name: "Certidões do requerente", ativo: true } })
  const DOCS = {
    NAS: { nome: "Certidão de nascimento", perfil: perfilCivil.id },
    CAS: { nome: "Certidão de casamento", perfil: perfilCivil.id },
    OBI: { nome: "Certidão de óbito", perfil: perfilCivil.id },
    REQ: { nome: "Certidão do requerente", perfil: perfilReq.id },
  } as const
  // Categoria 'REGISTRO_CIVIL' (a que o domínio "certidões" do Relatório lê): sem ela os relatórios CSV/Excel/PDF saem vazios no palco.
  const categoriaCivil = await prisma.categoriaDocumental.upsert({ where: { code: "REGISTRO_CIVIL" }, update: {}, create: { code: "REGISTRO_CIVIL", name: "Registro civil", sistema: true } })
  for (const [k, d] of Object.entries(DOCS)) {
    const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_${k}`, name: d.nome, natureza: "DOCUMENTO" } })
    await prisma.tipoDocumentoCadastro.create({ data: { code: `${MARCA}-${k}`, name: d.nome, itemCatalogoId: item.id, nature: "certidao", naturezaOperacionalId: natureza.id, perfilOperacionalId: d.perfil, categoriaDocumentalId: categoriaCivil.id } })
  }
  const faseGen = await prisma.catalogoFase.findUniqueOrThrow({ where: { phaseKey: "genealogia" } })
  await prisma.faseNaturezaPermitida.upsert({
    where: { catalogoFaseId_naturezaOperacionalId: { catalogoFaseId: faseGen.id, naturezaOperacionalId: natureza.id } },
    update: { ativo: true }, create: { catalogoFaseId: faseGen.id, naturezaOperacionalId: natureza.id, ativo: true },
  })
  {
    const tipoId = tipoIt.id // UM conjunto de regras (aplicaTodosProcessos): vale para os dois tipos
    const regra = (k: keyof typeof DOCS, extra: Record<string, unknown>) => prisma.matrizDocumental.create({
      data: {
        tipoProcessoId: tipoId, aplicaTodosProcessos: true, documentTypeCode: `${MARCA}-${k}`, documentosAceitos: [`${MARCA}-${k}`],
        codigo: `${MARCA}_R_${k}_${tipoId}`, nome: DOCS[k].nome, requisitoNome: DOCS[k].nome, status: "PUBLICADA", arquivado: false,
        faseExigencia: "genealogia", obrigatoriedade: "OBRIGATORIA", ...extra,
      },
    })
    await regra("NAS", { publicoAlvo: "PESSOA_DA_LINHA_RETA", publicosAlvo: ["PESSOA_DA_LINHA_RETA"] })
    await regra("CAS", { publicoAlvo: "PESSOA_DA_LINHA_RETA", publicosAlvo: ["PESSOA_DA_LINHA_RETA"], alvoNecessidade: "UNIAO", condicoes: { combinador: "TODAS", regras: [{ campo: "casado", operador: "igual", valor: true }] } })
    await regra("OBI", { publicoAlvo: "PESSOA_DA_LINHA_RETA", publicosAlvo: ["PESSOA_DA_LINHA_RETA"], condicoes: { combinador: "TODAS", regras: [{ campo: "falecido", operador: "igual", valor: true }] } })
    await regra("REQ", { publicoAlvo: "REQUERENTE", publicosAlvo: ["REQUERENTE"] })
  }

  // WORKFLOW INTERNO publicado de cada fase (global: tipoProcessoId = null).
  for (const f of FASES) {
    const documental = f.key === "emissao_documental" || f.key === "traducao_juramentada" || f.key === "apostilamento"
    const wf = await prisma.phaseInternalWorkflow.create({
      data: {
        wfUid: `${MARCA}::${f.key}`, phaseKey: f.key, name: `Workflow Interno · ${f.label}`, active: true, tipoProcessoId: null, execucao: "SEQUENCIAL",
        ...(documental ? { escopoExecucao: "DOCUMENTO" as const, exigeDocumento: true, exigePessoa: true } : {}),
      },
    })
    for (const [i, p] of PASSOS[f.key].entries()) {
      const step = await prisma.phaseInternalWorkflowStep.create({
        data: {
          workflowId: wf.id, key: p.key, label: p.label, ordem: i + 1, createsTask: true, required: true, owner: "equipe_documental",
          slaDays: 0, cardinalidade: p.card ?? (documental ? "DOCUMENTO" : null),
          // sequência DECLARADA (o modo SEQUENCIAL só vale quando o cadastro não declara dependência)
          dependeDe: i > 0 ? [PASSOS[f.key][i - 1].key] : [],
          diasParaIniciar: 2, diasAposCobranca: 1, escalarApos: 2,
        },
      })
      if (f.key === "emissao_documental" && p.key === "solicitar_certidao") {
        const SUBS = [
          { key: "enviar_requerimento", label: "Enviar requerimento", ordem: 0, espera: false, dependeDe: [] as string[] },
          { key: "aguardar_retorno", label: "Aguardar retorno do cartório", ordem: 1, espera: true, dependeDe: ["enviar_requerimento"] },
        ]
        for (const s of SUBS) {
          const sub = await prisma.stepSubtaskDefinition.create({
            data: { stepId: step.id, key: s.key, label: s.label, ordem: s.ordem, esperaExternaAoLiberar: s.espera, acompanhamentoAtivo: s.espera, acompanhamentoPrimeiroDias: s.espera ? 5 : null, dependeDe: s.dependeDe },
          })
          await prisma.stepAction.create({ data: { stepId: step.id, subtaskId: sub.id, key: "concluir", label: "Concluir", ordem: 1, effectKey: "COMPLETE_STEP" } })
        }
      }
    }
    const pub = await publicarWorkflow({ workflowId: wf.id, actorId: null, pularCompetenciaDeEfeito: true })
    if (!pub.ok) throw new Error(`publicação do workflow ${f.key} falhou: ${JSON.stringify(pub).slice(0, 400)}`)
    // a UNIDADE de trabalho (perfil) aponta para o workflow de emissão publicado (nunca para um workflow vazio da mesma fase)
    if (f.key === "emissao_documental") await prisma.perfilOperacionalDocumento.updateMany({ where: { id: { in: [perfilCivil.id, perfilReq.id] } }, data: { workflowId: wf.id } })
  }
  log("cadastro: workflows publicados")
  return {
    adminId: adminBase.id, paises: { IT: it.id, ES: es.id }, tipos: { IT: tipoIt.id, ES: tipoEs.id }, modalidades: { IT: modIt.id, ES: modEs.id },
    perfis: { civil: perfilCivil.id, requerente: perfilReq.id }, usuarios: {}, orgaos: {},
  }
}

// ============================================================================
// B. EQUIPE (7 não-admin: limite de carga, aptidão por unidade e por país, 1 ausência vigente e 1 futura) e ÓRGÃOS
// ============================================================================
const PERMISSOES_EXECUTOR = {
  "arvore.ver": true, "arvore.criar": true, "arvore.editar": true, "clientes.ver": true, "eventos.ver": true,
  "processos.ver": true, "processos.ver_paginas": true, "processos.editar": true,
  "tarefas.ver": true, "tarefas.criar": true, "tarefas.iniciar_concluir": true, "tarefas.bloquear": true,
  "documentos.ver": true, "documentos.editar": true,
  "workflow.iniciarPasso": true, "workflow.concluirPasso": true, "workflow.gerarTarefa": true, "workflow.dispensarPasso": true,
}
const EQUIPE: Array<{ chave: string; nome: string; limite: number; paises: Array<"IT" | "ES">; unidades: Array<"civil" | "requerente"> }> = [
  { chave: "daniela", nome: "Daniela Brait", limite: 80, paises: ["IT", "ES"], unidades: ["civil", "requerente"] },
  { chave: "priscila", nome: "Priscila Tavares", limite: 150, paises: ["IT", "ES"], unidades: ["civil", "requerente"] },
  { chave: "rafael", nome: "Rafael Souza", limite: 150, paises: ["ES"], unidades: ["civil"] },
  { chave: "beatriz", nome: "Beatriz Gerbi", limite: 60, paises: ["IT"], unidades: ["civil", "requerente"] },
  { chave: "tiago", nome: "Tiago Pellegrini", limite: 100, paises: ["IT", "ES"], unidades: ["civil"] },
  { chave: "camila", nome: "Camila Fontana", limite: 150, paises: ["IT"], unidades: ["civil", "requerente"] },
  { chave: "lucas", nome: "Lucas Ferraz", limite: 40, paises: ["ES"], unidades: ["requerente"] },
]
async function equipe(cad: Cad) {
  log("equipe…")
  for (const e of EQUIPE) {
    const u = await prisma.usuario.create({ data: { nome: e.nome, email: `${e.chave}@palco.test`, senha: "x", tipo: "assistente", permissoesCustom: PERMISSOES_EXECUTOR } })
    cad.usuarios[e.chave] = u.id
    const r1 = await definirAptidoes(u.id, e.unidades.map((k) => cad.perfis[k]))
    if (!r1.ok) throw new Error(r1.erro)
    const r2 = await definirAptidoesPais(u.id, e.paises.map((k) => cad.paises[k]), cad.adminId)
    if (!r2.ok) throw new Error(r2.erro)
    const r3 = await definirCapacidade({ usuarioId: u.id, limiteExecutaveis: e.limite, autorId: cad.adminId })
    if (!r3.ok) throw new Error(r3.erro)
  }
}

const CATEGORIAS = [
  { code: "CARTORIO", nome: "Cartório", rotuloBola: "Cartório" },
  { code: "TRADUTOR", nome: "Tradutor juramentado", rotuloBola: "Tradutor" },
  { code: "JUIZO", nome: "Juízo", rotuloBola: "Juízo" },
  { code: "CONSULADO", nome: "Consulado", rotuloBola: "Consulado" },
] as const
type CatCode = (typeof CATEGORIAS)[number]["code"]
const ORGAOS: Array<{ chave: string; name: string; cat: CatCode; pais: "IT" | "ES" | null; city: string; state: string; email: string; canal: string }> = [
  { chave: "caxias", name: "Cartório de Registro Civil de Caxias do Sul", cat: "CARTORIO", pais: null, city: "Caxias do Sul", state: "RS", email: "civil@cartorio-caxias.example", canal: "CRC" },
  { chave: "poa4", name: "4ª Zona de Registro Civil de Porto Alegre", cat: "CARTORIO", pais: null, city: "Porto Alegre", state: "RS", email: "quarta.zona@cartorio-poa.example", canal: "ECARTORIO" },
  { chave: "santos1", name: "1º Ofício de Registro Civil de Santos", cat: "CARTORIO", pais: null, city: "Santos", state: "SP", email: "primeiro.oficio@cartorio-santos.example", canal: "EMAIL" },
  { chave: "vicenza", name: "Comune di Vicenza — Stato Civile", cat: "CARTORIO", pais: "IT", city: "Vicenza", state: "Veneto", email: "statocivile@comune-vicenza.example", canal: "COMUNE" },
  { chave: "treviso", name: "Comune di Treviso — Anagrafe", cat: "CARTORIO", pais: "IT", city: "Treviso", state: "Veneto", email: "anagrafe@comune-treviso.example", canal: "COMUNE" },
  { chave: "bergamo", name: "Comune di Bergamo — Ufficio Anagrafe", cat: "CARTORIO", pais: "IT", city: "Bergamo", state: "Lombardia", email: "anagrafe@comune-bergamo.example", canal: "EMAIL" },
  { chave: "granada", name: "Registro Civil de Granada", cat: "CARTORIO", pais: "ES", city: "Granada", state: "Andalucía", email: "registrocivil@granada.example", canal: "EMAIL" },
  { chave: "vigo", name: "Registro Civil de Vigo", cat: "CARTORIO", pais: "ES", city: "Vigo", state: "Galicia", email: "registrocivil@vigo.example", canal: "EMAIL" },
  { chave: "tribRoma", name: "Tribunale Ordinario di Roma — Sezione Cittadinanza", cat: "JUIZO", pais: "IT", city: "Roma", state: "Lazio", email: "cittadinanza@tribunale-roma.example", canal: "EMAIL" },
  { chave: "juzgadoMadrid", name: "Juzgado de Primera Instancia nº 14 de Madrid", cat: "JUIZO", pais: "ES", city: "Madrid", state: "Madrid", email: "primera.instancia14@juzgado-madrid.example", canal: "EMAIL" },
  { chave: "consItalia", name: "Consolato Generale d'Italia em São Paulo", cat: "CONSULADO", pais: "IT", city: "São Paulo", state: "SP", email: "cittadinanza.sanpaolo@consolato.example", canal: "CONSULADO" },
  { chave: "consEspanha", name: "Consulado-Geral da Espanha em São Paulo", cat: "CONSULADO", pais: "ES", city: "São Paulo", state: "SP", email: "memoria.democratica@consulado-es.example", canal: "CONSULADO" },
  { chave: "tradIt", name: "Studio Traduzioni Giurate Veneto", cat: "TRADUTOR", pais: "IT", city: "Padova", state: "Veneto", email: "traduzioni@studio-veneto.example", canal: "EMAIL" },
  { chave: "tradEs", name: "Traductores Jurados Hispano-Brasileños", cat: "TRADUTOR", pais: "ES", city: "Madrid", state: "Madrid", email: "contacto@traductores-hb.example", canal: "EMAIL" },
]
async function orgaos(cad: Cad) {
  log("órgãos e categorias…")
  const cats = new Map<string, number>()
  for (const [i, c] of CATEGORIAS.entries()) {
    const cat = await prisma.categoriaOrganizacao.create({ data: { code: `${MARCA}_${c.code}`, nome: c.nome, rotuloBola: c.rotuloBola, ordem: i + 1 } })
    cats.set(c.code, cat.id)
  }
  for (const o of ORGAOS) {
    const org = await prisma.orgaoProtocolo.create({
      data: {
        name: o.name, type: o.cat === "CARTORIO" ? "cartorio" : o.cat === "JUIZO" ? "tribunal" : o.cat === "CONSULADO" ? "consulado" : "tradutor",
        paisId: o.pais ? cad.paises[o.pais] : null, city: o.city, state: o.state, email: o.email, funcoes: ["ORGAO"], ativo: true,
        categorias: { create: [{ categoriaId: cats.get(o.cat)! }] },
      },
    })
    cad.orgaos[o.chave] = org.id
  }
}

// ============================================================================
// C. FAMÍLIAS / PROCESSOS
// ============================================================================
const NOMES_M = { IT: ["Giovanni", "Antonio", "Luigi", "Pietro", "Giuseppe", "Domenico", "Angelo", "Bruno"], ES: ["Manuel", "José", "Francisco", "Antonio", "Joaquín", "Ramón", "Ángel", "Santiago"] } as const
const NOMES_F = { IT: ["Maria", "Teresa", "Giulia", "Rosa", "Angela", "Lucia", "Carolina", "Elena"], ES: ["María", "Carmen", "Josefa", "Dolores", "Pilar", "Concepción", "Rosario", "Mercedes"] } as const
const NOMES_BR = ["Ricardo", "Fernanda", "Marcelo", "Patrícia", "André", "Juliana", "Eduardo", "Mariana", "Rogério", "Cristina"] as const
const CIDADES = { IT: ["Vicenza", "Treviso", "Bergamo", "Belluno", "Brescia", "Udine"], ES: ["Granada", "Vigo", "Sevilla", "Oviedo", "Pontevedra", "Valencia"] } as const

interface Ids { arvoreId: number; processoId: number; familiaId: number; requerenteIds: number[]; pessoaIds: number[] }

interface SpecFamilia {
  sobrenome: string
  pais: "IT" | "ES"
  /** gerações ascendentes na linha reta ACIMA do requerente (1 = pais; 3 = pais, avós, bisavós). */
  geracoes: 1 | 2 | 3
  nReq: 1 | 2 | 3
  /** quantas gerações acima do requerente já faleceram (as mais antigas). */
  falecidos: number
}

/**
 * Árvore + requerente(s) + processo (criarProcessoV2) + necessidades/documentos/tarefas da Genealogia.
 * A árvore é gravada direto e depois convergida pelo reconciliador OFICIAL (materializarGenealogia + reconciliarTarefas),
 * o mesmo caminho do cadastro inicial de uma família.
 */
async function montarFamilia(cad: Cad, spec: SpecFamilia, indice: number): Promise<Ids> {
  const { sobrenome, pais } = spec
  const familia = await prisma.familia.create({ data: { nome: `Família ${sobrenome}` } })
  const arv = await prisma.arvore.create({ data: { nome: `Árvore ${sobrenome}`, familiaId: familia.id } })
  const cidade = (k: number) => CIDADES[pais][(indice + k) % CIDADES[pais].length]
  const ano0 = 1978 + (indice % 14)
  const nomeBR = (k: number) => NOMES_BR[(indice + k) % NOMES_BR.length]
  const pessoaIds: number[] = []
  const novaPessoa = async (d: { nome: string; sexo: "M" | "F"; ano: number; vivo: boolean; linhaReta: boolean; requerente?: "maior" | "nao"; casado?: boolean; italiano?: boolean; paiId?: number | null; maeId?: number | null }) => {
    const p = await prisma.pessoa.create({
      data: {
        arvoreId: arv.id, nome: d.nome, sobrenome, sexo: d.sexo, data_nasc: new Date(Date.UTC(d.ano, (indice * 3) % 12, 1 + (indice % 27))),
        vivo: d.vivo, ...(d.vivo ? {} : { data_obito: new Date(Date.UTC(d.ano + 62 + (indice % 9), 4, 10)) }),
        linhaReta: d.linhaReta, requerente: d.requerente ?? "nao", casado: !!d.casado, documentacao: true,
        paiId: d.paiId ?? null, maeId: d.maeId ?? null,
        ...(d.italiano ? { local_nasc: cidade(0), pais_nasc: pais === "IT" ? "Itália" : "Espanha", nacionalidade: pais === "IT" ? "Italiana" : "Espanhola" } : { local_nasc: "Caxias do Sul", estado_nasc: "RS", pais_nasc: "Brasil", nacionalidade: "Brasileira" }),
      },
      select: { id: true },
    })
    pessoaIds.push(p.id)
    return p.id
  }
  // gerações do topo (mais antiga) para baixo, para já ter os pais ao criar os filhos
  type Casal = { paiId: number; maeId: number }
  let acima: Casal | null = null
  for (let g = spec.geracoes; g >= 1; g--) {
    const vivo = (spec.geracoes - g) >= spec.falecidos // as mais antigas faleceram primeiro
    const ano = ano0 - 28 * g
    const m = NOMES_M[pais][(indice + g) % NOMES_M[pais].length]
    const f = NOMES_F[pais][(indice + g + 1) % NOMES_F[pais].length]
    const paiId = await novaPessoa({ nome: m, sexo: "M", ano, vivo, linhaReta: true, casado: true, italiano: g === spec.geracoes, paiId: acima?.paiId ?? null, maeId: acima?.maeId ?? null })
    const maeId = await novaPessoa({ nome: f, sexo: "F", ano: ano + 2, vivo, linhaReta: true, casado: true, italiano: g === spec.geracoes })
    await prisma.uniao.create({ data: { pessoa1Id: paiId, pessoa2Id: maeId, tipo: "casamento_civil", data_inicio: new Date(Date.UTC(ano + 24, 5, 12)), local: cidade(g) } })
    acima = { paiId, maeId }
  }
  // requerente(s): o 1º é linha reta (filho do casal mais novo); os demais são irmãos
  const reqs: number[] = []
  for (let r = 0; r < spec.nReq; r++) {
    const id = await novaPessoa({ nome: nomeBR(r), sexo: r % 2 === 0 ? "M" : "F", ano: ano0 + r * 3, vivo: true, linhaReta: r === 0, requerente: "maior", paiId: acima!.paiId, maeId: acima!.maeId })
    reqs.push(id)
  }
  await recalcularNumerosLinhagemDaArvore(arv.id)

  const requerenteIds: number[] = []
  for (const pid of reqs) {
    const p = await prisma.pessoa.findUniqueOrThrow({ where: { id: pid }, select: { nome: true, sobrenome: true } })
    const rq = await prisma.requerente.create({
      data: { nome: `${p.nome} ${p.sobrenome}`, personId: pid, nacionalidade: "Brasileira", pais: "Brasil", email: `${p.nome.toLowerCase()}.${sobrenome.toLowerCase().replace(/[^a-z]/g, "")}@exemplo.test` },
      select: { id: true },
    })
    requerenteIds.push(rq.id)
  }

  const criado = await criarProcessoV2({
    nome: `Família ${sobrenome}`, pais: pais === "IT" ? "ITALIA" : "ESPANHA", tipoProcessoMotorId: cad.tipos[pais], modalidadeId: cad.modalidades[pais],
    arvoreId: arv.id, requerenteIds, idempotencyKey: `${MARCA}-fam-${indice}`, solicitadoPorId: cad.adminId,
  })
  if (!criado.success) throw new Error(`criarProcessoV2(${sobrenome}) falhou: ${criado.code} ${criado.message}`)
  const familiaIdDoProcesso = familia.id
  await prisma.processo.update({ where: { id: criado.processId }, data: { familiaId: familiaIdDoProcesso } })
  await materializarGenealogia(criado.processId)
  await reconciliarTarefas({ processoId: criado.processId })
  return { arvoreId: arv.id, processoId: criado.processId, familiaId: familia.id, requerenteIds, pessoaIds }
}

async function irParaFase(cad: Cad, processoId: number, faseAlvo: string, preservarHistorico = false) {
  const r = await movePhaseManual(processoId, { faseAlvo, justificativa: MOTIVO, motivoCodigo: "PALCO", solicitadoPorId: cad.adminId, preservarHistorico, origem: "palco" })
  if (!r.success) throw new Error(`movePhaseManual(${processoId} -> ${faseAlvo}): ${JSON.stringify(r).slice(0, 300)}`)
}

async function resumo(processoId: number): Promise<string> {
  const p = await prisma.processo.findUniqueOrThrow({ where: { id: processoId }, select: { codigo: true, faseAtualKey: true } })
  const nec = await prisma.necessidadeDocumental.count({ where: { processoId } })
  const doc = await prisma.documento.count({ where: { pessoa: { arvore: { processos: { some: { id: processoId } } } } } })
  const t = await prisma.tarefa.groupBy({ by: ["faseMacroKey", "statusTarefa"], where: { processoId }, _count: true })
  return `${p.codigo} fase=${p.faseAtualKey} nec=${nec} doc=${doc} tarefas=${JSON.stringify(t.map((x) => `${x.faseMacroKey}/${x.statusTarefa}:${x._count}`))}`
}

// ============================================================================
// D. ESTADO DE CADA TAREFA (pelas portas oficiais; datas passadas por UPDATE)
// ============================================================================
type EstadoTarefa = "A_INICIAR" | "EM_ANDAMENTO" | "AGUARDANDO_TERCEIRO" | "AGUARDANDO_CLIENTE" | "BLOQUEADA" | "CONCLUIDA" | "CANCELADA" | "NAO_EXIGIDA"
interface Plano {
  estado: EstadoTarefa
  /** responsável (chave da equipe); ausente/null = sem responsável */
  dono?: string | null
  /** prazo em dias a partir de hoje (negativo = atrasada); null = sem prazo; ausente = deixa o que o motor gravou */
  prazo?: number | null
  prioridade?: "BAIXA" | "MEDIA" | "ALTA" | "URGENTE"
  /** AGUARDANDO_TERCEIRO: órgão (chave), há quantos dias foi pedido, cobranças SEM resposta já feitas e há quantos dias foi a última */
  orgao?: string
  pedidoHa?: number
  semResposta?: number
  ultimaCobrancaHa?: number
  /** próximo acompanhamento (dias a partir de hoje; negativo = vencido) */
  cobrarEm?: number
  canal?: "CRC" | "ECARTORIO" | "EMAIL" | "WHATSAPP" | "BALCAO" | "COMUNE" | "CORREIOS" | "CONSULADO"
  /** EM_ANDAMENTO/etc.: há quantos dias iniciou; CONCLUIDA/CANCELADA: há quantos dias terminou */
  haDias?: number
  /** motivo (BLOQUEADA, CANCELADA, AGUARDANDO_CLIENTE) */
  motivo?: string
  /** órgão a vincular mesmo sem estar aguardando (ex.: para "bola com" futura) */
  vincularOrgao?: string
}

const CANAL_DE_CONTATO = { CRC: "EMAIL", ECARTORIO: "EMAIL", EMAIL: "EMAIL", WHATSAPP: "WHATSAPP", BALCAO: "PRESENCIAL", COMUNE: "EMAIL", CORREIOS: "OFICIO", CONSULADO: "EMAIL" } as const

async function aplicarPlano(cad: Cad, tarefaId: number, plano: Plano, idx: number) {
  const t = await prisma.tarefa.findUniqueOrThrow({
    where: { id: tarefaId },
    select: { id: true, titulo: true, processoId: true, faseMacroKey: true, documentoId: true, pessoaId: true, workflowStepInstanceId: true, workflowInstanceId: true, documento: { select: { pessoaId: true } } },
  })
  const donoId = plano.dono ? cad.usuarios[plano.dono] : null
  if (plano.dono && !donoId) throw new Error(`dono desconhecido: ${plano.dono}`)
  if (donoId) {
    const r = await atribuirTarefa({ tarefaId, responsavelId: donoId, autorId: cad.adminId, motivo: MOTIVO })
    if (!r.ok) throw new Error(`atribuir ${tarefaId}: ${r.mensagem}`)
    await prisma.tarefa.update({ where: { id: tarefaId }, data: { dataAtribuicao: em(-(2 + (idx % 9))) } })
  }
  const autor = donoId ?? cad.adminId
  const ctx = { origem: "USER" as const, usuarioId: autor }
  const orgaoChave = plano.orgao ?? plano.vincularOrgao
  if (orgaoChave) {
    const orgaoId = cad.orgaos[orgaoChave]
    if (!orgaoId) throw new Error(`órgão desconhecido: ${orgaoChave}`)
    // o mesmo vínculo da porta "Vincular órgão" (Documento.orgaoId + Tarefa.orgaoId)
    if (t.documentoId) await prisma.documento.update({ where: { id: t.documentoId }, data: { orgaoId } })
    await prisma.tarefa.update({ where: { id: tarefaId }, data: { orgaoId } })
  }
  const stepId = t.workflowStepInstanceId
  switch (plano.estado) {
    case "A_INICIAR": break
    case "EM_ANDAMENTO": {
      const r = await iniciarTarefaSync(tarefaId, ctx)
      if (!r.success) throw new Error(`iniciar ${tarefaId}: ${JSON.stringify(r).slice(0, 200)}`)
      const quando = em(-(plano.haDias ?? 1))
      await prisma.tarefa.update({ where: { id: tarefaId }, data: { dataInicio: quando } })
      if (stepId) await prisma.phaseWorkflowStepInstance.update({ where: { id: stepId }, data: { startedAt: quando } })
      break
    }
    case "AGUARDANDO_TERCEIRO": {
      const pedidoHa = plano.pedidoHa ?? 5
      const dataEnvio = em(-pedidoHa)
      const orgaoId = cad.orgaos[plano.orgao ?? "caxias"]
      const previsao = plano.prazo != null ? em(plano.prazo, 15) : new Date(dataEnvio.getTime() + 15 * DIA)
      const diasEsperados = Math.max(1, Math.round((previsao.getTime() - dataEnvio.getTime()) / DIA))
      const comSubtarefas = t.faseMacroKey === "emissao_documental" && !!stepId && !!t.documentoId
      if (t.documentoId) {
        await prisma.solicitacaoDocumento.create({
          data: {
            documentoId: t.documentoId, processoId: t.processoId!, pessoaId: t.documento?.pessoaId ?? t.pessoaId!, faseMacroKey: t.faseMacroKey ?? "emissao_documental",
            workflowInstanceId: t.workflowInstanceId, stepInstanceId: stepId, tarefaId, canal: plano.canal ?? "EMAIL", orgaoId,
            dataEnvio, prazoEsperadoDias: diasEsperados, previsaoRetorno: previsao, criadoPorId: autor,
            status: "AGUARDANDO_PROTOCOLO", chaveIdempotencia: `${MARCA}-sol-${tarefaId}`,
          },
        })
      }
      if (comSubtarefas) {
        const r = await concluirSubtarefaCorrentePeloPasso({ stepInstanceId: stepId!, executadoPorId: autor, payload: {}, canalKey: plano.canal ?? "EMAIL", fornecedorId: orgaoId })
        if (!r.aplicavel) throw new Error(`concluir subtarefa de envio ${tarefaId}: ${r.motivo}`)
        await prisma.subtaskExecution.updateMany({ where: { stepInstanceId: stepId! }, data: { startedAt: dataEnvio } })
        await prisma.subtaskExecution.updateMany({ where: { stepInstanceId: stepId!, subtaskKey: "enviar_requerimento" }, data: { completedAt: dataEnvio, enviadoEm: dataEnvio } })
        await prisma.subtaskExecution.updateMany({ where: { stepInstanceId: stepId!, subtaskKey: "aguardar_retorno" }, data: { enviadoEm: dataEnvio, startedAt: dataEnvio, previstoPara: previsao } })
        for (let i = 0; i < (plano.semResposta ?? 0); i++) {
          const quando = em(-((plano.ultimaCobrancaHa ?? 2) + ((plano.semResposta ?? 0) - 1 - i) * 7))
          const c = await registrarCobranca({
            stepInstanceId: stepId!, subtaskKey: "aguardar_retorno", canal: CANAL_DE_CONTATO[plano.canal ?? "EMAIL"], resultado: "SEM_RESPOSTA",
            observacao: "Cobrança registrada no palco", documentoId: t.documentoId, orgaoId, registradoPorId: autor, dataContato: quando,
          })
          if (!c.ok) throw new Error(`cobrança ${tarefaId}: ${c.motivo}`)
        }
        if (plano.cobrarEm != null) await prisma.subtaskExecution.updateMany({ where: { stepInstanceId: stepId!, subtaskKey: "aguardar_retorno" }, data: { proximoAcompanhamentoEm: em(plano.cobrarEm) } })
      } else {
        // fases sem subtarefa de espera (tradução, apostilamento, retificação…): a espera é a do próprio status da tarefa
        const r = await aguardarTerceiro({ tarefaId, autorId: autor, motivo: plano.motivo ?? "Aguardando retorno do terceiro" })
        if (!r.ok) throw new Error(`aguardar ${tarefaId}: ${r.mensagem}`)
      }
      await prisma.tarefa.update({ where: { id: tarefaId }, data: { dataInicio: dataEnvio, ...(plano.prazo !== undefined ? { dataPrazo: plano.prazo === null ? null : em(plano.prazo, 15) } : { dataPrazo: previsao }) } })
      if (stepId) await prisma.phaseWorkflowStepInstance.update({ where: { id: stepId }, data: { startedAt: dataEnvio } })
      await prisma.logAuditoria.updateMany({ where: { entidade: "Tarefa", entidadeId: tarefaId, acao: "TAREFA_AGUARDANDO_TERCEIRO" }, data: { criadoEm: dataEnvio } })
      // o caminho automático (passo que nasce em espera) só grava o evento de workflow: é dele que sai "desde quando a bola está lá"
      await prisma.workflowEvento.updateMany({ where: { entityType: "tarefa", entityId: tarefaId, tipo: "TAREFA_BLOQUEADA" }, data: { criadoEm: dataEnvio } })
      break
    }
    case "AGUARDANDO_CLIENTE": {
      const r = await aguardarTerceiro({ tarefaId, autorId: autor, motivo: plano.motivo ?? "Aguardando o cliente enviar a documentação" })
      if (!r.ok) throw new Error(`aguardar ${tarefaId}: ${r.mensagem}`)
      // o cliente (não um terceiro): único estado que o motor já não grava sozinho — vira por UPDATE só neste banco
      await prisma.tarefa.update({ where: { id: tarefaId }, data: { statusTarefa: "AGUARDANDO_CLIENTE", dataInicio: em(-(plano.haDias ?? 4)) } })
      await prisma.logAuditoria.updateMany({ where: { entidade: "Tarefa", entidadeId: tarefaId, acao: "TAREFA_AGUARDANDO_TERCEIRO" }, data: { criadoEm: em(-(plano.haDias ?? 4)) } })
      break
    }
    case "BLOQUEADA": {
      const r = await bloquearTarefa({ tarefaId, autorId: autor, motivo: plano.motivo ?? "Documento do cliente ilegível — pedir novo envio" })
      if (!r.ok) throw new Error(`bloquear ${tarefaId}: ${r.mensagem}`)
      await prisma.logAuditoria.updateMany({ where: { entidade: "Tarefa", entidadeId: tarefaId, acao: "TAREFA_BLOQUEADA" }, data: { criadoEm: em(-(plano.haDias ?? 3)) } })
      break
    }
    case "CONCLUIDA": {
      // a OBRIGAÇÃO só está concluída quando TODOS os passos dela estão (a régua de `obrigacaoConcluidaNaFase`):
      // conclui-se cada passo da unidade, em ordem, pela porta de passo — a tarefa acompanha.
      if (stepId) {
        const passo = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: stepId }, select: { processoId: true, faseMacroKey: true, documentoId: true, necessidadeId: true, ciclo: true } })
        const unidade = await prisma.phaseWorkflowStepInstance.findMany({
          where: { processoId: passo.processoId, faseMacroKey: passo.faseMacroKey, ciclo: passo.ciclo, documentoId: passo.documentoId, necessidadeId: passo.necessidadeId, status: { notIn: ["CONCLUIDO", "CANCELADO", "SUPERSEDIDO", "DISPENSADO"] } },
          orderBy: { ordem: "asc" }, select: { id: true },
        })
        for (const u of unidade) {
          const rp = await concluirPasso(u.id, ctx)
          if (!rp.success) throw new Error(`concluir passo ${u.id} (tarefa ${tarefaId}): ${JSON.stringify(rp).slice(0, 200)}`)
        }
      }
      const atual = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaId }, select: { statusTarefa: true } })
      if (!atual.statusTarefa.startsWith("CONCLUIDO")) {
        const r = await concluirTarefaSync(tarefaId, ctx)
        if (!r.success) throw new Error(`concluir ${tarefaId}: ${JSON.stringify(r).slice(0, 200)}`)
      }
      const quando = em(-(plano.haDias ?? 3))
      await prisma.tarefa.update({ where: { id: tarefaId }, data: { dataConclusao: quando, dataInicio: em(-((plano.haDias ?? 3) + 4)) } })
      await prisma.workflowEvento.updateMany({ where: { entityType: "tarefa", entityId: tarefaId, tipo: "TAREFA_CONCLUIDA" }, data: { criadoEm: quando } })
      break
    }
    case "CANCELADA": {
      const r = await cancelarTarefa({ tarefaId, autorId: cad.adminId, motivo: plano.motivo ?? "Documento não necessário para este processo" })
      if (!r.ok) throw new Error(`cancelar ${tarefaId}: ${r.mensagem}`)
      const quando = em(-(plano.haDias ?? 1))
      await prisma.tarefa.update({ where: { id: tarefaId }, data: { dataConclusao: quando } })
      await prisma.logAuditoria.updateMany({ where: { entidade: "Tarefa", entidadeId: tarefaId, acao: "TAREFA_CANCELADA" }, data: { criadoEm: quando } })
      break
    }
    case "NAO_EXIGIDA": break // tratada por `dispensarPelaArvore` (muda a árvore, não a tarefa)
  }
  // prazo e prioridade (configuração da tarefa; para AGUARDANDO com solicitação, o prazo de leitura é o da solicitação)
  const data: { dataPrazo?: Date | null; prioridade?: "BAIXA" | "MEDIA" | "ALTA" | "URGENTE" } = {}
  if (plano.prazo !== undefined) data.dataPrazo = plano.prazo === null ? null : em(plano.prazo, 15)
  if (plano.prioridade) data.prioridade = plano.prioridade
  if (Object.keys(data).length && !["CONCLUIDA", "CANCELADA"].includes(plano.estado)) await prisma.tarefa.update({ where: { id: tarefaId }, data })
}

// ============================================================================
// E. AS 28 FAMÍLIAS (fase, tamanho da árvore, tempo na fase e o estado das tarefas)
// ============================================================================
const x = (n: number, plano: Plano): Plano[] => Array.from({ length: n }, () => ({ ...plano }))
const SEM_DONO = null

interface FamiliaDoPalco extends SpecFamilia {
  fase: string
  /** dias desde que o processo entrou na fase atual */
  diasNaFase: number
  /** planos aplicados às tarefas da FASE ATUAL, na ordem; o que sobrar recebe o plano padrão */
  planos?: Plano[]
  /** passa por esta fase intermediária e a deixa com tarefas abertas (preservarHistorico) -> "fase deixada" */
  deixaFase?: string
  /** quantas uniões a árvore deixa de exigir (casado -> solteiro): documento NÃO EXIGIDO */
  naoExigidas?: number
  pausado?: { haDias: number; motivo: string }
  divergencia?: boolean
  semDonoNoRestante?: boolean
}

const FAMILIAS: FamiliaDoPalco[] = [
  // ── Genealogia ──
  { sobrenome: "Moretti", pais: "IT", fase: "genealogia", geracoes: 2, nReq: 1, falecidos: 1, diasNaFase: 6,
    planos: [...x(2, { estado: "CONCLUIDA", haDias: 2 }), ...x(1, { estado: "EM_ANDAMENTO", haDias: 2 }), ...x(2, { estado: "AGUARDANDO_CLIENTE", motivo: "Esperando o cliente enviar o registro de batismo", haDias: 3 })] },
  { sobrenome: "Villaverde", pais: "ES", fase: "genealogia", geracoes: 3, nReq: 2, falecidos: 2, diasNaFase: 38,
    planos: [...x(3, { estado: "A_INICIAR", dono: SEM_DONO, prazo: -6, prioridade: "ALTA" }), ...x(2, { estado: "BLOQUEADA", haDias: 20, motivo: "Cliente não enviou o documento do bisavô" }),
      ...x(4, { estado: "AGUARDANDO_CLIENTE", haDias: 30, motivo: "Esperando o cliente confirmar a data de casamento" }), { estado: "EM_ANDAMENTO", haDias: 25, prazo: -10 }] },
  { sobrenome: "Ferrante", pais: "IT", fase: "genealogia", geracoes: 1, nReq: 3, falecidos: 0, diasNaFase: 2, semDonoNoRestante: true },
  { sobrenome: "Quintana", pais: "ES", fase: "genealogia", geracoes: 2, nReq: 1, falecidos: 0, diasNaFase: 12,
    planos: [...x(2, { estado: "CONCLUIDA", haDias: 4 }), ...x(3, { estado: "EM_ANDAMENTO", haDias: 3 })] },
  // ── Emissão documental ──
  { sobrenome: "Lombardi", pais: "IT", fase: "emissao_documental", geracoes: 3, nReq: 2, falecidos: 2, diasNaFase: 25, naoExigidas: 1,
    planos: [{ estado: "CONCLUIDA", haDias: 4 }, { estado: "CONCLUIDA", haDias: 6 }, { estado: "CONCLUIDA", haDias: 9 },
      ...x(2, { estado: "EM_ANDAMENTO", haDias: 2, prazo: 2 }),
      ...x(3, { estado: "AGUARDANDO_TERCEIRO", orgao: "vicenza", canal: "COMUNE", pedidoHa: 21, semResposta: 2, ultimaCobrancaHa: 2, cobrarEm: -1, prazo: -3 }),
      ...x(2, { estado: "AGUARDANDO_TERCEIRO", orgao: "treviso", canal: "COMUNE", pedidoHa: 6, prazo: 9, cobrarEm: 1 }),
      ...x(2, { estado: "AGUARDANDO_TERCEIRO", orgao: "caxias", canal: "CRC", pedidoHa: 11, semResposta: 1, ultimaCobrancaHa: 4, cobrarEm: 0, prazo: 4 }),
      { estado: "BLOQUEADA", haDias: 5, motivo: "Certidão do cliente com nome divergente — pedir nova via" }, { estado: "CANCELADA", haDias: 1 }] },
  { sobrenome: "Echevarría", pais: "ES", fase: "emissao_documental", geracoes: 3, nReq: 1, falecidos: 1, diasNaFase: 41,
    planos: [...x(4, { estado: "AGUARDANDO_TERCEIRO", orgao: "granada", canal: "EMAIL", pedidoHa: 33, semResposta: 2, ultimaCobrancaHa: 3, cobrarEm: -2, prazo: -8 }),
      ...x(2, { estado: "AGUARDANDO_TERCEIRO", orgao: "vigo", canal: "EMAIL", pedidoHa: 28, semResposta: 3, ultimaCobrancaHa: 1, cobrarEm: 2, prazo: -5 }),
      ...x(2, { estado: "EM_ANDAMENTO", haDias: 9, prazo: -1 }), { estado: "CANCELADA", haDias: 3 }] },
  { sobrenome: "Castellani", pais: "IT", fase: "emissao_documental", geracoes: 2, nReq: 1, falecidos: 0, diasNaFase: 9, naoExigidas: 1,
    planos: [...x(2, { estado: "CONCLUIDA", haDias: 2 }), ...x(3, { estado: "AGUARDANDO_TERCEIRO", orgao: "bergamo", canal: "EMAIL", pedidoHa: 5, prazo: 10, cobrarEm: 2 }), { estado: "EM_ANDAMENTO", haDias: 1, prazo: 3 }] },
  { sobrenome: "Mendizábal", pais: "ES", fase: "emissao_documental", geracoes: 2, nReq: 2, falecidos: 1, diasNaFase: 17,
    planos: [...x(5, { estado: "A_INICIAR", dono: SEM_DONO, prazo: 0, prioridade: "URGENTE" }), ...x(2, { estado: "AGUARDANDO_TERCEIRO", orgao: "santos1", canal: "EMAIL", pedidoHa: 9, prazo: 6, cobrarEm: 3 }), ...x(2, { estado: "CONCLUIDA", haDias: 5 })] },
  { sobrenome: "Bellandi", pais: "IT", fase: "emissao_documental", geracoes: 2, nReq: 1, falecidos: 2, diasNaFase: 52, semDonoNoRestante: true,
    planos: [...x(2, { estado: "BLOQUEADA", haDias: 14, motivo: "Aguardando assinatura da procuração pelo cliente" }), ...x(2, { estado: "AGUARDANDO_CLIENTE", haDias: 40, motivo: "Cliente precisa confirmar o local de nascimento" }),
      ...x(3, { estado: "AGUARDANDO_TERCEIRO", orgao: "santos1", canal: "EMAIL", pedidoHa: 52, semResposta: 2, ultimaCobrancaHa: 5, cobrarEm: -10, prazo: -25 }), { estado: "CONCLUIDA", haDias: 12 }] },
  { sobrenome: "Larrañaga", pais: "ES", fase: "emissao_documental", geracoes: 1, nReq: 1, falecidos: 0, diasNaFase: 3,
    planos: [{ estado: "CONCLUIDA", haDias: 1 }, { estado: "CONCLUIDA", haDias: 2 }, { estado: "CONCLUIDA", haDias: 2 }, { estado: "CONCLUIDA", haDias: 3 }, { estado: "EM_ANDAMENTO", haDias: 1, prazo: 1 }] },
  { sobrenome: "Zanotti", pais: "IT", fase: "emissao_documental", geracoes: 3, nReq: 1, falecidos: 2, diasNaFase: 14, divergencia: true, naoExigidas: 1,
    planos: [...x(2, { estado: "CONCLUIDA", haDias: 3 }), ...x(2, { estado: "EM_ANDAMENTO", haDias: 4, prazo: 1 }),
      ...x(3, { estado: "AGUARDANDO_TERCEIRO", orgao: "treviso", canal: "COMUNE", pedidoHa: 12, prazo: 3, cobrarEm: 0, semResposta: 1, ultimaCobrancaHa: 6 }), { estado: "CANCELADA", haDias: 2 }] },
  { sobrenome: "Barroso", pais: "ES", fase: "emissao_documental", geracoes: 2, nReq: 1, falecidos: 0, diasNaFase: 20, pausado: { haDias: 6, motivo: "Cliente pediu para aguardar a decisão da família" },
    planos: [...x(3, { estado: "AGUARDANDO_TERCEIRO", orgao: "granada", canal: "EMAIL", pedidoHa: 20, prazo: -2, cobrarEm: -1 }), ...x(2, { estado: "EM_ANDAMENTO", haDias: 7, prazo: 2 })] },
  // ── Análise documental ──
  { sobrenome: "Righetti", pais: "IT", fase: "analise_documental", geracoes: 2, nReq: 1, falecidos: 1, diasNaFase: 5, deixaFase: "emissao_documental",
    planos: [{ estado: "EM_ANDAMENTO", haDias: 2, prazo: 2 }] },
  { sobrenome: "Iglesias", pais: "ES", fase: "analise_documental", geracoes: 1, nReq: 2, falecidos: 0, diasNaFase: 11,
    planos: [{ estado: "A_INICIAR", dono: SEM_DONO, prazo: -1, prioridade: "ALTA" }] },
  { sobrenome: "Pavanello", pais: "IT", fase: "analise_documental", geracoes: 2, nReq: 1, falecidos: 0, diasNaFase: 3, naoExigidas: 1,
    planos: [{ estado: "EM_ANDAMENTO", haDias: 1, prazo: 5 }] },
  // ── Retificação / Emissão retificada ──
  { sobrenome: "Tessaro", pais: "IT", fase: "retificacao_registros", geracoes: 2, nReq: 1, falecidos: 1, diasNaFase: 34,
    planos: [{ estado: "AGUARDANDO_TERCEIRO", orgao: "tribRoma", pedidoHa: 25, prazo: -2, motivo: "Aguardando o juízo decidir a retificação" }, { estado: "CONCLUIDA", haDias: 8 }] },
  { sobrenome: "Olmedo", pais: "ES", fase: "retificacao_registros", geracoes: 1, nReq: 1, falecidos: 0, diasNaFase: 70, semDonoNoRestante: true,
    planos: [{ estado: "AGUARDANDO_TERCEIRO", orgao: "juzgadoMadrid", dono: SEM_DONO, pedidoHa: 66, prazo: -30, motivo: "Aguardando sentença do juzgado" }, { estado: "BLOQUEADA", haDias: 40, motivo: "Falta o laudo de grafia do cartório" }] },
  { sobrenome: "Marchesini", pais: "IT", fase: "emissao_documental_retificada", geracoes: 2, nReq: 1, falecidos: 0, diasNaFase: 8,
    planos: [{ estado: "AGUARDANDO_TERCEIRO", orgao: "vicenza", pedidoHa: 7, prazo: 8, motivo: "Segunda via pedida ao comune" }, { estado: "EM_ANDAMENTO", haDias: 2, prazo: 4 }] },
  // ── Tradução juramentada ──
  { sobrenome: "Carraro", pais: "IT", fase: "traducao_juramentada", geracoes: 2, nReq: 1, falecidos: 1, diasNaFase: 12, deixaFase: "analise_documental",
    planos: [...x(4, { estado: "AGUARDANDO_TERCEIRO", orgao: "tradIt", pedidoHa: 8, prazo: 3, motivo: "Com a tradutora" }), ...x(3, { estado: "EM_ANDAMENTO", haDias: 2, prazo: 2 }), { estado: "CONCLUIDA", haDias: 2 }] },
  { sobrenome: "Valdés", pais: "ES", fase: "traducao_juramentada", geracoes: 2, nReq: 1, falecidos: 0, diasNaFase: 4,
    planos: [...x(5, { estado: "AGUARDANDO_TERCEIRO", orgao: "tradEs", pedidoHa: 3, prazo: 7, motivo: "Com a tradutora" }), ...x(2, { estado: "CONCLUIDA", haDias: 1 })] },
  { sobrenome: "Benavides", pais: "ES", fase: "traducao_juramentada", geracoes: 1, nReq: 1, falecidos: 0, diasNaFase: 22,
    planos: [...x(2, { estado: "AGUARDANDO_TERCEIRO", orgao: "tradEs", pedidoHa: 20, prazo: -4, motivo: "Com a tradutora" }), { estado: "BLOQUEADA", haDias: 6, motivo: "Tradutora pede o documento original em melhor resolução" }] },
  // ── Apostilamento ──
  { sobrenome: "Bortolotto", pais: "IT", fase: "apostilamento", geracoes: 2, nReq: 1, falecidos: 1, diasNaFase: 9,
    planos: [...x(3, { estado: "AGUARDANDO_TERCEIRO", orgao: "poa4", pedidoHa: 4, prazo: 5, motivo: "No cartório apostilador" }), ...x(3, { estado: "CONCLUIDA", haDias: 2 })] },
  { sobrenome: "Ledesma", pais: "ES", fase: "apostilamento", geracoes: 1, nReq: 1, falecidos: 0, diasNaFase: 27,
    planos: [...x(2, { estado: "AGUARDANDO_TERCEIRO", orgao: "santos1", pedidoHa: 25, prazo: -6, motivo: "No cartório apostilador" }), { estado: "EM_ANDAMENTO", haDias: 4, prazo: 1 }] },
  // ── Aguardando protocolo / Protocolado / Finalizado ──
  { sobrenome: "Dalla Costa", pais: "IT", fase: "aguardando_protocolo", geracoes: 2, nReq: 1, falecidos: 0, diasNaFase: 6,
    planos: [{ estado: "EM_ANDAMENTO", haDias: 2, prazo: 5 }, { estado: "A_INICIAR", prazo: 12 }] },
  { sobrenome: "Arriaga", pais: "ES", fase: "aguardando_protocolo", geracoes: 1, nReq: 1, falecidos: 0, diasNaFase: 45,
    planos: [{ estado: "AGUARDANDO_CLIENTE", haDias: 30, motivo: "Aguardando a procuração assinada e reconhecida" }, { estado: "A_INICIAR", dono: SEM_DONO, prazo: -7 }] },
  { sobrenome: "Zanchetta", pais: "IT", fase: "protocolado", geracoes: 2, nReq: 1, falecidos: 0, diasNaFase: 100,
    planos: [{ estado: "AGUARDANDO_TERCEIRO", orgao: "consItalia", pedidoHa: 100, prazo: null, motivo: "Protocolado no consulado — aguardando reconhecimento" }, { estado: "CONCLUIDA", haDias: 100 }] },
  { sobrenome: "Montoya", pais: "ES", fase: "protocolado", geracoes: 1, nReq: 1, falecidos: 0, diasNaFase: 130,
    planos: [{ estado: "AGUARDANDO_TERCEIRO", orgao: "consEspanha", pedidoHa: 130, prazo: null, motivo: "Protocolado no consulado — aguardando resolução" }, { estado: "CONCLUIDA", haDias: 130 }] },
  { sobrenome: "Fumagalli", pais: "IT", fase: "finalizado", geracoes: 1, nReq: 1, falecidos: 0, diasNaFase: 3,
    planos: [{ estado: "CONCLUIDA", haDias: 2 }] },
]

const DONOS_PADRAO = { IT: ["daniela", "priscila", "beatriz", "camila", "tiago"], ES: ["priscila", "rafael", "tiago", "lucas", "daniela"] } as const
const PRAZOS_PADRAO: Array<number | null> = [-4, -1, 0, 1, 3, 7, 7, 12, null, 25]
const PRIORIDADES_PADRAO = ["MEDIA", "ALTA", "MEDIA", "BAIXA", "MEDIA", "URGENTE", "MEDIA"] as const

/** Dispensa pela ÁRVORE (união que deixou de existir): documento NÃO EXIGIDO, necessidade DISPENSADA — a mesma porta do sistema. */
async function dispensarPelaArvore(cad: Cad, ids: Ids, quantas: number) {
  const unioes = await prisma.uniao.findMany({ where: { pessoa1Id: { in: ids.pessoaIds } }, orderBy: { id: "asc" }, select: { id: true, pessoa1Id: true, pessoa2Id: true } })
  for (const u of unioes.slice(0, quantas)) {
    await aplicarMudancaNaArvore({
      arvoreId: ids.arvoreId, autorId: cad.adminId,
      fn: async (tx) => { await tx.pessoa.updateMany({ where: { id: { in: [u.pessoa1Id, u.pessoa2Id] } }, data: { casado: false } }); return u.id },
      motivo: () => "uma pessoa deixou de ser casada na árvore (palco)",
    })
  }
}

async function datasDoProcesso(processoId: number, diasNaFase: number) {
  const logs = await prisma.phaseAdvanceLog.findMany({ where: { processoId, resultado: { in: ["AVANCADO", "MOVIDO", "FORCADO", "RETORNADO", "REABERTO"] as never } }, orderBy: { id: "asc" }, select: { id: true } })
  const todos = logs.length ? logs : await prisma.phaseAdvanceLog.findMany({ where: { processoId }, orderBy: { id: "asc" }, select: { id: true } })
  for (const [k, l] of todos.entries()) await prisma.phaseAdvanceLog.update({ where: { id: l.id }, data: { criadoEm: em(-(diasNaFase + (todos.length - 1 - k) * 6)) } })
  const proc = await prisma.processo.findUniqueOrThrow({ where: { id: processoId }, select: { faseAtualKey: true } })
  // a 1ª fase nasce com o processo (a entrada é a abertura); nas demais, a abertura é anterior às fases percorridas
  const aberto = em(-(diasNaFase + (todos.length ? todos.length * 6 + 8 : 0)))
  await prisma.processo.update({ where: { id: processoId }, data: { createdAt: aberto, dataInicio: aberto } })
  await prisma.phaseWorkflowInstance.updateMany({ where: { processoId, faseMacroKey: proc.faseAtualKey! }, data: { createdAt: em(-diasNaFase) } })
}

interface Montada { spec: FamiliaDoPalco; ids: Ids }

async function executarFamilia(cad: Cad, spec: FamiliaDoPalco, indice: number): Promise<Montada> {
  const ids = await montarFamilia(cad, spec, indice)
  if (spec.fase !== "genealogia") {
    if (spec.deixaFase) {
      await irParaFase(cad, ids.processoId, spec.deixaFase)
      await irParaFase(cad, ids.processoId, spec.fase, true) // a fase anterior FICA com tarefas abertas
    } else {
      await irParaFase(cad, ids.processoId, spec.fase)
    }
  }
  if (spec.naoExigidas) await dispensarPelaArvore(cad, ids, spec.naoExigidas)
  await datasDoProcesso(ids.processoId, spec.diasNaFase)

  // tarefas ABERTAS da fase atual (o que a Torre mostra), na ordem de criação
  const tarefas = await prisma.tarefa.findMany({
    where: { processoId: ids.processoId, faseMacroKey: spec.fase, statusTarefa: { notIn: ["SUPERSEDIDA", "CANCELADA"] } },
    orderBy: { id: "asc" }, select: { id: true },
  })
  const donos = DONOS_PADRAO[spec.pais]
  let k = 0
  for (const t of tarefas) {
    const dado = spec.planos?.[k]
    let plano: Plano
    if (dado) plano = dado
    else {
      // plano padrão: a iniciar, com dono em rodízio (a cada 9ª sem dono) e prazos variados
      const semDono = spec.semDonoNoRestante || (k + indice) % 9 === 8
      plano = { estado: "A_INICIAR", dono: semDono ? null : donos[(k + indice) % donos.length], prazo: PRAZOS_PADRAO[(k * 3 + indice) % PRAZOS_PADRAO.length], prioridade: PRIORIDADES_PADRAO[(k + indice) % PRIORIDADES_PADRAO.length] }
    }
    // dono em rodízio quando o plano não diz nada (undefined); `null` = SEM responsável de propósito
    if (plano.dono === undefined) plano = { ...plano, dono: spec.semDonoNoRestante ? null : donos[(k + indice) % donos.length] }
    // certidão da Emissão com cartório já vinculado (a maioria; 1 em cada 8 fica "sem órgão emissor", como acontece de verdade)
    if (spec.fase === "emissao_documental" && !plano.orgao && !plano.vincularOrgao && (k + indice) % 8 !== 7) {
      plano = { ...plano, vincularOrgao: ["caxias", "poa4", "santos1"][(k + indice) % 3] }
    }
    await aplicarPlano(cad, t.id, plano, k + indice)
    k++
  }
  // as tarefas que ficaram na fase deixada: dono em rodízio e prazo vencido em algumas
  if (spec.deixaFase) {
    const antigas = await prisma.tarefa.findMany({ where: { processoId: ids.processoId, faseMacroKey: spec.deixaFase, statusTarefa: "NAO_INICIADA" }, orderBy: { id: "asc" }, select: { id: true } })
    for (const [i, t] of antigas.entries()) await aplicarPlano(cad, t.id, { estado: "A_INICIAR", dono: i < 2 ? null : donos[(i + indice) % donos.length], prazo: i % 3 === 0 ? -5 : 4 }, i)
  }
  if (spec.divergencia) {
    // passo CONCLUÍDO com a tarefa ainda aberta (estados contraditórios): é o que a regra de divergência do "Precisa de você" enxerga
    const t = await prisma.tarefa.findFirst({ where: { processoId: ids.processoId, faseMacroKey: spec.fase, statusTarefa: "NAO_INICIADA", workflowStepInstanceId: { not: null } }, orderBy: { id: "desc" }, select: { workflowStepInstanceId: true } })
    if (t?.workflowStepInstanceId) await prisma.phaseWorkflowStepInstance.update({ where: { id: t.workflowStepInstanceId }, data: { status: "CONCLUIDO", completedAt: em(-1) } })
  }
  if (spec.pausado) {
    const r = await pausarProcesso({ processoId: ids.processoId, usuarioId: cad.adminId, justificativa: spec.pausado.motivo })
    if (!r.ok) throw new Error(`pausar ${spec.sobrenome}: ${r.erro}`)
    await prisma.processoPausa.updateMany({ where: { processoId: ids.processoId, retomadoEm: null }, data: { pausadoEm: em(-spec.pausado.haDias) } })
  }
  return { spec, ids }
}

async function familias(cad: Cad): Promise<Montada[]> {
  const feitas: Montada[] = []
  for (const [i, f] of FAMILIAS.entries()) {
    feitas.push(await executarFamilia(cad, f, i))
    log(`família ${String(i + 1).padStart(2)}/${FAMILIAS.length} ${f.sobrenome} (${f.pais}, ${f.fase})`)
  }
  return feitas
}

/** Ausências ABERTAS DEPOIS das atribuições (o sistema recusa atribuir a quem já está ausente): Rafael em férias agora, Daniela com afastamento futuro. */
async function ausencias(cad: Cad) {
  // Ausência VIGENTE (Rafael: férias, sucessor sugerido Tiago) e FUTURA (Daniela: afastamento).
  const a1 = await abrirIndisponibilidade({ usuarioId: cad.usuarios.rafael, tipo: "FERIAS", inicio: em(-3), fim: em(9), motivo: "férias", autorId: cad.adminId, sucessorSugeridoId: cad.usuarios.tiago })
  if (!a1.ok) throw new Error(a1.erro)
  const a2 = await abrirIndisponibilidade({ usuarioId: cad.usuarios.daniela, tipo: "AFASTAMENTO", inicio: em(12), fim: em(26), motivo: "consulta médica e recuperação", autorId: cad.adminId, sucessorSugeridoId: cad.usuarios.priscila })
  if (!a2.ok) throw new Error(a2.erro)
}

// ============================================================================
// F. METAS, COMENTÁRIOS, VISÕES, FOTOS DIÁRIAS, CARGA, HISTÓRICO
// ============================================================================
async function metas(cad: Cad) {
  const padrao: Record<string, number> = {
    genealogia: 15, emissao_documental: 30, analise_documental: 7, retificacao_registros: 60, emissao_documental_retificada: 20,
    traducao_juramentada: 10, apostilamento: 15, aguardando_protocolo: 30,
  }
  for (const [phaseKey, metaDias] of Object.entries(padrao)) {
    const r = await definirMeta({ phaseKey, metaDias, autorId: cad.adminId })
    if (!r.ok) throw new Error(`meta ${phaseKey}: ${r.erro}`)
  }
  // por país (a meta do país vence a padrão)
  for (const [phaseKey, pais, metaDias] of [["emissao_documental", "ES", 45], ["genealogia", "ES", 20], ["traducao_juramentada", "IT", 14], ["analise_documental", "ES", 10]] as const) {
    const r = await definirMeta({ phaseKey, paisId: cad.paises[pais], metaDias, autorId: cad.adminId })
    if (!r.ok) throw new Error(`meta ${phaseKey}/${pais}: ${r.erro}`)
  }
}

async function comentarios(cad: Cad, feitas: Montada[]) {
  const de = (sobrenome: string) => feitas.find((f) => f.spec.sobrenome === sobrenome)!
  const m = (chave: string, nome: string) => `@[${nome}](${cad.usuarios[chave]})`
  const marco = `@[Marco Rovatti](${cad.adminId})`
  const lista: Array<{ fam: string; autor: number; texto: string; haHoras: number; tarefa?: boolean }> = [
    { fam: "Lombardi", autor: cad.adminId, haHoras: 30, texto: `O cliente confirmou por telefone que a certidão de óbito do avô está registrada em Vicenza. ${m("priscila", "Priscila Tavares")} pode cobrar o comune amanhã?` },
    { fam: "Lombardi", autor: cad.usuarios.priscila, haHoras: 22, texto: `Cobrei hoje cedo por e-mail, sem resposta ainda. ${marco} vale ligar para o Stato Civile?` },
    { fam: "Echevarría", autor: cad.adminId, haHoras: 50, texto: `${m("rafael", "Rafael Souza")} o Registro Civil de Granada continua sem resposta há mais de 30 dias. Podemos trocar o canal?` },
    { fam: "Echevarría", autor: cad.usuarios.priscila, haHoras: 5, texto: `Liguei para Granada: pediram o número de protocolo do primeiro pedido. ${m("tiago", "Tiago Pellegrini")} você tem o comprovante?` },
    { fam: "Moretti", autor: cad.usuarios.daniela, haHoras: 76, texto: `Enviei o link do formulário ao cliente; ele ficou de devolver até sexta. ${m("camila", "Camila Fontana")} assume se eu me ausentar.` },
    { fam: "Bellandi", autor: cad.adminId, haHoras: 8, texto: `Esta família está há 52 dias na emissão. ${m("beatriz", "Beatriz Gerbi")} priorize as bloqueadas e me avise o que depende do cliente.` },
    { fam: "Bellandi", autor: cad.usuarios.beatriz, haHoras: 2, texto: `Combinado, ${marco}. Já pedi a procuração assinada de novo.`, tarefa: true },
    { fam: "Carraro", autor: cad.usuarios.camila, haHoras: 40, texto: `A tradutora prometeu as primeiras 4 traduções para quinta. ${marco} ok manter o prazo?` },
  ]
  for (const c of lista) {
    const f = de(c.fam)
    const tarefa = c.tarefa ? await prisma.tarefa.findFirst({ where: { processoId: f.ids.processoId, statusTarefa: { notIn: ["SUPERSEDIDA"] } }, orderBy: { id: "asc" }, select: { id: true } }) : null
    const r = await criarComentario(tarefa ? { tarefaId: tarefa.id, autorId: c.autor, texto: c.texto } : { familiaId: f.ids.familiaId, autorId: c.autor, texto: c.texto })
    if (!r.ok) throw new Error(`comentário ${c.fam}: ${r.erro}`)
    await prisma.comentarioTarefa.update({ where: { id: r.comentario.id }, data: { criadoEm: new Date(AGORA.getTime() - c.haHoras * 3_600_000) } })
  }
}

async function visoes(cad: Cad) {
  const nova = (usuarioId: number, nome: string, b: Record<string, unknown>, compartilhada: boolean) =>
    prisma.relatorioVisao.create({ data: { usuarioId, dominio: "torre-tarefas", nome, spec: JSON.parse(JSON.stringify(limparSpec(b))), compartilhada, usadaEm: em(-1) } })
  await nova(cad.adminId, "★ Itália · emissão parada", { visao: "todas", agrupar: "fam", pais: "Itália", filtros: { fase: "emissao_documental", risco: "atencao" } }, false)
  await nova(cad.adminId, "★ Minha semana", { visao: "vencidas", agrupar: "resp" }, false)
  await nova(cad.usuarios.priscila, "Da equipe: Priscila · Espanha", { visao: "cartorio", agrupar: "orgao", pais: "Espanha" }, true)
}

/** Limite de carga de cada pessoa proporcional ao que ela de fato tem em mãos (Beatriz no limite, Lucas acima, os demais folgados). */
async function ajustarCarga(cad: Cad) {
  const razao: Record<string, number> = { daniela: 0.78, priscila: 0.5, rafael: 0.55, beatriz: 1, tiago: 0.65, camila: 0.6, lucas: 1.4 }
  // os executáveis são medidos pela MESMA conta da aba Equipe (linhas da Torre), não por uma contagem paralela
  const { linhas } = await listarTarefasDaTorre({}, new Date())
  const cargas = cargaPorPessoa(linhas)
  for (const e of EQUIPE) {
    const executaveis = cargas.get(cad.usuarios[e.chave])?.executaveis ?? 0
    const limite = Math.max(2, Math.round(executaveis / razao[e.chave]))
    const r = await definirCapacidade({ usuarioId: cad.usuarios[e.chave], limiteExecutaveis: limite, autorId: cad.adminId })
    if (!r.ok) throw new Error(r.erro)
  }
}

/** 10 fotos diárias (hoje real + 9 passadas com tendência plausível), COM as colunas novas — alimenta "vs semana passada". */
async function fotosDiarias() {
  const hoje = await gravarIndicadoresDoDia(AGORA)
  const h = hoje.indicadores
  const d0 = new Date(AGORA); d0.setUTCHours(0, 0, 0, 0)
  for (let n = 1; n <= 9; n++) {
    const data = new Date(d0.getTime() - n * DIA)
    const j = (base: number, amp: number, fase: number) => Math.max(0, Math.round(base + Math.sin(n * 1.3 + fase) * amp + n * (amp / 4)))
    await prisma.torreIndicadorDiario.create({
      data: {
        data, vencidas: j(h.vencidas, 3, 0) + (n === 7 ? 4 : 0), vencemEm7Dias: j(h.vencemEm7Dias, 4, 1), semDono: j(h.semDono, 2, 2) + (n === 7 ? 3 : 0),
        aguardandoTerceiro: Math.max(0, h.aguardandoTerceiro - n * 2 + (n % 3)), cobrancasPendentes: j(h.cobrancasPendentes, 2, 3), escaladas: Math.max(0, h.escaladas - (n > 4 ? 2 : 0)),
        emRisco: j(h.emRisco, 3, 4), backlogAbertas: j(h.backlogAbertas, 6, 5), backlogFechadasNaSemana: Math.max(0, h.backlogFechadasNaSemana - n),
        processosAtivos: Math.max(1, h.processosAtivos - (n > 6 ? 1 : 0)), tarefasAbertas: Math.max(1, h.tarefasAbertas - n * 3 + 8),
        comEquipe: Math.max(0, h.comEquipe - n * 2 + 5), comCartorio: Math.max(0, h.comCartorio - n * 2),
      },
    })
  }
}

/** O histórico (LogAuditoria) nasceu todo "agora": espalha-o pelos últimos dias, mantendo o que já foi datado de propósito. */
async function espalharHistorico() {
  const recentes = await prisma.logAuditoria.findMany({ where: { criadoEm: { gt: new Date(Date.now() - 6 * 3_600_000) } }, orderBy: { id: "asc" }, select: { id: true } })
  let i = 0
  for (const l of recentes) {
    i++
    if (i % 5 === 0) continue // um quinto fica em "hoje"
    const dias = Math.floor(rnd() * 9)
    const d = em(-dias); d.setUTCHours(11 + Math.floor(rnd() * 8), Math.floor(rnd() * 60), 0, 0)
    await prisma.logAuditoria.update({ where: { id: l.id }, data: { criadoEm: d } })
  }
}

async function resumoFinal(cad: Cad, feitas: Montada[]) {
  void cad
  const proc = await prisma.processo.groupBy({ by: ["faseAtualKey"], _count: true })
  const porFase = new Map(proc.map((p) => [p.faseAtualKey, p._count]))
  console.log("\n── PROCESSOS por fase ──")
  for (const f of FASES) console.log(`  ${f.label.padEnd(32)} ${porFase.get(f.key) ?? 0}`)
  const tarefas = await prisma.tarefa.groupBy({ by: ["statusTarefa"], _count: true, where: { statusTarefa: { not: "SUPERSEDIDA" } } })
  console.log("── TAREFAS por status (sem as superseded) ──"); for (const t of tarefas) console.log(`  ${t.statusTarefa.padEnd(22)} ${t._count}`)
  const docs = await prisma.documento.groupBy({ by: ["status"], _count: true }); console.log("── DOCUMENTOS ──", JSON.stringify(docs.map((d) => `${d.status}:${d._count}`)))
  const cont = {
    familias: feitas.length, pessoas: await prisma.pessoa.count(), unioes: await prisma.uniao.count(), requerentes: await prisma.requerente.count(),
    necessidades: await prisma.necessidadeDocumental.count(), solicitacoes: await prisma.solicitacaoDocumento.count(), contatos: await prisma.contatoTerceiro.count(),
    orgaos: await prisma.orgaoProtocolo.count(), usuarios: await prisma.usuario.count(), comentarios: await prisma.comentarioTarefa.count(), mencoes: await prisma.comentarioMencao.count(),
    logAuditoria: await prisma.logAuditoria.count(), metas: await prisma.metaTempoFase.count(), fotos: await prisma.torreIndicadorDiario.count(), visoes: await prisma.relatorioVisao.count(),
    pausasVigentes: await prisma.processoPausa.count({ where: { retomadoEm: null } }),
  }
  console.log("── CONTAGENS ──", JSON.stringify(cont))
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
