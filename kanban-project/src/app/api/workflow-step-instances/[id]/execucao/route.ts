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
import { requisitosPendentes } from "@/src/services/requisitos-da-etapa"
import { avaliarCondicao, descreverCondicao, type Condicao } from "@/src/lib/motor/condicoes"

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
  // AS OPÇÕES VÊM, NESTA ORDEM: das cadastradas na versão (identidade própria, com
  // inativação), do catálogo global quando o campo aponta para ele, e por último do
  // JSON antigo — que é o formato de antes de a opção ter identidade.
  const resolverOpcoes = (campo: { opcoesCadastradas?: Array<{ key: string; label: string; ativo: boolean; ordem: number; condicao: unknown }>; opcoes: unknown }) => {
    const cadastradas = (campo.opcoesCadastradas ?? []).filter((o) => o.ativo !== false)
    if (cadastradas.length > 0) {
      return [...cadastradas].sort((a, b) => a.ordem - b.ordem)
        .map((o) => ({ value: o.key, label: o.label, condicao: o.condicao }))
    }
    const o = campo.opcoes as { catalogo?: string } | unknown[] | null
    if (o && !Array.isArray(o) && typeof o === "object" && (o as { catalogo?: string }).catalogo === "canais") {
      return canais.map((c) => ({ value: c.key, label: c.label, meta: c }))
    }
    return Array.isArray(o) ? o : []
  }

  const tentativas = await tentativasDoPasso(id)
  const vigente = await tentativaVigente(id)
  // O que já foi preenchido nesta execução — é sobre ele que condição e requisito são
  // avaliados, e é ele que a tela devolve preenchido ao recarregar.
  const valoresAtuais = ((vigente?.payload as { valores?: Record<string, unknown> } | null)?.valores ?? {}) as Record<string, unknown>

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
            .map((c) => ({
              ...c,
              opcoes: resolverOpcoes(c),
              // A condição vai legível para a tela poder EXPLICAR por que um campo não
              // aparece, em vez de simplesmente escondê-lo.
              condicaoDescrita: descreverCondicao(c.condicao as Condicao | null,
                Object.fromEntries(hist.passo.campos.map((x) => [x.key, x.label]))),
            })),
          acoes: hist.passo.acoes.filter((a) => a.ativo !== false).map((a) => ({
            ...a, efeito: efeito(a.effectKey),
          })),
          checklist: hist.passo.checkItens.filter((i) => i.ativo !== false),
          // OS CANAIS DESTE PASSO — os cadastrados na versão. Sem cadastro, a lista
          // fica vazia e o executor cai na semente, que é o dado de antes do cadastro.
          canais: (hist.passo.canais ?? []).filter((c) => c.ativo !== false)
            .filter((c) => avaliarCondicao(c.condicao as Condicao | null, { valores: valoresAtuais })),
          requisitos: (hist.passo.requisitos ?? []).filter((r) => r.ativo !== false),
        }
      : null,
    execucaoAtual: vigente,
    execucoesAnteriores: tentativas.filter((t) => t.supersededAt != null),
    valores: valoresAtuais,
    // O QUE FALTA, calculado no servidor. A tela mostra para ajudar; quem recusa é a
    // porta de execução, com a mesma conta.
    pendencias: hist
      ? await requisitosPendentes({
          stepInstanceId: id,
          requisitos: hist.passo.requisitos ?? [],
          campos: hist.passo.campos,
          checklist: hist.passo.checkItens,
          canais: hist.passo.canais ?? [],
          valores: valoresAtuais,
        })
      : [],
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
