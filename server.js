/**
 * THÉRA Corp — Serveur WhatsApp Bot
 * Twilio ↔ Typebot Bridge v2
 */

const express = require('express');
const fetch = require('node-fetch');

// ── TWILIO INITIALISÉ EN HAUT ──────────────────────────────
const twilio = require('twilio');
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ── CONFIG ─────────────────────────────────────────────────
const TWILIO_WA_NUMBER = 'whatsapp:+14155238886';
const TYPEBOT_START = process.env.TYPEBOT_START_URL || 'https://typebot.io/api/v1/typebots/bot-boutique-thera-wa-zux8uaj/startChat';
const TYPEBOT_CONTINUE = 'https://typebot.io/api/v1/sessions/{sessionId}/continueChat';
const PORT             = process.env.PORT || 3000;

// ── SESSIONS ───────────────────────────────────────────────
const sessions = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [phone, session] of sessions.entries()) {
    if (now - session.lastActivity > 30 * 60 * 1000) {
      sessions.delete(phone);
    }
  }
}, 5 * 60 * 1000);

// ── HELPER : Envoyer message WhatsApp ──────────────────────
async function sendWA(to, text) {
  return twilioClient.messages.create({
    from: TWILIO_WA_NUMBER,
    to:   to,
    body: text
  });
}

// ── HELPER : Extraire texte de Typebot ─────────────────────
function extractText(response) {
  const results = [];

  if (response.messages) {
    for (const msg of response.messages) {
      if (msg.type === 'text' && msg.content?.richText) {
        const lines = msg.content.richText
          .map(b => b.children?.map(c => c.text || '').join('') || '')
          .filter(t => t.trim());
        if (lines.length) results.push(lines.join('\n'));
      }
    }
  }

  if (response.input?.type === 'choice input' && response.input?.items) {
    const btns = response.input.items.map(i => i.content).join('\n');
    if (btns) results.push(btns);
  }

  return results;
}

// ── HELPER : Appel Typebot ─────────────────────────────────
async function callTypebot(sessionId, message) {
  if (!sessionId) {
    // Nouvelle conversation
    const res = await fetch(TYPEBOT_START, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message ? { message } : {})
    });
    if (!res.ok) throw new Error(`startChat ${res.status}: ${await res.text()}`);
    return await res.json();
  } else {
    // Continuer
    const url = TYPEBOT_CONTINUE.replace('{sessionId}', sessionId);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    if (!res.ok) throw new Error(`continueChat ${res.status}: ${await res.text()}`);
    return await res.json();
  }
}

// ── WEBHOOK PRINCIPAL ──────────────────────────────────────
app.post('/webhook/whatsapp', async (req, res) => {
  res.status(200).send('<Response></Response>');

  const from = req.body.From;
  const body = req.body.Body || '';

  console.log(`\n📱 ${from}: "${body}"`);

  try {
    const existing = sessions.get(from);
    let typebotRes;

    if (!existing) {
      console.log('🆕 Nouvelle session');
      typebotRes = await callTypebot(null, body);
      sessions.set(from, {
        sessionId: typebotRes.sessionId,
        lastActivity: Date.now()
      });
      console.log(`✅ Session: ${typebotRes.sessionId}`);
    } else {
      existing.lastActivity = Date.now();
      console.log(`♻️  Session: ${existing.sessionId}`);
      typebotRes = await callTypebot(existing.sessionId, body);
    }

    const messages = extractText(typebotRes);
    console.log(`📤 ${messages.length} message(s)`);

    for (const msg of messages) {
      await sendWA(from, msg);
      console.log(`   ✓ Envoyé`);
      if (messages.length > 1) await new Promise(r => setTimeout(r, 600));
    }

  } catch (err) {
    console.error('❌', err.message);
    sessions.delete(from);
    try {
      await sendWA(from, 'Désolé, une erreur est survenue. Réessayez dans un instant.');
    } catch (e) {
      console.error('Erreur fallback:', e.message);
    }
  }
});

// ── SANTÉ ──────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'THÉRA Corp WhatsApp Bot v2',
    sessions: sessions.size,
    twilio_sid: process.env.TWILIO_ACCOUNT_SID ? '✅ configuré' : '❌ manquant',
    twilio_token: process.env.TWILIO_AUTH_TOKEN ? '✅ configuré' : '❌ manquant'
  });
});

// ── START ──────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════╗
║   THÉRA Corp WhatsApp Bot v2 — LIVE   ║
╠═══════════════════════════════════════╣
║  Port    : ${PORT}                       ║
║  SID     : ${process.env.TWILIO_ACCOUNT_SID ? '✅' : '❌ MANQUANT'}                       ║
║  Token   : ${process.env.TWILIO_AUTH_TOKEN ? '✅' : '❌ MANQUANT'}                       ║
╚═══════════════════════════════════════╝
  `);
});
