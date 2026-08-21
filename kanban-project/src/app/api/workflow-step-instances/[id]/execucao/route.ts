// src/app/api/workflow-step-instances/[id]/execucao/route.ts
//
// A CONFIGURAÇÃO QUE ESTA ETAPA EXECUTA — e a execução de uma ação dela.
//
// GET  devolve campos, ações e checklist DA VERSÃO que esta execução registrou, mais
//      o histórico de tentativas. É o que o painel desenha: nada aqui é inventado
//      pela tela, e nada vem da configuração de hoje.
// POST executa uma ação cadastrada pela porta única de domínio.
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { extrairUsuarioComPermissoes, verificarPermissao } from "@/src/lib/verificar-permissao"
import { definicaoHistoricaDoPasso } from "@/src/services/versao-publicada"
import { executarAcaoCadastrada } from "@/src/services/executar-acao-cadastrada"
import { tentativasDoPasso, tentativaVigente } from "@/src/services/execucao-do-passo"
import { efeito } from "@/src/lib/motor/catalogo-de-efeitos"
import { executorEfetivo } from "@/src/services/validacao-de-publicacao"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, "workflow.iniciarPasso")
  if (erro) return erro
  const id = Number((await params).id)
  if (!Number.isFinite(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

  const passo = await prisma.phaseWorkflowStepInstance.findUnique({
    where: { id },
    select: { id: true, stepKey: true, status: true, faseMacroKey: true, ciclo: true, documentoId: true, processoId: true },
  })
  if (!passo) return NextResponse.json({ error: "Etapa não encontrada." }, { status: 404 })

  const hist = await definicaoHistoricaDoPasso(id)
  // OPÇÕES QUE VÊM DE CATÁLOGO GLOBAL são resolvidas aqui, no servidor: um campo pode
  // dizer `{ catalogo: "canais" }` em vez de repetir a lista de canais dentro do passo.
  // Assim, cadastrar um canal novo aparece em todo campo que aponta para o catálogo.
  const canais = await prisma.canalOperacional.findMany({
    where: { ativo: true }, orderBy: [{ ordem: "asc" }],
    select: { key: true, label: true, descricao: true, protocoloObrigatorio: true, anexoObrigatorioLabel: true, rastreioObrigatorio: true, observacaoObrigatoria: true },
  })
  const resolverOpcoes = (opcoes: unknown) => {
    const o = opcoes as { catalogo?: string } | unknown[] | null
    if (o && !Array.isArray(o) && typeof o === "object" && (o as { catalogo?: string }).catalogo === "canais") {
      return canais.map((c) => ({ value: c.key, label: c.label, meta: c }))
    }
    return Array.isArray(o) ? o : []
  }

  const tentativas = await tentativasDoPasso(id)
  const vigente = await tentativaVigente(id)

  return NextResponse.json({
    passo,
    versao: hist?.versao ?? null,
    executor: hist ? executorEfetivo({ key: passo.stepKey, executorKey: hist.passo.executorKey }, passo.faseMacroKey) : null,
    // `null` diz a verdade: esta execução é anterior ao versionamento e não tem
    // configuração congelada. A tela mostra o painel operacional, não um formulário
    // montado a partir de suposição.
    configuracao: hist
      ? {
          label: hist.passo.label,
          descricao: hist.passo.description,
          campos: hist.passo.campos.filter((c) => c.ativo !== false)
            .map((c) => ({ ...c, opcoes: resolverOpcoes(c.opcoes) })),
          acoes: hist.passo.acoes.filter((a) => a.ativo !== false).map((a) => ({
            ...a, efeito: efeito(a.effectKey),
          })),
          checklist: hist.passo.checkItens.filter((i) => i.ativo !== false),
        }
      : null,
    execucaoAtual: vigente,
    execucoesAnteriores: tentativas.filter((t) => t.supersededAt != null),
  })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, "workflow.iniciarPasso")
  if (erro) return erro
  const id = Number((await params).id)
  if (!Number.isFinite(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const acaoKey = String(body?.acao ?? "")
  if (!acaoKey) return NextResponse.json({ error: "Ação não informada." }, { status: 400 })

  const u = await extrairUsuarioComPermissoes(request)
  const r = await executarAcaoCadastrada(id, acaoKey, (body?.valores ?? {}) as Record<string, unknown>, {
    usuarioId: u?.userId ?? null,
    // O mapa de permissões é `{ chave: boolean }`; a porta quer a lista das concedidas.
    permissoes: Object.entries(u?.permissoes ?? {}).filter(([, v]) => v === true).map(([k]) => k),
    // IDEMPOTÊNCIA DO COMANDO: o mesmo clique reenviado traz a mesma correlação e não
    // vira duas execuções. Sem ela, dois cliques criariam duas novas vias.
    correlationId: String(body?.correlationId ?? `acao|si${id}|${acaoKey}|${u?.userId ?? 0}`),
  })
  return NextResponse.json(r, { status: r.ok ? 200 : 422 })
}
