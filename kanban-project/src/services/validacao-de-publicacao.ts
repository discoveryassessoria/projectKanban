// src/services/validacao-de-publicacao.ts
// ============================================================================
// O QUE NÃO PODE SER PUBLICADO.
//
// ─── POR QUE A TRAVA É NA PUBLICAÇÃO ────────────────────────────────────────
// Configuração inválida não dá erro na hora de configurar: dá erro semanas depois,
// no meio de um processo real, com o operador olhando uma tela que não faz o que
// deveria. Um passo que depende de um passo que não existe fica bloqueado para
// sempre; um ciclo A→B→A trava os dois; uma ação que aponta para um efeito
// inexistente vira um botão que não faz nada.
//
// Publicar é o único momento em que a configuração inteira está sob os olhos.
// É onde a recusa custa menos e explica mais.
//
// ─── O QUE ELA RECUSA ───────────────────────────────────────────────────────
// Dependência inexistente, auto-dependência, ciclo, efeito fora do catálogo, efeito
// fora da COMPETÊNCIA da fase, efeito que o executor do passo não sabe disparar,
// campo de tipo que o executor não sabe desenhar, ação que exige campo inexistente.
//
// ─── O QUE ELA NÃO FAZ ──────────────────────────────────────────────────────
// Não conserta. Recusar e explicar é o contrato; consertar por conta própria seria
// decidir pelo administrador o que ele quis dizer.
// ============================================================================

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { efeito, efeitoExiste, efeitosDaFase } from "@/src/lib/motor/catalogo-de-efeitos"
import { executorSuportaCampo, executorSuportaEfeito, capacidades, TIPOS_DE_CAMPO } from "@/src/lib/motor/registro-de-executores"
import { resolveWorkflowStepEditor } from "@/src/lib/process-stage/step-editor-registry"

type DB = Prisma.TransactionClient | typeof prisma

export interface ProblemaDePublicacao {
  codigo: string
  stepKey: string | null
  mensagem: string
}

export interface PassoParaValidar {
  key: string
  label: string
  executorKey?: string | null
  dependeDe?: string[] | null
  acoes?: { key: string; effectKey: string; requerCampos?: string[] | null; ativo?: boolean }[]
  campos?: { key: string; tipo: string; ativo?: boolean }[]
}

/** O executor efetivo do passo: o declarado, ou o que o registro resolve pela chave. */
export function executorEfetivo(passo: { key: string; executorKey?: string | null }, phaseKey: string | null): string {
  if (passo.executorKey) return passo.executorKey
  return resolveWorkflowStepEditor({ stepKey: passo.key, phaseKey }).kind
}

/** Ciclo no grafo de dependências declaradas. Devolve o caminho, para a mensagem doer menos. */
export function detectarCiclo(passos: PassoParaValidar[]): string[] | null {
  const adj = new Map(passos.map((p) => [p.key, (p.dependeDe ?? []).slice()]))
  const estado = new Map<string, 0 | 1 | 2>()
  const pilha: string[] = []
  function dfs(n: string): string[] | null {
    estado.set(n, 1); pilha.push(n)
    for (const d of adj.get(n) ?? []) {
      if (!adj.has(d)) continue
      const e = estado.get(d) ?? 0
      if (e === 1) return [...pilha, d]
      if (e === 0) { const r = dfs(d); if (r) return r }
    }
    pilha.pop(); estado.set(n, 2); return null
  }
  for (const p of passos) if ((estado.get(p.key) ?? 0) === 0) { const r = dfs(p.key); if (r) return r }
  return null
}

/**
 * VALIDA UMA CONFIGURAÇÃO INTEIRA. Função PURA — recebe a competência da fase já
 * resolvida, para poder ser testada sem banco e usada dentro de transação.
 */
