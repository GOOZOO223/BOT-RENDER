/**
 * THÉRA Corp — Serveur WhatsApp Bot
 * Twilio ↔ Typebot Bridge
 * 
 * Stack : Node.js + Express
 * Déploiement : Render.com (gratuit)
 */

const express = require('express');
const fetch = require('node-fetch');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ── CONFIGURATION ──────────────────────────────────────────
const CONFIG = {
  // Twilio
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN:  process.env.TWILIO_AUTH_TOKEN,
  TWILIO_WA_NUMBER:   'whatsapp:+14155238886', // Ton sandbox Twilio

  // Typebot
  TYPEBOT_START_URL: 'https://typebot.io/api/v1/typebots/bot-boutique-thera-pro-dfowr4x/startChat',
  TYPEBOT_CONTINUE_URL: 'https://typebot.io/api/v1/sessions/{sessionId}/continueChat',
  TYPEBOT_API_KEY: process.env.TYPEBOT_API_KEY || '', // Optionnel si bot public

  // App
  PORT: process.env.PORT || 3000
};

// ── SESSION STORE (mémoire — simple pour prototype) ────────
// En production : utiliser Redis ou une base de données
const sessions = new Map();
// Format : { phoneNumber: { sessionId, lastActivity } }

// Nettoyage sessions inactives (> 30 min)
setInterval(() => {
  const now = Date.now();
  for (const [phone, session] of sessions.entries()) {
    if (now - session.lastActivity > 30 * 60 * 1000) {
      sessions.delete(phone);
      console.log(`Session expirée supprimée : ${phone}`);
    }
  }
}, 5 * 60 * 1000); // Vérif toutes les 5 min

