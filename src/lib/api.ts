/**
 * Cliente do servidor do provedor (API + ACS).
 *
 * A URL e o token sao configurados na tela "Conexao" e ficam no navegador.
 * Quando o servidor nao esta acessivel, o painel continua funcionando em
 * modo local — as acoes que dependem do servidor sao sinalizadas.
 */

import type { Branding, Equipamento, EstadoApp, EventoLog, Perfil, PoliticaRestore } from './types'

const CHAVE = 'rfn.conexao.v1'

export interface ConfiguracaoConexao {
  urlBase: string
  token: string
  ativo: boolean
}

export interface DispositivoACS {
  serial: string
  oid: string
  modelo: string
  fabricante: string
  firmware: string
  ultimoContato: string
  parametros: { path: string; value: string }[]
  eventos: { code: string; timestamp: string }[]
  hashEsperado?: string
}

export interface EstadoServidor extends Omit<EstadoApp, 'logs'> {
  logs: EventoLog[]
  dispositivos: DispositivoACS[]
  servidor: {
    versao: string
    acsUrl: string
    tokenPainel: string
    tokenDispositivo: string
    acsUsuario: string
  }
}

export interface PacoteConfiguracao {
  perfilId: string
  perfilNome: string
  modelo: string
  hash: string
  parametros: { path: string; value: string }[]
  login: { pagina: string }
  politica: PoliticaRestore
  geradoEm: string
}

export interface EquipamentoCadastro {
  serial?: string
  identificador?: string
  modelo?: string
  fabricante?: string
  tipo?: string
  perfilId?: string
  clienteId?: string
  firmwareAlvo?: string
}

export interface InfoProvisionamento {
  acsUrl: string
  acsUsuario: string
  tokenDispositivo: string
  perfis: {
    id: string
    nome: string
    modelo: string
    metodoRestore: string
    dhcpOption43: string
    dhcpOption60: string
  }[]
  exemploDhcpd: string
  exemploUci: string
}

export interface HostVarredura {
  ip: string
  mac: string
  portas: number[]
  modelo: string
  fabricante: string
  firmware: string
  serial: string
  deviceId: string
  servidor: string
  titulo: string
  via: string
}

export interface VarreduraRede {
  id: string
  cidr: string
  portas: number[]
  estado: 'rodando' | 'concluida' | 'cancelada' | 'erro'
  total: number
  percorridos: number
  encontrados: number
  inicio: string
  fim: string | null
  mensagem: string
  hosts: HostVarredura[]
  cancelado: boolean
}

export interface RedeLocal {
  interface: string
  endereco: string
  mascara: string
  cidr: string
}

export const conexaoPadrao: ConfiguracaoConexao = {
  urlBase: typeof window === 'undefined' ? '' : `${window.location.origin}`,
  token: '',
  ativo: false,
}

export function lerConexao(): ConfiguracaoConexao {
  if (typeof window === 'undefined') return conexaoPadrao
  try {
    const bruto = window.localStorage.getItem(CHAVE)
    if (!bruto) return conexaoPadrao
    return { ...conexaoPadrao, ...(JSON.parse(bruto) as Partial<ConfiguracaoConexao>) }
  } catch {
    return conexaoPadrao
  }
}

export function gravarConexao(config: ConfiguracaoConexao) {
  try {
    window.localStorage.setItem(CHAVE, JSON.stringify(config))
  } catch {
    /* persistencia indisponivel */
  }
}

export class ErroConexao extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ErroConexao'
  }
}

function limparUrl(url: string) {
  return url.replace(/\/+$/, '')
}

async function requisicao<T>(
  config: ConfiguracaoConexao,
  caminho: string,
  init: RequestInit = {},
): Promise<T> {
  const base = limparUrl(config.urlBase)
  if (!base) throw new ErroConexao('Informe a URL do servidor do provedor.', 0)
  const cabecalhos: Record<string, string> = {
    'content-type': 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  }
  if (config.token) cabecalhos.authorization = `Bearer ${config.token}`

  let resposta: Response
  try {
    resposta = await fetch(`${base}${caminho}`, { ...init, headers: cabecalhos })
  } catch (erro) {
    throw new ErroConexao(
      `Falha de rede ao contatar ${base}: ${erro instanceof Error ? erro.message : 'erro desconhecido'}`,
      0,
    )
  }

  const tipo = resposta.headers.get('content-type') || ''
  if (!resposta.ok) {
    let detalhe = `${resposta.status} ${resposta.statusText}`
    if (tipo.includes('application/json')) {
      try {
        const corpo = (await resposta.json()) as { erro?: string }
        if (corpo.erro) detalhe = corpo.erro
      } catch {
        /* corpo nao json */
      }
    }
    throw new ErroConexao(detalhe, resposta.status)
  }

  if (tipo.includes('application/json')) return (await resposta.json()) as T
  return (await resposta.text()) as unknown as T
}

