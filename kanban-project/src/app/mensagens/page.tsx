// src/app/mensagens/page.tsx
"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { getStoredUser, isAuthenticated } from "@/lib/auth"
import { HeaderBar } from "@/src/components/header-bar"
import { Send, MessageCircle, ArrowLeft, Pencil, Trash2, X, Check } from "lucide-react"

interface User {
  id: number
  nome: string
  email: string
  tipo: string
}

interface Conversa {
  processoId: number
  processoNome: string
  pais: string
  naoLidas: number
  ultimaMensagem: {
    conteudo: string
    data: string
    remetente: string
  } | null
}

interface Mensagem {
  id: number
  conteudo: string
  data: string
  ehEquipe: boolean
  remetente: string
  editadoEm: string | null
  usuarioId: number | null
}

const BANDEIRAS: Record<string, string> = {
  ITALIA: "🇮🇹",
  PORTUGAL: "🇵🇹",
  ESPANHA: "🇪🇸",
  ALEMANHA: "🇩🇪",
}

function formatarData(dataStr: string): string {
  const data = new Date(dataStr)
  const agora = new Date()
  const diff = agora.getTime() - data.getTime()
  const dias = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (dias === 0) {
    return data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  } else if (dias === 1) {
    return "Ontem"
  } else if (dias < 7) {
    return data.toLocaleDateString("pt-BR", { weekday: "short" })
  }
  return data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
}

function formatarHora(dataStr: string): string {
  return new Date(dataStr).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
}

function formatarDataSeparador(dataStr: string): string {
  const data = new Date(dataStr)
  const hoje = new Date()
  const ontem = new Date(hoje)
  ontem.setDate(ontem.getDate() - 1)

  if (data.toDateString() === hoje.toDateString()) return "Hoje"
  if (data.toDateString() === ontem.toDateString()) return "Ontem"
  return data.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })
}

