// src/services/requisitos-da-etapa.ts
// ============================================================================
// O QUE FALTA PARA CONCLUIR — cobrado pelo CADASTRO, não pelo executor.
//
// ─── A DISTINÇÃO QUE FALTAVA ────────────────────────────────────────────────
// Campo, item de checklist e evidência são COISAS que a etapa tem. Requisito é uma
// AFIRMAÇÃO sobre elas: "o protocolo precisa estar preenchido", "o checklist precisa
// estar completo", "precisa haver comprovante anexado".
//
// Sem essa separação, "exige comprovante" morava dentro do executor — e mudar isso,
// ou torná-lo condicional ao canal escolhido, era deploy. Pior: o servidor não sabia
// da exigência, então o que a tela cobrava e o que a rota aceitava podiam divergir.
//
// ─── ONDE ELE É COBRADO ─────────────────────────────────────────────────────
// No SERVIDOR, na hora de executar a ação. A tela mostra o que falta para ajudar; a
// recusa vem daqui.
// ============================================================================

import { prisma } from "@/lib/prisma"
import { avaliarCondicao, type Condicao } from "@/src/lib/motor/condicoes"
import type { RequisitoCongelado, CanalCongelado, CampoCongelado, ItemChecklistCongelado } from "@/src/services/versao-publicada"

export interface RequisitoPendente {
  key: string
  label: string
  tipo: string
  alvoKey: string | null
  motivo: string
}

function vazio(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "") ||
    (Array.isArray(v) && v.length === 0)
}

/**
 * O QUE FALTA, dado o que foi preenchido.
 *
 * `acaoKey` restringe aos requisitos daquela ação mais os da conclusão do passo: uma
 * ação de "registrar divergência" não deve cobrar o comprovante que só a conclusão
 * exige.
 */
export async function requisitosPendentes(args: {
  stepInstanceId: number
  requisitos: RequisitoCongelado[]
  campos: CampoCongelado[]
  checklist: ItemChecklistCongelado[]
  canais: CanalCongelado[]
  valores: Record<string, unknown>
  acaoKey?: string | null
}): Promise<RequisitoPendente[]> {
  const ctx = { valores: args.valores }
  const pendentes: RequisitoPendente[] = []

  // ── OS REQUISITOS CADASTRADOS ─────────────────────────────────────────────
  for (const r of args.requisitos.filter((x) => x.ativo !== false && x.obrigatorio)) {
    // Requisito de outra ação não se aplica a esta.
    if (r.acaoKey && r.acaoKey !== args.acaoKey) continue
    if (!avaliarCondicao(r.condicao as Condicao | null, ctx)) continue

    if (r.tipo === "CAMPO_PREENCHIDO") {
      if (vazio(args.valores[r.alvoKey ?? ""])) {
        const campo = args.campos.find((c) => c.key === r.alvoKey)
        pendentes.push({ key: r.key, label: r.label, tipo: r.tipo, alvoKey: r.alvoKey,
          motivo: `Preencha "${campo?.label ?? r.alvoKey}".` })
      }
      continue
    }

    if (r.tipo === "CHECKLIST_COMPLETO") {
      const marcados = (args.valores.checklist ?? {}) as Record<string, unknown>
      const alvos = r.alvoKey
        ? args.checklist.filter((c) => c.key === r.alvoKey)
        : args.checklist.filter((c) => c.obrigatorio && c.ativo !== false)
      const faltando = alvos.filter((c) => marcados[c.key] !== true)
      if (faltando.length > 0) {
        pendentes.push({ key: r.key, label: r.label, tipo: r.tipo, alvoKey: r.alvoKey,
          motivo: `Confira: ${faltando.map((c) => c.label).join(", ")}.` })
      }
      continue
    }

    if (r.tipo === "EVIDENCIA_ANEXADA") {
      // A EVIDÊNCIA É O ARQUIVO QUE JÁ EXISTE. Nada de um segundo sistema de anexos:
      // conta-se o que está vinculado a esta etapa.
      // O arquivo pertence ao DOCUMENTO; a etapa diz de qual documento ela é. Contar
      // pela etapa direto exigiria um vínculo que não existe — e criar esse vínculo
      // seria um segundo sistema de anexos, que o §17 proíbe.
      const passo = await prisma.phaseWorkflowStepInstance.findUnique({
        where: { id: args.stepInstanceId }, select: { documentoId: true },
      })
      const n = passo?.documentoId
        ? await prisma.documentoArquivo.count({ where: { documentoId: passo.documentoId } }).catch(() => 0)
        : 0
      const doValor = Array.isArray(args.valores[r.alvoKey ?? "arquivo"])
        ? (args.valores[r.alvoKey ?? "arquivo"] as unknown[]).length
        : vazio(args.valores[r.alvoKey ?? "arquivo"]) ? 0 : 1
      if (n + doValor < r.minimo) {
        pendentes.push({ key: r.key, label: r.label, tipo: r.tipo, alvoKey: r.alvoKey,
          motivo: r.minimo > 1 ? `Anexe ${r.minimo} evidência(s).` : "Anexe a evidência." })
      }
      continue
    }

    if (r.tipo === "ACAO_EXECUTADA") {
      const jaFeita = args.valores.acao === r.alvoKey ||
        (Array.isArray(args.valores.acoesExecutadas) && (args.valores.acoesExecutadas as string[]).includes(r.alvoKey ?? ""))
      if (!jaFeita) {
        pendentes.push({ key: r.key, label: r.label, tipo: r.tipo, alvoKey: r.alvoKey,
          motivo: `Execute "${r.alvoKey}" antes.` })
      }
    }
  }

  // ── O QUE O CANAL ESCOLHIDO EXIGE ─────────────────────────────────────────
  //
  // Isto vivia dentro do executor de solicitação — a lista de canais e, para cada um,
  // o que ele pedia. Agora vem do cadastro do passo, e é cobrado no servidor.
  const canalEscolhido = typeof args.valores.canal === "string" ? args.valores.canal : null
  if (canalEscolhido) {
    const canal = args.canais.find((c) => c.key === canalEscolhido)
    if (canal) {
      const exige = (cond: boolean, campo: string, rotulo: string) => {
        if (cond && vazio(args.valores[campo])) {
          pendentes.push({ key: `canal:${canal.key}:${campo}`, label: rotulo, tipo: "CAMPO_PREENCHIDO", alvoKey: campo,
            motivo: `O canal "${canal.label}" exige ${rotulo.toLowerCase()}.` })
        }
      }
      exige(canal.exigeProtocolo, "numero_protocolo", "Número do protocolo")
      exige(canal.exigeRastreio, "codigo_rastreio", "Código de rastreio")
      exige(canal.exigeObservacao, "observacao", "Observação do envio")
      if (canal.exigeAnexo && vazio(args.valores.requerimento) && vazio(args.valores.arquivo)) {
        pendentes.push({ key: `canal:${canal.key}:anexo`, label: canal.anexoLabel ?? "Comprovante", tipo: "EVIDENCIA_ANEXADA", alvoKey: null,
          motivo: `O canal "${canal.label}" exige ${(canal.anexoLabel ?? "o comprovante").toLowerCase()}.` })
      }
      for (const campo of canal.camposObrigatorios ?? []) {
        if (vazio(args.valores[campo])) {
          const def = args.campos.find((c) => c.key === campo)
          pendentes.push({ key: `canal:${canal.key}:${campo}`, label: def?.label ?? campo, tipo: "CAMPO_PREENCHIDO", alvoKey: campo,
            motivo: `O canal "${canal.label}" exige "${def?.label ?? campo}".` })
        }
      }
    }
  }

  return pendentes
}
