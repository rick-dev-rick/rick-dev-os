# RICK_DEV OS

Painel pessoal com login de ADM e acesso de convidado somente para leitura.
Os dados compartilhados são armazenados no Supabase, com regras de leitura e gravação configuradas no banco.

## Publicação

O GitHub Actions publica automaticamente o site no GitHub Pages quando houver uma alteração na branch `main`.
Apenas os arquivos necessários para o site são enviados para a página publicada.

## Supabase

O arquivo `supabase-config.js` contém a URL do projeto e a chave publishable, que é própria para uso no navegador. Nunca use nele uma chave `secret` ou `service_role`.
As tabelas e regras de acesso estão documentadas em `supabase/setup.sql`.
