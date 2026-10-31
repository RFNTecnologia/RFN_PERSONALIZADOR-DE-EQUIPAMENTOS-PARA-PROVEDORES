import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, Loader2, Plug, Radar, Radio, Square, Upload, Wifi } from 'lucide-react'
import { api, ErroConexao, gravarConexao, lerConexao, sessaoAutomatica } from '@/lib/api'
import type { ConfiguracaoConexao, RedeLocal, VarreduraRede } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const ESTADOS: Record<
  string,
  { rotulo: string; variante: 'info' | 'success' | 'warning' | 'danger' } | undefined
> = {
  rodando: { rotulo: 'Em andamento', variante: 'info' },
  concluida: { rotulo: 'Concluída', variante: 'success' },
  cancelada: { rotulo: 'Cancelada', variante: 'warning' },
  erro: { rotulo: 'Erro', variante: 'danger' },
}

/** Rotulo e cor do estado de uma varredura (aceita estados vindos do servidor). */
function estadoInfo(estado: string): { rotulo: string; variante: 'info' | 'success' | 'warning' | 'danger' } {
  return ESTADOS[estado] ?? { rotulo: estado, variante: 'info' }
}

export function Varredura() {
  const [redes, setRedes] = useState<RedeLocal[]>([])
  const [cidr, setCidr] = useState('')
  const [portas, setPortas] = useState('80,443,8080,8443,7547')
  const [trabalho, setTrabalho] = useState<VarreduraRede | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [config, setConfig] = useState<ConfiguracaoConexao>(lerConexao)
  const [tentando, setTentando] = useState(false)
  const [conectando, setConectando] = useState(false)
  const [urlServidor, setUrlServidor] = useState(config.urlBase)
  const [tokenServidor, setTokenServidor] = useState(config.token)
  const [historico, setHistorico] = useState<VarreduraRede[]>([])
  const [descobrindo, setDescobrindo] = useState(false)
  const timer = useRef<number | null>(null)

  const semServidor = !config.urlBase || !config.token

  // Sessao automatica: quando o painel e servido pelo proprio servidor do
  // provedor, o token e obtido sozinho, sem colar na aba Conexao.
  useEffect(() => {
    if (!config.urlBase || config.token || tentando) return
    let cancelado = false
    setTentando(true)
    sessaoAutomatica(config)
      .then((nova) => {
        if (cancelado || !nova) return
        setConfig(nova)
        gravarConexao(nova)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelado) setTentando(false)
      })
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.urlBase, config.token])

  const parar = useCallback(() => {
    if (timer.current) {
      window.clearInterval(timer.current)
      timer.current = null
    }
  }, [])

  useEffect(() => {
    if (semServidor) return
    api
      .redesLocais(config)
      .then((dados) => {
        setRedes(dados.redes)
        if (!cidr && dados.redes.length) setCidr(dados.redes[0].cidr)
      })
      .catch(() => {
        /* servidor fora do ar: a tela mostra o aviso abaixo */
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semServidor, config.urlBase, config.token])

  useEffect(() => {
    if (semServidor) return
    api
      .historicoVarreduras(config)
      .then((dados) => setHistorico(dados.varreduras || []))
      .catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semServidor, config.urlBase, config.token])

  useEffect(() => parar, [parar])

  const acompanhar = useCallback(
    (id: string) => {
      parar()
      timer.current = window.setInterval(() => {
        api
          .varredura(config, id)
          .then((dados) => {
            setTrabalho(dados)
            if (dados.estado !== 'rodando') {
              parar()
              toast.success(dados.mensagem)
              carregarHistorico()
            }
          })
          .catch((erro) => {
            parar()
            toast.error(erro instanceof ErroConexao ? erro.message : 'Falha ao consultar a varredura.')
          })
      }, 1200)
    },
    [config, parar],
  )

  async function iniciar() {
    if (semServidor) {
      toast.error('Use o card “Servidor do provedor” para apontar para o servidor do provedor.')
      return
    }
    if (!cidr.trim()) {
      toast.error('Informe a faixa a varrer (ex.: 192.168.10.0/24).')
      return
    }
    const lista = portas
      .split(',')
      .map((p) => Number(p.trim()))
      .filter((p) => Number.isInteger(p) && p > 0 && p < 65536)
    setCarregando(true)
    try {
      const dados = await api.iniciarVarredura(config, { cidr: cidr.trim(), portas: lista })
      setTrabalho(dados)
      toast.success(`Varredura iniciada em ${dados.cidr}.`)
      acompanhar(dados.id)
    } catch (erro) {
      toast.error(erro instanceof ErroConexao ? erro.message : 'Não foi possível iniciar a varredura.')
    } finally {
      setCarregando(false)
    }
  }

  async function descobrir() {
    if (semServidor) {
      toast.error('Configure o servidor do provedor antes de descoberta.')
      return
    }
    setDescobrindo(true)
    try {
      const dados = await api.descobrirRede(config)
      setTrabalho(dados)
      if (dados.encontrados) toast.success(`${dados.encontrados} equipamento(s) anunciado(s) via UPnP/SSDP.`)
      else toast.info('Nenhum equipamento respondeu ao UPnP/SSDP nesta rede.')
      carregarHistorico()
    } catch (erro) {
      toast.error(erro instanceof ErroConexao ? erro.message : 'Não foi possível rodar a descoberta.')
    } finally {
      setDescobrindo(false)
    }
  }

  async function cancelar() {
    if (!trabalho) return
    try {
      const dados = await api.cancelarVarredura(config, trabalho.id)
      setTrabalho(dados)
      parar()
      toast.info('Varredura cancelada.')
    } catch (erro) {
      toast.error(erro instanceof ErroConexao ? erro.message : 'Não foi possível cancelar.')
    }
  }

  async function carregarHistorico() {
    if (semServidor) return
    try {
      const dados = await api.historicoVarreduras(config)
      setHistorico(dados.varreduras || [])
    } catch {
      /* historico indisponivel */
    }
  }

  async function importar() {
    if (!trabalho) return
    try {
      const dados = await api.importarVarredura(config, trabalho.id)
      toast.success(
        `${dados.criados} equipamento(s) adicionado(s) à frota · ${dados.jaConhecidos} já conhecido(s).`,
      )
    } catch (erro) {
      toast.error(erro instanceof ErroConexao ? erro.message : 'Não foi possível importar.')
    }
  }

  async function conectarServidor() {
    const url = urlServidor.trim().replace(/\/+$/, '')
    if (!url) {
      toast.error('Informe a URL do servidor do provedor.')
      return
    }
    setConectando(true)
    try {
      if (tokenServidor.trim()) {
        const nova: ConfiguracaoConexao = { urlBase: url, token: tokenServidor.trim(), ativo: true }
        await api.health(nova)
        setConfig(nova)
        gravarConexao(nova)
        toast.success('Servidor configurado.')
      } else {
        const nova = await sessaoAutomatica({ urlBase: url, token: '', ativo: false })
        if (!nova) {
          throw new Error(
            'Não foi possível obter a sessão automática. Cole o token do servidor (data/token.txt).',
          )
        }
        setConfig(nova)
        setUrlServidor(nova.urlBase)
        setTokenServidor(nova.token)
        gravarConexao(nova)
        toast.success('Sessão automática obtida do servidor.')
      }
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : 'Não foi possível conectar ao servidor.')
    } finally {
      setConectando(false)
    }
  }

  const progresso = trabalho && trabalho.total ? Math.round((trabalho.percorridos / trabalho.total) * 100) : 0

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Varredura de rede</h1>
        <p className="text-sm text-muted-foreground">
          Localiza os equipamentos reais do provedor na rede. A varredura roda no servidor do painel (que
          enxerga a LAN), é somente leitura e não altera nada no equipamento.
        </p>
      </header>

      {semServidor && (
        <Card className="border-amber-300 bg-amber-50">
          <CardHeader>
            <CardTitle className="text-amber-900">Servidor não configurado</CardTitle>
            <CardDescription className="text-amber-800">
              A varredura roda no servidor do provedor (é ele que enxerga a LAN dos equipamentos).
              Informe a URL abaixo — o token é obtido sozinho quando o painel é servido pelo
              servidor; caso contrário, cole o token de <span className="font-mono">data/token.txt</span>.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Servidor do provedor</CardTitle>
          <CardDescription>
            Onde a varredura é executada. Deixe o token em branco para usar a sessão automática.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="url-servidor">URL do servidor</Label>
              <Input
                id="url-servidor"
                value={urlServidor}
                onChange={(e) => setUrlServidor(e.target.value)}
                placeholder="http://10.0.0.10:8080"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="token-servidor">Token do painel</Label>
              <Input
                id="token-servidor"
                value={tokenServidor}
                onChange={(e) => setTokenServidor(e.target.value)}
                placeholder="token de data/token.txt"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={conectarServidor} disabled={conectando}>
              {conectando ? <Loader2 className="animate-spin" /> : <Plug />}
              Conectar
            </Button>
            {!semServidor && (
              <Badge variant="success">
                <CheckCircle2 className="size-3.5" aria-hidden="true" />
                Servidor conectado
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Alvo da varredura</CardTitle>
          <CardDescription>
            Portas sondadas: web (80/443/8080/8443), TR-069 (7547) e acesso administrativo (22/23).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="cidr">Faixa de rede (CIDR)</Label>
              {redes.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {redes.map((rede) => (
                    <button
                      key={rede.cidr}
                      type="button"
                      onClick={() => setCidr(rede.cidr)}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                        cidr === rede.cidr
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-accent'
                      }`}
                    >
                      {rede.cidr} · {rede.interface}
                    </button>
                  ))}
                </div>
              )}
              <Input
                id="cidr"
                value={cidr}
                onChange={(e) => setCidr(e.target.value)}
                placeholder="192.168.10.0/24"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="portas">Portas</Label>
              <Input
                id="portas"
                value={portas}
                onChange={(e) => setPortas(e.target.value)}
                placeholder="80,443,8080,8443,7547"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={iniciar} disabled={semServidor || carregando || trabalho?.estado === 'rodando'}>
              {carregando ? <Loader2 className="animate-spin" /> : <Radar />}
              Iniciar varredura
            </Button>
            <Button variant="outline" onClick={descobrir} disabled={semServidor || descobrindo}>
              {descobrindo ? <Loader2 className="animate-spin" /> : <Radio />}
              Descobrir por UPnP (SSDP)
            </Button>
            {trabalho?.estado === 'rodando' && (
              <Button variant="outline" onClick={cancelar}>
                <Square /> Cancelar
              </Button>
            )}
            {trabalho && trabalho.estado !== 'rodando' && (
              <Button variant="secondary" onClick={importar}>
                <Upload /> Importar para a frota
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {trabalho && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Resultado</CardTitle>
              <Badge variant={estadoInfo(trabalho.estado).variante}>
                {estadoInfo(trabalho.estado).rotulo}
              </Badge>
            </div>
            <CardDescription>{trabalho.mensagem}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${trabalho.estado === 'rodando' ? progresso : 100}%` }}
                />
              </div>
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span>
                  {trabalho.cidr} · {trabalho.percorridos}/{trabalho.total} endereços
                </span>
                <span>{trabalho.encontrados} equipamento(s) encontrado(s)</span>
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>IP</TableHead>
                  <TableHead>MAC</TableHead>
                  <TableHead>Equipamento</TableHead>
                  <TableHead>Firmware</TableHead>
                  <TableHead>Serial</TableHead>
                  <TableHead>Portas</TableHead>
                  <TableHead>Origem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trabalho.hosts.map((host) => (
                  <TableRow key={host.ip}>
                    <TableCell className="font-mono text-xs">{host.ip}</TableCell>
                    <TableCell className="font-mono text-xs">{host.mac || '—'}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <Wifi className="size-3.5 text-muted-foreground" aria-hidden="true" />
                        <span>
                          {host.fabricante || '—'} {host.modelo || ''}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">{host.firmware || '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{host.serial || '—'}</TableCell>
                    <TableCell className="text-xs">{host.portas.length ? host.portas.join(', ') : '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{host.via || '—'}</TableCell>
                  </TableRow>
                ))}
                {!trabalho.hosts.length && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      Nenhum equipamento identificado até agora.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {historico.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Varreduras anteriores</CardTitle>
            <CardDescription>
              Histórico gravado no servidor (sobrevive a reinício). Clique em uma varredura para abrir o
              resultado.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Faixa</TableHead>
                  <TableHead>Início</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Encontrados</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {historico.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs">{item.cidr}</TableCell>
                    <TableCell className="text-xs">
                      {new Date(item.inicio).toLocaleString('pt-BR')}
                    </TableCell>
                    <TableCell>
                      <Badge variant={estadoInfo(item.estado).variante}>
                        {estadoInfo(item.estado).rotulo}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{item.encontrados}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setTrabalho(item)
                          setCidr(item.cidr)
                        }}
                      >
                        Abrir
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
