"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { 
  Plus, Trash2, Loader2, Save, DollarSign, FileText, Pencil, Check, X,
  Download, FileDown, ChevronDown, ChevronUp, CheckSquare, Square,
  ArrowUp, ArrowDown
} from "lucide-react"

interface TipoServico {
  id: number
  nome: string
  ordem: number
}

interface LinhaTabela {
  pessoaId: number
  numeroLinhagem: number
  ordemCusto: number
  nome: string
  tipoRegistro: string
  ordemRegistro: number
  data: string | null
  local: string
  cartorio: string
  livro: string
  folha: string
  termo: string
  dadosRegistro: string
  conjuge: string
  paiNome: string | null
  maeNome: string | null
  observacao: string
  valores: Record<number, number>
  total: number
  isPrimeiraLinha: boolean
  documentoId: number | null
}

interface TabelaCustosProps {
  processoId: number
  nomeFamilia?: string
}

export function TabelaCustos({ processoId, nomeFamilia }: TabelaCustosProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [linhas, setLinhas] = useState<LinhaTabela[]>([])
  const [servicos, setServicos] = useState<TipoServico[]>([])
  const [totaisPorServico, setTotaisPorServico] = useState<Record<number, number>>({})
  const [totalGeral, setTotalGeral] = useState(0)
  
  // Estado para edição de valores
  const [valoresEditados, setValoresEditados] = useState<Record<string, string>>({})
  const [temAlteracoes, setTemAlteracoes] = useState(false)
  
  // Modal para adicionar serviço
  const [showAddServico, setShowAddServico] = useState(false)
  const [novoServico, setNovoServico] = useState("")
  const [addingServico, setAddingServico] = useState(false)
  
  // Edição de nome do serviço
  const [editandoServico, setEditandoServico] = useState<number | null>(null)
  const [novoNomeServico, setNovoNomeServico] = useState("")
  const [salvandoNome, setSalvandoNome] = useState(false)
  
  // Controle de visualização
  const [mostrarDetalhes, setMostrarDetalhes] = useState(true)
  
  // ✅ ATUALIZADO: Seleção por LINHA (documento) ao invés de por pessoa
  // Chave: pessoaId-tipoRegistro
  const [linhasSelecionadas, setLinhasSelecionadas] = useState<Set<string>>(new Set())
  
  // ✅ NOVO: Ordem customizada das pessoas dentro de cada grupo de linhagem
  // Chave: pessoaId, Valor: posição dentro do grupo
  const [ordemPessoas, setOrdemPessoas] = useState<Record<number, number>>({})
  
  const carregandoRef = useRef(false)
  const tabelaRef = useRef<HTMLDivElement>(null)

  // Carregar dados
  const carregarDados = useCallback(async () => {
    if (carregandoRef.current) return
    carregandoRef.current = true
    
    try {
      setLoading(true)
      const response = await fetch(`/api/processos/${processoId}/custos`)
      if (response.ok) {
        const data = await response.json()
        setLinhas(data.linhas || [])
        setServicos(data.servicos || [])
        setTotaisPorServico(data.totaisPorServico || {})
        setTotalGeral(data.totalGeral || 0)
        
        // ✅ ATUALIZADO: Inicializar valores por linha (incluindo tipoRegistro)
        const valores: Record<string, string> = {}
        
        data.linhas?.forEach((linha: LinhaTabela) => {
          data.servicos?.forEach((s: TipoServico) => {
            // Chave inclui tipoRegistro para diferenciar documentos da mesma pessoa
            const key = `${linha.pessoaId}-${linha.tipoRegistro}-${s.id}`
            valores[key] = (linha.valores[s.id] || 0).toString()
          })
        })
        setValoresEditados(valores)
        setTemAlteracoes(false)
        
        // ✅ ATUALIZADO: Inicializar ordem das pessoas usando ordemCusto do servidor
        const ordemInicial: Record<number, number> = {}
        data.linhas?.forEach((linha: LinhaTabela) => {
          if (linha.isPrimeiraLinha) {
            ordemInicial[linha.pessoaId] = linha.ordemCusto ?? 0
          }
        })
        setOrdemPessoas(ordemInicial)
      }
    } catch (error) {
      console.error("Erro ao carregar dados:", error)
    } finally {
      setLoading(false)
      carregandoRef.current = false
    }
  }, [processoId])

  useEffect(() => {
    carregarDados()
  }, [carregarDados])

  // ✅ CORRIGIDO: Funções para reordenar pessoas dentro do mesmo grupo de linhagem
  const getPessoasDoGrupo = (numeroLinhagem: number): number[] => {
    const pessoasSet = new Set<number>()
    linhas.filter(l => l.numeroLinhagem === numeroLinhagem && l.isPrimeiraLinha)
      .forEach(l => pessoasSet.add(l.pessoaId))
    // Ordenar por ordemCusto, com desempate por pessoaId
    return Array.from(pessoasSet).sort((a, b) => {
      const ordemA = ordemPessoas[a] ?? 0
      const ordemB = ordemPessoas[b] ?? 0
      if (ordemA !== ordemB) {
        return ordemA - ordemB
      }
      return a - b // desempate por pessoaId
    })
  }

  // Salvar ordem no servidor
  const salvarOrdem = async (novaOrdem: Record<number, number>) => {
    try {
      const ordens = Object.entries(novaOrdem).map(([pessoaId, ordemCusto]) => ({
        pessoaId: parseInt(pessoaId),
        ordemCusto
      }))
      
      await fetch(`/api/processos/${processoId}/custos`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ordens })
      })
    } catch (error) {
      console.error('Erro ao salvar ordem:', error)
    }
  }

  const moverPessoaParaCima = (pessoaId: number, numeroLinhagem: number) => {
    const pessoasDoGrupo = getPessoasDoGrupo(numeroLinhagem)
    const indexAtual = pessoasDoGrupo.indexOf(pessoaId)
    
    if (indexAtual <= 0) return // Já está no topo
    
    const pessoaAcima = pessoasDoGrupo[indexAtual - 1]
    
    // ✅ CORRIGIDO: Usar índices para trocar (não os valores antigos)
    const novaOrdem = {
      ...ordemPessoas,
      [pessoaId]: indexAtual - 1,
      [pessoaAcima]: indexAtual
    }
    
    setOrdemPessoas(novaOrdem)
    salvarOrdem(novaOrdem) // Salvar no servidor
  }

  const moverPessoaParaBaixo = (pessoaId: number, numeroLinhagem: number) => {
    const pessoasDoGrupo = getPessoasDoGrupo(numeroLinhagem)
    const indexAtual = pessoasDoGrupo.indexOf(pessoaId)
    
    if (indexAtual >= pessoasDoGrupo.length - 1) return // Já está no fundo
    
    const pessoaAbaixo = pessoasDoGrupo[indexAtual + 1]
    
    // ✅ CORRIGIDO: Usar índices para trocar (não os valores antigos)
    const novaOrdem = {
      ...ordemPessoas,
      [pessoaId]: indexAtual + 1,
      [pessoaAbaixo]: indexAtual
    }
    
    setOrdemPessoas(novaOrdem)
    salvarOrdem(novaOrdem) // Salvar no servidor
  }

  const podeMoverParaCima = (pessoaId: number, numeroLinhagem: number): boolean => {
    const pessoasDoGrupo = getPessoasDoGrupo(numeroLinhagem)
    return pessoasDoGrupo.indexOf(pessoaId) > 0
  }

  const podeMoverParaBaixo = (pessoaId: number, numeroLinhagem: number): boolean => {
    const pessoasDoGrupo = getPessoasDoGrupo(numeroLinhagem)
    return pessoasDoGrupo.indexOf(pessoaId) < pessoasDoGrupo.length - 1
  }

  // ✅ CORRIGIDO: Linhas ordenadas com a ordem customizada
  const linhasOrdenadas = [...linhas].sort((a, b) => {
    // Primeiro por número de linhagem
    if (a.numeroLinhagem !== b.numeroLinhagem) {
      return a.numeroLinhagem - b.numeroLinhagem
    }
    // Depois pela ordem customizada da pessoa
    const ordemA = ordemPessoas[a.pessoaId] ?? 0
    const ordemB = ordemPessoas[b.pessoaId] ?? 0
    if (ordemA !== ordemB) {
      return ordemA - ordemB
    }
    // ✅ IMPORTANTE: Desempate por pessoaId para manter linhas da mesma pessoa juntas
    if (a.pessoaId !== b.pessoaId) {
      return a.pessoaId - b.pessoaId
    }
    // Por fim, pelo tipo de registro
    return a.ordemRegistro - b.ordemRegistro
  })

  // ✅ ATUALIZADO: Atualizar valor local (inclui tipoRegistro)
  const handleValorChange = (pessoaId: number, tipoRegistro: string, servicoId: number, valor: string) => {
    const valorLimpo = valor.replace(/[^0-9.,]/g, '').replace(',', '.')
    const key = `${pessoaId}-${tipoRegistro}-${servicoId}`
    setValoresEditados(prev => ({ ...prev, [key]: valorLimpo }))
    setTemAlteracoes(true)
  }

  // ✅ ATUALIZADO: Calcular total da LINHA (não mais da pessoa)
  const calcularTotalLinha = (pessoaId: number, tipoRegistro: string) => {
    return servicos.reduce((acc, s) => {
      const key = `${pessoaId}-${tipoRegistro}-${s.id}`
      const valor = parseFloat(valoresEditados[key] || '0') || 0
      return acc + valor
    }, 0)
  }

  // Manter calcularTotalPessoa para compatibilidade (soma todas as linhas da pessoa)
  const calcularTotalPessoa = (pessoaId: number) => {
    const linhasDaPessoa = linhas.filter(l => l.pessoaId === pessoaId)
    return linhasDaPessoa.reduce((acc, linha) => {
      return acc + calcularTotalLinha(linha.pessoaId, linha.tipoRegistro)
    }, 0)
  }

  // ✅ ATUALIZADO: Calcular total do serviço (soma TODAS as linhas)
  const calcularTotalServico = (servicoId: number) => {
    return linhas.reduce((acc, linha) => {
      const key = `${linha.pessoaId}-${linha.tipoRegistro}-${servicoId}`
      const valor = parseFloat(valoresEditados[key] || '0') || 0
      return acc + valor
    }, 0)
  }

  const calcularTotalGeral = () => {
    return servicos.reduce((acc, s) => acc + calcularTotalServico(s.id), 0)
  }

  // ✅ ATUALIZADO: Salvar alterações (inclui tipoRegistro)
  const salvarAlteracoes = async () => {
    try {
      setSaving(true)
      
      // Gerar custos para CADA linha (cada documento)
      const custos = linhas.flatMap(linha => 
        servicos.map(s => ({
          pessoaId: linha.pessoaId,
          tipoServicoId: s.id,
          tipoRegistro: linha.tipoRegistro === '-' ? null : linha.tipoRegistro,
          valor: parseFloat(valoresEditados[`${linha.pessoaId}-${linha.tipoRegistro}-${s.id}`] || '0') || 0
        }))
      )

      const response = await fetch(`/api/processos/${processoId}/custos`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ custos })
      })

      if (response.ok) {
        setTemAlteracoes(false)
        await carregarDados()
      } else {
        alert("Erro ao salvar custos")
      }
    } catch (error) {
      console.error("Erro ao salvar:", error)
      alert("Erro ao salvar custos")
    } finally {
      setSaving(false)
    }
  }

  // Adicionar serviço
  const adicionarServico = async () => {
    if (!novoServico.trim()) return

    try {
      setAddingServico(true)
      const response = await fetch(`/api/processos/${processoId}/servicos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: novoServico.trim() })
      })

      if (response.ok) {
        setNovoServico("")
        setShowAddServico(false)
        await carregarDados()
      } else {
        alert("Erro ao adicionar serviço")
      }
    } catch (error) {
      console.error("Erro ao adicionar serviço:", error)
    } finally {
      setAddingServico(false)
    }
  }

  // Renomear serviço
  const iniciarEdicaoNome = (servico: TipoServico) => {
    setEditandoServico(servico.id)
    setNovoNomeServico(servico.nome)
  }

  const cancelarEdicaoNome = () => {
    setEditandoServico(null)
    setNovoNomeServico("")
  }

  const salvarNomeServico = async (servicoId: number) => {
    if (!novoNomeServico.trim()) return

    try {
      setSalvandoNome(true)
      const response = await fetch(`/api/processos/${processoId}/servicos/${servicoId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: novoNomeServico.trim() })
      })

      if (response.ok) {
        setEditandoServico(null)
        setNovoNomeServico("")
        await carregarDados()
      } else {
        alert("Erro ao renomear serviço")
      }
    } catch (error) {
      console.error("Erro ao renomear serviço:", error)
    } finally {
      setSalvandoNome(false)
    }
  }

  // Remover serviço
  const removerServico = async (servicoId: number, nome: string) => {
    if (!confirm(`Deseja remover o serviço "${nome}"? Todos os valores vinculados serão perdidos.`)) {
      return
    }

    try {
      const response = await fetch(`/api/processos/${processoId}/servicos/${servicoId}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        await carregarDados()
      } else {
        alert("Erro ao remover serviço")
      }
    } catch (error) {
      console.error("Erro ao remover serviço:", error)
    }
  }

  // Formatar valor para exibição
  const formatarMoeda = (valor: number) => {
    return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  }

  // Formatar data
  const formatarData = (data: string | null) => {
    if (!data) return '-'
    try {
      return new Date(data).toLocaleDateString('pt-BR')
    } catch {
      return data
    }
  }

  // ✅ ATUALIZADO: Funções de seleção por LINHA (documento)
  // Chave única: pessoaId-tipoRegistro
  const getLinhaKey = (linha: LinhaTabela) => `${linha.pessoaId}-${linha.tipoRegistro}`
  
  const toggleSelecionarLinha = (linha: LinhaTabela) => {
    const key = getLinhaKey(linha)
    setLinhasSelecionadas(prev => {
      const novo = new Set(prev)
      if (novo.has(key)) {
        novo.delete(key)
      } else {
        novo.add(key)
      }
      return novo
    })
  }

  const selecionarTodas = () => {
    setLinhasSelecionadas(new Set(linhas.map(l => getLinhaKey(l))))
  }

  const limparSelecao = () => {
    setLinhasSelecionadas(new Set())
  }

  const temSelecao = linhasSelecionadas.size > 0
  const todasSelecionadas = linhasSelecionadas.size === linhas.length && linhas.length > 0

  // Exportar para PDF usando jsPDF + autoTable
  const exportarPDF = async (apenasSelecionadas: boolean = false) => {
    try {
      // Importar jsPDF e autoTable dinamicamente
      const { default: jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')

      // ✅ ATUALIZADO: Filtrar por LINHAS selecionadas
      const linhasParaExportar = apenasSelecionadas && linhasSelecionadas.size > 0
        ? linhas.filter(l => linhasSelecionadas.has(getLinhaKey(l)))
        : linhas

      // Calcular número total de colunas para determinar tamanho da fonte
      const numColunas = 8 + servicos.length + 1 // 8 fixas + serviços + total
      
      // Ajustar fonte baseado no número de colunas
      let fontSize = 7
      let headerFontSize = 6.5
      let pageFormat: string | [number, number] = 'a4'
      
      // Com mais de 11 colunas, usar A3 para não quebrar nomes
      if (numColunas > 11) {
        pageFormat = 'a3'
        fontSize = 6.5
        headerFontSize = 6
      }
      if (numColunas > 16) {
        fontSize = 5.5
        headerFontSize = 5
      }
      if (numColunas > 20) {
        fontSize = 5
        headerFontSize = 4.5
      }

      const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: pageFormat
      })

      const pageWidth = doc.internal.pageSize.getWidth()
      const pageHeight = doc.internal.pageSize.getHeight()
      const marginX = 8
      const usableWidth = pageWidth - (marginX * 2)

      // Título
      doc.setFontSize(14)
      doc.setTextColor(30, 58, 95)
      const titulo = nomeFamilia 
        ? `Relatório de Custos - Processo ${nomeFamilia}`
        : 'Relatório de Custos - Processo'
      doc.text(titulo, marginX, 12)

      // ✅ NOVO: Calcular rowSpan para cada pessoa
      const linhasPorPessoa: Record<number, number> = {}
      linhasParaExportar.forEach(l => {
        linhasPorPessoa[l.pessoaId] = (linhasPorPessoa[l.pessoaId] || 0) + 1
      })

      // Rastrear se já processou a primeira linha de cada pessoa
      const pessoaProcessada = new Set<number>()

      // ✅ ORDEM ORIGINAL DO SISTEMA: Nº, Nome, Registro, Data, Local, DadosRegistro, Cônjuge, Genitores
      const dadosTabela: any[][] = linhasParaExportar.map(linha => {
        const isFirstOfPerson = !pessoaProcessada.has(linha.pessoaId)
        if (isFirstOfPerson) {
          pessoaProcessada.add(linha.pessoaId)
        }
        
        const rowSpan = linhasPorPessoa[linha.pessoaId] || 1
        const genitoresText = [linha.paiNome ? `Pai: ${linha.paiNome}` : '', linha.maeNome ? `Mãe: ${linha.maeNome}` : ''].filter(Boolean).join('\n') || '-'

        if (isFirstOfPerson) {
          // Primeira linha da pessoa: inclui todas as colunas, com rowSpan onde necessário
          const row: any[] = [
            // Colunas 0, 1 com rowSpan
            rowSpan > 1 
              ? { content: String(linha.numeroLinhagem), rowSpan, styles: { valign: 'middle', halign: 'center' } }
              : String(linha.numeroLinhagem),
            rowSpan > 1 
              ? { content: linha.nome, rowSpan, styles: { valign: 'middle' } }
              : linha.nome,
            // Colunas 2, 3, 4, 5 sem rowSpan
            linha.tipoRegistro,
            formatarData(linha.data),
            linha.local || '-',
            linha.dadosRegistro || '-',
            // Colunas 6, 7 com rowSpan
            rowSpan > 1 
              ? { content: linha.conjuge || '-', rowSpan, styles: { valign: 'middle' } }
              : (linha.conjuge || '-'),
            rowSpan > 1 
              ? { content: genitoresText, rowSpan, styles: { valign: 'middle' } }
              : genitoresText
          ]

          // Valores dos serviços
          servicos.forEach(s => {
            row.push(formatarMoeda(parseFloat(valoresEditados[`${linha.pessoaId}-${linha.tipoRegistro}-${s.id}`] || '0') || 0))
          })

          // Total da linha
          row.push(formatarMoeda(calcularTotalLinha(linha.pessoaId, linha.tipoRegistro)))

          return row
        } else {
          // Linhas subsequentes: pula colunas 0, 1, 6, 7 (cobertas pelo rowSpan)
          // O autoTable espera apenas as colunas NÃO cobertas
          const row: any[] = [
            // Colunas 2, 3, 4, 5 
            linha.tipoRegistro,
            formatarData(linha.data),
            linha.local || '-',
            linha.dadosRegistro || '-'
          ]

          // Valores dos serviços
          servicos.forEach(s => {
            row.push(formatarMoeda(parseFloat(valoresEditados[`${linha.pessoaId}-${linha.tipoRegistro}-${s.id}`] || '0') || 0))
          })

          // Total da linha
          row.push(formatarMoeda(calcularTotalLinha(linha.pessoaId, linha.tipoRegistro)))

          return row
        }
      })

      // ✅ ATUALIZADO: Calcular totais de TODAS as linhas filtradas
      const calcularTotalServicoFiltrado = (servicoId: number) => {
        return linhasParaExportar.reduce((acc, linha) => {
          const key = `${linha.pessoaId}-${linha.tipoRegistro}-${servicoId}`
          const valor = parseFloat(valoresEditados[key] || '0') || 0
          return acc + valor
        }, 0)
      }

      const calcularTotalGeralFiltrado = () => {
        return servicos.reduce((acc, s) => acc + calcularTotalServicoFiltrado(s.id), 0)
      }

      // ✅ CORRIGIDO: Linha de totais como array (ordem original)
      const linhaTotais: any[] = [
        '',
        { content: 'TOTAL GERAL', styles: { fontStyle: 'bold' } },
        '', '', '', '', '', '' // registro, data, local, dadosRegistro, conjuge, genitores
      ]
      servicos.forEach(s => {
        linhaTotais.push({ content: formatarMoeda(calcularTotalServicoFiltrado(s.id)), styles: { fontStyle: 'bold' } })
      })
      linhaTotais.push({ content: formatarMoeda(calcularTotalGeralFiltrado()), styles: { fontStyle: 'bold', fillColor: [217, 119, 6], textColor: [255, 255, 255] } })
      dadosTabela.push(linhaTotais)

      // ✅ ORDEM ORIGINAL DO SISTEMA
      const headers = [
        'Nº', 'Nome', 'Registro', 'Data', 'Local', 'Dados Registro', 'Cônjuge', 'Genitores',
        ...servicos.map(s => s.nome),
        'TOTAL'
      ]

      // Calcular larguras proporcionais (pesos relativos) - ordem original
      const pesosBase = [1.2, 4, 2, 2, 3, 4, 3, 4] // numero, nome, registro, data, local, dadosRegistro, conjuge, genitores
      const pesoServico = 3.5
      const pesoTotal = 3
      
      const todosOsPesos = [...pesosBase, ...servicos.map(() => pesoServico), pesoTotal]
      const somaPesos = todosOsPesos.reduce((a, b) => a + b, 0)
      const unidade = usableWidth / somaPesos
      const larguras = todosOsPesos.map(p => unidade * p)

      // Construir columnStyles com índices numéricos - ordem original
      const columnStyles: Record<number, any> = {}
      
      columnStyles[0] = { cellWidth: larguras[0], halign: 'center' } // numero
      columnStyles[1] = { cellWidth: larguras[1], halign: 'left' } // nome
      columnStyles[2] = { cellWidth: larguras[2], halign: 'center' } // registro
      columnStyles[3] = { cellWidth: larguras[3], halign: 'center' } // data
      columnStyles[4] = { cellWidth: larguras[4], halign: 'left' } // local
      columnStyles[5] = { cellWidth: larguras[5], halign: 'left' } // dadosRegistro
      columnStyles[6] = { cellWidth: larguras[6], halign: 'left' } // conjuge
      columnStyles[7] = { cellWidth: larguras[7], halign: 'left' } // genitores
      
      // Colunas de serviço
      servicos.forEach((s, idx) => {
        columnStyles[8 + idx] = { cellWidth: larguras[8 + idx], halign: 'right' }
      })
      
      // Coluna total
      const totalIdx = 8 + servicos.length
      columnStyles[totalIdx] = { 
        cellWidth: larguras[totalIdx], 
        halign: 'right',
        fillColor: [255, 251, 235],
        fontStyle: 'bold',
        textColor: [180, 83, 9]
      }

      // Gerar tabela
      autoTable(doc, {
        head: [headers],
        body: dadosTabela,
        startY: 18,
        tableWidth: usableWidth,
        styles: {
          fontSize: fontSize,
          cellPadding: 1.2,
          overflow: 'linebreak',
          lineColor: [200, 200, 200],
          lineWidth: 0.1,
          valign: 'middle'
        },
        headStyles: {
          fillColor: [30, 58, 95],
          textColor: 255,
          fontStyle: 'bold',
          halign: 'center',
          fontSize: headerFontSize,
          cellPadding: 1.5,
          minCellHeight: 10
        },
        columnStyles,
        didParseCell: (data) => {
          // Estilizar última linha (totais)
          if (data.row.index === dadosTabela.length - 1) {
            data.cell.styles.fillColor = [229, 231, 235]
            data.cell.styles.fontStyle = 'bold'
          }
        },
        margin: { top: 18, right: marginX, bottom: 15, left: marginX }
      })

      // Caixa com total geral
      const finalY = (doc as any).lastAutoTable?.finalY || 150
      const boxWidth = 65
      const boxX = pageWidth - marginX - boxWidth
      const boxY = Math.min(finalY + 8, pageHeight - 28)
      
      doc.setFillColor(245, 158, 11)
      doc.roundedRect(boxX, boxY, boxWidth, 16, 2, 2, 'F')
      doc.setFontSize(8)
      doc.setTextColor(255, 255, 255)
      const pessoasUnicasFiltradas = [...new Set(linhasParaExportar.map(l => l.pessoaId))]
      const tituloTotal = apenasSelecionadas && linhasSelecionadas.size > 0 
        ? `Total (${linhasParaExportar.length} documento${linhasParaExportar.length > 1 ? 's' : ''})`
        : 'Total Geral do Processo'
      doc.text(tituloTotal, boxX + 4, boxY + 5)
      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.text(formatarMoeda(calcularTotalGeralFiltrado()), boxX + 4, boxY + 12)

      // Salvar
      const sufixoSelecao = apenasSelecionadas && linhasSelecionadas.size > 0 ? '-parcial' : ''
      const nomeArquivo = nomeFamilia 
        ? `relatorio-custos-${nomeFamilia.toLowerCase().replace(/\s+/g, '-')}${sufixoSelecao}-${new Date().toISOString().split('T')[0]}.pdf`
        : `relatorio-custos${sufixoSelecao}-${new Date().toISOString().split('T')[0]}.pdf`
      doc.save(nomeArquivo)
    } catch (error) {
      console.error('Erro ao gerar PDF:', error)
      alert('Erro ao gerar PDF. Verifique se as bibliotecas estão instaladas.')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
      </div>
    )
  }

  if (linhas.length === 0) {
    return (
      <div className="text-center py-12">
        <FileText className="w-12 h-12 mx-auto text-gray-300 mb-4" />
        <h3 className="text-lg font-medium text-gray-600 mb-2">Nenhuma pessoa na árvore</h3>
        <p className="text-sm text-gray-400 max-w-md mx-auto">
          Adicione pessoas na aba "Árvore Genealógica" para que elas apareçam aqui na planilha de custos.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header com ações */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-amber-500" />
          <h3 className="font-semibold text-gray-800">Planilha de Custos</h3>
          <span className="text-sm text-gray-500">
            ({linhas.length} {linhas.length === 1 ? 'documento' : 'documentos'})
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setMostrarDetalhes(!mostrarDetalhes)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition"
          >
            {mostrarDetalhes ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {mostrarDetalhes ? 'Ocultar Detalhes' : 'Mostrar Detalhes'}
          </button>
          
          {/* Exportar selecionados (aparece quando há seleção) */}
          {temSelecao && (
            <button
              onClick={() => exportarPDF(true)}
              className="flex items-center gap-2 px-4 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition"
            >
              <FileDown className="w-4 h-4" />
              Exportar Selecionados ({linhasSelecionadas.size})
            </button>
          )}
          
          <button
            onClick={() => exportarPDF(false)}
            className="flex items-center gap-2 px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition"
          >
            <FileDown className="w-4 h-4" />
            Exportar Todos
          </button>
          {temAlteracoes && (
            <button
              onClick={salvarAlteracoes}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Salvar
            </button>
          )}
          <button
            onClick={() => setShowAddServico(true)}
            className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition"
          >
            <Plus className="w-4 h-4" />
            Adicionar Coluna
          </button>
        </div>
      </div>

      {/* Modal adicionar serviço */}
      {showAddServico && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={novoServico}
              onChange={(e) => setNovoServico(e.target.value)}
              placeholder="Nome do serviço (ex: Procuração)"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
              onKeyPress={(e) => e.key === 'Enter' && adicionarServico()}
              autoFocus
            />
            <button
              onClick={adicionarServico}
              disabled={addingServico || !novoServico.trim()}
              className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition disabled:opacity-50"
            >
              {addingServico ? <Loader2 className="w-4 h-4 animate-spin" /> : "Adicionar"}
            </button>
            <button
              onClick={() => { setShowAddServico(false); setNovoServico("") }}
              className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Tabela de custos estilo Excel */}
      <div ref={tabelaRef} className="overflow-x-auto border border-gray-200 rounded-lg shadow-sm">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-[#1e3a5f] text-white">
              <th className="px-2 py-2 text-center font-semibold border-r border-[#2d4a6f] w-10">
                <button
                  onClick={todasSelecionadas ? limparSelecao : selecionarTodas}
                  className="hover:bg-[#2d4a6f] p-1 rounded transition"
                  title={todasSelecionadas ? "Desmarcar todas" : "Selecionar todas"}
                >
                  {todasSelecionadas ? (
                    <CheckSquare className="w-4 h-4 text-blue-300" />
                  ) : (
                    <Square className="w-4 h-4 text-gray-300" />
                  )}
                </button>
              </th>
              <th className="px-2 py-2 text-center font-semibold border-r border-[#2d4a6f] w-12">Nº</th>
              <th className="px-3 py-2 text-left font-semibold border-r border-[#2d4a6f] min-w-[150px]">Nome</th>
              {mostrarDetalhes && (
                <>
                  <th className="px-2 py-2 text-center font-semibold border-r border-[#2d4a6f] min-w-[90px]">Registro</th>
                  <th className="px-2 py-2 text-center font-semibold border-r border-[#2d4a6f] min-w-[90px]">Data</th>
                  <th className="px-2 py-2 text-left font-semibold border-r border-[#2d4a6f] min-w-[120px]">Local</th>
                  <th className="px-2 py-2 text-left font-semibold border-r border-[#2d4a6f] min-w-[180px]">Dados do Registro</th>
                  <th className="px-2 py-2 text-left font-semibold border-r border-[#2d4a6f] min-w-[120px]">Cônjuge</th>
                  <th className="px-2 py-2 text-left font-semibold border-r border-[#2d4a6f] min-w-[180px]">Genitores</th>
                  <th className="px-2 py-2 text-left font-semibold border-r border-[#2d4a6f] min-w-[100px]">Observação</th>
                </>
              )}
              {servicos.map(servico => (
                <th key={servico.id} className="px-2 py-2 text-center font-semibold border-r border-[#2d4a6f] min-w-[100px]">
                  {editandoServico === servico.id ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={novoNomeServico}
                        onChange={(e) => setNovoNomeServico(e.target.value)}
                        className="w-full px-1 py-0.5 text-xs border rounded text-gray-800"
                        onKeyPress={(e) => e.key === 'Enter' && salvarNomeServico(servico.id)}
                        autoFocus
                      />
                      <button onClick={() => salvarNomeServico(servico.id)} className="text-green-300 hover:text-green-100">
                        {salvandoNome ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                      </button>
                      <button onClick={cancelarEdicaoNome} className="text-gray-300 hover:text-white">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center gap-1 group">
                      <span className="truncate" title={servico.nome}>{servico.nome}</span>
                      <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => iniciarEdicaoNome(servico)} className="text-blue-200 hover:text-white p-0.5">
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button onClick={() => removerServico(servico.id, servico.nome)} className="text-red-300 hover:text-red-100 p-0.5">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )}
                </th>
              ))}
              <th className="px-3 py-2 text-right font-semibold bg-amber-600 min-w-[100px]">Total</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              // Calcular quantas linhas cada pessoa tem para o rowSpan
              const linhasPorPessoa: Record<number, number> = {}
              linhasOrdenadas.forEach(l => {
                linhasPorPessoa[l.pessoaId] = (linhasPorPessoa[l.pessoaId] || 0) + 1
              })
              
              return linhasOrdenadas.map((linha, idx) => {
              const isFirstOfPerson = linha.isPrimeiraLinha
              const bgColor = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'
              const personBg = isFirstOfPerson ? '' : 'bg-gray-100/50'
              const isSelected = linhasSelecionadas.has(getLinhaKey(linha))
              const selectedBg = isSelected ? 'bg-blue-50' : ''
              const rowSpanCount = linhasPorPessoa[linha.pessoaId] || 1
              
              // Verificar se pode mover para cima/baixo
              const canMoveUp = isFirstOfPerson && podeMoverParaCima(linha.pessoaId, linha.numeroLinhagem)
              const canMoveDown = isFirstOfPerson && podeMoverParaBaixo(linha.pessoaId, linha.numeroLinhagem)
              
              return (
                <tr 
                  key={`${linha.pessoaId}-${linha.tipoRegistro}-${idx}`}
                  className={`border-t border-gray-200 hover:bg-amber-50/50 transition ${bgColor} ${personBg} ${selectedBg}`}
                >
                  {/* Checkbox de seleção - em todas as linhas */}
                  <td className="px-2 py-1.5 text-center border-r border-gray-200">
                    <button
                      onClick={() => toggleSelecionarLinha(linha)}
                      className="hover:bg-gray-100 p-1 rounded transition"
                    >
                      {isSelected ? (
                        <CheckSquare className="w-4 h-4 text-blue-600" />
                      ) : (
                        <Square className="w-4 h-4 text-gray-400" />
                      )}
                    </button>
                  </td>
                  
                  {/* Número de Linhagem - em todas as linhas */}
                  <td className="px-2 py-1.5 text-center font-medium text-gray-700 border-r border-gray-200">
                    {linha.numeroLinhagem}
                  </td>
                  
                  {/* Nome - em todas as linhas + setas de reordenação */}
                  <td className="px-3 py-1.5 font-medium text-gray-800 border-r border-gray-200">
                    <div className="flex items-center justify-between gap-1">
                      <span>{linha.nome}</span>
                      {isFirstOfPerson && (canMoveUp || canMoveDown) && (
                        <div className="flex flex-col gap-0.5">
                          <button
                            onClick={() => moverPessoaParaCima(linha.pessoaId, linha.numeroLinhagem)}
                            disabled={!canMoveUp}
                            className={`p-0.5 rounded ${canMoveUp ? 'hover:bg-gray-200 text-gray-500' : 'text-gray-200 cursor-not-allowed'}`}
                            title="Mover para cima"
                          >
                            <ArrowUp className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => moverPessoaParaBaixo(linha.pessoaId, linha.numeroLinhagem)}
                            disabled={!canMoveDown}
                            className={`p-0.5 rounded ${canMoveDown ? 'hover:bg-gray-200 text-gray-500' : 'text-gray-200 cursor-not-allowed'}`}
                            title="Mover para baixo"
                          >
                            <ArrowDown className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                  
                  {mostrarDetalhes && (
                    <>
                      {/* Tipo de Registro */}
                      <td className="px-2 py-1.5 text-center border-r border-gray-200">
                        <span className={`
                          inline-block px-2 py-0.5 rounded text-xs font-medium
                          ${linha.tipoRegistro === 'Nascimento' ? 'bg-green-100 text-green-700' : ''}
                          ${linha.tipoRegistro === 'Casamento' ? 'bg-blue-100 text-blue-700' : ''}
                          ${linha.tipoRegistro === 'Óbito' ? 'bg-gray-200 text-gray-700' : ''}
                          ${linha.tipoRegistro === '-' ? 'text-gray-400' : ''}
                        `}>
                          {linha.tipoRegistro}
                        </span>
                      </td>
                      
                      {/* Data */}
                      <td className="px-2 py-1.5 text-center text-gray-600 border-r border-gray-200">
                        {formatarData(linha.data)}
                      </td>
                      
                      {/* Local */}
                      <td className="px-2 py-1.5 text-gray-600 border-r border-gray-200 truncate max-w-[120px]" title={linha.local}>
                        {linha.local || '-'}
                      </td>
                      
                      {/* Dados do Registro */}
                      <td className="px-2 py-1.5 text-gray-600 border-r border-gray-200 text-xs">
                        {linha.livro || linha.folha || linha.termo ? (
                          <span>
                            {linha.livro && <span>Livro {linha.livro}</span>}
                            {linha.folha && <span> / Folhas {linha.folha}</span>}
                            {linha.termo && <span> / Termo {linha.termo}</span>}
                          </span>
                        ) : '-'}
                      </td>
                      
                      {/* Cônjuge - com rowSpan para mesclar células */}
                      {isFirstOfPerson && (
                        <td 
                          className="px-2 py-1.5 text-gray-600 border-r border-gray-200 max-w-[120px] align-middle" 
                          title={linha.conjuge}
                          rowSpan={rowSpanCount}
                        >
                          {linha.conjuge || '-'}
                        </td>
                      )}
                      
                      {/* Genitores - com rowSpan para mesclar células */}
                      {isFirstOfPerson && (
                        <td 
                          className="px-2 py-1.5 text-gray-600 border-r border-gray-200 text-xs align-middle"
                          rowSpan={rowSpanCount}
                        >
                          {(linha.paiNome || linha.maeNome) ? (
                            <div className="space-y-0.5">
                              {linha.paiNome && <div><span className="font-medium">Pai:</span> {linha.paiNome}</div>}
                              {linha.maeNome && <div><span className="font-medium">Mãe:</span> {linha.maeNome}</div>}
                            </div>
                          ) : '-'}
                        </td>
                      )}
                      
                      {/* Observação */}
                      <td className="px-2 py-1.5 text-gray-600 border-r border-gray-200 truncate max-w-[100px]" title={linha.observacao}>
                        {linha.observacao || '-'}
                      </td>
                    </>
                  )}
                  
                  {/* Valores por Serviço - ✅ ATUALIZADO: Em TODAS as linhas */}
                  {servicos.map(servico => (
                    <td key={servico.id} className="px-1 py-1 text-center border-r border-gray-200">
                      <input
                        type="text"
                        value={valoresEditados[`${linha.pessoaId}-${linha.tipoRegistro}-${servico.id}`] || ''}
                        onChange={(e) => handleValorChange(linha.pessoaId, linha.tipoRegistro, servico.id, e.target.value)}
                        placeholder="0"
                        className="w-full px-1 py-0.5 text-right text-xs border border-gray-200 rounded focus:ring-1 focus:ring-amber-500 focus:border-amber-500 bg-white"
                      />
                    </td>
                  ))}
                  
                  {/* Total da Linha */}
                  <td className="px-3 py-1.5 text-right font-semibold text-amber-700 bg-amber-50">
                    {formatarMoeda(calcularTotalLinha(linha.pessoaId, linha.tipoRegistro))}
                  </td>
                </tr>
              )
            })
            })()}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-400 bg-gray-200 font-semibold">
              <td colSpan={mostrarDetalhes ? 10 : 3} className="px-3 py-2 text-gray-700">
                TOTAL
              </td>
              {servicos.map(servico => (
                <td key={servico.id} className="px-2 py-2 text-center text-gray-700">
                  {formatarMoeda(calcularTotalServico(servico.id))}
                </td>
              ))}
              <td className="px-3 py-2 text-right text-lg text-white bg-amber-600 font-bold">
                {formatarMoeda(calcularTotalGeral())}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Resumo Total */}
      <div className="flex justify-end">
        <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-white px-6 py-4 rounded-xl shadow-lg">
          <p className="text-sm opacity-90">Total Geral do Processo</p>
          <p className="text-2xl font-bold">{formatarMoeda(calcularTotalGeral())}</p>
        </div>
      </div>
    </div>
  )
}