// ── HELPER : Envoyer message WhatsApp via Twilio ────────────
async function sendWhatsApp(to, message) {
  const twilio = require('twilio')(CONFIG.TWILIO_ACCOUNT_SID, CONFIG.TWILIO_AUTH_TOKEN);
  
  // Découper les messages trop longs (WhatsApp max 4096 chars)
  const chunks = splitMessage(message, 1500);
  
  for (const chunk of chunks) {
    await twilio.messages.create({
      from: CONFIG.TWILIO_WA_NUMBER,
      to: to,
      body: chunk
    });
    // Petit délai entre messages pour respecter l'ordre
    if (chunks.length > 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

// ── HELPER : Découper les longs messages ───────────────────
function splitMessage(text, maxLength) {
  if (text.length <= maxLength) return [text];
  
  const chunks = [];
  const lines = text.split('\n');
  let current = '';
  
  for (const line of lines) {
    if ((current + '\n' + line).length > maxLength) {
      if (current) chunks.push(current.trim());
      current = line;
    } else {
      current = current ? current + '\n' + line : line;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks;
}

// ── HELPER : Extraire le texte des messages Typebot ────────
function extractMessages(typebotResponse) {
  const messages = [];
  
  if (!typebotResponse.messages) return messages;
  
  for (const msg of typebotResponse.messages) {
    if (msg.type === 'text' && msg.content?.richText) {
      // Convertir richText en texte plat
      const text = msg.content.richText
        .map(block => {
          if (block.children) {
            return block.children.map(child => child.text || '').join('');
          }
          return '';
        })
        .filter(t => t.trim())
        .join('\n');
      
      if (text.trim()) messages.push(text);
    }
  }
  
  // Ajouter les boutons de choix si présents
  if (typebotResponse.input?.type === 'choice input' && typebotResponse.input?.items) {
    const buttons = typebotResponse.input.items
      .map((item, i) => `${item.content}`)
      .join('\n');
    
    if (buttons) messages.push(buttons);
  }
  
  return messages;
}

// ── HELPER : Appel API Typebot (démarrer) ──────────────────
async function startTypebotChat(phoneNumber, message) {
  const headers = {
    'Content-Type': 'application/json'
  };
  if (CONFIG.TYPEBOT_API_KEY) {
    headers['Authorization'] = `Bearer ${CONFIG.TYPEBOT_API_KEY}`;
  }

  const body = {};
  if (message) {
    body.message = message;
  }

  const response = await fetch(CONFIG.TYPEBOT_START_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Typebot startChat error ${response.status}: ${err}`);
  }

  return await response.json();
}

// ── HELPER : Appel API Typebot (continuer) ─────────────────
async function continueTypebotChat(sessionId, message) {
  const url = CONFIG.TYPEBOT_CONTINUE_URL.replace('{sessionId}', sessionId);
  
  const headers = {
    'Content-Type': 'application/json'
  };
  if (CONFIG.TYPEBOT_API_KEY) {
    headers['Authorization'] = `Bearer ${CONFIG.TYPEBOT_API_KEY}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Typebot continueChat error ${response.status}: ${err}`);
  }

  return await response.json();
}

// ── ROUTE PRINCIPALE : Webhook Twilio ──────────────────────
app.post('/webhook/whatsapp', async (req, res) => {
  // Répondre immédiatement à Twilio (évite timeout)
  res.status(200).send('<Response></Response>');

  const from    = req.body.From;    // ex: whatsapp:+22391421413
  const body    = req.body.Body;    // message du client
  const msgType = req.body.MessageType || 'text';

  console.log(`\n📱 Message reçu de ${from}: "${body}"`);

  try {
    let typebotResponse;
    const existingSession = sessions.get(from);

    if (!existingSession) {
      // ── NOUVELLE CONVERSATION ──
      console.log(`🆕 Nouvelle session pour ${from}`);
      typebotResponse = await startTypebotChat(from, body || '');
      
      // Sauvegarder la session
      sessions.set(from, {
        sessionId: typebotResponse.sessionId,
        lastActivity: Date.now()
      });
      console.log(`✅ Session créée : ${typebotResponse.sessionId}`);

    } else {
      // ── CONVERSATION EXISTANTE ──
      console.log(`♻️  Session existante : ${existingSession.sessionId}`);
      existingSession.lastActivity = Date.now();
      
      typebotResponse = await continueTypebotChat(
        existingSession.sessionId,
        body || ''
      );
    }

    // Extraire et envoyer les messages
    const messages = extractMessages(typebotResponse);
    console.log(`📤 ${messages.length} message(s) à envoyer`);

    for (const msg of messages) {
      console.log(`   → "${msg.substring(0, 60)}..."`);
      await sendWhatsApp(from, msg);
    }

    // Si conversation terminée, supprimer la session
    if (typebotResponse.hasStarted === false || 
        messages.length === 0) {
      sessions.delete(from);
      console.log(`🔚 Session terminée pour ${from}`);
    }

  } catch (error) {
    console.error(`❌ Erreur :`, error.message);
    
    // Message d'erreur au client
    try {
      await sendWhatsApp(
        from,
        "Désolé, une erreur est survenue 😔\nVeuillez réessayer dans quelques instants."
      );
    } catch (e) {
      console.error('Erreur envoi message erreur:', e.message);
    }
    
    // Supprimer la session en cas d'erreur
    sessions.delete(from);
  }
});

// ── ROUTE SANTÉ ────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'THÉRA Corp WhatsApp Bot',
    sessions: sessions.size,
    uptime: Math.floor(process.uptime()) + 's'
  });
});

// ── ROUTE DEBUG (désactiver en production) ─────────────────
app.get('/debug/sessions', (req, res) => {
  const sessionList = [];
  for (const [phone, session] of sessions.entries()) {
    sessionList.push({
      phone,
      sessionId: session.sessionId,
      age: Math.floor((Date.now() - session.lastActivity) / 1000) + 's'
    });
  }
  res.json({ count: sessions.size, sessions: sessionList });
});

// ── DÉMARRAGE ──────────────────────────────────────────────
app.listen(CONFIG.PORT, () => {
  console.log(`
╔═══════════════════════════════════════╗
║   THÉRA Corp WhatsApp Bot — ONLINE    ║
╠═══════════════════════════════════════╣
║  Port    : ${CONFIG.PORT}                       ║
║  Typebot : bot-boutique-thera-pro     ║
║  Twilio  : Sandbox actif              ║
╚═══════════════════════════════════════╝
  `);
});

module.exports = app;
