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
import { validarCondicao } from "@/src/lib/motor/condicoes"
import { capacidadeDoExecutor } from "@/src/lib/motor/registro-de-executores"

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
  acoes?: { key: string; effectKey: string; requerCampos?: string[] | null; ativo?: boolean; condicao?: unknown }[]
  campos?: {
    key: string; tipo: string; ativo?: boolean; obrigatorio?: boolean; condicao?: unknown
    /** Opções COM identidade (`StepFieldOption`) — as que o histórico consegue nomear. */
    opcoes?: Array<{ key: string; ativo?: boolean }>
    /**
     * A coluna JSON antiga, ou o ponteiro para um catálogo (`{ catalogo: "canais" }`).
     * Entra aqui só para a validação saber distinguir "campo de escolha sem opção
     * nenhuma" de "as opções vêm de outro lugar" — sem isso, as duas situações são o
     * mesmo array vazio, e a recusa certa acusaria também quem está correto.
     */
    opcoesLegado?: unknown
  }[]
  checkItens?: { key: string; ativo?: boolean }[]
  canais?: { key: string; ativo?: boolean; camposObrigatorios?: string[] | null; condicao?: unknown }[]
  requisitos?: { key: string; tipo: string; alvoKey?: string | null; acaoKey?: string | null; condicao?: unknown; ativo?: boolean }[]
  /// REGRA DE CONCLUSÃO em vocabulário fechado.
  regraDeConclusao?: string | null
  subtarefas?: SubtarefaParaValidar[]
}

