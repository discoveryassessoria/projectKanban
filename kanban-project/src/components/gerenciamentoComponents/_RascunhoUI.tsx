'use client'

// src/components/gerenciamentoComponents/_RascunhoUI.tsx
//
// HONESTIDADE DAS TELAS-RASCUNHO (reestruturação 25/07).
// Algumas telas do Gerenciamento foram portadas do mockup e nunca chegaram a ser
// ligadas ao banco: a estrutura (colunas, filtros, formulários) está correta, mas
// listar/salvar ainda não persiste. Elas continuam no menu oficial — não são
// órfãs e nada foi apagado — porém:
//   • suas ações são renderizadas DESABILITADAS com tooltip honesto (nunca um
//     botão que parece funcionar e não faz nada);
//   • um aviso no topo diz claramente que os números/linhas não vêm do banco,
//     para nenhum dado falso ser lido como real.
// Nenhuma regra de negócio, rota ou dado é afetado por este arquivo.

export const TITULO_RASCUNHO =
  'Ação indisponível: esta tela ainda não está conectada ao banco.'

export const BTN_RASCUNHO =
  'cursor-not-allowed rounded-lg border border-[var(--border-default)] px-3 py-1.5 text-xs font-medium text-[var(--text-muted)]'

export function AvisoRascunho({ children }: { children?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-start gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-2.5 text-[12.5px] text-amber-100/90">
      <span aria-hidden="true" className="mt-[1px]">⚠️</span>
      <span>
        {children ?? (
          <>
            Tela ainda <span className="font-semibold">não conectada ao banco</span>: a estrutura está definida,
            mas a listagem e o cadastro não persistem. Os valores exibidos não representam dados reais.
          </>
        )}
      </span>
    </div>
  )
}
