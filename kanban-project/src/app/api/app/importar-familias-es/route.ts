// TEMPORÁRIO — importação em lote de processos por família (Espanha).
// Endpoint de operação única: criado para rodar a carga do arquivo
// "processos_requerentes.xlsx" e REMOVIDO logo depois. Guardado por token.
//
// Regras:
//  - usa o serviço de domínio canônico criarProcessoV2 (nasce v2, 1ª fase,
//    Workflow Interno, tarefas iniciais, phase.entered) — não escreve fase à mão;
//  - NUNCA duplica: pula nome já existente no país (comparação normalizada)
//    e ainda usa idempotencyKey estável por família;
//  - dryRun por padrão.

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { criarProcessoV2 } from "@/src/services/criar-processo"
import { herdarFamiliaDaArvore } from "@/src/services/familia"
import { processarOutbox } from "@/src/services/outbox-dispatcher"
import { ondePaisEh } from "@/src/lib/identidade/canonica"

export const maxDuration = 300
export const dynamic = "force-dynamic"

const TOKEN = "imp-fam-es-9f2a7c14b8d3"

const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim()

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  if (body?.token !== TOKEN) return NextResponse.json({ error: "não autorizado" }, { status: 401 })

  const dryRun = body?.dryRun !== false
  const nomes: string[] = Array.isArray(body?.nomes) ? body.nomes.map((n: string) => String(n).trim()).filter(Boolean) : []
  if (!nomes.length) return NextResponse.json({ error: "nomes vazio" }, { status: 400 })

  // 1) país Espanha (catálogo oficial)
  const paises = await prisma.catalogoPais.findMany({ select: { id: true, countryKey: true, countryLabel: true, ativo: true } })
  const pais = paises.find((p) => p.ativo && (norm(p.countryLabel).includes("espanh") || norm(p.countryKey) === "es" || norm(p.countryKey).includes("espanh")))
  if (!pais) return NextResponse.json({ error: "país Espanha não encontrado", paises }, { status: 422 })

  // 2) tipo de processo do país (motor)
  const tipos = await prisma.tipoProcessoNacionalidade.findMany({
    where: { paisId: pais.id },
    select: { id: true, name: true, code: true, ativo: true, arquivado: true },
  })
  const tiposAtivos = tipos.filter((t) => t.ativo && !t.arquivado)
  const tipoId = Number(body?.tipoProcessoMotorId) || (tiposAtivos.length === 1 ? tiposAtivos[0].id : 0)
  if (!tipoId) return NextResponse.json({ error: "tipo de processo ambíguo/ausente — informe tipoProcessoMotorId", tipos }, { status: 422 })

  // 3) fase inicial do Macro publicado (tem que ser genealogia)
  const macro = await prisma.macroWorkflow.findUnique({
    where: { tipoProcessoId: tipoId },
    include: { fases: { orderBy: { ordem: "asc" }, select: { phaseKey: true, ordem: true } } },
  })
  const primeiraFase = macro?.fases?.[0]?.phaseKey ?? null
  const faseOk = !!primeiraFase && norm(primeiraFase).includes("genealogia")
  if (!macro?.ativo || !faseOk) {
    return NextResponse.json(
      { error: "Macro sem fase inicial de genealogia", macroAtivo: macro?.ativo ?? null, fases: macro?.fases ?? [] },
      { status: 422 },
    )
  }

  // 4) existentes no país (dedupe forte por nome normalizado)
  const existentes = await prisma.processo.findMany({
    where: ondePaisEh(pais.countryKey),
    select: { id: true, codigo: true, nome: true },
  })
  const mapaExistente = new Map(existentes.map((p) => [norm(p.nome), p]))

  const criados: Array<{ nome: string; processId: number; codigo: string; fase: string; tarefas: number }> = []
  const pulados: Array<{ nome: string; motivo: string; processId?: number; codigo?: string | null }> = []
  const erros: Array<{ nome: string; code: string; message: string }> = []

  const vistosNoLote = new Set<string>()

  for (const nome of nomes) {
    const chave = norm(nome)
    if (vistosNoLote.has(chave)) { pulados.push({ nome, motivo: "duplicado no próprio lote" }); continue }
    vistosNoLote.add(chave)

    const jaExiste = mapaExistente.get(chave)
    if (jaExiste) {
      pulados.push({ nome, motivo: "já existe no país", processId: jaExiste.id, codigo: jaExiste.codigo })
      continue
    }
    if (dryRun) { criados.push({ nome, processId: 0, codigo: "(dry-run)", fase: primeiraFase!, tarefas: 0 }); continue }

    const r = await criarProcessoV2({
      nome,
      pais: pais.countryKey,
      tipoProcessoMotorId: tipoId,
      idempotencyKey: `import-familias-es|${chave}`,
    })
    if (!r.success) { erros.push({ nome, code: r.code, message: r.message }); continue }

    try { await herdarFamiliaDaArvore(r.processId) } catch { /* best-effort (igual à API) */ }

    mapaExistente.set(chave, { id: r.processId, codigo: r.processCode, nome })
    if (r.created) criados.push({ nome, processId: r.processId, codigo: r.processCode, fase: r.currentPhaseKey, tarefas: r.tarefasIniciais })
    else pulados.push({ nome, motivo: "idempotente (mesma chave já criada)", processId: r.processId, codigo: r.processCode })
  }

  if (!dryRun) {
    try { await processarOutbox({ tipos: ["phase.entered"], limite: 500 }) } catch { /* best-effort */ }
  }

  return NextResponse.json({
    dryRun,
    pais: pais.countryKey,
    tipoProcessoMotorId: tipoId,
    faseInicial: primeiraFase,
    totalEntrada: nomes.length,
    criados: criados.length,
    pulados: pulados.length,
    erros: erros.length,
    detalhe: { criados, pulados, erros },
  })
}