export interface SubtarefaParaValidar {
  key: string
  label: string
  ativo?: boolean
  obrigatoria?: boolean
  repetivel?: boolean
  maxOcorrencias?: number | null
  modoExecucao?: string | null
  responsavelRegra?: string | null
  fonteDeCanais?: string | null
  tiposDeCanal?: string[] | null
  executorKey?: string | null
  dependeDe?: string[] | null
  condicaoEntrada?: unknown
  condicaoConclusao?: unknown
  condicaoVisibilidade?: unknown
  acoes?: PassoParaValidar["acoes"]
  campos?: PassoParaValidar["campos"]
  checkItens?: PassoParaValidar["checkItens"]
  requisitos?: PassoParaValidar["requisitos"]
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
      for (const pb of validarCondicao(a.condicao, chavesDeCampo, `ação "${a.key}"`)) {
        problemas.push({ codigo: "CONDICAO_INVALIDA", stepKey: p.key, mensagem: `${pb.caminho}: ${pb.mensagem}` })
      }
    }

    // ── CHAVES DUPLICADAS ────────────────────────────────────────────────
    // A chave é a identidade que o histórico guarda. Duas iguais no mesmo passo fazem
    // "qual foi escolhida?" depender de qual linha for lida primeiro.
    for (const [nome, lista] of [
      ["campo", camposAtivos.map((c) => c.key)],
      ["ação", (p.acoes ?? []).map((a) => a.key)],
      ["item de checklist", (p.checkItens ?? []).map((c) => c.key)],
      ["canal", (p.canais ?? []).map((c) => c.key)],
      ["requisito", (p.requisitos ?? []).map((r) => r.key)],
    ] as const) {
      const vistas = new Set<string>()
      for (const k of lista) {
        if (vistas.has(k)) {
          problemas.push({ codigo: "CHAVE_DUPLICADA", stepKey: p.key,
            mensagem: `Há mais de um ${nome} com a chave "${k}" em "${p.label}".` })
        }
        vistas.add(k)
      }
    }

    // ── OPÇÕES ───────────────────────────────────────────────────────────
    for (const c of camposAtivos) {
      const precisaOpcoes = ["select", "multiselect", "radio"].includes(c.tipo)
      const ativas = (c.opcoes ?? []).filter((o) => o.ativo !== false)
      const legado = c.opcoesLegado
      const temOutraFonte =
        (Array.isArray(legado) && legado.length > 0) ||
        (!!legado && !Array.isArray(legado) && typeof legado === "object" &&
          typeof (legado as { catalogo?: unknown }).catalogo === "string")
      if (precisaOpcoes && (c.opcoes ?? []).length > 0 && ativas.length === 0) {
        problemas.push({ codigo: "CAMPO_SEM_OPCAO_ATIVA", stepKey: p.key,
          mensagem: `O campo "${c.key}" é de escolha e todas as opções dele estão inativas — não haveria o que escolher.` })
      } else if (precisaOpcoes && (c.opcoes ?? []).length === 0 && !temOutraFonte) {
        // NENHUMA fonte de opção: nem cadastrada, nem JSON antigo, nem catálogo. Antes
        // de a opção ter identidade, uma lista vazia queria dizer "o executor decide";
        // agora quer dizer o que diz, e publicar isso entregaria ao operador um campo
        // de escolha sem nada para escolher.
        problemas.push({ codigo: "CAMPO_SEM_OPCAO_ATIVA", stepKey: p.key,
          mensagem: `O campo "${c.key}" é de escolha e não tem nenhuma opção cadastrada em "${p.label}".` })
      }
      // CAMPO OBRIGATÓRIO IMPOSSÍVEL: exigir preenchimento de algo que a condição
      // esconde é pedir ao operador uma coisa que ele não pode ver.
      if (c.obrigatorio && c.condicao != null) {
        problemas.push({ codigo: "CAMPO_OBRIGATORIO_CONDICIONAL", stepKey: p.key,
          mensagem: `O campo "${c.key}" é obrigatório e tem condição de visibilidade: quando a condição for falsa, ele seria exigido sem aparecer. Use um requisito condicional.` })
      }
      for (const pb of validarCondicao(c.condicao, chavesDeCampo, `campo "${c.key}"`)) {
        problemas.push({ codigo: "CONDICAO_INVALIDA", stepKey: p.key, mensagem: `${pb.caminho}: ${pb.mensagem}` })
      }
    }

    // ── CANAIS ───────────────────────────────────────────────────────────
    const cap = capacidadeDoExecutor(exec)
    if ((p.canais ?? []).length > 0 && cap && !cap.suportaCanais) {
      problemas.push({ codigo: "CANAL_SEM_SUPORTE", stepKey: p.key,
        mensagem: `"${p.label}" tem canais cadastrados, e o executor "${exec}" não sabe oferecê-los.` })
    }
    for (const canal of p.canais ?? []) {
      for (const campo of canal.camposObrigatorios ?? []) {
        if (!chavesDeCampo.has(campo)) {
          problemas.push({ codigo: "CANAL_EXIGE_CAMPO_INEXISTENTE", stepKey: p.key,
            mensagem: `O canal "${canal.key}" exige o campo "${campo}", que não está cadastrado em "${p.label}".` })
        }
      }
      for (const pb of validarCondicao(canal.condicao, chavesDeCampo, `canal "${canal.key}"`)) {
        problemas.push({ codigo: "CONDICAO_INVALIDA", stepKey: p.key, mensagem: `${pb.caminho}: ${pb.mensagem}` })
      }
    }

    // ── REQUISITOS ───────────────────────────────────────────────────────
    const chavesChecklist = new Set((p.checkItens ?? []).map((c) => c.key))
    const chavesAcao = new Set((p.acoes ?? []).map((a) => a.key))
    for (const r of (p.requisitos ?? []).filter((x) => x.ativo !== false)) {
      if (r.tipo === "CAMPO_PREENCHIDO" && (!r.alvoKey || !chavesDeCampo.has(r.alvoKey))) {
        problemas.push({ codigo: "REQUISITO_ALVO_INEXISTENTE", stepKey: p.key,
          mensagem: `O requisito "${r.key}" aponta para o campo "${r.alvoKey ?? "—"}", que não existe em "${p.label}".` })
      }
      if (r.tipo === "CHECKLIST_COMPLETO" && r.alvoKey && !chavesChecklist.has(r.alvoKey)) {
        problemas.push({ codigo: "REQUISITO_ALVO_INEXISTENTE", stepKey: p.key,
          mensagem: `O requisito "${r.key}" aponta para o item de checklist "${r.alvoKey}", que não existe em "${p.label}".` })
      }
      if (r.tipo === "ACAO_EXECUTADA" && (!r.alvoKey || !chavesAcao.has(r.alvoKey))) {
        problemas.push({ codigo: "REQUISITO_ALVO_INEXISTENTE", stepKey: p.key,
          mensagem: `O requisito "${r.key}" aponta para a ação "${r.alvoKey ?? "—"}", que não existe em "${p.label}".` })
      }
      if (r.acaoKey && !chavesAcao.has(r.acaoKey)) {
        problemas.push({ codigo: "REQUISITO_ACAO_INEXISTENTE", stepKey: p.key,
          mensagem: `O requisito "${r.key}" se aplica à ação "${r.acaoKey}", que não existe em "${p.label}".` })
      }
      if (r.tipo === "EVIDENCIA_ANEXADA" && cap && !cap.suportaEvidencia) {
        problemas.push({ codigo: "REQUISITO_SEM_SUPORTE", stepKey: p.key,
          mensagem: `O requisito "${r.key}" pede evidência, e o executor "${exec}" não sabe recebê-la.` })
      }
      for (const pb of validarCondicao(r.condicao, chavesDeCampo, `requisito "${r.key}"`)) {
        problemas.push({ codigo: "CONDICAO_INVALIDA", stepKey: p.key, mensagem: `${pb.caminho}: ${pb.mensagem}` })
      }
    }

    // ── AS SUBTAREFAS ─────────────────────────────────────────────────────
    problemas.push(...validarSubtarefas(p, permitidos))
  }

  const ciclo = detectarCiclo(passos)
  if (ciclo) {
    problemas.push({ codigo: "DEPENDENCIA_CICLICA", stepKey: ciclo[0] ?? null,
      mensagem: `As dependências formam um ciclo: ${ciclo.join(" → ")}. Nenhum desses passos ficaria disponível.` })
  }
  return problemas
}