export const api = {
  /**
   * Sessao do painel junto ao servidor. Quando o painel e servido pelo
   * proprio servidor do provedor, o token e devolvido automaticamente e a
   * conexao deixa de depender de colar o token na mao.
   */
  async sessao(config: ConfiguracaoConexao) {
    const base = limparUrl(config.urlBase)
    if (!base) throw new ErroConexao('Informe a URL do servidor do provedor.', 0)
    const resposta = await fetch(`${base}/api/sessao`, { headers: { accept: 'application/json' } })
    if (!resposta.ok) {
      throw new ErroConexao('Servidor nao entregou sessao automatica.', resposta.status)
    }
    return (await resposta.json()) as { ok: boolean; urlBase: string; token: string; mesmaOrigem: boolean }
  },

  health(config: ConfiguracaoConexao) {
    return requisicao<{ ok: boolean; servico: string; hora: string }>(config, '/api/health')
  },

  estado(config: ConfiguracaoConexao) {
    return requisicao<EstadoServidor>(config, '/api/estado')
  },

  salvarEstado(config: ConfiguracaoConexao, dados: Partial<EstadoApp>) {
    return requisicao<EstadoServidor>(config, '/api/estado', {
      method: 'PUT',
      body: JSON.stringify(dados),
    })
  },

  salvarBranding(config: ConfiguracaoConexao, branding: Branding) {
    return requisicao<EstadoServidor>(config, '/api/branding', {
      method: 'PATCH',
      body: JSON.stringify(branding),
    })
  },

  salvarPolitica(config: ConfiguracaoConexao, politica: PoliticaRestore) {
    return requisicao<EstadoServidor>(config, '/api/politica', {
      method: 'PATCH',
      body: JSON.stringify(politica),
    })
  },

  salvarPerfil(config: ConfiguracaoConexao, perfil: Perfil) {
    return requisicao<EstadoServidor>(config, '/api/perfis', {
      method: 'PUT',
      body: JSON.stringify(perfil),
    })
  },

  sincronizarEquipamento(config: ConfiguracaoConexao, id: string) {
    return requisicao<{ ok: boolean; divergente: boolean; hash: string; pacote: PacoteConfiguracao }>(
      config,
      `/api/equipamentos/${id}/sincronizar`,
      { method: 'POST' },
    )
  },

  reiniciarEquipamento(config: ConfiguracaoConexao, id: string) {
    return requisicao<{ ok: boolean }>(config, `/api/equipamentos/${id}/reiniciar`, {
      method: 'POST',
    })
  },

  exportar(config: ConfiguracaoConexao) {
    return requisicao<Record<string, unknown>>(config, '/api/exportar')
  },

  importar(config: ConfiguracaoConexao, dados: unknown) {
    return requisicao<EstadoServidor>(config, '/api/importar', {
      method: 'POST',
      body: JSON.stringify(dados),
    })
  },

  /** URL publica da tela de login ja montada com a identidade do provedor. */
  urlLogin(config: ConfiguracaoConexao, serial?: string) {
    const base = limparUrl(config.urlBase)
    return serial ? `${base}/api/login.html?serial=${encodeURIComponent(serial)}` : `${base}/api/login.html`
  },

  /** URL de bootstrap que o CPE usa para recuperar a configuracao. */
  urlBootstrap(config: ConfiguracaoConexao, serial: string, tokenDispositivo?: string) {
    const base = limparUrl(config.urlBase)
    const token = tokenDispositivo || config.token
    return `${base}/bootstrap?serial=${encodeURIComponent(serial)}&token=${encodeURIComponent(token)}`
  },

  /** Cadastra um equipamento (pelo serial ou pelo identificador de provisionamento). */
  novoEquipamento(config: ConfiguracaoConexao, dados: EquipamentoCadastro) {
    return requisicao<{ ok: boolean; equipamento: Equipamento }>(config, '/api/equipamentos', {
      method: 'POST',
      body: JSON.stringify(dados),
    })
  },

  /** Redes (faixas) que o servidor do provedor alcanca. */
  redesLocais(config: ConfiguracaoConexao) {
    return requisicao<{ redes: RedeLocal[]; portasPadrao: number[] }>(config, '/api/rede/redes')
  },

  /** Inicia uma varredura de rede no servidor do provedor. */
  iniciarVarredura(config: ConfiguracaoConexao, dados: { cidr: string; portas?: number[]; limite?: number }) {
    return requisicao<VarreduraRede>(config, '/api/rede/varredura', {
      method: 'POST',
      body: JSON.stringify(dados),
    })
  },

  /** Estado de uma varredura em andamento (acompanhamento pelo painel). */
  varredura(config: ConfiguracaoConexao, id: string) {
    return requisicao<VarreduraRede>(config, `/api/rede/varredura/${encodeURIComponent(id)}`)
  },

  cancelarVarredura(config: ConfiguracaoConexao, id: string) {
    return requisicao<VarreduraRede>(config, `/api/rede/varredura/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  },

  historicoVarreduras(config: ConfiguracaoConexao) {
    return requisicao<{ varreduras: VarreduraRede[] }>(config, '/api/rede/varreduras')
  },

  /** Importa os equipamentos encontrados na varredura para a frota. */
  importarVarredura(config: ConfiguracaoConexao, id: string) {
    return requisicao<{ ok: boolean; criados: number; jaConhecidos: number; ids: string[] }>(
      config,
      `/api/rede/varredura/${encodeURIComponent(id)}/importar`,
      { method: 'POST' },
    )
  },

  /** Descoberta UPnP/SSDP: equipamentos que se anunciam na rede local. */
  descobrirRede(config: ConfiguracaoConexao) {
    return requisicao<VarreduraRede>(config, '/api/rede/descobrir', {
      method: 'POST',
      body: JSON.stringify({}),
    })
  },

  /** Dados de provisionamento via DHCP (option 43/60) e ACS. */
  infoProvisionamento(config: ConfiguracaoConexao) {
    return requisicao<InfoProvisionamento>(config, '/api/dhcp-info')
  },

  listarFirmware(config: ConfiguracaoConexao) {
    return requisicao<{ arquivos: string[] }>(config, '/api/firmware')
  },

  /** Publica um firmware para download pelo CPE. */
  async publicarFirmware(config: ConfiguracaoConexao, nome: string, arquivo: File) {
    const bytes = new Uint8Array(await arquivo.arrayBuffer())
    let binario = ''
    for (let i = 0; i < bytes.length; i += 1) binario += String.fromCharCode(bytes[i])
    return requisicao<{ ok: boolean; nome: string; bytes: number; url: string }>(config, '/api/firmware', {
      method: 'POST',
      body: JSON.stringify({ nome, conteudoBase64: btoa(binario) }),
    })
  },

  removerFirmware(config: ConfiguracaoConexao, nome: string) {
    return requisicao<{ ok: boolean }>(config, `/api/firmware/${encodeURIComponent(nome)}`, {
      method: 'DELETE',
    })
  },

  /** Baixa o kit de implantacao (.tar.gz) do equipamento. */
  async baixarKit(config: ConfiguracaoConexao, id: string, serial: string) {
    const base = limparUrl(config.urlBase)
    const cabecalhos: Record<string, string> = {}
    if (config.token) cabecalhos.authorization = `Bearer ${config.token}`
    const resposta = await fetch(`${base}/api/equipamentos/${encodeURIComponent(id)}/kit`, {
      headers: cabecalhos,
    })
    if (!resposta.ok) {
      let detalhe = `${resposta.status} ${resposta.statusText}`
      try {
        const corpo = (await resposta.json()) as { erro?: string }
        if (corpo.erro) detalhe = corpo.erro
      } catch {
        /* corpo nao json */
      }
      throw new ErroConexao(detalhe, resposta.status)
    }
    const blob = await resposta.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `kit-${serial || id}.tar.gz`
    link.click()
    URL.revokeObjectURL(url)
  },

  /**
   * Baixa o pacote de instalacao do servidor (painel + ACS).
   * Formato "zip" (padrao, abre nativamente no Windows) ou "tar.gz".
   */
  async baixarPacoteServidor(config: ConfiguracaoConexao, formato: 'zip' | 'tar.gz' = 'zip') {
    const base = limparUrl(config.urlBase)
    const cabecalhos: Record<string, string> = {}
    if (config.token) cabecalhos.authorization = `Bearer ${config.token}`
    const caminho = formato === 'zip' ? '/api/pacote.zip' : '/api/pacote'
    const resposta = await fetch(`${base}${caminho}`, { headers: cabecalhos })
    if (!resposta.ok) {
      let detalhe = `${resposta.status} ${resposta.statusText}`
      try {
        const corpo = (await resposta.json()) as { erro?: string }
        if (corpo.erro) detalhe = corpo.erro
      } catch {
        /* corpo nao json */
      }
      throw new ErroConexao(detalhe, resposta.status)
    }
    const blob = await resposta.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `rfn-painel-1.0.0.${formato}`
    link.click()
    URL.revokeObjectURL(url)
  },

  /** Arquivos do kit de implantacao em texto (visualizacao no painel). */
  arquivosKit(config: ConfiguracaoConexao, id: string) {
    return requisicao<{ hash: string; arquivos: { nome: string; bytes: number }[]; conteudo: Record<string, string> }>(
      config,
      `/api/equipamentos/${encodeURIComponent(id)}/kit-arquivos`,
    )
  },

  /** URL completa do agente, para download pelo painel. */
  urlAgente(config: ConfiguracaoConexao, serial: string, tokenDispositivo?: string) {
    const base = limparUrl(config.urlBase)
    const token = tokenDispositivo || config.token
    return `${base}/api/agente?serial=${encodeURIComponent(serial)}&token=${encodeURIComponent(token)}`
  },

  /** URL do arquivo de configuracao em formato shell (consumido pelo agente). */
  urlBootstrapEnv(config: ConfiguracaoConexao, serial: string, tokenDispositivo?: string) {
    const base = limparUrl(config.urlBase)
    const token = tokenDispositivo || config.token
    return `${base}/bootstrap/env?serial=${encodeURIComponent(serial)}&token=${encodeURIComponent(token)}`
  },

  /** URL da pagina de login pronta para publicar no CPE. */
  urlLoginDispositivo(config: ConfiguracaoConexao, serial: string, tokenDispositivo?: string) {
    const base = limparUrl(config.urlBase)
    const token = tokenDispositivo || config.token
    return `${base}/bootstrap/login.html?serial=${encodeURIComponent(serial)}&token=${encodeURIComponent(token)}`
  },
}

/**
 * Tenta obter a sessao automaticamente junto ao servidor. Funciona quando o
 * painel e servido pelo proprio servidor do provedor (mesma origem) ou quando
 * o servidor aceita a requisicao sem token. Devolve null quando nao ha
 * sessao automatica disponivel.
 */
export async function sessaoAutomatica(
  config: ConfiguracaoConexao,
): Promise<ConfiguracaoConexao | null> {
  if (!config.urlBase) return null
  const candidatas = [config.urlBase]
  try {
    const alvo = new URL(config.urlBase)
    if (alvo.port !== '8080') candidatas.push(`${alvo.protocol}//${alvo.hostname}:8080`)
  } catch {
    /* url invalida: tenta apenas a informada */
  }
  for (const urlBase of candidatas) {
    try {
      const dados = await api.sessao({ ...config, urlBase })
      if (!dados.token) continue
      return { ...config, urlBase: dados.urlBase || urlBase, token: dados.token, ativo: true }
    } catch {
      /* tenta a proxima candidata */
    }
  }
  return null
}

/** Baixa um conteudo de texto como arquivo local. */
export function baixarArquivo(nome: string, conteudo: string, tipo = 'application/json') {
  const blob = new Blob([conteudo], { type: `${tipo};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = nome
  link.click()
  URL.revokeObjectURL(url)
}

export function resumoEquipamentos(equipamentos: Equipamento[]) {
  return {
    total: equipamentos.length,
    online: equipamentos.filter((e) => e.status === 'online').length,
    recuperacao: equipamentos.filter((e) => e.status === 'em-recuperacao').length,
  }
}
