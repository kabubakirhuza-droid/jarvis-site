// netlify/functions/ask-ai.js
//
// Netlify serverless function — lets jarvis.html get real AI answers on
// a phone with NO Termux/local server, WITHOUT ever exposing the API key
// to the browser. The key lives only in Netlify's own environment
// variable settings (Site configuration -> Environment variables ->
// ANTHROPIC_API_KEY), never in this file or in jarvis.html, so it can't
// be read from "view source" the way it could if it were embedded
// client-side.
//
// Uses Node's built-in https module only — no npm install / package.json
// needed, matching the same "no extra dependencies" approach as the
// Python helper scripts.

const https = require('https');

const AI_MODEL = 'claude-haiku-4-5-20251001';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let question;
  try {
    question = JSON.parse(event.body || '{}').question;
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Bad request' }) };
  }
  if (!question || typeof question !== 'string') {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing question' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reply: 'Ключ ИИ не настроен в Netlify. Добавьте переменную ANTHROPIC_API_KEY в настройках сайта (Site configuration -> Environment variables) и передеплойте.',
      }),
    };
  }

  const payload = JSON.stringify({
    model: AI_MODEL,
    max_tokens: 400,
    system:
      'Ты голосовой ассистент Jarvis на телефоне. Отвечай кратко (2-4 предложения), ' +
      'разговорным языком, без markdown-разметки и списков — твой ответ будет ' +
      'прочитан вслух синтезатором речи.',
    messages: [{ role: 'user', content: question }],
  });

  try {
    const reply = await new Promise((resolve, reject) => {
      const req = https.request(
        'https://api.anthropic.com/v1/messages',
        {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (parsed.content && parsed.content[0] && parsed.content[0].text) {
                resolve(parsed.content[0].text.trim());
              } else if (parsed.error) {
                resolve('ИИ вернул ошибку: ' + parsed.error.message);
              } else {
                resolve('ИИ вернул неожиданный ответ.');
              }
            } catch (e) {
              reject(e);
            }
          });
        }
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply }),
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply: 'Не получилось связаться с ИИ: ' + err.message }),
    };
  }
};