/**
 * VALIDA AS SUBTAREFAS DE UM PASSO.
 *
 * Mesma lógica do passo, um nível abaixo — e por isso os mesmos códigos de problema:
 * o administrador não precisa aprender um segundo vocabulário de erro para descobrir
 * que a dependência aponta para o nada.
 *
 * A DIFERENÇA que importa: dependência de subtarefa só pode apontar para IRMÃ. Deixar
 * apontar para um passo criaria um segundo grafo de dependências atravessando dois
 * níveis — e um ciclo entre eles não teria onde ser detectado.
 */
export function validarSubtarefas(
  p: PassoParaValidar,
  efeitosPermitidosDaFase: Set<string>,
): ProblemaDePublicacao[] {
  const problemas: ProblemaDePublicacao[] = []
  const subs = (p.subtarefas ?? []).filter((st) => st.ativo !== false)
  if (subs.length === 0) {
    // REGRA DE CONCLUSÃO QUE OLHA SUBTAREFA, SEM SUBTAREFA, é um passo que nunca
    // conclui. O default (`ACAO_DO_PASSO`) não cai aqui.
    if (p.regraDeConclusao && p.regraDeConclusao !== "ACAO_DO_PASSO") {
      problemas.push({ codigo: "CONCLUSAO_SEM_SUBTAREFA", stepKey: p.key,
        mensagem: `"${p.label}" conclui por subtarefas (${p.regraDeConclusao}) e não tem nenhuma cadastrada — nunca concluiria.` })
    }
    return problemas
  }

  const chaves = new Set(subs.map((st) => st.key))
  const vistas = new Set<string>()
  for (const st of subs) {
    if (vistas.has(st.key)) {
      problemas.push({ codigo: "CHAVE_DUPLICADA", stepKey: p.key,
        mensagem: `Há mais de uma subtarefa com a chave "${st.key}" em "${p.label}".` })
    }
    vistas.add(st.key)

    // ── DEPENDÊNCIA ─────────────────────────────────────────────────────
    const deps = st.dependeDe ?? []
    for (const d of deps) {
      if (d === st.key) {
        problemas.push({ codigo: "DEPENDENCIA_REFLEXIVA", stepKey: p.key,
          mensagem: `A subtarefa "${st.label}" depende de si mesma — nunca ficaria disponível.` })
      } else if (!chaves.has(d)) {
        problemas.push({ codigo: "DEPENDENCIA_INEXISTENTE", stepKey: p.key,
          mensagem: `A subtarefa "${st.label}" depende de "${d}", que não é subtarefa de "${p.label}".` })
      }
    }
    if (new Set(deps).size !== deps.length) {
      problemas.push({ codigo: "DEPENDENCIA_DUPLICADA", stepKey: p.key,
        mensagem: `A subtarefa "${st.label}" repete a mesma dependência mais de uma vez.` })
    }

    // ── EXECUTOR E EFEITOS ──────────────────────────────────────────────
    const exec = st.executorKey ?? executorEfetivo({ key: p.key, executorKey: p.executorKey }, null)
    const cap = capacidadeDoExecutor(exec)
    if (st.executorKey && !cap) {
      problemas.push({ codigo: "EXECUTOR_INEXISTENTE", stepKey: p.key,
        mensagem: `A subtarefa "${st.label}" declara o executor "${st.executorKey}", que não está no registro.` })
    }
    const chavesDeCampo = new Set((st.campos ?? []).filter((c) => c.ativo !== false).map((c) => c.key))
    const chavesAcao = new Set((st.acoes ?? []).map((a) => a.key))
    const chavesChecklist = new Set((st.checkItens ?? []).filter((c) => c.ativo !== false).map((c) => c.key))

    for (const a of (st.acoes ?? []).filter((x) => x.ativo !== false)) {
      if (!efeitoExiste(a.effectKey)) {
        problemas.push({ codigo: "EFEITO_INEXISTENTE", stepKey: p.key,
          mensagem: `A ação "${a.key}" da subtarefa "${st.label}" aponta para o efeito "${a.effectKey}", que não existe.` })
        continue
      }
      if (!efeitosPermitidosDaFase.has(a.effectKey)) {
        problemas.push({ codigo: "EFEITO_FORA_DE_COMPETENCIA", stepKey: p.key,
          mensagem: `A subtarefa "${st.label}" oferece um resultado que esta fase não tem competência para executar.` })
      }
      if (cap && cap.efeitos !== "*" && !cap.efeitos.includes(a.effectKey)) {
        problemas.push({ codigo: "EFEITO_SEM_SUPORTE", stepKey: p.key,
          mensagem: `A ação "${a.key}" da subtarefa "${st.label}" usa um efeito que o executor "${exec}" não dispara.` })
      }
      for (const campo of a.requerCampos ?? []) {
        if (!chavesDeCampo.has(campo)) {
          problemas.push({ codigo: "ACAO_EXIGE_CAMPO_INEXISTENTE", stepKey: p.key,
            mensagem: `A ação "${a.key}" da subtarefa "${st.label}" exige o campo "${campo}", que não está cadastrado nela.` })
        }
      }
      for (const pb of validarCondicao(a.condicao, chavesDeCampo, `subtarefa "${st.key}" › ação "${a.key}"`)) {
        problemas.push({ codigo: "CONDICAO_INVALIDA", stepKey: p.key, mensagem: `${pb.caminho}: ${pb.mensagem}` })
      }
    }

    // ── SUBTAREFA SEM AÇÃO NENHUMA não pode ser concluída por ninguém ────
    if (st.modoExecucao !== "AUTOMATICA" && (st.acoes ?? []).filter((a) => a.ativo !== false).length === 0) {
      problemas.push({ codigo: "SUBTAREFA_SEM_ACAO", stepKey: p.key,
        mensagem: `A subtarefa "${st.label}" é manual e não tem nenhuma ação — o operador a veria sem poder concluí-la.` })
    }

    // ── CAMPOS E OPÇÕES ─────────────────────────────────────────────────
    for (const c of (st.campos ?? []).filter((x) => x.ativo !== false)) {
      if (!TIPOS_DE_CAMPO.includes(c.tipo as never)) {
        problemas.push({ codigo: "CAMPO_TIPO_DESCONHECIDO", stepKey: p.key,
          mensagem: `O campo "${c.key}" da subtarefa "${st.label}" é do tipo "${c.tipo}", que não existe.` })
      }
      const precisaOpcoes = ["select", "multiselect", "radio"].includes(c.tipo)
      const ativas = (c.opcoes ?? []).filter((o) => o.ativo !== false)
      if (precisaOpcoes && (c.opcoes ?? []).length > 0 && ativas.length === 0) {
        problemas.push({ codigo: "CAMPO_SEM_OPCAO_ATIVA", stepKey: p.key,
          mensagem: `O campo "${c.key}" da subtarefa "${st.label}" é de escolha e todas as opções estão inativas.` })
      }
      if (c.obrigatorio && c.condicao != null) {
        problemas.push({ codigo: "CAMPO_OBRIGATORIO_CONDICIONAL", stepKey: p.key,
          mensagem: `O campo "${c.key}" da subtarefa "${st.label}" é obrigatório e condicional: seria exigido sem aparecer.` })
      }
      for (const pb of validarCondicao(c.condicao, chavesDeCampo, `subtarefa "${st.key}" › campo "${c.key}"`)) {
        problemas.push({ codigo: "CONDICAO_INVALIDA", stepKey: p.key, mensagem: `${pb.caminho}: ${pb.mensagem}` })
      }
    }

    // ── REQUISITOS ──────────────────────────────────────────────────────
    for (const r of (st.requisitos ?? []).filter((x) => x.ativo !== false)) {
      if (r.tipo === "CAMPO_PREENCHIDO" && (!r.alvoKey || !chavesDeCampo.has(r.alvoKey))) {
        problemas.push({ codigo: "REQUISITO_ALVO_INEXISTENTE", stepKey: p.key,
          mensagem: `O requisito "${r.key}" da subtarefa "${st.label}" aponta para o campo "${r.alvoKey ?? "—"}", que não existe nela.` })
      }
      if (r.tipo === "CHECKLIST_COMPLETO" && r.alvoKey && !chavesChecklist.has(r.alvoKey)) {
        problemas.push({ codigo: "REQUISITO_ALVO_INEXISTENTE", stepKey: p.key,
          mensagem: `O requisito "${r.key}" da subtarefa "${st.label}" aponta para o item "${r.alvoKey}", que não existe nela.` })
      }
      if (r.tipo === "ACAO_EXECUTADA" && (!r.alvoKey || !chavesAcao.has(r.alvoKey))) {
        problemas.push({ codigo: "REQUISITO_ALVO_INEXISTENTE", stepKey: p.key,
          mensagem: `O requisito "${r.key}" da subtarefa "${st.label}" aponta para a ação "${r.alvoKey ?? "—"}", que não existe nela.` })
      }
      if (r.acaoKey && !chavesAcao.has(r.acaoKey)) {
        problemas.push({ codigo: "REQUISITO_ACAO_INEXISTENTE", stepKey: p.key,
          mensagem: `O requisito "${r.key}" da subtarefa "${st.label}" se aplica à ação "${r.acaoKey}", que não existe nela.` })
      }
      if (r.tipo === "EVIDENCIA_ANEXADA" && cap && !cap.suportaEvidencia) {
        problemas.push({ codigo: "REQUISITO_SEM_SUPORTE", stepKey: p.key,
          mensagem: `O requisito "${r.key}" da subtarefa "${st.label}" pede evidência, e o executor "${exec}" não sabe recebê-la.` })
      }
      for (const pb of validarCondicao(r.condicao, chavesDeCampo, `subtarefa "${st.key}" › requisito "${r.key}"`)) {
        problemas.push({ codigo: "CONDICAO_INVALIDA", stepKey: p.key, mensagem: `${pb.caminho}: ${pb.mensagem}` })
      }
    }

    // ── CANAIS ──────────────────────────────────────────────────────────
    if (st.fonteDeCanais && st.fonteDeCanais !== "NENHUMA" && cap && !cap.suportaCanais) {
      problemas.push({ codigo: "CANAL_SEM_SUPORTE", stepKey: p.key,
        mensagem: `A subtarefa "${st.label}" usa canais, e o executor "${exec}" não sabe oferecê-los.` })
    }
    if (st.fonteDeCanais === "TIPOS_PERMITIDOS" && (st.tiposDeCanal ?? []).length === 0) {
      problemas.push({ codigo: "CANAL_SEM_TIPO", stepKey: p.key,
        mensagem: `A subtarefa "${st.label}" restringe os canais por tipo e não listou nenhum — não sobraria canal nenhum.` })
    }

    // ── REPETIÇÃO ───────────────────────────────────────────────────────
    if (st.maxOcorrencias != null && !st.repetivel) {
      problemas.push({ codigo: "REPETICAO_INCOERENTE", stepKey: p.key,
        mensagem: `A subtarefa "${st.label}" tem teto de ocorrências e não é repetível.` })
    }

    // ── CONDIÇÕES DA PRÓPRIA SUBTAREFA ──────────────────────────────────
    for (const [nome, cond] of [["entrada", st.condicaoEntrada], ["conclusão", st.condicaoConclusao], ["visibilidade", st.condicaoVisibilidade]] as const) {
      for (const pb of validarCondicao(cond, chavesDeCampo, `subtarefa "${st.key}" › condição de ${nome}`)) {
        problemas.push({ codigo: "CONDICAO_INVALIDA", stepKey: p.key, mensagem: `${pb.caminho}: ${pb.mensagem}` })
      }
    }
  }

  // ── CICLO ENTRE SUBTAREFAS ────────────────────────────────────────────
  const cicloSub = detectarCiclo(subs.map((st) => ({ key: st.key, label: st.label, dependeDe: st.dependeDe ?? [] })))
  if (cicloSub) {
    problemas.push({ codigo: "DEPENDENCIA_CICLICA", stepKey: p.key,
      mensagem: `As subtarefas de "${p.label}" formam um ciclo: ${cicloSub.join(" → ")}. Nenhuma delas ficaria disponível.` })
  }

  return problemas
}

