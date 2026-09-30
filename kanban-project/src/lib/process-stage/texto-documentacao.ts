// src/lib/process-stage/texto-documentacao.ts
// ============================================================================
// TEXTO DA DOCUMENTAÇÃO NA ABA GERAL (30/09/2026). Módulo PURO (importável no cliente).
//
// A contagem de "documentos requeridos/recebidos" (`documentacaoRequeridaDoProcesso`) é DA FASE ATIVA: são as certidões que
// a fase atual trabalha. Antes o cartão dizia "0 de 12 documentos recebidos" e o alerta "12 documentos ainda não recebidos"
// sem dizer de qual fase, e parecia contradizer as 12 certidões já localizadas/validadas na Genealogia — que é outro
// trabalho (localizar o registro), não o recebimento do papel. Agora o texto diz a fase ("Emissão documental: 0 de 12
// recebidos") e o alerta é sobre a certidão A RECEBER naquela fase.
// ============================================================================
export function textoDoCartaoDeDocumentacao(a: { recebidos: number; total: number; faseLabel: string | null }): string {
  const base = `${a.recebidos} de ${a.total} ${a.total === 1 ? "certidão recebida" : "certidões recebidas"}`
  return a.faseLabel ? `${a.faseLabel}: ${base}` : base
}

/** `null` = nenhum alerta (nada a receber, ou a fase ativa não trabalha certidões). */
export function textoDoAlertaDeDocumentos(a: { aplicavel: boolean; pendentes: number; faseLabel: string | null }): string | null {
  if (!a.aplicavel || a.pendentes <= 0) return null
  const n = a.pendentes
  const onde = a.faseLabel ? ` na fase ${a.faseLabel}` : ""
  return `${n} ${n === 1 ? "certidão ainda a receber" : "certidões ainda a receber"}${onde}`
}
