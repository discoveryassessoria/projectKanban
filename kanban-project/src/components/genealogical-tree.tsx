"use client"

import React, { useCallback, useState, useMemo } from "react"
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
  MarkerType,
  type Edge,
  Handle,
  Position,
} from "reactflow"
import "reactflow/dist/style.css"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/src/components/ui/badge"
import { Plus, Edit3, Trash2, Users, Calendar, MapPin, Heart, Crown, User, UserPlus, TreePine } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Pessoa, Arvore, TreeNode } from "@/src/types/genealogy"
import { PersonFormDialog, type PersonFormData } from "@/src/components/person-form-dialog"
import { ConfirmationDialog } from "@/src/components/confirmation-dialog"

const PersonNode = ({ data }: { data: TreeNode["data"] }) => {
  const { pessoa, onAddChild, onAddParent, onAddSpouse, onEdit, onDelete, relationshipType } = data

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

  const getRelationshipStyle = () => {
    switch (relationshipType) {
      case "pai":
        return "border-blue-500 bg-blue-50 shadow-blue-100"
      case "mae":
        return "border-pink-500 bg-pink-50 shadow-pink-100"
      case "filho":
        return "border-green-500 bg-green-50 shadow-green-100"
      case "conjuge":
        return "border-purple-500 bg-purple-50 shadow-purple-100"
      case "irmao":
        return "border-orange-500 bg-orange-50 shadow-orange-100"
      default:
        return "border-gray-300 bg-white shadow-gray-100"
    }
  }

  const getRelationshipBadge = () => {
    const badges: Record<string, { label: string; icon: typeof User; color: string }> = {
      pai: { label: "Pai", icon: User, color: "bg-blue-100 text-blue-800 border-blue-200" },
      mae: { label: "Mãe", icon: User, color: "bg-pink-100 text-pink-800 border-pink-200" },
      filho: { label: "Filho(a)", icon: UserPlus, color: "bg-green-100 text-green-800 border-green-200" },
      conjuge: { label: "Cônjuge", icon: Heart, color: "bg-purple-100 text-purple-800 border-purple-200" },
      irmao: { label: "Irmão(ã)", icon: Users, color: "bg-orange-100 text-orange-800 border-orange-200" },
    }

    if (relationshipType && relationshipType in badges) {
      const badge = badges[relationshipType]
      const Icon = badge.icon
      return (
        <Badge variant="outline" className={`text-xs ${badge.color} mb-2`}>
          <Icon className="h-2 w-2 mr-1" />
          {badge.label}
        </Badge>
      )
    }
    return null
  }

  return (
    <Card
      className={cn(
        "tree-node group relative w-72 p-4 border-2 transition-all duration-300 hover:shadow-lg",
        getRelationshipStyle(),
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        className="w-3 h-3 bg-blue-500 border-2 border-white shadow-md"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        className="w-3 h-3 bg-green-500 border-2 border-white shadow-md"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        className="w-3 h-3 bg-purple-500 border-2 border-white shadow-md"
      />
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        className="w-3 h-3 bg-purple-500 border-2 border-white shadow-md"
      />

      <div className="absolute -top-3 -right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-7 p-0 bg-white shadow-md hover:bg-green-500 hover:text-white border-green-200"
          onClick={() => onAddChild(pessoa.id)}
          title="Adicionar Filho"
        >
          <Plus className="h-3 w-3" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-7 p-0 bg-white shadow-md hover:bg-blue-500 hover:text-white border-blue-200"
          onClick={() => onAddParent(pessoa.id, "pai")}
          title="Adicionar Pai"
        >
          <User className="h-3 w-3" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-7 p-0 bg-white shadow-md hover:bg-pink-500 hover:text-white border-pink-200"
          onClick={() => onAddParent(pessoa.id, "mae")}
          title="Adicionar Mãe"
        >
          <User className="h-3 w-3" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-7 p-0 bg-white shadow-md hover:bg-purple-500 hover:text-white border-purple-200"
          onClick={() => onAddSpouse(pessoa.id)}
          title="Adicionar Cônjuge"
        >
          <Heart className="h-3 w-3" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-7 p-0 bg-white shadow-md hover:bg-yellow-500 hover:text-white border-yellow-200"
          onClick={() => onEdit(pessoa)}
          title="Editar"
        >
          <Edit3 className="h-3 w-3" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-7 p-0 bg-white shadow-md hover:bg-red-500 hover:text-white border-red-200"
          onClick={() => onDelete(pessoa.id)}
          title="Excluir"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {getRelationshipBadge()}

      {/* Person Info */}
      <div className="space-y-3">
        <div>
          <h3 className="font-bold text-lg text-gray-800 leading-tight">
            {pessoa.nome} {pessoa.sobrenome || ""}
          </h3>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Calendar className="h-3 w-3" />
            <span>{getLifeSpan()}</span>
          </div>

          {pessoa.local_nasc && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <MapPin className="h-3 w-3" />
              <span className="truncate">{pessoa.local_nasc}</span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-1">
          {pessoa.batizado && (
            <Badge variant="secondary" className="text-xs bg-emerald-100 text-emerald-800 border-emerald-200">
              <Crown className="h-2 w-2 mr-1" />
              Batizado
            </Badge>
          )}

          {(pessoa.unioesComoPessoa1?.length || pessoa.unioesComoPessoa2?.length) && (
            <Badge variant="outline" className="text-xs border-rose-200 text-rose-700 bg-rose-50">
              <Heart className="h-2 w-2 mr-1" />
              Casado
            </Badge>
          )}

          {(pessoa.filhosComoPai?.length || 0) + (pessoa.filhosComoMae?.length || 0) > 0 && (
            <Badge variant="outline" className="text-xs border-indigo-200 text-indigo-700 bg-indigo-50">
              <Users className="h-2 w-2 mr-1" />
              {(pessoa.filhosComoPai?.length || 0) + (pessoa.filhosComoMae?.length || 0)} filhos
            </Badge>
          )}
        </div>
      </div>
    </Card>
  )
}

interface GenealogicalTreeProps {
  arvore: Arvore
  onUpdate?: () => void
  className?: string
}

export function GenealogicalTree({ arvore, onUpdate = () => {}, className }: GenealogicalTreeProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge[]>([])

  const nodeTypes = useMemo(
    () => ({
      person: PersonNode,
    }),
    [],
  )

  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    title: "",
    description: "",
    onConfirm: () => {},
  })

  const handleAddChild = async (parentId: number) => {
    setDialogConfig({
      title: "Adicionar Filho",
      description: "Adicione informações sobre o filho desta pessoa.",
      onSubmit: async (data) => {
        try {
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
          } else {
            const error = await response.json()
            alert(error.error || "Erro ao adicionar filho")
          }
        } catch (error) {
          console.error("Erro ao adicionar filho:", error)
          alert("Erro ao adicionar filho")
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
        try {
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
            const updateResponse = await fetch(`/api/pessoas/${childId}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(updateData),
            })

            if (updateResponse.ok) {
              onUpdate()
            } else {
              const error = await updateResponse.json()
              alert(error.error || `Erro ao vincular ${parentType}`)
            }
          } else {
            const error = await parentResponse.json()
            alert(error.error || `Erro ao adicionar ${parentType}`)
          }
        } catch (error) {
          console.error(`Erro ao adicionar ${parentType}:`, error)
          alert(`Erro ao adicionar ${parentType}`)
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
        try {
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
            const unionResponse = await fetch("/api/unioes", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                pessoa1Id: personId,
                pessoa2Id: newSpouse.id,
                arvoreId: arvore.id,
              }),
            })

            if (unionResponse.ok) {
              onUpdate()
            } else {
              const error = await unionResponse.json()
              alert(error.error || "Erro ao criar união")
            }
          } else {
            const error = await spouseResponse.json()
            alert(error.error || "Erro ao adicionar cônjuge")
          }
        } catch (error) {
          console.error("Erro ao adicionar cônjuge:", error)
          alert("Erro ao adicionar cônjuge")
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
        try {
          const response = await fetch(`/api/pessoas/${pessoa.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...pessoa, ...data }),
          })
          if (response.ok) {
            onUpdate()
          } else {
            const error = await response.json()
            alert(error.error || "Erro ao atualizar pessoa")
          }
        } catch (error) {
          console.error("Erro ao atualizar pessoa:", error)
          alert("Erro ao atualizar pessoa")
        }
      },
    })
    setShowPersonDialog(true)
  }

  const handleDeletePerson = async (pessoaId: number) => {
    const pessoa = arvore.pessoas?.find((p) => p.id === pessoaId)
    const personName = pessoa ? `${pessoa.nome} ${pessoa.sobrenome || ""}`.trim() : "esta pessoa"

    console.log("[v0] Delete requested for person ID:", pessoaId, "type:", typeof pessoaId)
    console.log("[v0] Person found in tree:", pessoa ? "Yes" : "No")

    setConfirmDialog({
      open: true,
      title: "Confirmar Exclusão",
      description: `Tem certeza que deseja excluir ${personName}? Esta ação não pode ser desfeita.`,
      onConfirm: async () => {
        try {
          const validId = Number(pessoaId)
          console.log("[v0] Converted ID:", validId, "isNaN:", isNaN(validId))

          if (isNaN(validId) || validId <= 0) {
            console.log("[v0] Invalid ID detected in frontend")
            setConfirmDialog({
              open: true,
              title: "Erro na Exclusão",
              description: "ID da pessoa inválido. Tente recarregar a página.",
              onConfirm: () => setConfirmDialog((prev) => ({ ...prev, open: false })),
            })
            return
          }

          console.log("[v0] Making DELETE request to:", `/api/pessoas/${validId}`)
          const response = await fetch(`/api/pessoas/${validId}`, {
            method: "DELETE",
          })

          console.log("[v0] Response status:", response.status)
          console.log("[v0] Response ok:", response.ok)

          if (response.ok) {
            console.log("[v0] Delete successful, updating tree")
            onUpdate()
            setConfirmDialog((prev) => ({ ...prev, open: false }))
          } else {
            const error = await response.json()
            console.log("[v0] Delete failed with error:", error)

            let errorMessage = "Erro ao excluir pessoa"

            if (error.error === "Não é possível excluir uma pessoa que possui filhos") {
              errorMessage = "Não é possível excluir uma pessoa que possui filhos. Remova os filhos primeiro."
            } else if (error.error === "Pessoa não encontrada") {
              errorMessage = "Esta pessoa não foi encontrada no sistema."
            } else if (error.error === "ID inválido") {
              errorMessage = "Erro interno: ID da pessoa inválido. Tente recarregar a página."
            } else if (error.error) {
              errorMessage = error.error
            }

            setConfirmDialog({
              open: true,
              title: "Erro na Exclusão",
              description: errorMessage,
              onConfirm: () => setConfirmDialog((prev) => ({ ...prev, open: false })),
            })
          }
        } catch (error) {
          console.error("[v0] Network error during delete:", error)
          setConfirmDialog({
            open: true,
            title: "Erro de Conexão",
            description: "Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.",
            onConfirm: () => setConfirmDialog((prev) => ({ ...prev, open: false })),
          })
        }
      },
    })
  }

  const generateTreeLayout = useCallback(
    (pessoas: Pessoa[]) => {
      const nodeMap = new Map<number, TreeNode>()
      const edgeList: Edge[] = []

      if (!pessoas || pessoas.length === 0) {
        return { nodes: [], edges: [] }
      }

      const LEVEL_HEIGHT = 300
      const NODE_WIDTH = 320
      const SIBLING_SPACING = 50
      const GENERATION_OFFSET = 100

      // Track positions and relationships
      const generationPositions = new Map<number, number>()
      const relationshipMap = new Map<number, string>()

      const calculatePosition = (generation: number, isSpouse = false): { x: number; y: number } => {
        const currentX = generationPositions.get(generation) || 0
        const spacing = isSpouse ? NODE_WIDTH / 2 : NODE_WIDTH + SIBLING_SPACING
        generationPositions.set(generation, currentX + spacing)

        return {
          x: currentX,
          y: generation * LEVEL_HEIGHT + (isSpouse ? GENERATION_OFFSET / 2 : 0),
        }
      }

      const determineRelationshipType = (pessoa: Pessoa, context: { parentId?: number; isSpouse?: boolean }) => {
        if (context.isSpouse) return "conjuge"
        if (context.parentId) {
          const parent = pessoas.find((p) => p.id === context.parentId)
          if (parent) {
            if (parent.filhosComoPai?.some((f) => f.id === pessoa.id)) return "filho"
            if (parent.filhosComoMae?.some((f) => f.id === pessoa.id)) return "filho"
          }
        }
        if (pessoa.paiId || pessoa.maeId) {
          // Check if this person is a parent of others
          const isParent = pessoas.some((p) => p.paiId === pessoa.id || p.maeId === pessoa.id)
          if (isParent) {
            // Determine if pai or mae based on gender or existing relationships
            const childrenAsPai = pessoa.filhosComoPai?.length || 0
            const childrenAsMae = pessoa.filhosComoMae?.length || 0
            return childrenAsPai > childrenAsMae ? "pai" : "mae"
          }
          return "filho"
        }
        return undefined
      }

      const processNode = (
        pessoa: Pessoa,
        generation = 0,
        processed = new Set<number>(),
        context: { parentId?: number; isSpouse?: boolean } = {},
      ) => {
        if (processed.has(pessoa.id)) return
        processed.add(pessoa.id)

        const relationshipType = determineRelationshipType(pessoa, context)
        if (relationshipType) {
          relationshipMap.set(pessoa.id, relationshipType)
        }

        const position = calculatePosition(generation, context.isSpouse)

        const node: TreeNode = {
          id: pessoa.id.toString(),
          type: "person",
          position,
          data: {
            pessoa,
            relationshipType,
            onAddChild: handleAddChild,
            onAddParent: handleAddParent,
            onAddSpouse: handleAddSpouse,
            onEdit: handleEditPerson,
            onDelete: handleDeletePerson,
          },
        }

        nodeMap.set(pessoa.id, node)

        const spouses = [
          ...(pessoa.unioesComoPessoa1 || []).map((u) => u.pessoa2),
          ...(pessoa.unioesComoPessoa2 || []).map((u) => u.pessoa1),
        ].filter(Boolean)

        spouses.forEach((spouse) => {
          if (!processed.has(spouse.id)) {
            processNode(spouse, generation, processed, { isSpouse: true })

            const marriageEdge: Edge = {
              id: `marriage-${pessoa.id}-${spouse.id}`,
              source: pessoa.id.toString(),
              target: spouse.id.toString(),
              sourceHandle: "right",
              targetHandle: "left",
              type: "straight",
              style: {
                stroke: "#dc2626",
                strokeWidth: 6,
                strokeDasharray: "10,5",
              },
              label: "💕",
              labelStyle: {
                fontSize: "18px",
                fontWeight: "bold",
                backgroundColor: "white",
                padding: "4px 8px",
                borderRadius: "16px",
                border: "2px solid #dc2626",
                boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
              },
            }
            edgeList.push(marriageEdge)
          }
        })

        // Process children (next generation)
        const allChildren = [...(pessoa.filhosComoPai || []), ...(pessoa.filhosComoMae || [])]
        const uniqueChildren = allChildren.filter(
          (child, index, arr) => arr.findIndex((c) => c.id === child.id) === index,
        )

        uniqueChildren.forEach((child) => {
          processNode(child, generation + 1, processed, { parentId: pessoa.id })

          const parentChildEdge: Edge = {
            id: `parent-${pessoa.id}-${child.id}`,
            source: pessoa.id.toString(),
            target: child.id.toString(),
            sourceHandle: "bottom",
            targetHandle: "top",
            type: "smoothstep",
            style: {
              stroke: "#1e40af",
              strokeWidth: 4,
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: "#1e40af",
              width: 24,
              height: 24,
            },
            label: "👶",
            labelStyle: {
              fontSize: "16px",
              fontWeight: "bold",
              backgroundColor: "white",
              padding: "2px 6px",
              borderRadius: "12px",
              border: "1px solid #1e40af",
              boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
            },
          }
          edgeList.push(parentChildEdge)
        })
      }

      // Find root nodes or use first person
      const rootNodes = pessoas.filter((p) => !p.paiId && !p.maeId)
      const nodesToProcess = rootNodes.length > 0 ? rootNodes : [pessoas[0]]

      const processed = new Set<number>()
      nodesToProcess.forEach((root) => processNode(root, 0, processed))

      // Process remaining unprocessed nodes
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
  const [dialogConfig, setDialogConfig] = useState<{
    title: string
    description: string
    person?: Pessoa
    onSubmit: (data: PersonFormData) => Promise<void>
  }>({
    title: "",
    description: "",
    person: undefined,
    onSubmit: async () => {},
  })

  return (
    <div
      className={cn("genealogy-tree w-full bg-gradient-to-br from-slate-50 to-slate-100 relative", className)}
      style={{ height: "calc(100vh - 80px)" }} // Fixed height to account for header
    >
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
            padding: 0.3,
            includeHiddenNodes: false,
            minZoom: 0.1,
            maxZoom: 1.5,
          }}
          minZoom={0.05}
          maxZoom={2}
          defaultViewport={{ x: 0, y: 0, zoom: 0.6 }}
          className="bg-gradient-to-br from-slate-50 to-slate-100"
        >
          <Controls
            className="bg-white border border-gray-200 rounded-lg shadow-lg"
            showZoom={true}
            showFitView={true}
            showInteractive={true}
          />
          <MiniMap
            className="bg-white border border-gray-200 rounded-lg shadow-lg"
            nodeColor={(node) => {
              const relationshipType = node.data?.relationshipType
              switch (relationshipType) {
                case "pai":
                  return "#3b82f6"
                case "mae":
                  return "#ec4899"
                case "filho":
                  return "#10b981"
                case "conjuge":
                  return "#8b5cf6"
                case "irmao":
                  return "#f59e0b"
                default:
                  return "#6b7280"
              }
            }}
            maskColor="rgba(0, 0, 0, 0.1)"
          />
          <Background variant={BackgroundVariant.Dots} gap={25} size={1} color="#e2e8f0" />
        </ReactFlow>
      </ReactFlowProvider>

      <div className="absolute bottom-4 left-4 bg-white rounded-lg shadow-lg border border-gray-200 p-4 z-10 max-w-xs">
        <h3 className="font-semibold text-sm text-gray-800 mb-3 flex items-center gap-2">
          <TreePine className="h-4 w-4" />
          Legenda
        </h3>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded border-2 border-blue-500 bg-blue-50"></div>
            <span className="text-xs text-gray-600">Pai</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded border-2 border-pink-500 bg-pink-50"></div>
            <span className="text-xs text-gray-600">Mãe</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded border-2 border-green-500 bg-green-50"></div>
            <span className="text-xs text-gray-600">Filho(a)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded border-2 border-purple-500 bg-purple-50"></div>
            <span className="text-xs text-gray-600">Cônjuge</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded border-2 border-orange-500 bg-orange-50"></div>
            <span className="text-xs text-gray-600">Irmão(ã)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded border-2 border-gray-300 bg-white"></div>
            <span className="text-xs text-gray-600">Pessoa Principal</span>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-6 h-0.5 bg-blue-700"></div>
            <span className="text-xs text-gray-600">Parentesco</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-6 h-0.5 bg-red-600"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(to right, #dc2626 0, #dc2626 8px, transparent 8px, transparent 12px)",
              }}
            ></div>
            <span className="text-xs text-gray-600">Casamento</span>
          </div>
        </div>
      </div>

      {/* PersonFormDialog */}
      <PersonFormDialog
        open={showPersonDialog}
        onOpenChange={setShowPersonDialog}
        title={dialogConfig.title}
        description={dialogConfig.description}
        person={dialogConfig.person}
        onSubmit={dialogConfig.onSubmit}
      />

      <ConfirmationDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog((prev) => ({ ...prev, open }))}
        title={confirmDialog.title}
        description={confirmDialog.description}
        onConfirm={confirmDialog.onConfirm}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
      />
    </div>
  )
}
