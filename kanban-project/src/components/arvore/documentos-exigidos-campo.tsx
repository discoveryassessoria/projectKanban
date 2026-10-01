"use client"

// Multi-seleção "Certidões exigidas desta pessoa" (Nascimento / Casamento / Óbito) — abre ABAIXO da caixa "Precisa de documentação".
// Mesmo componente nas duas modais (Adicionar / Editar). A lista é um FILTRO SUBTRATIVO sobre a regra automática da árvore
// (`Pessoa.documentosExigidos`): só retira o que a árvore já pede. Vale para QUALQUER pessoa, inclusive linha reta e requerente.

import { DOCUMENTOS_EXIGIVEIS, situacaoDosDocumentosMarcados, type CodigoDocumentoExigivel, type FatosParaDocumentos } from "@/src/lib/genealogia/documentos-exigidos"

export const TEXTO_PRECISA_DOCUMENTACAO =
  "Marque para o sistema gerar os documentos desta pessoa e colocá-la na Central Operacional / workflow, e escolha abaixo quais certidões ela precisa. Se desligado, o sistema não gera os documentos desta pessoa — exceto quem está na linha principal (linha reta ou requerente), que continua entrando."

export function DocumentosExigidosCampo({
  marcados, onChange, fatos,
}: {
  marcados: CodigoDocumentoExigivel[]
  onChange: (proximo: CodigoDocumentoExigivel[]) => void
  /** O que a árvore sabe desta pessoa agora (falecida? casamento?): é o que decide se Casamento/Óbito marcados serão gerados. */
  fatos: FatosParaDocumentos
}) {
  // Só os MARCADOS que a árvore ainda não sustenta ganham aviso — nada de texto genérico.
  const semFato = situacaoDosDocumentosMarcados(marcados, fatos).filter((d) => !d.gera)
  const alternar = (code: CodigoDocumentoExigivel) =>
    onChange(DOCUMENTOS_EXIGIVEIS.map((d) => d.code).filter((c) => (c === code ? !marcados.includes(c) : marcados.includes(c))))

  return (
    <fieldset className="rounded-lg border border-gray-200 p-3 mt-2 ml-7" data-testid="documentos-exigidos">
      <legend className="px-1 text-xs font-semibold text-gray-700">Certidões exigidas desta pessoa</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {DOCUMENTOS_EXIGIVEIS.map((d) => (
          <label key={d.code} className="flex items-center gap-2 text-sm cursor-pointer text-gray-700">
            <input
              type="checkbox"
              checked={marcados.includes(d.code)}
              onChange={() => alternar(d.code)}
              className="w-4 h-4 text-amber-600 border-gray-300 rounded focus:ring-[var(--border-strong)]"
            />
            {d.rotulo}
          </label>
        ))}
      </div>
      {semFato.map((d) => (
        <p key={d.code} className="text-xs text-amber-800 mt-2" data-testid={`documentos-exigidos-aviso-${d.code}`}>
          <strong>{d.rotulo}:</strong> {d.aviso}
        </p>
      ))}
      {marcados.length === 0 && (
        <p className="text-xs text-amber-700 mt-2" data-testid="documentos-exigidos-nenhum">
          Nenhum documento marcado. Se isto zerar a exigência de documentos do processo, ele não avança sozinho: espera uma decisão humana.
        </p>
      )}
    </fieldset>
  )
}
