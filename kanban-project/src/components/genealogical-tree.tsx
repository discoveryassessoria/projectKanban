"use client"

import React, { useCallback, useState } from "react"
import ReactFlow, {
  addEdge,
  type Connection,
  useNodesState,
  useEdgesState,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  ReactFlowProvider,
} from "reactflow"
import "reactflow/dist/style.css"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/src/components/ui/badge"
import { Plus, Edit3, Trash2, Users, Calendar, MapPin, Heart, Crown } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Pessoa, Arvore, TreeNode, TreeEdge } from "@/src/types/genealogy"
import { PersonFormDialog } from "@/src/components/person-form-dialog"

// Custom Node Component
const PersonNode = ({ data }: { data: TreeNode["data"] }) => {
  const { pessoa, onAddChild, onAddParent, onAddSpouse, onEdit, onDelete } = data

  const formatDate = (date?: Date) => {
    if (!date) return ""
    return new Date(date).toLocaleDateString("pt-BR", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  }

  const getLifeSpan = () => {
    const birth = pessoa.data_nasc ? formatDate(pessoa.data_nasc) : "?"
    const death = pessoa.data_obito ? formatDate(pessoa.data_obito) : ""
    return death ? `${birth} - ${death}` : birth
  }

  return (
    <Card className="tree-node relative w-64 p-4 bg-white border-2 border-border">
      {/* Action Buttons */}
      <div className="absolute -top-2 -right-2 flex gap-1">
        <Button
          size="sm"
          variant="outline"
          className="tree-action-button h-8 w-8 p-0 bg-transparent"
          onClick={() => onAddChild(pessoa.id)}
          title="Adicionar Filho"
        >
          <Plus className="h-3 w-3" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="tree-action-button h-8 w-8 p-0 bg-transparent"
          onClick={() => onAddParent(pessoa.id, "pai")}
          title="Adicionar Pai"
        >
          <Plus className="h-3 w-3" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="tree-action-button h-8 w-8 p-0 bg-transparent"
          onClick={() => onAddParent(pessoa.id, "mae")}
          title="Adicionar Mãe"
        >
          <Plus className="h-3 w-3" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="tree-action-button h-8 w-8 p-0 bg-transparent"
          onClick={() => onAddSpouse(pessoa.id)}
          title="Adicionar Cônjuge"
        >
          <Plus className="h-3 w-3" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="tree-action-button h-8 w-8 p-0 bg-transparent"
          onClick={() => onEdit(pessoa)}
          title="Editar Pessoa"
        >
          <Edit3 className="h-3 w-3" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="tree-action-button delete h-8 w-8 p-0 bg-transparent"
          onClick={() => onDelete(pessoa.id)}
          title="Excluir Pessoa"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {/* Person Info */}
      <div className="space-y-3">
        <div>
          <h3 className="font-semibold text-lg tree-person-name leading-tight">
            {pessoa.nome} {pessoa.sobrenome || ""}
          </h3>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm tree-person-dates">
            <Calendar className="h-3 w-3" />
            <span>{getLifeSpan()}</span>
          </div>

          {pessoa.local_nasc && (
            <div className="flex items-center gap-2 text-sm tree-person-dates">
              <MapPin className="h-3 w-3" />
              <span>{pessoa.local_nasc}</span>
            </div>
          )}
        </div>

        {/* Badges */}
        <div className="flex flex-wrap gap-1">
          {pessoa.batizado && (
            <Badge variant="secondary" className="text-xs bg-green-100 text-green-800 border-green-200">
              <Crown className="h-2 w-2 mr-1" />
              Batizado
            </Badge>
          )}

          {(pessoa.unioesComoPessoa1?.length || pessoa.unioesComoPessoa2?.length) && (
            <Badge variant="outline" className="text-xs border-pink-200 text-pink-700">
              <Heart className="h-2 w-2 mr-1" />
              Casado
            </Badge>
          )}

          {(pessoa.filhosComoPai?.length || 0) + (pessoa.filhosComoMae?.length || 0) > 0 && (
            <Badge variant="outline" className="text-xs border-blue-200 text-blue-700">
              <Users className="h-2 w-2 mr-1" />
              {(pessoa.filhosComoPai?.length || 0) + (pessoa.filhosComoMae?.length || 0)} filhos
            </Badge>
          )}
        </div>
      </div>
    </Card>
  )
}

const nodeTypes = {
  person: PersonNode,
}

interface GenealogicalTreeProps {
  arvore: Arvore
  onUpdate?: () => void
  className?: string
}

export function GenealogicalTree({ arvore, onUpdate = () => {}, className }: GenealogicalTreeProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  const handleAddChild = async (parentId: number) => {
    setDialogConfig({
      title: "Adicionar Filho",
      description: "Adicione informações sobre o filho desta pessoa.",
      onSubmit: async (data) => {
        const response = await fetch("/api/pessoas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...data,
            arvoreId: arvore.id,
            paiId: parentId,
          }),
        })
        if (response.ok) {
          onUpdate()
        }
      },
    })
    setShowPersonDialog(true)
  }

  const handleAddParent = async (childId: number, parentType: "pai" | "mae") => {
    setDialogConfig({
      title: `Adicionar ${parentType === "pai" ? "Pai" : "Mãe"}`,
      description: `Adicione informações sobre ${parentType === "pai" ? "o pai" : "a mãe"} desta pessoa.`,
      onSubmit: async (data) => {
        const parentData = {
          ...data,
          arvoreId: arvore.id,
        }

        const parentResponse = await fetch("/api/pessoas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parentData),
        })

        if (parentResponse.ok) {
          const newParent = await parentResponse.json()

          // Update child to link to new parent
          const updateData = parentType === "pai" ? { paiId: newParent.id } : { maeId: newParent.id }
          await fetch(`/api/pessoas/${childId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updateData),
          })

          onUpdate()
        }
      },
    })
    setShowPersonDialog(true)
  }

  const handleAddSpouse = async (personId: number) => {
    setDialogConfig({
      title: "Adicionar Cônjuge",
      description: "Adicione informações sobre o cônjuge desta pessoa.",
      onSubmit: async (data) => {
        const spouseResponse = await fetch("/api/pessoas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...data,
            arvoreId: arvore.id,
          }),
        })

        if (spouseResponse.ok) {
          const newSpouse = await spouseResponse.json()

          // Create union between the two people
          await fetch("/api/unioes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              pessoa1Id: personId,
              pessoa2Id: newSpouse.id,
              arvoreId: arvore.id,
            }),
          })

          onUpdate()
        }
      },
    })
    setShowPersonDialog(true)
  }

  const handleEditPerson = async (pessoa: Pessoa) => {
    setDialogConfig({
      title: "Editar Pessoa",
      description: "Atualize as informações desta pessoa.",
      person: pessoa,
      onSubmit: async (data) => {
        const response = await fetch(`/api/pessoas/${pessoa.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...pessoa, ...data }),
        })
        if (response.ok) {
          onUpdate()
        }
      },
    })
    setShowPersonDialog(true)
  }

  const handleDeletePerson = async (pessoaId: number) => {
    if (!confirm("Tem certeza que deseja excluir esta pessoa?")) return

    try {
      const response = await fetch(`/api/pessoas/${pessoaId}`, {
        method: "DELETE",
      })

      if (response.ok) {
        onUpdate()
      } else {
        const error = await response.json()
        alert(error.error || "Erro ao excluir pessoa")
      }
    } catch (error) {
      console.error("Erro ao excluir pessoa:", error)
    }
  }

  // Generate tree layout
  const generateTreeLayout = useCallback(
    (pessoas: Pessoa[]) => {
      const nodeMap = new Map<number, TreeNode>()
      const edgeList: TreeEdge[] = []

      if (!pessoas || pessoas.length === 0) {
        return { nodes: [], edges: [] }
      }

      // Layout configuration
      const LEVEL_HEIGHT = 250
      const NODE_WIDTH = 300
      const SIBLING_SPACING = 80

      // Track positions by generation
      const generationPositions = new Map<number, number>()

      const calculatePosition = (generation: number): { x: number; y: number } => {
        const currentX = generationPositions.get(generation) || 0
        generationPositions.set(generation, currentX + NODE_WIDTH + SIBLING_SPACING)

        return {
          x: currentX,
          y: generation * LEVEL_HEIGHT,
        }
      }

      const processNode = (pessoa: Pessoa, generation = 0, processed = new Set<number>()) => {
        if (processed.has(pessoa.id)) return
        processed.add(pessoa.id)

        const position = calculatePosition(generation)

        const node: TreeNode = {
          id: pessoa.id.toString(),
          type: "person",
          position,
          data: {
            pessoa,
            onAddChild: handleAddChild,
            onAddParent: handleAddParent,
            onAddSpouse: handleAddSpouse,
            onEdit: handleEditPerson,
            onDelete: handleDeletePerson,
          },
        }

        nodeMap.set(pessoa.id, node)

        // Process children
        const allChildren = [...(pessoa.filhosComoPai || []), ...(pessoa.filhosComoMae || [])]

        // Remove duplicates
        const uniqueChildren = allChildren.filter(
          (child, index, arr) => arr.findIndex((c) => c.id === child.id) === index,
        )

        uniqueChildren.forEach((child) => {
          processNode(child, generation + 1, processed)

          const edge: TreeEdge = {
            id: `${pessoa.id}-${child.id}`,
            source: pessoa.id.toString(),
            target: child.id.toString(),
            type: "smoothstep",
            style: {
              stroke: "#2E86C1",
              strokeWidth: 2,
            },
          }

          edgeList.push(edge)
        })
      }

      // Find root nodes (people without parents) or use first person if no clear root
      const rootNodes = pessoas.filter((p) => !p.paiId && !p.maeId)
      const nodesToProcess = rootNodes.length > 0 ? rootNodes : [pessoas[0]]

      const processed = new Set<number>()
      nodesToProcess.forEach((root) => processNode(root, 0, processed))

      // Process any remaining unprocessed nodes
      pessoas.forEach((pessoa) => {
        if (!processed.has(pessoa.id)) {
          processNode(pessoa, 0, processed)
        }
      })

      return {
        nodes: Array.from(nodeMap.values()),
        edges: edgeList,
      }
    },
    [arvore.id, onUpdate],
  )

  // Update nodes and edges when pessoas change
  React.useEffect(() => {
    const { nodes: newNodes, edges: newEdges } = generateTreeLayout(arvore.pessoas || [])
    setNodes(newNodes)
    setEdges(newEdges)
  }, [arvore.pessoas, generateTreeLayout, setNodes, setEdges])

  const onConnect = useCallback((params: Connection) => setEdges((eds) => addEdge(params, eds)), [setEdges])

  // Dialog state and config
  const [showPersonDialog, setShowPersonDialog] = useState(false)
  type DialogConfig = {
    title: string
    description: string
    person?: Pessoa
    onSubmit: (data: Record<string, unknown>) => Promise<void>
  }

  const [dialogConfig, setDialogConfig] = useState<DialogConfig>({
    title: "",
    description: "",
    person: undefined,
    onSubmit: async (_data: Record<string, unknown>) => {},
  })

  return (
    <div className={cn("genealogy-tree w-full h-screen", className)}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{
            padding: 0.2,
            includeHiddenNodes: false,
          }}
          minZoom={0.1}
          maxZoom={2}
          defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
          className="bg-background"
        >
          <Controls
            className="bg-card border border-border rounded-lg shadow-lg"
            showZoom={true}
            showFitView={true}
            showInteractive={true}
          />
          <MiniMap
            className="bg-card border border-border rounded-lg shadow-lg"
            nodeColor="#123C73"
            maskColor="rgba(154, 160, 166, 0.1)"
          />
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e2e8f0" />
        </ReactFlow>
      </ReactFlowProvider>

      {/* PersonFormDialog */}
      <PersonFormDialog
        open={showPersonDialog}
        onOpenChange={setShowPersonDialog}
        title={dialogConfig.title}
        description={dialogConfig.description}
        person={dialogConfig.person}
        onSubmit={dialogConfig.onSubmit}
      />
    </div>
  )
}
