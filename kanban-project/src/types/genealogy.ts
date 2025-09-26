import type {
  Pessoa as PrismaPessoa,
  Arvore as PrismaArvore,
  Uniao as PrismaUniao,
} from "@prisma/client"
import type { Node } from "reactflow"

export type Pessoa = PrismaPessoa & {
  pai?: PrismaPessoa
  mae?: PrismaPessoa
  filhosComoPai?: PrismaPessoa[]
  filhosComoMae?: PrismaPessoa[]
  unioesComoPessoa1?: (PrismaUniao & { pessoa2: PrismaPessoa })[]
  unioesComoPessoa2?: (PrismaUniao & { pessoa1: PrismaPessoa })[]
}

export type Uniao = PrismaUniao & {
  pessoa1: Pessoa
  pessoa2: Pessoa
}

export type Arvore = PrismaArvore & {
  pessoas?: Pessoa[]
}

export type TreeNode = Node<{
  pessoa: Pessoa
  relationshipType?: string
  onAddChild: (parentId: number) => void
  onAddParent: (childId: number, parentType: "pai" | "mae") => void
  onAddSpouse: (personId: number) => void
  onEdit: (pessoa: Pessoa) => void
  onDelete: (pessoaId: number) => void
}>

export interface TreeEdge {
  id: string
  source: string
  target: string
  type?: string
  style?: {
    stroke?: string
    strokeWidth?: number
    strokeDasharray?: string
  }
  markerEnd?: {
    type: "arrow" | "arrowclosed"
    color?: string
    width?: number
    height?: number
  }
  label?: string
  labelStyle?: {
    fontSize?: string
    fontWeight?: string
    backgroundColor?: string
    padding?: string
    borderRadius?: string
    border?: string
  }
}
