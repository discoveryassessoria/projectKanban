// src/lib/documentos/regras-documentais/resumo.ts
//
// Frase-resumo legível de uma regra documental (puro). Usada no construtor de
// condições e na simulação. Não mostra JSON técnico ao usuário.

import { type RegraDocumental, PUBLICO_ALVO_LABEL } from "./tipos"
import { justificativaDoConjunto } from "./condicoes"

export function resumoRegra(regra: RegraDocumental, docLabel?: string): string {
  const doc = docLabel || regra.documentTypeCode
  const publico = PUBLICO_ALVO_LABEL[regra.publicoAlvo] ?? regra.publicoAlvo
  const obr = regra.obrigatoriedade === "OBRIGATORIA" ? "Exige" : "Sugere"
  const temCond = regra.condicoes && regra.condicoes.regras.length > 0
  const cond = temCond ? ` que ${justificativaDoConjunto(regra.condicoes)}` : ""
  const fase = regra.faseExigencia ? ` a partir da fase "${regra.faseExigencia}"` : ""
  const bloqueio = regra.bloqueiaConclusaoFase && regra.faseBloqueio
    ? ` Bloqueia a conclusão da fase "${regra.faseBloqueio}".`
    : ""
  const validade = regra.possuiValidade && regra.validadeDias
    ? ` Possui validade de ${regra.validadeDias} dias${regra.renovarQuandoExpirado ? " (renovável)" : ""}.`
    : ""
  const ateFinal = regra.obrigatorioAteFinalProcesso ? " Permanece necessário até o final do processo." : ""
  return `${obr} ${doc} para ${publico.toLowerCase()}${cond}${fase}.${bloqueio}${validade}${ateFinal}`.trim()
}
