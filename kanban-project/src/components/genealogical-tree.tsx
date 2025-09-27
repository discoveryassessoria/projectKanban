"use client"

import type React from "react"
import { useCallback, useState, useMemo, useEffect } from "react"
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
  type Node,
  Position,
} from "reactflow"
import "reactflow/dist/style.css"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/src/components/ui/badge"
import {
  Plus,
  Edit3,
  Trash2,
  Users,
  Calendar,
  MapPin,
  Heart,
  Crown,
  User,
  UserPlus,
  TreePine,
  MessageSquare,
  X,
} from "lucide-react"
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
    const badges: Record<string, { label: string; icon: React.ElementType; color: string }> = {
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
          disabled={!!pessoa.paiId}
          title="Adicionar Pai"
        >
          <User className="h-3 w-3" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-7 p-0 bg-white shadow-md hover:bg-pink-500 hover:text-white border-pink-200"
          onClick={() => onAddParent(pessoa.id, "mae")}
          disabled={!!pessoa.maeId}
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

      <div className="absolute -top-3 left-1/2 -translate-x-1/2">
        {pessoa.sexo === "Masculino" && <User className="h-5 w-5 text-blue-500" />}
        {pessoa.sexo === "Feminino" && <User className="h-5 w-5 text-pink-500" />}
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

export function genealogicalTree({ arvore, onUpdate = () => {}, className }: GenealogicalTreeProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([])

  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge[]>([])
  const [showCommentModal, setShowCommentModal] = useState(false)
  const [treeComment, setTreeComment] = useState(arvore.descricao || "")

  const nodeTypes = useMemo(
    () => ({
      person: PersonNode,
    }),
    [],
  )

  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean
    title: string
    description: string
    onConfirm: () => void
    variant?: "default" | "destructive"
  }>({
    open: false,
    title: "",
    description: "",
    onConfirm: () => {},
  })

  const handleAddChild = useCallback(
    (parentId: number) => {
      setDialogConfig({
        title: "Adicionar Filho",
        description: "Adicione informações sobre o filho desta pessoa.",
        relationshipType: "filho",
        currentPersonId: parentId,
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
    },
    [arvore.id, onUpdate],
  )

  const handleAddParent = useCallback(
    (childId: number, parentType: "pai" | "mae") => {
      setDialogConfig({
        title: `Adicionar ${parentType === "pai" ? "Pai" : "Mãe"}`,
        description: `Adicione informações sobre ${parentType === "pai" ? "o pai" : "a mãe"} desta pessoa.`,
        fixedSexo: parentType === "pai" ? "Masculino" : "Feminino",
        relationshipType: parentType,
        currentPersonId: childId,
        onSubmit: async (data) => {
          try {
            let parentId: number

            if (data.id) {
              // Usando pessoa existente
              parentId = data.id
            } else {
              // Criando nova pessoa
              const parentData = {
                ...data,
                sexo: parentType === "pai" ? "Masculino" : "Feminino",
                arvoreId: arvore.id,
              }

              const parentResponse = await fetch("/api/pessoas", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(parentData),
              })

              if (!parentResponse.ok) {
                const error = await parentResponse.json()
                console.error("Erro ao criar pai/mãe:", error)
                alert(error.error || `Erro ao adicionar ${parentType}`)
                return
              }
              const newParent = await parentResponse.json()
              parentId = newParent.id
            }

            // Atualizar o filho para referenciar o pai/mãe
            const updatePayload = {
              [parentType === "pai" ? "paiId" : "maeId"]: parentId,
            }

            const updateResponse = await fetch(`/api/pessoas/${childId}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(updatePayload),
            })

            if (updateResponse.ok) {
              onUpdate()
            } else {
              const error = await updateResponse.json()
              console.error("Erro ao vincular pai/mãe:", error)
              alert(error.error || `Erro ao vincular ${parentType}`)
            }
          } catch (error) {
            console.error(`Erro ao adicionar ${parentType}:`, error)
            alert(`Erro ao adicionar ${parentType}`)
          }
        },
      })
      setShowPersonDialog(true)
    },
    [arvore.id, onUpdate],
  )

  const handleAddSpouse = useCallback(
    (personId: number) => {
      setDialogConfig({
        title: "Adicionar Cônjuge",
        description: "Adicione informações sobre o cônjuge desta pessoa.",
        fixedSexo: undefined,
        relationshipType: "conjuge",
        currentPersonId: personId,
        onSubmit: async (data) => {
          let spouseId: number

          if (data.id) {
            // Usando pessoa existente
            spouseId = data.id
          } else {
            // Criando nova pessoa
            const spouseResponse = await fetch("/api/pessoas", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...data,
                arvoreId: arvore.id,
              }),
            })

            if (!spouseResponse.ok) {
              const error = await spouseResponse.json()
              console.error("Erro ao criar cônjuge:", error)
              alert(error.error || "Erro ao adicionar cônjuge")
              return
            }
            const newSpouse = await spouseResponse.json()
            spouseId = newSpouse.id
          }

          // Criar união entre as duas pessoas
          const unionResponse = await fetch("/api/unioes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              pessoa1Id: personId,
              pessoa2Id: spouseId,
              tipo: "Casamento",
            }),
          })

          if (unionResponse.ok) {
            onUpdate()
          } else {
            const error = await unionResponse.json()
            if (error.error?.includes("Unique constraint failed")) {
              alert("Erro: Esta união já existe.")
            } else {
              console.error("Erro ao criar união:", error)
              alert(error.error || "Erro ao criar união")
            }
          }
        },
      })
      setShowPersonDialog(true)
    },
    [arvore.id, onUpdate],
  )

  const handleEditPerson = useCallback(
    (pessoa: Pessoa) => {
      setDialogConfig({
        title: "Editar Pessoa",
        description: "Atualize as informações desta pessoa.",
        person: pessoa,
        fixedSexo: undefined,
        onSubmit: async (data) => {
          try {
            const response = await fetch(`/api/pessoas/${pessoa.id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(data),
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
    },
    [onUpdate],
  )

  const handleDeletePerson = useCallback(
    (pessoaId: number) => {
      const pessoa = arvore.pessoas?.find((p) => p.id === pessoaId)
      const personName = pessoa ? `${pessoa.nome} ${pessoa.sobrenome || ""}`.trim() : "esta pessoa"

      setConfirmDialog({
        open: true,
        title: "Confirmar Exclusão",
        description: `Tem certeza que deseja excluir ${personName}? Esta ação não pode ser desfeita.`,
        variant: "destructive",
        onConfirm: async () => {
          try {
            const validId = Number(pessoaId)

            if (isNaN(validId) || validId <= 0) {
              console.log("[v0] Invalid ID detected in frontend")
              setConfirmDialog({
                open: true,
                title: "Erro na Exclusão",
                description: "ID da pessoa inválido. Tente recarregar a página.",
                onConfirm: () => setConfirmDialog((prev) => ({ ...prev, open: false })),
                variant: "destructive",
              })
              return
            }

            const response = await fetch(`/api/pessoas/${validId}`, {
              method: "DELETE",
            })

            if (response.ok) {
              onUpdate()
              setConfirmDialog((prev) => ({ ...prev, open: false }))
            } else {
              const error = await response.json()
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
                variant: "destructive",
              })
            }
          } catch (error) {
            console.error("[v0] Network error during delete:", error)
            setConfirmDialog({
              open: true,
              title: "Erro de Conexão",
              description: "Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.",
              onConfirm: () => setConfirmDialog((prev) => ({ ...prev, open: false })),
              variant: "destructive",
            })
          }
        },
      })
    },
    [arvore.pessoas, onUpdate],
  )

  const handleSaveTreeComment = async () => {
    try {
      const response = await fetch(`/api/arvore/${arvore.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ descricao: treeComment }),
      })
      if (response.ok) {
        onUpdate()
        setShowCommentModal(false)
      } else {
        alert("Erro ao salvar comentário.")
      }
    } catch (error) {
      alert("Erro ao salvar comentário.")
    }
  }

  const generateTreeLayout = useCallback(
    (pessoas: Pessoa[]) => {
      const nodeMap = new Map<number, TreeNode>()
      const edgeList: Edge[] = []

      if (!pessoas || pessoas.length === 0) {
        return { nodes: [], edges: [] }
      }

      // Constantes para layout
      const DEFAULT_X_SPACING = 350
      const DEFAULT_Y_SPACING = 450

      // Criar nós
      pessoas.forEach((pessoa) => {
        const node: TreeNode = {
          id: pessoa.id.toString(),
          type: "person",
          position: {
            x: pessoa.x ?? (Math.random() - 0.5) * DEFAULT_X_SPACING,
            y: pessoa.y ?? (Math.random() - 0.5) * DEFAULT_Y_SPACING,
          },
          data: {
            pessoa: pessoa,
            onAddChild: handleAddChild,
            onAddParent: handleAddParent,
            onAddSpouse: handleAddSpouse,
            onEdit: handleEditPerson,
            onDelete: handleDeletePerson,
          },
        }

        nodeMap.set(pessoa.id, node)
      })

      // Criar arestas (conexões)
      pessoas.forEach((pessoa) => {
        // Conexões pai -> filho
        if (pessoa.paiId && nodeMap.has(pessoa.paiId)) {
          edgeList.push({
            id: `edge-pai-${pessoa.id}`,
            source: pessoa.paiId.toString(),
            target: pessoa.id.toString(),
            type: "smoothstep",
            style: { stroke: "#1e40af", strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: "#1e40af" },
          })
        }
        if (pessoa.maeId && nodeMap.has(pessoa.maeId)) {
          edgeList.push({
            id: `edge-mae-${pessoa.id}`,
            source: pessoa.maeId.toString(),
            target: pessoa.id.toString(),
            type: "smoothstep",
            style: { stroke: "#db2777", strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: "#db2777" },
          })
        }

        // Conexões de casamento
        const unioes = [...(pessoa.unioesComoPessoa1 || []), ...(pessoa.unioesComoPessoa2 || [])]

        unioes.forEach((uniao) => {
          const spouseId = uniao.pessoa1Id === pessoa.id ? uniao.pessoa2Id : uniao.pessoa1Id
          if (nodeMap.has(spouseId)) {
            // Evitar duplicação de arestas
            const edgeExists = edgeList.some(
              (edge) =>
                edge.id === `edge-casamento-${spouseId}-${pessoa.id}` ||
                edge.id === `edge-casamento-${pessoa.id}-${spouseId}`,
            )

            if (!edgeExists) {
              edgeList.push({
                id: `edge-casamento-${pessoa.id}-${spouseId}`,
                source: pessoa.id.toString(),
                target: spouseId.toString(),
                type: "straight",
                style: {
                  stroke: "#dc2626", // Cor vermelha para casamento/união
                  strokeWidth: 3,
                  strokeDasharray: "5 5",
                },
                sourceHandle: "right",
                targetHandle: "left",
              })
            }
          }
        })
      })

      return {
        nodes: Array.from(nodeMap.values()),
        edges: edgeList,
      }
    },
    [arvore.id, handleAddChild, handleAddParent, handleAddSpouse, handleEditPerson, handleDeletePerson],
  )

  const onNodeDragStop = useCallback(
    async (event: React.MouseEvent, node: Node) => {
      const { id, position } = node
      const personId = Number(id)

      if (isNaN(personId)) return

      // Otimisticamente atualiza a UI
      setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, position } : n)))

      // Salva a nova posição no backend
      await fetch(`/api/pessoas/${personId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x: position.x, y: position.y }),
      }).catch((error) => {
        console.error("Falha ao salvar a posição do nó:", error)
        // TODO: Reverter a posição ou notificar o usuário
      })
    },
    [setNodes],
  )

  // Update nodes and edges when pessoas change
  useEffect(() => {
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
    fixedSexo?: "Masculino" | "Feminino"
    relationshipType?: "pai" | "mae" | "filho" | "conjuge"
    currentPersonId?: number
    onSubmit: (data: PersonFormData) => Promise<void>
  }>({
    title: "",
    description: "",
    person: undefined,
    fixedSexo: undefined,
    relationshipType: undefined,
    currentPersonId: undefined,
    onSubmit: async () => {},
  })

  return (
    <div
      className={cn("genealogy-tree w-full bg-gradient-to-br from-slate-50 to-slate-100 relative", className)}
      style={{ height: "calc(100vh - 80px)" }}
    >
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStop={onNodeDragStop}
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

      <div className="absolute bottom-4 left-4 bg-white rounded-lg shadow-lg border border-gray-200 p-4 z-10 max-w-xs flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <h3 className="font-semibold text-sm text-gray-800 flex items-center gap-2">
            <TreePine className="h-4 w-4" />
            Legenda
          </h3>
          <Button size="sm" variant="outline" onClick={() => setShowCommentModal(true)} className="h-7 px-2">
            <MessageSquare className="h-3 w-3 mr-1" /> Comentário
          </Button>
        </div>
        <div className="space-y-3">
          {/* Node Types */}
          <div>
            <h4 className="text-xs font-medium text-gray-700 mb-2">Tipos de Pessoa</h4>
            <div className="space-y-1">
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
                <div className="w-4 h-4 rounded border-2 border-gray-300 bg-white"></div>
                <span className="text-xs text-gray-600">Pessoa Principal</span>
              </div>
            </div>
          </div>

          {/* Line Types */}
          <div className="pt-2 border-t border-gray-200">
            <h4 className="text-xs font-medium text-gray-700 mb-2">Tipos de Ligação</h4>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="flex items-center">
                  <div className="w-4 h-0.5 bg-blue-600"></div>
                  <div className="w-2 h-2 border border-blue-600 bg-blue-600 transform rotate-45 -ml-1"></div>
                </div>
                <span className="text-xs text-gray-600">Parentesco (pai/mãe → filho)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center">
                  <div className="w-4 h-0.5 bg-red-600" style={{ strokeDasharray: "2 2" }}></div>
                </div>
                <span className="text-xs text-gray-600">União (casamento)</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tree Comment Modal */}
      {showCommentModal && (
        <div className="absolute bottom-4 left-4 mb-0 ml-[21rem] bg-white rounded-lg shadow-xl border border-gray-200 p-4 z-20 w-80">
          <div className="flex justify-between items-center mb-2">
            <h4 className="text-base font-semibold text-gray-800">Comentário da Árvore</h4>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setShowCommentModal(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <textarea
            className="w-full p-2 border rounded-md text-sm"
            rows={5}
            value={treeComment}
            onChange={(e) => setTreeComment(e.target.value)}
            placeholder="Adicione um comentário sobre a árvore..."
          />
          <div className="flex justify-end gap-2 mt-3">
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                setTreeComment("")
                handleSaveTreeComment()
              }}
            >
              Excluir
            </Button>
            <Button size="sm" onClick={handleSaveTreeComment} className="bg-blue-600 hover:bg-blue-700">
              Salvar
            </Button>
          </div>
        </div>
      )}

      {/* PersonFormDialog */}
      <PersonFormDialog
        open={showPersonDialog}
        onOpenChange={setShowPersonDialog}
        title={dialogConfig.title}
        description={dialogConfig.description}
        person={dialogConfig.person}
        onSubmit={dialogConfig.onSubmit}
        pessoas={arvore.pessoas}
        fixedSexo={dialogConfig.fixedSexo}
        relationshipType={dialogConfig.relationshipType}
        currentPersonId={dialogConfig.currentPersonId}
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
