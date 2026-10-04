RFN V12.1 - Patch Laboratorio MR60X: escrita deterministica

Arquivos substituidos:
- frontend/app.js
- frontend/index.html
- backend/server.js

O patch adiciona escrita real para parametros que o CPE reporta como gravaveis dentro do catalogo deterministico MR60X. O campo respeita booleano/numero/texto e o backend valida o caminho contra o catalogo antes de enviar setParameterValues.

NAO altera banco de dados, volumes Docker, .env ou configuracoes do GenieACS.

Aplicacao recomendada:
1. Pare somente o container api antes de substituir backend/server.js, ou aplique os tres arquivos e recrie apenas api.
2. Mantenha uma copia dos tres arquivos atuais antes de substituir.
3. Depois rode: docker compose up -d --build api
4. Atualize o navegador com Ctrl+F5.

Para o teste de bloqueio, no Laboratorio MR60X:
Device.PPP.Interface.1.Enable -> selecionar false -> Escrever.

Depois confirme o valor e se o CPE continua online no GenieACS.
Para restaurar: selecionar true -> Escrever.
