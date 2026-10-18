# RFN_Personalizar-roteadores — Fase 1

Stack inicial:
- GenieACS 1.2.x: ACS TR-069 (CWMP)
- MongoDB: banco do GenieACS
- Redis: fila/cache do GenieACS
- Supabase PostgreSQL: banco da plataforma do provedor
- Node.js/Express: API da plataforma
- Nginx: proxy reverso
- Docker Compose

## O que esta fase entrega

- Infraestrutura Docker pronta.
- ACS TR-069 exposto na porta 7547.
- NBI do GenieACS na porta 7557, somente na rede Docker.
- File Server do GenieACS na porta 7567, somente na rede Docker.
- UI do GenieACS na porta 3000, somente na rede Docker.
- API própria em /api.
- Cadastro inicial de clientes, equipamentos e perfis.
- Supabase PostgreSQL para os dados da plataforma.
- Estrutura para extensões/provisionamento por fabricante.
- Nginx como ponto único de entrada.

## Configuração inicial

No PowerShell do VS Code, na raiz do projeto:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
```

Confirme que `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` correspondem ao projeto RFN. Antes de continuar, preencha `DATABASE_URL` com a URI PostgreSQL do projeto Supabase obtida em Dashboard → Connect → Session pooler. Não use a publishable key como senha do banco. O aplicativo usa essa conexão tanto para as tabelas operacionais quanto para ler `public.profiles`; as migrations criam as tabelas operacionais no Supabase. Dados que estavam somente no PostgreSQL local antigo não são copiados automaticamente.

Depois, gere os segredos ausentes e valide a configuração:

```powershell
.\scripts\bootstrap-local.ps1
docker compose config -q
```

Inicie os serviços:

```powershell
docker compose up -d --build
docker compose ps
docker compose logs --tail 100 api nginx genieacs
```

No Supabase Dashboard, crie um usuário em Authentication → Users e depois promova o perfil para `role = 'admin'` usando a instrução em `SETUP_SUPABASE_AUTH.md`. Acesse `http://localhost/` e entre com esse e-mail e senha. A rota `/genieacs/` exige uma sessão administrativa válida.

## Produção com HTTPS

Configure DNS para o servidor e obtenha um certificado TLS. Coloque a cadeia em `certs/fullchain.pem` e a chave privada em `certs/privkey.pem`; a pasta `certs/` é ignorada pelo Git. Depois valide e inicie com o overlay:

```powershell
docker compose -f docker-compose.yml -f docker-compose.production.yml config
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d --build
```

O overlay redireciona HTTP para HTTPS e ativa cookies `Secure`. Sem os arquivos de certificado o Nginx de produção não inicia. No firewall, libere apenas `80`, `443` e `7547` conforme a necessidade. O NBI `7557`, File Server `7567`, UI interna `3000`, MongoDB, Redis e PostgreSQL não são publicados no host.

O TLS administrativo está preparado; o endpoint CWMP `7547` ainda não recebe certificado TLS nesta configuração. Não anuncie `https://` no ACS URL até configurar e testar TLS para CWMP no GenieACS/CPE. Restrinja a porta CWMP por firewall às redes dos CPEs sempre que possível.

## Checklist de liberação

- [ ] `docker compose config` e `docker compose ... config` com overlay de produção terminam sem erro.
- [ ] Segredos exclusivos definidos no `.env`; o arquivo não é versionado nem incluído em imagens.
- [ ] DNS, certificado, renovação do certificado e firewall conferidos.
- [ ] Login, logout, bloqueio de API anônima e bloqueio da UI GenieACS anônima testados.
- [ ] `/health`, healthcheck da API, logs e alertas operacionais verificados.
- [x] Backup PostgreSQL local criptografado e agendado; restauração completa testada em instância descartável.
- [ ] Cópia off-site dos backups configurada e restauração testada em outra máquina. O backup DPAPI atual só pode ser descriptografado pela conta Windows que o criou.
- [ ] Um CPE de laboratório fez Inform, apareceu no GenieACS e teve parâmetros reais confirmados.
- [ ] Perfis foram testados por modelo e firmware antes de qualquer aplicação em lote.
- [ ] Procedimentos de rotação de senhas, recuperação e atualização documentados.

