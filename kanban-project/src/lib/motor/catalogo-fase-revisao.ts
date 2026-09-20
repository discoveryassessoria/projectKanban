// src/lib/motor/catalogo-fase-revisao.ts
// ============================================================================
// REVISÃO CONGELADA DE UMA FASE DO CATÁLOGO — serviço único, usado pela rota de
// edição (`PUT /api/gerenciamento/catalogo-fases/[id]`) e por testes. Extraído
// da rota para que o teste exercite a MESMA lógica de diff/snapshot que a tela
// usa — nunca uma segunda cópia que pode divergir dela.
//
// Mesmo padrão de `PhaseInternalWorkflowVersao`/`MacroWorkflowVersao`: a
// definição (`CatalogoFase`) é o rascunho editável; a revisão é o conteúdo
// congelado. Só nasce revisão nova quando um campo que a operação LÊ de fato
// muda — editar e salvar sem mudar nada não é fato novo.
// ============================================================================
import type { Prisma, PrismaClient, CatalogoFase } from "@prisma/client"

export type DadosCatalogoFase = Pick<
  CatalogoFase,
  "label" | "descricao" | "escopo" | "ordemPadrao" | "requiredPadrao" | "conditionalPadrao" | "efeitosPermitidos" | "ativo" | "status"
>

/**
 * `ativo` é a entrada da tela; `status` é a fonte. Nunca duas verdades.
 *
 * `statusAtual` distingue RASCUNHO de INATIVA quando `ativo:false`: uma fase
 * que NUNCA foi publicada (RASCUNHO) e continua `ativo:false` PERMANECE
 * RASCUNHO — editar sem publicar não pode narrar falsamente "foi publicada e
 * depois desativada". Só uma fase JÁ PUBLICADA vira INATIVA ao desativar
 * (mandato "Catálogo de Fases", correção 20/09/2026, bug 3).
 */
export function statusDeAtivo(ativo: boolean, statusAtual?: CatalogoFase["status"]): "RASCUNHO" | "PUBLICADA" | "INATIVA" {
  if (ativo) return "PUBLICADA"
  if (statusAtual === "RASCUNHO") return "RASCUNHO"
  return "INATIVA"
}

export function algoMudou(atual: DadosCatalogoFase, novos: DadosCatalogoFase): boolean {
  return (
    novos.label !== atual.label ||
    novos.descricao !== atual.descricao ||
    novos.escopo !== atual.escopo ||
    novos.requiredPadrao !== atual.requiredPadrao ||
    novos.conditionalPadrao !== atual.conditionalPadrao ||
    novos.ordemPadrao !== atual.ordemPadrao ||
    novos.status !== atual.status ||
    JSON.stringify(novos.efeitosPermitidos ?? null) !== JSON.stringify(atual.efeitosPermitidos ?? null)
  )
}

type DB = Prisma.TransactionClient | PrismaClient

/**
 * Aplica os dados novos, e — só quando algo mudou de fato — incrementa
 * `revisaoAtual` e congela `CatalogoFaseRevisao`. Idempotente no sentido de
 * "salvar sem mudar nada não gera ruído"; NÃO precisa idempotência de reexecução
 * (é sempre uma escrita explícita do administrador).
 */
export async function publicarRevisaoCatalogoFase(
  db: DB,
  atual: CatalogoFase,
  dadosNovos: DadosCatalogoFase,
  congeladoPorId: number | null,
): Promise<{ fase: CatalogoFase; revisaoNova: number; mudou: boolean }> {
  const mudou = algoMudou(atual, dadosNovos)
  const revisaoNova = atual.revisaoAtual + (mudou ? 1 : 0)

  const fase = await db.catalogoFase.update({
    where: { id: atual.id },
    // phaseKey NÃO entra no update — chave estável (vínculo com fluxos/runtime).
    data: { ...dadosNovos, efeitosPermitidos: dadosNovos.efeitosPermitidos as never, revisaoAtual: revisaoNova },
  })

  if (mudou) {
    await db.catalogoFaseRevisao.create({
      data: {
        catalogoFaseId: fase.id, revisao: revisaoNova, phaseKey: fase.phaseKey,
        label: fase.label, descricao: fase.descricao, escopo: fase.escopo,
        ordemPadrao: fase.ordemPadrao, requiredPadrao: fase.requiredPadrao,
        conditionalPadrao: fase.conditionalPadrao, status: fase.status,
        efeitosPermitidos: fase.efeitosPermitidos as never,
        congeladoPorId, origem: "PUBLICACAO",
      },
    })
  }

  return { fase, revisaoNova, mudou }
}
