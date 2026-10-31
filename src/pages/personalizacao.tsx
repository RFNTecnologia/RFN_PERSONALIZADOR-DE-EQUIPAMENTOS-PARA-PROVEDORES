import { useRef, useState } from 'react'
import { ImageUp, Plus, RotateCcw, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { useEstado } from '@/lib/store'
import { api, ErroConexao, lerConexao } from '@/lib/api'
import { brandingSeed } from '@/lib/seed'
import { rotuloTipo } from '@/lib/format'
import type { Branding, CampoExtra, TipoEquipamento } from '@/lib/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TelaLogin } from '@/components/preview/tela-login'

type Escopo = 'todos' | 'online' | `tipo:${TipoEquipamento}`

function CampoCor({
  id,
  rotulo,
  valor,
  aoMudar,
}: {
  id: string
  rotulo: string
  valor: string
  aoMudar: (v: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{rotulo}</Label>
      <div className="flex gap-2">
        <input
          id={`${id}-picker`}
          type="color"
          value={valor}
          onChange={(e) => aoMudar(e.target.value)}
          aria-label={`${rotulo} (seletor de cor)`}
          className="h-9 w-12 cursor-pointer rounded-md border bg-background p-1"
        />
        <Input
          id={id}
          value={valor}
          onChange={(e) => aoMudar(e.target.value)}
          className="font-mono text-xs"
        />
      </div>
    </div>
  )
}

export function Personalizacao() {
  const { branding, equipamentos, atualizarBranding, registrarLog } = useEstado()
  const [publicar, setPublicar] = useState(false)
  const [escopo, setEscopo] = useState<Escopo>('todos')
  const inputArquivo = useRef<HTMLInputElement>(null)

  function alterar(patch: Partial<Branding>) {
    atualizarBranding(patch)
  }

  function carregarLogo(arquivo: File) {
    const leitor = new FileReader()
    leitor.onload = () => {
      const resultado = leitor.result
      if (typeof resultado === 'string') {
        alterar({ logoUrl: resultado })
        toast.success('Logo carregada. Revise a pré-visualização antes de publicar.')
      }
    }
    leitor.readAsDataURL(arquivo)
  }

  function adicionarCampo() {
    const novo: CampoExtra = {
      id: `ce${Date.now()}`,
      rotulo: 'Novo campo',
      tipo: 'texto',
      placeholder: '',
      obrigatorio: false,
    }
    alterar({ camposExtras: [...branding.camposExtras, novo] })
  }

  function atualizarCampo(id: string, patch: Partial<CampoExtra>) {
    alterar({
      camposExtras: branding.camposExtras.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    })
  }

  function removerCampo(id: string) {
    alterar({ camposExtras: branding.camposExtras.filter((c) => c.id !== id) })
  }

  const alvo =
    escopo === 'todos'
      ? equipamentos
      : escopo === 'online'
        ? equipamentos.filter((e) => e.status === 'online')
        : equipamentos.filter((e) => e.tipo === escopo.split(':')[1])

  async function confirmarPublicacao() {
    const conexao = lerConexao()
    if (conexao.ativo && conexao.urlBase) {
      try {
        await api.salvarBranding(conexao, branding)
        for (const eq of alvo) {
          await api.sincronizarEquipamento(conexao, eq.id)
        }
        registrarLog({
          tipo: 'branding',
          equipamentoId: null,
          mensagem: `Tela de login publicada para ${alvo.length} equipamento(s)`,
          detalhe: `Template "${branding.nome}" aplicado via ACS (escopo: ${escopo}).`,
          resultado: 'sucesso',
        })
        setPublicar(false)
        toast.success(`Template publicado para ${alvo.length} equipamento(s).`)
      } catch (erro) {
        toast.error(
          erro instanceof ErroConexao
            ? erro.message
            : 'Falha ao publicar no servidor do provedor.',
        )
      }
      return
    }

    registrarLog({
      tipo: 'branding',
      equipamentoId: null,
      mensagem: `Tela de login publicada para ${alvo.length} equipamento(s)`,
      detalhe: `Template "${branding.nome}" registrado localmente (escopo: ${escopo}). Configure a conexão com o servidor em "Conexão" para publicar de fato.`,
      resultado: 'pendente',
    })
    setPublicar(false)
    toast.success(`Template registrado para ${alvo.length} equipamento(s).`)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Personalização da interface</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A tela de login que o cliente acessa no equipamento depois de qualquer reset.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              atualizarBranding({ ...brandingSeed, id: branding.id })
              toast('Ajustes visuais recomeçados.')
            }}
          >
            <RotateCcw aria-hidden="true" /> Recomeçar
          </Button>
          <Button onClick={() => setPublicar(true)}>
            <Upload aria-hidden="true" /> Publicar nos equipamentos
          </Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Editor do template</CardTitle>
            <CardDescription>
              Tudo aqui é publicado no CPE do cliente via ACS, sem depender de firmware específico.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="identidade">
              <TabsList>
                <TabsTrigger value="identidade">Identidade</TabsTrigger>
                <TabsTrigger value="cores">Cores</TabsTrigger>
                <TabsTrigger value="textos">Textos</TabsTrigger>
                <TabsTrigger value="campos">Campos</TabsTrigger>
                <TabsTrigger value="avancado">Avançado</TabsTrigger>
              </TabsList>

              <TabsContent value="identidade" className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="nome-template">Nome do template</Label>
                  <Input
                    id="nome-template"
                    value={branding.nome}
                    onChange={(e) => alterar({ nome: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="marca">Nome da marca</Label>
                  <Input
                    id="marca"
                    value={branding.marca}
                    onChange={(e) => alterar({ marca: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="logo">Logo do provedor</Label>
                  <div className="flex items-center gap-3">
                    <div className="grid size-16 place-items-center overflow-hidden rounded-lg border bg-muted">
                      {branding.logoUrl ? (
                        <img src={branding.logoUrl} alt="Logo atual" className="size-full object-contain" />
                      ) : (
                        <ImageUp className="size-5 text-muted-foreground" aria-hidden="true" />
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => inputArquivo.current?.click()}
                    >
                      Enviar imagem
                    </Button>
                    {branding.logoUrl && (
                      <Button variant="ghost" onClick={() => alterar({ logoUrl: '' })}>
                        Remover
                      </Button>
                    )}
                    <input
                      ref={inputArquivo}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const arquivo = e.target.files?.[0]
                        if (arquivo) carregarLogo(arquivo)
                      }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    PNG ou SVG, até 200 KB. Sem logo, usamos as iniciais da marca.
                  </p>
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">Tema escuro</p>
                    <p className="text-xs text-muted-foreground">
                      Para equipamentos com tela OLED ou uso noturno.
                    </p>
                  </div>
                  <Switch
                    checked={branding.tema === 'escuro'}
                    onCheckedChange={(v) =>
                      alterar({
                        tema: v ? 'escuro' : 'claro',
                        corFundo: v ? '#0b1220' : '#f1f5f9',
                        corPainel: v ? '#111827' : '#ffffff',
                        corTexto: v ? '#f8fafc' : '#0f172a',
                        corBorda: v ? '#1f2937' : '#e2e8f0',
                      })
                    }
                  />
                </div>
              </TabsContent>

              <TabsContent value="cores" className="grid gap-4 sm:grid-cols-2">
                <CampoCor
                  id="cor-primaria"
                  rotulo="Cor primária"
                  valor={branding.corPrimaria}
                  aoMudar={(v) => alterar({ corPrimaria: v })}
                />
                <CampoCor
                  id="cor-primaria-texto"
                  rotulo="Texto do botão"
                  valor={branding.corPrimariaTexto}
                  aoMudar={(v) => alterar({ corPrimariaTexto: v })}
                />
                <CampoCor
                  id="cor-fundo"
                  rotulo="Fundo da página"
                  valor={branding.corFundo}
                  aoMudar={(v) => alterar({ corFundo: v })}
                />
                <CampoCor
                  id="cor-painel"
                  rotulo="Fundo do painel"
                  valor={branding.corPainel}
                  aoMudar={(v) => alterar({ corPainel: v })}
                />
                <CampoCor
                  id="cor-texto"
                  rotulo="Cor do texto"
                  valor={branding.corTexto}
                  aoMudar={(v) => alterar({ corTexto: v })}
                />
                <CampoCor
                  id="cor-borda"
                  rotulo="Cor das bordas"
                  valor={branding.corBorda}
                  aoMudar={(v) => alterar({ corBorda: v })}
                />
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="raio">Raio dos cantos (px)</Label>
                  <Input
                    id="raio"
                    type="range"
                    min={0}
                    max={28}
                    value={branding.raio}
                    onChange={(e) => alterar({ raio: Number(e.target.value) })}
                  />
                </div>
              </TabsContent>

              <TabsContent value="textos" className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="titulo">Título</Label>
                  <Input
                    id="titulo"
                    value={branding.titulo}
                    onChange={(e) => alterar({ titulo: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="subtitulo">Subtítulo</Label>
                  <Textarea
                    id="subtitulo"
                    value={branding.subtitulo}
                    onChange={(e) => alterar({ subtitulo: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rotulo-botao">Texto do botão</Label>
                  <Input
                    id="rotulo-botao"
                    value={branding.rotuloBotao}
                    onChange={(e) => alterar({ rotuloBotao: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rodape">Rodapé</Label>
                  <Textarea
                    id="rodape"
                    value={branding.rodape}
                    onChange={(e) => alterar({ rodape: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="termos">Texto dos termos</Label>
                  <Textarea
                    id="termos"
                    value={branding.textoTermos}
                    onChange={(e) => alterar({ textoTermos: e.target.value })}
                    disabled={!branding.mostrarTermos}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ajuda">Link de suporte</Label>
                  <Input
                    id="ajuda"
                    value={branding.linkAjuda}
                    onChange={(e) => alterar({ linkAjuda: e.target.value })}
                  />
                </div>
              </TabsContent>

              <TabsContent value="campos" className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    Campos exibidos além de usuário e senha. Útil para validar o contrato.
                  </p>
                  <Button variant="outline" size="sm" onClick={adicionarCampo}>
                    <Plus aria-hidden="true" /> Campo
                  </Button>
                </div>

                {branding.camposExtras.length === 0 && (
                  <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                    Nenhum campo extra. A tela pede apenas usuário e senha.
                  </p>
                )}

                {branding.camposExtras.map((campo) => (
                  <div key={campo.id} className="space-y-3 rounded-lg border p-3">
                    <div className="flex items-center justify-between">
                      <Badge variant="outline">{campo.tipo}</Badge>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => removerCampo(campo.id)}
                        aria-label={`Remover campo ${campo.rotulo}`}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor={`rotulo-${campo.id}`}>Rótulo</Label>
                        <Input
                          id={`rotulo-${campo.id}`}
                          value={campo.rotulo}
                          onChange={(e) => atualizarCampo(campo.id, { rotulo: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`tipo-${campo.id}`}>Tipo</Label>
                        <Select
                          value={campo.tipo}
                          onValueChange={(v) =>
                            atualizarCampo(campo.id, { tipo: v as CampoExtra['tipo'] })
                          }
                        >
                          <SelectTrigger id={`tipo-${campo.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="texto">Texto livre</SelectItem>
                            <SelectItem value="cpf">CPF</SelectItem>
                            <SelectItem value="contrato">Contrato</SelectItem>
                            <SelectItem value="telefone">Telefone</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`placeholder-${campo.id}`}>Placeholder</Label>
                        <Input
                          id={`placeholder-${campo.id}`}
                          value={campo.placeholder}
                          onChange={(e) => atualizarCampo(campo.id, { placeholder: e.target.value })}
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-md border px-3 py-2">
                        <Label htmlFor={`obrig-${campo.id}`}>Obrigatório</Label>
                        <Switch
                          id={`obrig-${campo.id}`}
                          checked={campo.obrigatorio}
                          onCheckedChange={(v) => atualizarCampo(campo.id, { obrigatorio: v })}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="avancado" className="space-y-4">
                {[
                  {
                    id: 'mostrarTermos',
                    titulo: 'Exibir aceite de termos',
                    descricao: 'Checkbox de concordância antes de entrar no painel.',
                  },
                  {
                    id: 'mostrarWifi',
                    titulo: 'Exibir dados da rede',
                    descricao: 'Nome da rede e plano contratado no rodapé do formulário.',
                  },
                  {
                    id: 'mostrarVelocidade',
                    titulo: 'Exibir velocidade contratada',
                    descricao: 'Mostra o plano do cliente ao lado do SSID.',
                  },
                ].map((item) => (
                  <div key={item.id} className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium">{item.titulo}</p>
                      <p className="text-xs text-muted-foreground">{item.descricao}</p>
                    </div>
                    <Switch
                      checked={branding[item.id as 'mostrarTermos']}
                      onCheckedChange={(v) => alterar({ [item.id]: v } as unknown as Partial<Branding>)}
                    />
                  </div>
                ))}
                <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                  A tela de login é injetada no CPE por meio de um widget de branded login
                  suportado pelos firmwares gerenciados. Modelos sem suporte exibem a página
                  padrão do fabricante e o provedor é avisado nos alertas.
                </p>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <div className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <Card>
            <CardHeader>
              <CardTitle>Pré-visualização</CardTitle>
              <CardDescription>Como o cliente vê o equipamento após o reset</CardDescription>
            </CardHeader>
            <CardContent>
              <TelaLogin branding={branding} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Estado de erro</CardTitle>
              <CardDescription>Validação de credenciais com a marca do provedor</CardDescription>
            </CardHeader>
            <CardContent>
              <TelaLogin branding={branding} modo="erro" />
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={publicar} onOpenChange={setPublicar}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publicar personalização</DialogTitle>
            <DialogDescription>
              Escolha quais equipamentos recebem a nova tela de login. O envio é feito pelo ACS e
              pode levar alguns minutos.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Select value={escopo} onValueChange={(v) => setEscopo(v as Escopo)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os equipamentos ({equipamentos.length})</SelectItem>
                <SelectItem value="online">
                  Somente online ({equipamentos.filter((e) => e.status === 'online').length})
                </SelectItem>
                {(['roteador', 'ont', 'mesh'] as TipoEquipamento[]).map((t) => (
                  <SelectItem key={t} value={`tipo:${t}`}>
                    {rotuloTipo[t]} ({equipamentos.filter((e) => e.tipo === t).length})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              {alvo.length} equipamento(s) serão atualizados com o template “{branding.nome}”.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPublicar(false)}>
              Cancelar
            </Button>
            <Button onClick={confirmarPublicacao}>Publicar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
