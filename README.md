# Owlbear Discord RPG Bridge - Extension

Extensão para Owlbear Rodeo que se conecta com um bot do Discord para RPG.

## Como usar

### 1. Adicionar no Owlbear

1. Abra o Owlbear Rodeo
2. Vá em **Settings → Extensions**
3. **Add Extension** com a URL:
```
https://SEU_USUARIO.github.io/owlbear-discord-extension/manifest.json
```

### 2. Configurar conexão

1. Abra a extensão clicando no ícone
2. Cole a URL do ngrok (seu servidor local)
3. Clique em Conectar

### 3. Rodar o servidor local

No seu PC:
```bash
cd /home/nani/Documentos/exten
npm run dev    # Servidor
npm run bot    # Bot Discord (outro terminal)
ngrok http 3000  # Túnel (outro terminal)
```

Use a URL do ngrok na extensão.