export function validarConfiguracao(
  passos: PassoParaValidar[],
  ctx: { phaseKey: string; efeitosPermitidosDaFase: string[] },
): ProblemaDePublicacao[] {
  const problemas: ProblemaDePublicacao[] = []
  const chaves = new Set(passos.map((p) => p.key))
  const permitidos = new Set(ctx.efeitosPermitidosDaFase)

  for (const p of passos) {
    const deps = p.dependeDe ?? []
    for (const d of deps) {
      if (d === p.key) {
        problemas.push({ codigo: "DEPENDENCIA_REFLEXIVA", stepKey: p.key,
          mensagem: `"${p.label}" depende de si mesmo — nunca ficaria disponível.` })
      } else if (!chaves.has(d)) {
        problemas.push({ codigo: "DEPENDENCIA_INEXISTENTE", stepKey: p.key,
          mensagem: `"${p.label}" depende de "${d}", que não existe neste workflow.` })
      }
    }
    if (new Set(deps).size !== deps.length) {
      problemas.push({ codigo: "DEPENDENCIA_DUPLICADA", stepKey: p.key,
        mensagem: `"${p.label}" repete a mesma dependência mais de uma vez.` })
    }

    const exec = executorEfetivo(p, ctx.phaseKey)
    if (!capacidades(exec)) {
      problemas.push({ codigo: "EXECUTOR_INEXISTENTE", stepKey: p.key,
        mensagem: `"${p.label}" declara o executor "${exec}", que não existe.` })
      continue
    }

    const camposAtivos = (p.campos ?? []).filter((c) => c.ativo !== false)
    for (const c of camposAtivos) {
      if (!(TIPOS_DE_CAMPO as readonly string[]).includes(c.tipo)) {
        problemas.push({ codigo: "CAMPO_TIPO_DESCONHECIDO", stepKey: p.key,
          mensagem: `O campo "${c.key}" tem tipo "${c.tipo}", que não existe.` })
      } else if (!executorSuportaCampo(exec, c.tipo)) {
        problemas.push({ codigo: "CAMPO_SEM_SUPORTE", stepKey: p.key,
          mensagem: `O campo "${c.key}" é do tipo "${c.tipo}", e o executor "${exec}" de "${p.label}" não sabe desenhá-lo. Escolha outro tipo ou outro executor.` })
      }
    }

    const chavesDeCampo = new Set(camposAtivos.map((c) => c.key))
    for (const a of (p.acoes ?? []).filter((x) => x.ativo !== false)) {
      const def = efeito(a.effectKey)
      if (!def) {
        problemas.push({ codigo: "EFEITO_INEXISTENTE", stepKey: p.key,
          mensagem: `A ação "${a.key}" aponta para o efeito "${a.effectKey}", que não existe no catálogo.` })
        continue
      }
      if (!permitidos.has(a.effectKey)) {
        problemas.push({ codigo: "EFEITO_FORA_DE_COMPETENCIA", stepKey: p.key,
          mensagem: `A ação "${a.key}" faz "${def.label}", que é competência de ${def.competencia}. A fase "${ctx.phaseKey}" não tem essa competência declarada.` })
      }
      if (!executorSuportaEfeito(exec, a.effectKey)) {
        problemas.push({ codigo: "EFEITO_SEM_SUPORTE", stepKey: p.key,
          mensagem: `A ação "${a.key}" faz "${def.label}", e o executor "${exec}" de "${p.label}" não sabe disparar esse efeito.` })
      }
      for (const campo of [...(a.requerCampos ?? []), ...def.camposObrigatorios]) {
        if (!chavesDeCampo.has(campo)) {
          problemas.push({ codigo: "ACAO_EXIGE_CAMPO_INEXISTENTE", stepKey: p.key,
            mensagem: `A ação "${a.key}" exige o campo "${campo}", que não está cadastrado em "${p.label}".` })
        }
      }
    }
  }

  const ciclo = detectarCiclo(passos)
  if (ciclo) {
    problemas.push({ codigo: "DEPENDENCIA_CICLICA", stepKey: ciclo[0] ?? null,
      mensagem: `As dependências formam um ciclo: ${ciclo.join(" → ")}. Nenhum desses passos ficaria disponível.` })
  }
  return problemas
}

/** Resolve competência e valida o workflow como ele está no banco. */
export async function validarWorkflowParaPublicar(workflowId: number, db: DB = prisma): Promise<ProblemaDePublicacao[]> {
  const wf = await db.phaseInternalWorkflow.findUnique({
    where: { id: workflowId },
    include: {
      passos: {
        orderBy: { ordem: "asc" },
        include: { acoes: true, campos: true },
      },
    },
  })
  if (!wf) return [{ codigo: "WORKFLOW_INEXISTENTE", stepKey: null, mensagem: "Workflow não encontrado." }]

  const fase = await db.catalogoFase.findUnique({ where: { phaseKey: wf.phaseKey }, select: { efeitosPermitidos: true } })
  const permitidos = efeitosDaFase(wf.phaseKey, fase?.efeitosPermitidos ?? null)

  return validarConfiguracao(
    wf.passos.map((p) => ({
      key: p.key, label: p.label, executorKey: p.executorKey,
      dependeDe: Array.isArray(p.dependeDe) ? (p.dependeDe as string[]) : null,
      acoes: p.acoes.map((a) => ({
        key: a.key, effectKey: a.effectKey, ativo: a.ativo,
        requerCampos: Array.isArray(a.requerCampos) ? (a.requerCampos as string[]) : null,
      })),
      campos: p.campos.map((c) => ({ key: c.key, tipo: c.tipo, ativo: c.ativo })),
    })),
    { phaseKey: wf.phaseKey, efeitosPermitidosDaFase: permitidos },
  )
}

/** Só para telas: o efeito existe e é usável nesta fase? */
export function efeitoUsavelNaFase(effectKey: string, phaseKey: string, declarados: unknown): boolean {
  return efeitoExiste(effectKey) && efeitosDaFase(phaseKey, declarados).includes(effectKey)
}
