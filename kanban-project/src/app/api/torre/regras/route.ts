// GET /api/torre/regras — as TRÊS regras da Torre (r1, r2, r3) com estado e descrição (Bloco H3).
// Só r1/r2/r3. A descrição de r2 é LIDA do cadastro real (diasAposCobranca / escalarApos / esperas
// dos passos publicados); a de r3, dos limites cadastrados em Capacidade Operacional.
import { type NextRequest, NextResponse } from 'next/server'
import { exigirGerenciamento } from '@/src/lib/torre-acesso'
import { lerRegras, lerReguaDeCobranca, textoDaRegua } from '@/lib/operacional/regras-torre'
import { lerOrganizacao } from '@/lib/operacional/organizacao'

export async function GET(request: NextRequest) {
  const { erro } = await exigirGerenciamento(request, 'usuarios.gerenciar')
  if (erro) return erro
  const [regras, regua, org] = await Promise.all([lerRegras(), lerReguaDeCobranca(), lerOrganizacao()])
  const limites = [...org.values()].filter((o) => o.limiteExecutaveis != null).map((o) => `${o.nome} ${o.limiteExecutaveis}`)
  const descricao: Record<string, string> = {
    r1: 'Atribui sozinha cada tarefa aberta sem dono à pessoa apta (pela aptidão de país e fase cadastrada) de menor carga, com o desempate do "Precisa de você". Sem apto comprovado, não atribui: a tarefa fica em "Precisa de você". Desligada, não atribui nada.',
    r2: `Lida do cadastro dos passos publicados no Gerenciamento: ${textoDaRegua(regua)}. Desligada, o contato continua sendo registrado, mas a régua não reagenda o acompanhamento nem escala.`,
    r3: limites.length
      ? `Limites cadastrados em Capacidade Operacional: ${limites.join(' · ')}. Ao atingir o limite, a nova tarefa não é atribuída automaticamente a essa pessoa e vai para a fila de decisão ("Precisa de você").`
      : 'Nenhuma pessoa tem limite cadastrado em Capacidade Operacional — a regra não teria o que aplicar. Ao atingir o limite, a nova tarefa vai para a fila de decisão ("Precisa de você").',
  }
  return NextResponse.json({ regras: regras.map((r) => ({ ...r, descricao: descricao[r.chave] })) })
}
