"use client"

// Multi-seleção "Certidões exigidas desta pessoa" (Nascimento / Casamento / Óbito) — abre ABAIXO da caixa "Precisa de documentação".
// Mesmo componente nas duas modais (Adicionar / Editar). A lista é um FILTRO SUBTRATIVO sobre a regra automática da árvore
// (`Pessoa.documentosExigidos`): só retira o que a árvore já pede e só vale para quem está FORA da linha reta do requerente.

import { DOCUMENTOS_EXIGIVEIS, type CodigoDocumentoExigivel } from "@/src/lib/genealogia/documentos-exigidos"

export const TEXTO_PRECISA_DOCUMENTACAO =
  "Vale para pessoas fora da linha reta do requerente. Quem está na linha principal sempre segue a regra automática. Se desligado, o sistema não gera os documentos desta pessoa e ela não entra na Central Operacional / workflow."

export function DocumentosExigidosCampo({
  marcados, onChange, aplicavel,
}: {
  marcados: CodigoDocumentoExigivel[]
  onChange: (proximo: CodigoDocumentoExigivel[]) => void
  /** A pessoa está FORA da linha reta (não é requerente e não está na linha reta)? Só então a lista vale. */
  aplicavel: boolean
}) {
  const alternar = (code: CodigoDocumentoExigivel) =>
    onChange(DOCUMENTOS_EXIGIVEIS.map((d) => d.code).filter((c) => (c === code ? !marcados.includes(c) : marcados.includes(c))))

  return (
    <fieldset className="rounded-lg border border-gray-200 p-3 mt-2 ml-7" data-testid="documentos-exigidos">
      <legend className="px-1 text-xs font-semibold text-gray-700">Certidões exigidas desta pessoa</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {DOCUMENTOS_EXIGIVEIS.map((d) => (
          <label key={d.code} className={`flex items-center gap-2 text-sm ${aplicavel ? "cursor-pointer text-gray-700" : "cursor-not-allowed text-[var(--text-muted)]"}`}>
            <input
              type="checkbox"
              checked={marcados.includes(d.code)}
              disabled={!aplicavel}
              onChange={() => alternar(d.code)}
              className="w-4 h-4 text-amber-600 border-gray-300 rounded focus:ring-[var(--border-strong)]"
            />
            {d.rotulo}
          </label>
        ))}
      </div>
      {aplicavel ? (
        <>
          <p className="text-xs text-[var(--text-muted)] mt-2">
            A lista só retira o que a árvore já pede: marcar Casamento sem casamento na árvore, ou Óbito em pessoa viva, não cria documento. Um
            documento desmarcado NÃO volta sozinho se a pessoa casar ou falecer depois — marque-o de novo nesse caso.
          </p>
          {marcados.length === 0 && (
            <p className="text-xs text-amber-700 mt-2" data-testid="documentos-exigidos-nenhum">
              Nenhum documento marcado. Se isto zerar a exigência de documentos do processo, ele não avança sozinho: espera uma decisão humana.
            </p>
          )}
        </>
      ) : (
        <p className="text-xs text-[var(--text-muted)] mt-2" data-testid="documentos-exigidos-nao-se-aplica">
          Esta pessoa está na linha principal (linha reta ou requerente): a lista não se aplica — vale sempre a regra automática da árvore.
        </p>
      )}
    </fieldset>
  )
}
