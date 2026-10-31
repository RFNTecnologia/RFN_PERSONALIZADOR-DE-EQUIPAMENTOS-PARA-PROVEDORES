import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Cable,
  CheckCircle2,
  CloudUpload,
  Container,
  Download,
  Link2,
  Loader2,
  Package,
  RefreshCw,
  Router,
  Server,
  Terminal,
  TriangleAlert,
} from 'lucide-react'
import { api, baixarArquivo, ErroConexao, lerConexao, gravarConexao, sessaoAutomatica } from '@/lib/api'
import type { ConfiguracaoConexao, DispositivoACS, InfoProvisionamento } from '@/lib/api'
import { useEstado } from '@/lib/store'
import { formatarRelativo } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type EstadoConexao = 'desconectado' | 'conectando' | 'conectado' | 'erro'

export function Conexao() {
  const { branding, perfis, politica, equipamentos, aplicarEstadoServidor, registrarLog } = useEstado()
  const [config, setConfig] = useState<ConfiguracaoConexao>(lerConexao)
  const [status, setStatus] = useState<EstadoConexao>('desconectado')
  const [mensagem, setMensagem] = useState('Servidor não configurado.')
  const [ocupado, setOcupado] = useState(false)
  const [dispositivos, setDispositivos] = useState<DispositivoACS[]>([])
  const [tokenDispositivo, setTokenDispositivo] = useState('')
  const [info, setInfo] = useState<InfoProvisionamento | null>(null)
  const [firmwares, setFirmwares] = useState<string[]>([])
  const [cadastro, setCadastro] = useState({
    serial: '',
    identificador: '',
    modelo: '',
    perfilId: '',
  })

  useEffect(() => {
    gravarConexao(config)
  }, [config])

  // Sessao automatica: servindo o painel pelo proprio servidor do provedor,
  // o token e obtido sozinho, sem colar na mao.
  useEffect(() => {
    if (config.token) return
    let cancelado = false
    sessaoAutomatica(config)
      .then((nova) => {
        if (cancelado || !nova) return
        setConfig(nova)
        setStatus('conectado')
        setMensagem('Sessao obtida automaticamente no servidor do provedor.')
      })
      .catch(() => undefined)
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.urlBase, config.token])

  async function executar<T>(acao: () => Promise<T>, sucesso: string): Promise<T | null> {
    setOcupado(true)
    setStatus('conectando')
    try {
      const resultado = await acao()
      setStatus('conectado')
      setMensagem('Servidor do provedor respondeu normalmente.')
      toast.success(sucesso)
      return resultado
    } catch (erro) {
      const texto = erro instanceof ErroConexao ? erro.message : 'Falha inesperada na comunicação.'
      setStatus('erro')
      setMensagem(texto)
      toast.error(texto)
      return null
    } finally {
      setOcupado(false)
    }
  }

  async function testar() {
    const resultado = await executar(() => api.health(config), 'Servidor respondeu.')
    if (resultado) {
      setMensagem(`ACS/ painel "${resultado.servico}" ativo em ${config.urlBase}.`)
    }
  }

  async function carregarEstado() {
    const estado = await executar(() => api.estado(config), 'Estado sincronizado.')
    if (!estado) return
    aplicarEstadoServidor(estado)
    setDispositivos(estado.dispositivos ?? [])
    setTokenDispositivo(estado.servidor?.tokenDispositivo ?? '')
    registrarLog({
      tipo: 'provisionamento',
      mensagem: 'Estado carregado do servidor do provedor',
      detalhe: `${estado.equipamentos?.length ?? 0} equipamento(s) e ${estado.dispositivos?.length ?? 0} dispositivo(s) conectado(s) ao ACS.`,
      resultado: 'sucesso',
    })
  }

  async function enviarEstado() {
    const estado = await executar(
      () =>
        api.salvarEstado(config, {
          branding,
          perfis,
          politica,
          equipamentos,
        }),
      'Configuração enviada ao servidor.',
    )
    if (!estado) return
    setDispositivos(estado.dispositivos ?? [])
    setTokenDispositivo(estado.servidor?.tokenDispositivo ?? '')
  }

  async function sincronizar(serial: string, id: string) {
    const resposta = await executar(
      () => api.sincronizarEquipamento(config, id),
      `Sincronização enviada para ${serial}.`,
    )
    if (!resposta) return
    toast.info(
      resposta.divergente
        ? `Divergência detectada (hash ${resposta.hash}). O CPE vai reaplicar o perfil.`
        : `Configuração já estava aplicada (hash ${resposta.hash}).`,
    )
  }

  async function reiniciar(id: string, serial: string) {
    await executar(() => api.reiniciarEquipamento(config, id), `Reinício enviado para ${serial}.`)
  }

  async function baixarLogin(serial: string) {
    const html = await executar(() => fetch(api.urlLogin(config, serial)).then((r) => r.text()), 'Arquivo gerado.')
    if (html) baixarArquivo(`login-${serial}.html`, html, 'text/html')
  }

  async function baixarPaginaLogin() {
    const html = await executar(() => fetch(api.urlLogin(config)).then((r) => r.text()), 'Pagina gerada.')
    if (html) baixarArquivo('pacote-login.html', html, 'text/html')
  }

  async function baixarAgente(serial: string) {
    const script = await executar(
      () => fetch(api.urlAgente(config, serial, tokenDispositivo)).then((r) => r.text()),
      'Agente gerado.',
    )
    if (script) baixarArquivo(`rfn-bootstrap-${serial}.sh`, script, 'text/x-shellscript')
  }

  async function baixarKit(id: string, serial: string) {
    setOcupado(true)
    try {
      await api.baixarKit(config, id, serial)
      toast.success('Kit de implantação baixado.')
    } catch (erro) {
      const texto = erro instanceof ErroConexao ? erro.message : 'Falha ao gerar o kit.'
      toast.error(texto)
    } finally {
      setOcupado(false)
    }
  }

  async function baixarPacote(formato: 'zip' | 'tar.gz' = 'zip') {
    setOcupado(true)
    try {
      await api.baixarPacoteServidor(config, formato)
      toast.success(
        formato === 'zip'
          ? 'Pacote .zip baixado. No Windows, extraia com o Explorer ou com Expand-Archive.'
          : 'Pacote .tar.gz baixado.',
      )
    } catch (erro) {
      const texto = erro instanceof ErroConexao ? erro.message : 'Falha ao gerar o pacote.'
      toast.error(texto)
    } finally {
      setOcupado(false)
    }
  }

  async function carregarProvisionamento() {
    const dados = await executar(() => api.infoProvisionamento(config), 'Dados de provisionamento carregados.')
    if (dados) setInfo(dados)
  }

  async function carregarFirmwares() {
    const dados = await executar(() => api.listarFirmware(config), 'Firmwares carregados.')
    if (dados) setFirmwares(dados.arquivos)
  }

  async function enviarFirmware(arquivo: File) {
    const resultado = await executar(
      () => api.publicarFirmware(config, arquivo.name, arquivo),
      'Firmware publicado.',
    )
    if (resultado) {
      setFirmwares((lista) => [...new Set([...lista, resultado.nome])])
      copiar(resultado.url, 'URL do firmware')
    }
  }

  async function removerFirmware(nome: string) {
    const resultado = await executar(() => api.removerFirmware(config, nome), 'Firmware removido.')
    if (resultado) setFirmwares((lista) => lista.filter((item) => item !== nome))
  }

  async function cadastrarEquipamento() {
    const resultado = await executar(
      () =>
        api.novoEquipamento(config, {
          serial: cadastro.serial.trim() || undefined,
          identificador: cadastro.identificador.trim() || undefined,
          modelo: cadastro.modelo.trim() || undefined,
          perfilId: cadastro.perfilId || undefined,
        }),
      'Equipamento cadastrado.',
    )
    if (!resultado) return
    setCadastro({ serial: '', identificador: '', modelo: '', perfilId: '' })
    registrarLog({
      tipo: 'provisionamento',
      mensagem: `Equipamento ${resultado.equipamento.serial} cadastrado no servidor`,
      detalhe: `Restauracao pos-reset habilitada com o perfil "${resultado.equipamento.perfilId}".`,
      resultado: 'sucesso',
    })
    await carregarEstado()
  }

  async function exportarJson() {
    const dados = await executar(() => api.exportar(config), 'Configuração exportada.')
    if (dados) baixarArquivo('configuracao-provedor.json', JSON.stringify(dados, null, 2))
  }

  function copiar(texto: string, rotulo: string) {
    navigator.clipboard?.writeText(texto)
    toast.success(`${rotulo} copiado.`)
  }

  const badgeStatus =
    status === 'conectado' ? 'success' : status === 'erro' ? 'danger' : status === 'conectando' ? 'warning' : 'secondary'

  const comandosInstalacao = [
    'tar -xzf rfn-painel-1.0.0.tar.gz',
    'cd rfn-painel',
    'sudo sh instalar.sh',
    'cat /opt/rfn-painel/data/token.txt   # cole no painel (aba Conexão)',
  ].join('\n')

  const comandosDocker = [
    '# Windows (PowerShell) - baixe o .zip pelo painel antes:',
    'Expand-Archive .\\rfn-painel-1.0.0.zip -DestinationPath C:\\rfn',
    'cd C:\\rfn\\rfn-painel',
    'docker compose up -d --build',
    'docker compose logs -f',
    'docker exec rfn-painel cat /data/token.txt   # token do painel',
    '',
    '# Linux:',
    'tar -xzf rfn-painel-1.0.0.tar.gz',
    'cd rfn-painel',
    'docker compose up -d --build',
  ].join('\n')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Conexão com o servidor</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          O painel conversa com o servidor do provedor que hospeda o ACS (TR-069), o endpoint de bootstrap
          e a tela de login publicada. Sem servidor configurado, o painel opera em modo local.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="size-4" aria-hidden="true" /> Servidor do provedor
          </CardTitle>
          <CardDescription>Endereço do servidor e token de administrador.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="url-base">URL do servidor</Label>
              <Input
                id="url-base"
                value={config.urlBase}
                placeholder="https://acs.seuprovedor.com.br:8080"
                onChange={(e) => setConfig((c) => ({ ...c, urlBase: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="token-painel">Token do painel</Label>
              <Input
                id="token-painel"
                type="password"
                value={config.token}
                placeholder="token exibido pelo servidor no start"
                onChange={(e) => setConfig((c) => ({ ...c, token: e.target.value }))}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={testar} disabled={ocupado}>
              {ocupado ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
              Testar conexão
            </Button>
            <Button variant="outline" onClick={carregarEstado} disabled={ocupado}>
              <Download aria-hidden="true" /> Carregar do servidor
            </Button>
            <Button variant="outline" onClick={enviarEstado} disabled={ocupado}>
              <CloudUpload aria-hidden="true" /> Enviar configuração
            </Button>
            <Button variant="outline" onClick={exportarJson} disabled={ocupado}>
              <Download aria-hidden="true" /> Exportar JSON
            </Button>
            <Badge variant={badgeStatus}>{status}</Badge>
          </div>

          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            {status === 'erro' ? (
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-red-600" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
            )}
            {mensagem}
          </p>

          <Separator />

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="token-disp">Token do equipamento</Label>
              <Input
                id="token-disp"
                value={tokenDispositivo}
                placeholder="token de bootstrap dos CPEs"
                onChange={(e) => setTokenDispositivo(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Usado pelo agente do equipamento para chamar o endpoint de bootstrap.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Endpoints</Label>
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li>
                  ACS (TR-069): <span className="font-mono">{config.urlBase}/acs/tr069</span>
                </li>
                <li>
                  Bootstrap: <span className="font-mono">{config.urlBase}/bootstrap?serial=…</span>
                </li>
                <li>
                  Login publicado: <span className="font-mono">{config.urlBase}/api/login.html</span>
                </li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cable className="size-4" aria-hidden="true" /> Provisionamento da frota
          </CardTitle>
          <CardDescription>
            Envie o perfil do provedor ao equipamento, reinicie e gere os artefatos de implantação.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Serial</TableHead>
                <TableHead>Modelo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {equipamentos.map((eq) => (
                <TableRow key={eq.id}>
                  <TableCell className="font-mono text-xs">{eq.serial}</TableCell>
                  <TableCell>{eq.modelo}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{eq.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="xs" variant="outline" onClick={() => sincronizar(eq.serial, eq.id)}>
                        Sincronizar
                      </Button>
                      <Button size="xs" variant="outline" onClick={() => reiniciar(eq.id, eq.serial)}>
                        Reiniciar
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() =>
                          copiar(api.urlBootstrap(config, eq.serial, tokenDispositivo), 'URL de bootstrap')
                        }
                      >
                        <Link2 aria-hidden="true" /> Bootstrap
                      </Button>
                      <Button size="xs" variant="ghost" onClick={() => baixarLogin(eq.serial)}>
                        <Download aria-hidden="true" /> Login
                      </Button>
                      <Button size="xs" variant="ghost" onClick={() => baixarAgente(eq.serial)}>
                        <Terminal aria-hidden="true" /> Agente
                      </Button>
                      <Button size="xs" variant="ghost" onClick={() => baixarKit(eq.id, eq.serial)}>
                        <Package aria-hidden="true" /> Kit
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={baixarPaginaLogin}>
              <Download aria-hidden="true" /> Baixar página de login padrão
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="size-4" aria-hidden="true" /> Dispositivos conectados ao ACS
          </CardTitle>
          <CardDescription>Equipamentos que já falaram com o servidor via TR-069.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Serial</TableHead>
                <TableHead>Modelo</TableHead>
                <TableHead>Firmware</TableHead>
                <TableHead>Último contato</TableHead>
                <TableHead>Parâmetros</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dispositivos.map((d) => (
                <TableRow key={d.serial}>
                  <TableCell className="font-mono text-xs">{d.serial}</TableCell>
                  <TableCell>
                    {d.fabricante} {d.modelo}
                  </TableCell>
                  <TableCell className="text-xs">{d.firmware}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatarRelativo(d.ultimoContato)}
                  </TableCell>
                  <TableCell className="text-xs">{d.parametros?.length ?? 0}</TableCell>
                </TableRow>
              ))}
              {dispositivos.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    Nenhum dispositivo conectado ainda. O CPE aparece aqui após o primeiro Inform no ACS.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="size-4" aria-hidden="true" /> Provisionamento via DHCP e TR-069
          </CardTitle>
          <CardDescription>
            Dados que o provedor precisa aplicar na rede para o equipamento voltar para a
            configuração do provedor depois de um reset de fábrica.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button variant="outline" onClick={carregarProvisionamento} disabled={ocupado}>
            {ocupado ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw aria-hidden="true" />
            )}
            Carregar dados de provisionamento
          </Button>

          {info && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border p-3">
                  <p className="text-xs font-medium text-muted-foreground">URL do ACS (TR-069)</p>
                  <p className="mt-1 break-all font-mono text-xs">{info.acsUrl}</p>
                  <Button variant="link" className="h-auto p-0" onClick={() => copiar(info.acsUrl, 'URL do ACS')}>
                    Copiar
                  </Button>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs font-medium text-muted-foreground">Usuário do ACS</p>
                  <p className="mt-1 font-mono text-xs">{info.acsUsuario}</p>
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Perfil</TableHead>
                      <TableHead>Modelo</TableHead>
                      <TableHead>Option 43</TableHead>
                      <TableHead>Option 60</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {info.perfis.map((perfil) => (
                      <TableRow key={perfil.id}>
                        <TableCell className="text-xs">{perfil.nome}</TableCell>
                        <TableCell className="font-mono text-xs">{perfil.modelo}</TableCell>
                        <TableCell className="font-mono text-xs">{perfil.dhcpOption43 || '—'}</TableCell>
                        <TableCell className="font-mono text-xs">{perfil.dhcpOption60 || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="space-y-3">
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs font-medium text-muted-foreground">Servidor DHCP (option 43/60)</p>
                  <pre className="mt-1 overflow-x-auto font-mono text-xs">{info.exemploDhcpd}</pre>
                  <Button
                    variant="link"
                    className="h-auto p-0"
                    onClick={() => copiar(info.exemploDhcpd, 'Configuração do DHCP')}
                  >
                    Copiar
                  </Button>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs font-medium text-muted-foreground">OpenWrt (/etc/config/dhcp)</p>
                  <pre className="mt-1 overflow-x-auto font-mono text-xs">{info.exemploUci}</pre>
                  <Button
                    variant="link"
                    className="h-auto p-0"
                    onClick={() => copiar(info.exemploUci, 'Configuração do OpenWrt')}
                  >
                    Copiar
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="size-4" aria-hidden="true" /> Firmwares do provedor
          </CardTitle>
          <CardDescription>
            Arquivos hospedados no servidor e publicados para download pelo equipamento
            (Device.X.Firmware.1.DownloadURL).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={carregarFirmwares} disabled={ocupado}>
              <RefreshCw aria-hidden="true" /> Listar
            </Button>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted">
              <CloudUpload aria-hidden="true" /> Publicar firmware
              <input
                type="file"
                className="hidden"
                onChange={(evento) => {
                  const arquivo = evento.target.files?.[0]
                  if (arquivo) void enviarFirmware(arquivo)
                  evento.target.value = ''
                }}
              />
            </label>
          </div>

          {firmwares.length > 0 && (
            <ul className="divide-y rounded-lg border">
              {firmwares.map((nome) => (
                <li key={nome} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="truncate font-mono text-xs">{nome}</span>
                  <Button variant="ghost" size="sm" onClick={() => removerFirmware(nome)}>
                    Remover
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Router className="size-4" aria-hidden="true" /> Cadastrar equipamento
          </CardTitle>
          <CardDescription>
            Registre o serial de fábrica ou o identificador de provisionamento
            (grupo::modelo-carimbo-uid) para que o ACS reconheça o equipamento após o reset.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cad-serial">Serial de fábrica</Label>
              <Input
                id="cad-serial"
                value={cadastro.serial}
                placeholder="FS-ONT-884210"
                onChange={(e) => setCadastro((c) => ({ ...c, serial: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cad-identificador">Identificador de provisionamento</Label>
              <Input
                id="cad-identificador"
                value={cadastro.identificador}
                placeholder="gru1::cx588-1793224550476-38f3d149b1ba"
                onChange={(e) => setCadastro((c) => ({ ...c, identificador: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cad-modelo">Modelo</Label>
              <Input
                id="cad-modelo"
                value={cadastro.modelo}
                placeholder="cx588"
                onChange={(e) => setCadastro((c) => ({ ...c, modelo: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cad-perfil">Perfil de configuração</Label>
              <Select
                value={cadastro.perfilId}
                onValueChange={(valor) => setCadastro((c) => ({ ...c, perfilId: valor }))}
              >
                <SelectTrigger id="cad-perfil">
                  <SelectValue placeholder="Selecione o perfil" />
                </SelectTrigger>
                <SelectContent>
                  {perfis.map((perfil) => (
                    <SelectItem key={perfil.id} value={perfil.id}>
                      {perfil.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button onClick={cadastrarEquipamento} disabled={ocupado}>
            <Server aria-hidden="true" /> Cadastrar no servidor
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package aria-hidden="true" /> Instalar no servidor do provedor
          </CardTitle>
          <CardDescription>
            Baixe o pacote com o painel web, o ACS (TR-069), o endpoint de bootstrap e o agente de
            restauração. O servidor roda sem dependências externas: apenas Node 18 ou superior.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => baixarPacote('zip')} disabled={ocupado}>
              {ocupado ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Download aria-hidden="true" />
              )}
              Baixar pacote (.zip)
            </Button>
            <Button variant="outline" onClick={() => baixarPacote('tar.gz')} disabled={ocupado}>
              <Download aria-hidden="true" /> Baixar (.tar.gz)
            </Button>
            <Button variant="outline" onClick={() => copiar(comandosInstalacao, 'Comandos')}>
              <Terminal aria-hidden="true" /> Copiar comandos
            </Button>
            <Button variant="outline" onClick={() => copiar(comandosDocker, 'Comandos Docker')}>
              <Container aria-hidden="true" /> Copiar comandos Docker
            </Button>
          </div>

          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              Windows (Docker Desktop): baixe o <span className="font-mono">.zip</span>, clique com o
              botão direito no arquivo &gt; Extrair tudo, ou no PowerShell rode{' '}
              <span className="font-mono">Expand-Archive .\rfn-painel-1.0.0.zip -DestinationPath C:\rfn</span>.
              Depois, dentro de <span className="font-mono">C:\rfn</span>, rode{' '}
              <span className="font-mono">docker compose up -d --build</span>. O guia completo está em{' '}
              <span className="font-mono">docs/WINDOWS.md</span>.
            </li>
            <li>
              Linux: descompacte o pacote e rode <span className="font-mono">sudo sh instalar.sh</span>.
            </li>
            <li>
              Copie o token para o campo &quot;Token do painel&quot;:{' '}
              <span className="font-mono">cat /opt/rfn-painel/data/token.txt</span> (Linux) ou{' '}
              <span className="font-mono">docker exec rfn-painel cat /data/token.txt</span> (Docker).
            </li>
            <li>
              Ajuste <span className="font-mono">RFN_PUBLIC_URL</span> em{' '}
              <span className="font-mono">/opt/rfn-painel/env</span> com o endereço público do servidor e
              reinicie o serviço.
            </li>
            <li>Aponte o DHCP da rede (option 43/60) para a URL do ACS e cadastre a frota.</li>
            <li>Baixe o kit de implantação de cada equipamento e aplique-o no CPE.</li>
          </ol>

          <div className="space-y-1.5">
            <Label>Linux (systemd)</Label>
            <div className="rounded-lg border bg-muted/30 p-3">
              <pre className="overflow-x-auto font-mono text-xs">{comandosInstalacao}</pre>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Windows / Docker</Label>
            <div className="rounded-lg border bg-muted/30 p-3">
              <pre className="overflow-x-auto font-mono text-xs">{comandosDocker}</pre>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
