"use client"

import { useState, useEffect } from "react"
import { 
  Smartphone, 
  Loader2, 
  CheckCircle2, 
  XCircle, 
  Copy, 
  Check, 
  RefreshCw, 
  Trash2, 
  Mail,
  Shield,
  Clock,
  AlertTriangle,
  KeyRound
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface AcessoInfo {
  id: number
  email: string
  primeiroAcesso: boolean
  ativo: boolean
  criadoEm: string
  atualizadoEm: string
}

interface AcessoAppTabProps {
  clienteId: number | null
  clienteTipo: string // "contratante" | "requerente"
  clienteEmail: string
  clienteNome: string
  isViewMode: boolean
}

export function AcessoAppTab({ clienteId, clienteTipo, clienteEmail, clienteNome, isViewMode }: AcessoAppTabProps) {
  const [carregando, setCarregando] = useState(true)
  const [temAcesso, setTemAcesso] = useState(false)
  const [acesso, setAcesso] = useState<AcessoInfo | null>(null)
  const [email, setEmail] = useState(clienteEmail || "")
  const [senhaTemporaria, setSenhaTemporaria] = useState<string | null>(null)
  const [copiado, setCopiadoSenha] = useState(false)
  const [copiadoMsg, setCopiadoMsg] = useState(false)
  const [gerando, setGerando] = useState(false)
  const [resetando, setResetando] = useState(false)
  const [revogando, setRevogando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // Verificar se já tem acesso ao abrir
  useEffect(() => {
    if (clienteId) {
      verificarAcesso()
    } else {
      setCarregando(false)
    }
  }, [clienteId])

  // Atualizar email quando mudar
  useEffect(() => {
    if (clienteEmail && !temAcesso) {
      setEmail(clienteEmail)
    }
  }, [clienteEmail])

  const verificarAcesso = async () => {
    setCarregando(true)
    setErro(null)
    try {
      const response = await fetch(`/api/app/gerar-acesso?tipo=${clienteTipo}&id=${clienteId}`)
      const data = await response.json()
      
      if (data.temAcesso) {
        setTemAcesso(true)
        setAcesso(data.acesso)
        setEmail(data.acesso.email)
      } else {
        setTemAcesso(false)
        setAcesso(null)
      }
    } catch (error) {
      console.error("Erro ao verificar acesso:", error)
      setErro("Erro ao verificar acesso ao app")
    } finally {
      setCarregando(false)
    }
  }

  const gerarAcesso = async () => {
    if (!email.trim()) {
      setErro("E-mail é obrigatório")
      return
    }

    setGerando(true)
    setErro(null)
    setSenhaTemporaria(null)

    try {
      const body: any = { email: email.trim() }
      if (clienteTipo === "requerente") {
        body.requerenteId = clienteId
      } else {
        body.contratanteId = clienteId
      }

      const response = await fetch("/api/app/gerar-acesso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      const data = await response.json()

      if (!response.ok) {
        setErro(data.error || "Erro ao gerar acesso")
        return
      }

      setSenhaTemporaria(data.senhaTemporaria)
      await verificarAcesso()
    } catch (error) {
      setErro("Erro ao gerar acesso")
    } finally {
      setGerando(false)
    }
  }

  const resetarSenha = async () => {
    if (!acesso) return
    if (!confirm("Tem certeza que deseja resetar a senha? O cliente terá que usar a nova senha temporária.")) return

    setResetando(true)
    setErro(null)
    setSenhaTemporaria(null)

    try {
      const response = await fetch("/api/app/gerar-acesso", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acessoId: acesso.id }),
      })

      const data = await response.json()

      if (!response.ok) {
        setErro(data.error || "Erro ao resetar senha")
        return
      }

      setSenhaTemporaria(data.senhaTemporaria)
      await verificarAcesso()
    } catch (error) {
      setErro("Erro ao resetar senha")
    } finally {
      setResetando(false)
    }
  }

  const revogarAcesso = async () => {
    if (!acesso) return
    if (!confirm("Tem certeza que deseja REVOGAR o acesso ao app? O cliente não conseguirá mais entrar.")) return

    setRevogando(true)
    setErro(null)

    try {
      const response = await fetch(`/api/app/gerar-acesso?id=${acesso.id}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        const data = await response.json()
        setErro(data.error || "Erro ao revogar acesso")
        return
      }

      setTemAcesso(false)
      setAcesso(null)
      setSenhaTemporaria(null)
      setEmail(clienteEmail || "")
    } catch (error) {
      setErro("Erro ao revogar acesso")
    } finally {
      setRevogando(false)
    }
  }

  const copiarSenha = () => {
    if (!senhaTemporaria) return
    navigator.clipboard.writeText(senhaTemporaria)
    setCopiadoSenha(true)
    setTimeout(() => setCopiadoSenha(false), 2000)
  }

  const copiarMensagem = () => {
    if (!senhaTemporaria) return
    const emailAcesso = acesso?.email || email
    const msg = `Olá ${clienteNome}! 👋\n\nSeu acesso ao app Discovery Assessoria foi criado.\n\n📱 Baixe o app e faça login com:\n📧 Email: ${emailAcesso}\n🔑 Senha temporária: ${senhaTemporaria}\n\nNo primeiro acesso, você vai definir sua própria senha.\n\nQualquer dúvida, estamos à disposição!`
    navigator.clipboard.writeText(msg)
    setCopiadoMsg(true)
    setTimeout(() => setCopiadoMsg(false), 2000)
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  if (carregando) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
        <span className="ml-2 text-gray-500">Verificando acesso...</span>
      </div>
    )
  }

  if (!clienteId) {
    return (
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
        <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0" />
          <p className="text-sm text-amber-700">
            Salve o cliente primeiro para poder gerar acesso ao app.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Status do acesso */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
        <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-indigo-600" />
          Acesso ao App
        </h3>

        {/* Erro */}
        {erro && (
          <div className="mb-4 flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span>{erro}</span>
            <button onClick={() => setErro(null)} className="ml-auto text-red-400 hover:text-red-600">✕</button>
          </div>
        )}

        {temAcesso && acesso ? (
          /* ✅ Cliente JÁ TEM acesso */
          <div className="space-y-4">
            {/* Badge de status */}
            <div className="flex items-center justify-between p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                  <p className="font-semibold text-emerald-800">Acesso ativo</p>
                  <p className="text-sm text-emerald-600">O cliente pode acessar o app</p>
                </div>
              </div>
              {acesso.primeiroAcesso && (
                <span className="px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">
                  Aguardando primeiro login
                </span>
              )}
              {!acesso.primeiroAcesso && (
                <span className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium">
                  Já acessou o app
                </span>
              )}
            </div>

            {/* Detalhes */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                  <Mail className="h-3 w-3" />
                  Email de login
                </div>
                <p className="text-sm font-medium text-gray-900">{acesso.email}</p>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                  <Clock className="h-3 w-3" />
                  Acesso criado em
                </div>
                <p className="text-sm font-medium text-gray-900">{formatDate(acesso.criadoEm)}</p>
              </div>
            </div>

            {/* Senha temporária (se acabou de gerar ou resetar) */}
            {senhaTemporaria && (
              <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl space-y-3">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-indigo-600" />
                  <p className="text-sm font-semibold text-indigo-800">Senha temporária gerada</p>
                </div>
                
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-4 py-3 bg-white rounded-lg border border-indigo-200 font-mono text-lg text-center tracking-widest text-indigo-800 font-bold">
                    {senhaTemporaria}
                  </div>
                  <button
                    onClick={copiarSenha}
                    className="p-3 bg-white border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors"
                    title="Copiar senha"
                  >
                    {copiado ? (
                      <Check className="h-5 w-5 text-emerald-600" />
                    ) : (
                      <Copy className="h-5 w-5 text-indigo-600" />
                    )}
                  </button>
                </div>

                <button
                  onClick={copiarMensagem}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors text-sm"
                >
                  {copiadoMsg ? (
                    <>
                      <Check className="h-4 w-4" />
                      Mensagem copiada!
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" />
                      Copiar mensagem para WhatsApp
                    </>
                  )}
                </button>

                <p className="text-xs text-indigo-600 text-center">
                  ⚠️ Anote ou envie esta senha agora. Ela não será mostrada novamente.
                </p>
              </div>
            )}

            {/* Ações */}
            {!isViewMode && (
              <div className="flex items-center gap-3 pt-2">
                <Button
                  onClick={resetarSenha}
                  disabled={resetando}
                  variant="outline"
                  className="flex-1 border-amber-300 text-amber-700 hover:bg-amber-50"
                >
                  {resetando ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Resetar senha
                </Button>
                <Button
                  onClick={revogarAcesso}
                  disabled={revogando}
                  variant="outline"
                  className="border-red-300 text-red-600 hover:bg-red-50"
                >
                  {revogando ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Trash2 className="h-4 w-4 mr-2" />
                  )}
                  Revogar acesso
                </Button>
              </div>
            )}
          </div>
        ) : (
          /* ❌ Cliente NÃO TEM acesso */
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-gray-50 border border-gray-200 rounded-xl">
              <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">
                <XCircle className="h-5 w-5 text-gray-400" />
              </div>
              <div>
                <p className="font-semibold text-gray-700">Sem acesso ao app</p>
                <p className="text-sm text-gray-500">Este cliente ainda não tem acesso ao aplicativo</p>
              </div>
            </div>

            {!isViewMode && (
              <>
                {/* Campo de email */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    E-mail para login no app
                  </label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="email@exemplo.com"
                    className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400"
                  />
                  {clienteEmail && email !== clienteEmail && (
                    <p className="text-xs text-amber-600 mt-1">
                      ⚠️ E-mail diferente do cadastro ({clienteEmail})
                    </p>
                  )}
                  {!clienteEmail && (
                    <p className="text-xs text-gray-500 mt-1">
                      O cliente não tem e-mail cadastrado. Digite o e-mail que ele usará no app.
                    </p>
                  )}
                </div>

                {/* Botão gerar acesso */}
                <Button
                  onClick={gerarAcesso}
                  disabled={gerando || !email.trim()}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-5"
                >
                  {gerando ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Gerando acesso...
                    </>
                  ) : (
                    <>
                      <Smartphone className="h-4 w-4 mr-2" />
                      Gerar acesso ao app
                    </>
                  )}
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Explicação do fluxo */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
        <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <Shield className="h-4 w-4 text-indigo-600" />
          Como funciona
        </h3>
        <div className="space-y-2 text-sm text-gray-600">
          <div className="flex items-start gap-2">
            <span className="text-indigo-500 font-bold text-xs mt-0.5">1</span>
            <p>Clique em <strong>"Gerar acesso ao app"</strong> para criar login e senha temporária</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-indigo-500 font-bold text-xs mt-0.5">2</span>
            <p>Copie a <strong>mensagem para WhatsApp</strong> e envie para o cliente</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-indigo-500 font-bold text-xs mt-0.5">3</span>
            <p>O cliente abre o app, faz login e <strong>define sua própria senha</strong></p>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-indigo-500 font-bold text-xs mt-0.5">4</span>
            <p>Pronto! O cliente acompanha seus processos pelo aplicativo</p>
          </div>
        </div>
      </div>
    </div>
  )
}