O projeto não pode configurar DNS, emitir/renovar certificados, habilitar backups no projeto Supabase ou confirmar parâmetros de um CPE sem acesso a esses serviços e equipamentos. Não tente impedir reset físico: após reset, a personalização só pode ser reaplicada quando o equipamento voltar a alcançar o ACS e o firmware permitir.

## Backup PostgreSQL local

Para a conexão PostgreSQL local já configurada neste ambiente, o backup manual é:

```powershell
.\scripts\backup-database.ps1
```

Os dumps são verificados e cifrados com DPAPI para a conta Windows atual, em `%LOCALAPPDATA%\RFN_Personalizar-roteadores\backups`, com retenção local de 30 dias. Para instalar a tarefa diária às 02:15:

```powershell
.\scripts\backup-database.ps1 -InstallSchedule
```

A tarefa requer esta conta conectada e o Docker Desktop ativo. A restauração do backup inicial foi testada em um PostgreSQL descartável e isolado. DPAPI não substitui uma cópia off-site: configure armazenamento externo cifrado e um procedimento de recuperação em outra máquina antes de produção. Backups gerenciados do Supabase devem ser habilitados no próprio projeto quando `DATABASE_URL` apontar para Supabase.

## Primeiro teste com CPE

1. Acesse o painel por `http://SEU_IP/` em desenvolvimento ou `https://SEU_DOMINIO/` em produção e entre com a conta administrativa.
2. Configure no CPE o ACS URL `http://SEU_DOMINIO:7547/` enquanto CWMP TLS não estiver configurado.
3. Ligue o CPE à Internet e confira `docker compose logs -f genieacs`.
4. Confirme o dispositivo e seus parâmetros reais na UI do GenieACS.
5. Teste um perfil em laboratório antes de associá-lo a equipamentos de clientes.

## Estrutura

- `backend/`: API da plataforma
- `frontend/`: painel inicial
- `genieacs/`: extensões e configuração
- `nginx/`: proxy
- `backend/migrations/`: esquema e migrations do banco
- `postgres/`: configuração opcional do PostgreSQL em contêiner


## V12 — Laboratório MR60X / Reset Recovery

A V12 remove a dependência experimental de `Device.User.1/2` para recuperação pós-reset. O módulo `Laboratório MR60X` usa um catálogo determinístico por fabricante/modelo, registra refresh, leitura e write-probe em `lab_runs` e separa o que o CPE apenas reporta como gravável do que foi efetivamente aceito pelo ACS.

### Testes
- `RefreshObject`: solicita nova coleta do CPE.
- `Read`: solicita `getParameterValues` somente para caminhos do catálogo.
- `Write-probe`: reenvia o valor atual somente para parâmetros marcados como seguros e reportados como graváveis. O status `queued` não é tratado como prova de aplicação; a confirmação depende do próximo Inform/refresh.

O endpoint legado `enable-reset-recovery` responde HTTP 410 e não tenta mais alterar `Device.User.1/2`.


## V12.2 — laboratório e execução real

O laboratório distingue tarefa enfileirada de resultado confirmado. Leituras e write-probes duplicados são evitados enquanto houver uma tarefa equivalente pendente. Quando o CPE fizer um novo Inform, a abertura do Laboratório reconcilia automaticamente os testes pendentes com os timestamps reais do cache.

Para execução imediata, o MR60X precisa estar em comunicação CWMP com o ACS. O botão `RefreshObject` pode enfileirar a solicitação, mas o GenieACS só retorna HTTP 200 quando a tarefa foi executada; HTTP 202 significa que ficou para o próximo Inform, conforme a API oficial do GenieACS.