// ── OS MAPEADORES SÃO OS MESMOS PARA PASSO E SUBTAREFA ──────────────────────
// Duplicá-los faria a subtarefa ser validada com menos rigor que o passo, e a
// diferença só apareceria quando algo inválido fosse publicado dentro dela.

function paraValidarAcao(a: {
  key: string; effectKey: string; ativo: boolean; condicao: unknown; requerCampos: unknown
}) {
  return {
    key: a.key, effectKey: a.effectKey, ativo: a.ativo, condicao: a.condicao,
    requerCampos: Array.isArray(a.requerCampos) ? (a.requerCampos as string[]) : null,
  }
}

function paraValidarCampo(c: {
  key: string; tipo: string; ativo: boolean; obrigatorio: boolean; condicao: unknown; opcoes: unknown
  opcoesCadastradas: Array<{ key: string; ativo: boolean }>
}) {
  return {
    key: c.key, tipo: c.tipo, ativo: c.ativo, obrigatorio: c.obrigatorio, condicao: c.condicao,
    opcoes: c.opcoesCadastradas.map((o) => ({ key: o.key, ativo: o.ativo })),
    opcoesLegado: c.opcoes,
  }
}

function paraValidarRequisito(r: {
  key: string; tipo: string; alvoKey: string | null; acaoKey: string | null; condicao: unknown; ativo: boolean
}) {
  return { key: r.key, tipo: r.tipo, alvoKey: r.alvoKey, acaoKey: r.acaoKey, condicao: r.condicao, ativo: r.ativo }
}

