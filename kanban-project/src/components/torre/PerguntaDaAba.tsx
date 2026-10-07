// L2 da Lei da Torre: cada aba responde UMA pergunta, escrita no cabeçalho dela. A fonte é `PERGUNTA_DA_ABA` (lib/operacional/torre-abas.ts).
import { PERGUNTA_DA_ABA, type Aba } from "@/lib/operacional/torre-abas"

export function PerguntaDaAba({ aba }: { aba: Aba }) {
  return <div className="tor-aba-pergunta" data-testid="pergunta-da-aba" data-aba-pergunta={aba}>{PERGUNTA_DA_ABA[aba]}</div>
}
