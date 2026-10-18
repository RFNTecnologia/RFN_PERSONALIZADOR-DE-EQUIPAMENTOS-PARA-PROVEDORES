# Instalação — RFN V12.3.7

Esta atualização adiciona histórico persistente de provisionamento e reconciliação por Inform do CPE. Ela não altera automaticamente o roteador existente.

## Arquivos incluídos
- `backend/server.js`
- `backend/migrations/005_provisioning_activations.sql`
- `frontend/app.js`
- `V12.3.7_NOTAS.md`

## Aplicar no Windows / VS Code
1. Pare e feche edições pendentes no VS Code. Faça backup de `backend/server.js`, `frontend/app.js` e um backup normal do banco operacional `RFN_Equipamentos`.
2. Extraia este ZIP na raiz `C:\Users\robso\OneDrive\Desktop\RFN_Personalizar-roteadores`, preservando a estrutura de pastas e substituindo os dois arquivos listados. Copie a nova migration para `backend\migrations\005_provisioning_activations.sql`.
3. No terminal, na raiz do projeto, execute:

   ```powershell
   docker compose config -q
   docker compose up -d --build api nginx
   docker compose ps
   docker compose logs --tail 80 api
   ```

4. Espere a API aparecer como `healthy`. O bootstrap aplica a migration `005_provisioning_activations.sql` idempotentemente.
5. Abra o RFN, entre no MR60X e vá a `Provisionamento`. O quadro `Histórico de provisionamento` consulta operações registradas a partir desta versão.

## Como interpretar o histórico
- `Aguardando Inform`: o GenieACS aceitou a tarefa; a configuração ainda não foi confirmada por leitura posterior.
- `Configuração confirmada`: após um Inform posterior à submissão, todos os valores não secretos esperados foram observados no cache do CPE.
- `Valores divergentes`: o CPE enviou Inform, mas um ou mais valores esperados não correspondem ao que foi solicitado.
- `Revisar tarefa`: nenhum Inform posterior foi visto em 10 minutos.
- `Falha no envio`: o envio da tarefa ao GenieACS falhou.

O estado PPPoE, usuário, IP WAN e último Inform são exibidos separadamente. Uma configuração confirmada não garante que a Internet esteja conectada se o estado PPPoE não for `Connected`.

## Segurança e escopo
- O histórico nunca salva senhas PPPoE ou chaves Wi-Fi; salva apenas os nomes dos caminhos secretos que foram enviados.
- O GenieACS recebe os valores secretos de que precisa para executar `setParameterValues`; o histórico do RFN não os copia.
- O endpoint de provisionamento só aceita a lista fixa de 15 parâmetros do MR60X e revalida no backend se cada caminho está no cache e é gravável.
- O histórico começa com esta versão; as ativações anteriores não serão reconstruídas automaticamente.
- Não execute reset de fábrica nem altere VLAN, LAN ou parâmetros do ACS para testar este patch.