/** Resolve competência e valida o workflow como ele está no banco. */
export async function validarWorkflowParaPublicar(workflowId: number, db: DB = prisma): Promise<ProblemaDePublicacao[]> {
  const wf = await db.phaseInternalWorkflow.findUnique({
    where: { id: workflowId },
    include: {
      passos: {
        orderBy: { ordem: "asc" },
        include: {
          // OS FILHOS DO PASSO são os que não pertencem a subtarefa nenhuma — o mesmo
          // filtro do congelamento. Sem ele, o campo da subtarefa seria validado duas
          // vezes, e o requisito dela apontaria para um alvo "inexistente" no passo.
          acoes: { where: { subtaskId: null } },
          campos: { where: { subtaskId: null }, include: { opcoesCadastradas: true } },
          checkItens: { where: { subtaskId: null } },
          canais: { include: { canal: true } },
          requisitos: { where: { subtaskId: null } },
          subtarefas: {
            orderBy: { ordem: "asc" },
            include: {
              acoes: true,
              campos: { include: { opcoesCadastradas: true } },
              checkItens: true,
              requisitos: true,
            },
          },
        },
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
      acoes: p.acoes.map(paraValidarAcao),
      campos: p.campos.map(paraValidarCampo),
      checkItens: p.checkItens.map((c) => ({ key: c.key, ativo: c.ativo })),
      canais: p.canais.map((sc) => ({
        key: sc.canal.key, ativo: sc.ativo,
        camposObrigatorios: Array.isArray(sc.camposObrigatorios) ? (sc.camposObrigatorios as string[]) : null,
        condicao: sc.condicao,
      })),
      requisitos: p.requisitos.map(paraValidarRequisito),
      regraDeConclusao: p.regraDeConclusao,
      subtarefas: p.subtarefas.map((st) => ({
        key: st.key, label: st.label, ativo: st.ativo, obrigatoria: st.obrigatoria,
        repetivel: st.repetivel, maxOcorrencias: st.maxOcorrencias,
        modoExecucao: st.modoExecucao, responsavelRegra: st.responsavelRegra,
        fonteDeCanais: st.fonteDeCanais,
        tiposDeCanal: Array.isArray(st.tiposDeCanal) ? (st.tiposDeCanal as string[]) : null,
        executorKey: st.executorKey,
        dependeDe: Array.isArray(st.dependeDe) ? (st.dependeDe as string[]) : null,
        condicaoEntrada: st.condicaoEntrada,
        condicaoConclusao: st.condicaoConclusao,
        condicaoVisibilidade: st.condicaoVisibilidade,
        acoes: st.acoes.map(paraValidarAcao),
        campos: st.campos.map(paraValidarCampo),
        checkItens: st.checkItens.map((c) => ({ key: c.key, ativo: c.ativo })),
        requisitos: st.requisitos.map(paraValidarRequisito),
      })),
    })),
    { phaseKey: wf.phaseKey, efeitosPermitidosDaFase: permitidos },
  )
}

/** Só para telas: o efeito existe e é usável nesta fase? */
export function efeitoUsavelNaFase(effectKey: string, phaseKey: string, declarados: unknown): boolean {
  return efeitoExiste(effectKey) && efeitosDaFase(phaseKey, declarados).includes(effectKey)
}
