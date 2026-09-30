// src/components/kanban/ProcessoHistorico.tsx
// ============================================================================
// ABA "HISTÓRICO" DO PROCESSO — a linha do tempo de FATOS (um registro por fato real).
// É só a casca da aba: a tela, os filtros, os contadores e as exportações são do componente
// compartilhado `HistoricoDoProcesso`, que o Foco da família na Torre usa igual — mesma
// fonte (`src/services/historico-processo.ts`), duas rotas com a permissão de cada casa.
// (A versão anterior listava LogAuditoria cru por `entidade`; foi aposentada: era a causa de
// "Documentos 0 / Alterações 2" e de códigos técnicos aparecendo na tela.)
// ============================================================================
"use client"

import { HistoricoDoProcesso } from "@/src/components/historico/HistoricoDoProcesso"
import type { LinksDoFato } from "@/lib/operacional/historico-processo"

interface ProcessoHistoricoProps {
  processoId: number
  /** O processo mudou (ex.: uma certidão foi reaberta) — o container invalida Header/Kanban. */
  onUpdate?: () => void
  /** Abrir a certidão no painel da Central Operacional. */
  onAbrirCertidao?: (links: LinksDoFato) => void
  /** Abrir a pessoa na Árvore. */
  onAbrirPessoa?: (pessoaId: number) => void
}

export function ProcessoHistorico({ processoId, onUpdate, onAbrirCertidao, onAbrirPessoa }: ProcessoHistoricoProps) {
  return (
    <div className="h-full overflow-y-auto p-6">
      <HistoricoDoProcesso
        processoId={processoId}
        url={`/api/processos/${processoId}/historico`}
        onMudou={onUpdate}
        onAbrirCertidao={onAbrirCertidao}
        onAbrirPessoa={onAbrirPessoa}
      />
    </div>
  )
}
