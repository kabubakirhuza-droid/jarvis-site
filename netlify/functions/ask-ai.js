// netlify/functions/ask-ai.js
//
// Netlify serverless function — lets jarvis.html get real AI answers on
// a phone with NO Termux/local server, WITHOUT ever exposing the API key
// to the browser. The key lives only in Netlify's own environment
// variable settings (Site configuration -> Environment variables ->
// GEMINI_API_KEY), never in this file or in jarvis.html, so it can't
// be read from "view source" the way it could if it were embedded
// client-side.
//
// Uses Google Gemini because it has a genuinely free tier (no credit
// card, no expiration, 1500 requests/day on Flash models) — unlike most
// other providers. Get a free key at https://aistudio.google.com/apikey
//
// Uses Node's built-in https module only — no npm install / package.json
// needed, matching the same "no extra dependencies" approach as the
// Python helper scripts.

const https = require('https');

// Google's Gemini 2.5-series models (gemini-2.5-flash, gemini-2.5-flash-lite)
// now reject brand-new API keys outright ("no longer available to new
// users"). The "gemini-flash-latest" alias resolves to gemini-3.6-flash,
// the newest preview model, which only gets ~20 free requests/day and hit
// its quota almost immediately. gemini-3.5-flash is the current *stable*
// (non-preview) Gemini 3 model — pinned here directly rather than through
// an alias so it doesn't silently follow "latest" onto another
// low-quota preview later.
const AI_MODEL = 'gemini-3.5-flash';
const AI_SYSTEM_PROMPT =
  'Ты голосовой ассистент Jarvis на телефоне. Отвечай кратко (2-4 предложения), ' +
  'разговорным языком, без markdown-разметки и списков — твой ответ будет ' +
  'прочитан вслух синтезатором речи.';

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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reply:
          'Ключ ИИ не настроен в Netlify. Добавьте переменную GEMINI_API_KEY в настройках сайта ' +
          '(Site configuration -> Environment variables) со значением вашего бесплатного ключа ' +
          'с aistudio.google.com/apikey, и передеплойте.',
      }),
    };
  }

  const payload = JSON.stringify({
    contents: [{ parts: [{ text: question }] }],
    systemInstruction: { parts: [{ text: AI_SYSTEM_PROMPT }] },
    // gemini-3.5-flash defaults to "medium" thinking, which was silently
    // eating the whole maxOutputTokens cap and truncating the spoken
    // answer to a fragment. thinkingLevel: "minimal" keeps it fast and
    // direct — the right knob for Gemini 3.x (thinkingBudget is the old
    // 2.5-series knob and gets rejected as an invalid argument here).
    generationConfig: { maxOutputTokens: 600, thinkingConfig: { thinkingLevel: 'minimal' } },
  });

  const path =
    '/v1beta/models/' + AI_MODEL + ':generateContent?key=' + encodeURIComponent(apiKey);

  try {
    const reply = await new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'generativelanguage.googleapis.com',
          path,
          method: 'POST',
          headers: {
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
              const text = parsed &&
                parsed.candidates &&
                parsed.candidates[0] &&
                parsed.candidates[0].content &&
                parsed.candidates[0].content.parts &&
                parsed.candidates[0].content.parts[0] &&
                parsed.candidates[0].content.parts[0].text;
              if (text) {
                resolve(text.trim());
              } else if (parsed.error) {
                // Quota/rate-limit errors come back as a long English
                // paragraph full of URLs — bad to read aloud with TTS and
                // it was also long enough to sometimes stall mobile speech
                // synthesis. Give a short spoken-friendly Russian message
                // instead, and keep any other error short too.
                const code = parsed.error.code || res.statusCode;
                if (code === 429) {
                  resolve('Превышен дневной лимит бесплатных запросов к ИИ. Попробуйте ещё раз через минуту.');
                } else {
                  const short = String(parsed.error.message || '').split('\n')[0].slice(0, 150);
                  resolve('ИИ вернул ошибку: ' + short);
                }
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
