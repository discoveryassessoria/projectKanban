"use client"

// Multi-seleção "Certidões exigidas desta pessoa" (Nascimento / Casamento / Óbito) — abre ABAIXO da caixa "Precisa de documentação".
// Mesmo componente nas duas modais (Adicionar / Editar). A lista é um FILTRO SUBTRATIVO sobre a regra automática da árvore
// (`Pessoa.documentosExigidos`): só retira o que a árvore já pede. Vale para QUALQUER pessoa, inclusive linha reta e requerente.

import { DOCUMENTOS_EXIGIVEIS, type CodigoDocumentoExigivel } from "@/src/lib/genealogia/documentos-exigidos"

export const TEXTO_PRECISA_DOCUMENTACAO =
  "Marque para o sistema gerar os documentos desta pessoa e colocá-la na Central Operacional / workflow, e escolha abaixo quais certidões ela precisa. Se desligado, o sistema não gera os documentos desta pessoa — exceto quem está na linha principal (linha reta ou requerente), que continua entrando."

export function DocumentosExigidosCampo({
  marcados, onChange,
}: {
  marcados: CodigoDocumentoExigivel[]
  onChange: (proximo: CodigoDocumentoExigivel[]) => void
}) {
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
      <p className="text-xs text-[var(--text-muted)] mt-2">
        A lista só retira o que a árvore já pede: marcar Casamento sem casamento na árvore, ou Óbito em pessoa viva, não cria documento. Um
        documento desmarcado NÃO volta sozinho se a pessoa casar ou falecer depois — marque-o de novo nesse caso.
      </p>
      {marcados.length === 0 && (
        <p className="text-xs text-amber-700 mt-2" data-testid="documentos-exigidos-nenhum">
          Nenhum documento marcado. Se isto zerar a exigência de documentos do processo, ele não avança sozinho: espera uma decisão humana.
        </p>
      )}
    </fieldset>
  )
}
