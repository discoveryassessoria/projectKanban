// src/lib/process-stage/canais-fonte.ts
// ============================================================================
// DE ONDE VÊM OS CANAIS — do cadastro.
//
// `canais-solicitacao.ts` continua existindo com a mesma lista, e por dois motivos
// legítimos: ela é a SEMENTE do cadastro (o script de seed a copia com os mesmos
// valores) e é a PROVA de regressão (o teste compara cadastro contra ela e falha se
// divergirem). O que ela deixou de ser é a fonte que o runtime consulta.
//
// A ordem da troca importa: primeiro o cadastro passou a existir com valores
// idênticos, depois a comparação provou a equivalência, e só então a leitura mudou
// de lugar. Nunca houve um instante em que o sistema não soubesse quais canais
// existem.
//
// ─── QUANDO A TABELA ESTÁ VAZIA ─────────────────────────────────────────────
// Antes de o seed rodar — e só até lá — a lista em código responde. Isso não é um
// caminho paralelo permanente: é o que evita uma janela de deploy em que o
// operador abre a tela de solicitação e não há canal nenhum. O health check acusa
// a tabela vazia como pendência, para que a janela não vire estado.
// ============================================================================

import { prisma } from "@/lib/prisma"
import { CANAIS_SOLICITACAO, type ConfigCanal } from "./canais-solicitacao"
import type { CanalSolicitacaoDocumento } from "@prisma/client"

export interface CanalResolvido extends ConfigCanal {
  ativo: boolean
  ordem: number
  /** `true` = veio do cadastro; `false` = a semente respondeu (tabela ainda vazia). */
  doCadastro: boolean
}

/** Todos os canais utilizáveis, na ordem cadastrada. */
export async function canaisVigentes(apenasAtivos = true): Promise<CanalResolvido[]> {
  const linhas = await prisma.canalOperacional.findMany({
    where: apenasAtivos ? { ativo: true } : undefined,
    orderBy: [{ ordem: "asc" }, { id: "asc" }],
  })
  if (linhas.length > 0) {
    return linhas.map((c) => ({
      canal: c.key as CanalSolicitacaoDocumento,
      label: c.label,
      descricao: c.descricao ?? "",
      protocoloObrigatorio: c.protocoloObrigatorio,
      anexoObrigatorioLabel: c.anexoObrigatorioLabel,
      rastreioObrigatorio: c.rastreioObrigatorio,
      observacaoObrigatoria: c.observacaoObrigatoria,
      ativo: c.ativo,
      ordem: c.ordem,
      doCadastro: true,
    }))
  }
  return CANAIS_SOLICITACAO.map((c, i) => ({ ...c, ativo: true, ordem: i + 1, doCadastro: false }))
}

/** A configuração de um canal, pelo cadastro. `null` = canal desconhecido. */
export async function canalVigente(key: string): Promise<CanalResolvido | null> {
  return (await canaisVigentes(false)).find((c) => c.canal === key) ?? null
}

/**
 * O QUE FALTA para enviar por este canal, segundo o CADASTRO.
 *
 * Mesma resposta que `faltamCamposDoCanal` dava a partir da lista em código —
 * `scripts/cadastro-canonico.test.ts` compara as duas para cada canal e falha se
 * divergirem. O que mudou é que agora um canal cadastrado hoje também é validado.
 */
export async function faltamCamposDoCanalCadastrado(e: {
  canal: string
  numeroProtocolo?: string | null
  anexoUrl?: string | null
  codigoRastreio?: string | null
  observacao?: string | null
  destinatarioNome?: string | null
}): Promise<string[]> {
  const cfg = await canalVigente(e.canal)
  if (!cfg) return ["CANAL_INVALIDO"]
  const faltando: string[] = []
  if (cfg.protocoloObrigatorio && !(e.numeroProtocolo ?? "").trim()) faltando.push("NUMERO_PROTOCOLO")
  if (cfg.anexoObrigatorioLabel && !(e.anexoUrl ?? "").trim()) faltando.push("REQUERIMENTO")
  if (cfg.rastreioObrigatorio && !(e.codigoRastreio ?? "").trim()) faltando.push("CODIGO_RASTREIO")
  if (cfg.observacaoObrigatoria && !(e.observacao ?? "").trim()) faltando.push("OBSERVACAO")
  if (!(e.destinatarioNome ?? "").trim()) faltando.push("DESTINATARIO")
  return faltando
}
