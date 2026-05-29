# THÉRA Corp — WhatsApp Bot Server

## Architecture
```
Client WhatsApp → Twilio → Ce serveur → Typebot → Réponse → Client
```

## Déploiement sur Render.com (GRATUIT)

### Étape 1 — GitHub
1. Crée un repo GitHub : `thera-whatsapp-bot`
2. Upload ces 3 fichiers : server.js, package.json, .env.example

### Étape 2 — Render.com
1. Va sur render.com → New → Web Service
2. Connecte ton repo GitHub
3. Paramètres :
   - Build Command : `npm install`
   - Start Command : `npm start`
   - Environment : Node

### Étape 3 — Variables d'environnement sur Render
Ajoute ces variables dans Render → Environment :
```
TWILIO_ACCOUNT_SID = AC3306b37a20c1edcf622ddc9e6b469396
TWILIO_AUTH_TOKEN  = [ton nouveau token]
TYPEBOT_API_KEY    = [vide si bot public]
```

### Étape 4 — URL du serveur
Render te donne une URL :
`https://thera-whatsapp-bot.onrender.com`

### Étape 5 — Configurer Twilio
Dans Twilio → Sandbox Settings :
```
When a message comes in :
https://thera-whatsapp-bot.onrender.com/webhook/whatsapp
Method : HTTP POST
```

### Test
Envoie "join share-molecular" sur WhatsApp au +1 415 523 8886
Puis tape n'importe quel message → le bot répond !