export default function MensagensPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const [conversas, setConversas] = useState<Conversa[]>([])
  const [loadingConversas, setLoadingConversas] = useState(true)

  const [conversaAberta, setConversaAberta] = useState<number | null>(null)
  const [processoNome, setProcessoNome] = useState("")
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [loadingMensagens, setLoadingMensagens] = useState(false)
  const [texto, setTexto] = useState("")
  const [enviando, setEnviando] = useState(false)

  // Edit/delete state
  const [editandoId, setEditandoId] = useState<number | null>(null)
  const [textoEditando, setTextoEditando] = useState("")

  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const editInputRef = useRef<HTMLTextAreaElement>(null)

  // Auth
  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/login")
      return
    }
    const userData = getStoredUser()
    if (!userData) {
      router.push("/login")
      return
    }
    setUser(userData)
    setLoading(false)
  }, [router])

  // Buscar conversas
  const buscarConversas = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/mensagens")
      if (res.ok) {
        const data = await res.json()
        setConversas(data.conversas || [])
      }
    } catch (error) {
      console.error("Erro ao buscar conversas:", error)
    } finally {
      setLoadingConversas(false)
    }
  }, [])

  useEffect(() => {
    if (!loading) {
      buscarConversas()
      const interval = setInterval(buscarConversas, 15000)
      return () => clearInterval(interval)
    }
  }, [loading, buscarConversas])

  // Abrir conversa
  const abrirConversa = useCallback(
    async (processoId: number) => {
      setConversaAberta(processoId)
      setLoadingMensagens(true)
      setMensagens([])
      setEditandoId(null)

      try {
        const res = await fetch(`/api/admin/mensagens/${processoId}`)
        if (res.ok) {
          const data = await res.json()
          setMensagens(data.mensagens || [])
          setProcessoNome(data.processo?.nome || "")
          buscarConversas()
        }
      } catch (error) {
        console.error("Erro ao abrir conversa:", error)
      } finally {
        setLoadingMensagens(false)
      }
    },
    [buscarConversas]
  )

  // Polling de mensagens
  useEffect(() => {
    if (!conversaAberta) return

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/admin/mensagens/${conversaAberta}`)
        if (res.ok) {
          const data = await res.json()
          setMensagens(data.mensagens || [])
        }
      } catch {}
    }, 10000)

    return () => clearInterval(interval)
  }, [conversaAberta])

  // Scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [mensagens])

  // Focus edit input
  useEffect(() => {
    if (editandoId && editInputRef.current) {
      editInputRef.current.focus()
      const el = editInputRef.current
      el.style.height = "auto"
      el.style.height = Math.min(el.scrollHeight, 128) + "px"
    }
  }, [editandoId])

  // Enviar
  const handleEnviar = async () => {
    if (!texto.trim() || enviando || !conversaAberta || !user) return

    const textoEnviar = texto.trim()
    setTexto("")
    setEnviando(true)

    try {
      const res = await fetch(`/api/admin/mensagens/${conversaAberta}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conteudo: textoEnviar, usuarioId: user.id }),
      })

      if (res.ok) {
        const novaMensagem = await res.json()
        setMensagens((prev) => [...prev, novaMensagem])
        buscarConversas()
      }
    } catch (error) {
      setTexto(textoEnviar)
      console.error("Erro ao enviar:", error)
    } finally {
      setEnviando(false)
      inputRef.current?.focus()
    }
  }

  // ===== EDITAR =====
  const iniciarEdicao = (msg: Mensagem) => {
    setEditandoId(msg.id)
    setTextoEditando(msg.conteudo)
  }

  const cancelarEdicao = () => {
    setEditandoId(null)
    setTextoEditando("")
  }

  const salvarEdicao = async () => {
    if (!textoEditando.trim() || !editandoId || !user || !conversaAberta) return

    try {
      const res = await fetch(`/api/admin/mensagens/${conversaAberta}/${editandoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conteudo: textoEditando.trim(), usuarioId: user.id }),
      })

      if (res.ok) {
        setMensagens((prev) =>
          prev.map((m) =>
            m.id === editandoId
              ? { ...m, conteudo: textoEditando.trim(), editadoEm: new Date().toISOString() }
              : m
          )
        )
        cancelarEdicao()
      }
    } catch (error) {
      console.error("Erro ao editar:", error)
    }
  }

  // ===== APAGAR =====
  const handleApagar = async (msgId: number) => {
    if (!confirm("Apagar esta mensagem?")) return
    if (!user || !conversaAberta) return

    try {
      const res = await fetch(
        `/api/admin/mensagens/${conversaAberta}/${msgId}?usuarioId=${user.id}`,
        { method: "DELETE" }
      )

      if (res.ok) {
        setMensagens((prev) => prev.filter((m) => m.id !== msgId))
        buscarConversas()
      }
    } catch (error) {
      console.error("Erro ao apagar:", error)
    }
  }

  // Key handlers
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleEnviar()
    }
  }

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      salvarEdicao()
    }
    if (e.key === "Escape") {
      cancelarEdicao()
    }
  }

  // Agrupar mensagens por dia
  const mensagensAgrupadas = () => {
    const items: (Mensagem | { tipo: "separador"; data: string })[] = []
    let ultimaData = ""

    mensagens.forEach((msg) => {
      const dataMsg = new Date(msg.data).toDateString()
      if (dataMsg !== ultimaData) {
        items.push({ tipo: "separador", data: msg.data })
        ultimaData = dataMsg
      }
      items.push(msg)
    })

    return items
  }

  if (loading) {
    return (
      <div className="relative h-screen text-white overflow-hidden">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
        <div className="h-screen bg-black/40 backdrop-blur-sm flex items-center justify-center">
          <div className="animate-spin h-12 w-12 border-4 border-white border-t-transparent rounded-full" />
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-screen text-white overflow-hidden flex flex-col">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />

      <HeaderBar
        title="Mensagens"
        subtitle="Conversas com clientes"
        userName={user?.nome || "Usuário"}
        userRole={user?.tipo === "admin" ? "Administrador" : user?.tipo || "Usuário"}
        userEmail={user?.email || ""}
        projetos={[]}
        processos={[]}
        arvores={[]}
        onLogout={() => {
          localStorage.removeItem("authToken")
          localStorage.removeItem("user")
          router.push("/login")
        }}
      />

      <div className="flex-1 relative overflow-hidden">
        <div className="absolute inset-0 bg-black/40 pointer-events-none" />

        <main className="relative px-6 py-4 h-full">
          <div
            className="bg-white/5 border border-white/15 rounded-2xl backdrop-blur-xl shadow-lg overflow-hidden"
            style={{ height: "calc(100vh - 140px)" }}
          >
            <div className="flex h-full">
              {/* ===== LISTA DE CONVERSAS ===== */}
              <div
                className={`${
                  conversaAberta ? "hidden md:flex" : "flex"
                } flex-col w-full md:w-80 lg:w-96 border-r border-white/10`}
              >
                <div className="p-4 border-b border-white/10">
                  <h2 className="text-lg font-semibold text-white">Conversas</h2>
                </div>

                <div className="flex-1 overflow-y-auto">
                  {loadingConversas ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="animate-spin h-8 w-8 border-3 border-white border-t-transparent rounded-full" />
                    </div>
                  ) : conversas.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-white/50">
                      <MessageCircle className="h-12 w-12 mb-3 opacity-30" />
                      <p className="text-sm">Nenhuma conversa</p>
                      <p className="text-xs mt-1 opacity-60">
                        As mensagens dos clientes aparecerão aqui
                      </p>
                    </div>
                  ) : (
                    conversas.map((c) => (
                      <button
                        key={c.processoId}
                        onClick={() => abrirConversa(c.processoId)}
                        className={`w-full text-left px-4 py-3 border-b border-white/5 hover:bg-white/10 transition-colors ${
                          conversaAberta === c.processoId ? "bg-white/10" : ""
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="text-2xl flex-shrink-0">
                            {BANDEIRAS[c.pais] || "📁"}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-white truncate">
                                {c.processoNome}
                              </span>
                              {c.ultimaMensagem && (
                                <span className="text-xs text-white/40 flex-shrink-0 ml-2">
                                  {formatarData(c.ultimaMensagem.data)}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center justify-between mt-0.5">
                              <span className="text-xs text-white/50 truncate">
                                {c.ultimaMensagem
                                  ? `${c.ultimaMensagem.remetente}: ${c.ultimaMensagem.conteudo}`
                                  : "Nenhuma mensagem"}
                              </span>
                              {c.naoLidas > 0 && (
                                <span className="ml-2 flex-shrink-0 bg-emerald-500 text-white text-xs font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1.5">
                                  {c.naoLidas}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>

              {/* ===== ÁREA DE CHAT ===== */}
              <div
                className={`${conversaAberta ? "flex" : "hidden md:flex"} flex-col flex-1`}
              >
                {!conversaAberta ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-white/40">
                    <MessageCircle className="h-16 w-16 mb-4 opacity-20" />
                    <p className="text-lg font-medium">Selecione uma conversa</p>
                    <p className="text-sm mt-1 opacity-60">
                      Escolha um processo ao lado para ver as mensagens
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Header */}
                    <div className="px-4 py-3 border-b border-white/10 flex items-center gap-3">
                      <button
                        onClick={() => {
                          setConversaAberta(null)
                          setEditandoId(null)
                        }}
                        className="md:hidden p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                      >
                        <ArrowLeft className="h-5 w-5 text-white/70" />
                      </button>
                      <div>
                        <h3 className="text-sm font-semibold text-white">{processoNome}</h3>
                        <p className="text-xs text-white/50">Processo #{conversaAberta}</p>
                      </div>
                    </div>

                    {/* Mensagens */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-1">
                      {loadingMensagens ? (
                        <div className="flex items-center justify-center py-12">
                          <div className="animate-spin h-8 w-8 border-3 border-white border-t-transparent rounded-full" />
                        </div>
                      ) : mensagens.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-white/40">
                          <MessageCircle className="h-12 w-12 mb-3 opacity-20" />
                          <p className="text-sm">Nenhuma mensagem ainda</p>
                        </div>
                      ) : (
                        mensagensAgrupadas().map((item, index) => {
                          if ("tipo" in item) {
                            return (
                              <div
                                key={`sep-${index}`}
                                className="flex items-center gap-3 my-4"
                              >
                                <div className="flex-1 h-px bg-white/10" />
                                <span className="text-xs text-white/40 font-medium">
                                  {formatarDataSeparador(item.data)}
                                </span>
                                <div className="flex-1 h-px bg-white/10" />
                              </div>
                            )
                          }

                          const msg = item as Mensagem
                          const isEditing = editandoId === msg.id
                          // Equipe só pode editar/apagar suas próprias mensagens
                          const podeEditar = msg.ehEquipe && msg.usuarioId === user?.id

                          return (
                            <div
                              key={msg.id}
                              className={`flex ${
                                msg.ehEquipe ? "justify-end" : "justify-start"
                              } mb-2 group`}
                            >
                              {/* Botões de ação (à esquerda do balão, para msgs da equipe) */}
                              {msg.ehEquipe && podeEditar && !isEditing && (
                                <div className="flex items-center gap-0.5 mr-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={() => iniciarEdicao(msg)}
                                    className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                                    title="Editar"
                                  >
                                    <Pencil className="h-3.5 w-3.5 text-white/40 hover:text-white/70" />
                                  </button>
                                  <button
                                    onClick={() => handleApagar(msg.id)}
                                    className="p-1.5 rounded-lg hover:bg-red-500/20 transition-colors"
                                    title="Apagar"
                                  >
                                    <Trash2 className="h-3.5 w-3.5 text-white/40 hover:text-red-400" />
                                  </button>
                                </div>
                              )}

                              {/* Balão */}
                              <div
                                className={`max-w-[70%] px-4 py-2.5 rounded-2xl ${
                                  msg.ehEquipe
                                    ? "bg-indigo-600 text-white rounded-br-md"
                                    : "bg-white/10 text-white rounded-bl-md"
                                }`}
                              >
                                {!msg.ehEquipe && (
                                  <p className="text-xs font-semibold text-emerald-400 mb-1">
                                    {msg.remetente}
                                  </p>
                                )}
                                {msg.ehEquipe && !isEditing && (
                                  <p className="text-xs font-semibold text-indigo-200 mb-1">
                                    {msg.remetente}
                                  </p>
                                )}

                                {isEditing ? (
                                  <div>
                                    <textarea
                                      ref={editInputRef}
                                      value={textoEditando}
                                      onChange={(e) => setTextoEditando(e.target.value)}
                                      onKeyDown={handleEditKeyDown}
                                      className="w-full bg-indigo-700/50 border border-indigo-400/30 rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-indigo-300/50 max-h-32"
                                      rows={1}
                                      onInput={(e) => {
                                        const t = e.target as HTMLTextAreaElement
                                        t.style.height = "auto"
                                        t.style.height = Math.min(t.scrollHeight, 128) + "px"
                                      }}
                                    />
                                    <div className="flex items-center justify-end gap-1 mt-1.5">
                                      <span className="text-[10px] text-indigo-200/40 mr-auto">
                                        Enter salvar · Esc cancelar
                                      </span>
                                      <button
                                        onClick={cancelarEdicao}
                                        className="p-1 rounded hover:bg-white/10 transition-colors"
                                        title="Cancelar (Esc)"
                                      >
                                        <X className="h-4 w-4 text-indigo-200/60" />
                                      </button>
                                      <button
                                        onClick={salvarEdicao}
                                        disabled={!textoEditando.trim()}
                                        className="p-1 rounded hover:bg-white/10 transition-colors disabled:opacity-30"
                                        title="Salvar (Enter)"
                                      >
                                        <Check className="h-4 w-4 text-emerald-300" />
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    <p className="text-sm leading-relaxed whitespace-pre-wrap">
                                      {msg.conteudo}
                                    </p>
                                    <div className="flex items-center gap-1.5 mt-1.5 justify-end">
                                      {msg.editadoEm && (
                                        <span
                                          className={`text-[10px] italic ${
                                            msg.ehEquipe
                                              ? "text-indigo-200/40"
                                              : "text-white/25"
                                          }`}
                                        >
                                          editado
                                        </span>
                                      )}
                                      <span
                                        className={`text-[10px] ${
                                          msg.ehEquipe
                                            ? "text-indigo-200/60"
                                            : "text-white/30"
                                        }`}
                                      >
                                        {formatarHora(msg.data)}
                                      </span>
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>
                          )
                        })
                      )}
                      <div ref={chatEndRef} />
                    </div>

                    {/* Input */}
                    <div className="px-4 py-3 border-t border-white/10">
                      <div className="flex items-end gap-2">
                        <textarea
                          ref={inputRef}
                          value={texto}
                          onChange={(e) => setTexto(e.target.value)}
                          onKeyDown={handleKeyDown}
                          placeholder="Mensagem..."
                          rows={1}
                          className="flex-1 bg-white/10 border border-white/15 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 resize-none focus:outline-none focus:border-white/30 max-h-32"
                          style={{ height: "auto", minHeight: "40px", overflow: "hidden" }}
                          onInput={(e) => {
                            const t = e.target as HTMLTextAreaElement
                            t.style.height = "auto"
                            t.style.height = Math.min(t.scrollHeight, 128) + "px"
                          }}
                        />
                        <button
                          onClick={handleEnviar}
                          disabled={!texto.trim() || enviando}
                          className={`p-2.5 rounded-xl transition-colors ${
                            texto.trim() && !enviando
                              ? "bg-indigo-600 hover:bg-indigo-700 text-white"
                              : "bg-white/5 text-white/20 cursor-not-allowed"
                          }`}
                        >
                          {enviando ? (
                            <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />
                          ) : (
                            <Send className="h-5 w-5" />
                          )}
                        </button>
                      </div>
                      <p className="text-xs text-white/20 mt-1.5">
                        Enter para enviar · Shift+Enter para nova linha
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}