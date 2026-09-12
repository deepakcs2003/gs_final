import 'dotenv/config';
import { generateProductSuggestions } from '../services/ai/qwen.js';
import { env, integrations } from '../config/env.js';

/**
 * Standalone check for the "Generate with Qwen" helper.
 * Usage:  npm run dev:qwen -- <product-image-url>
 * Prints the exact API error so you can see the real cause (network, key, model…).
 */
const imageUrl = process.argv[2];
if (!imageUrl) {
  console.error('usage: npm run dev:qwen -- <image-url>');
  process.exit(1);
}

console.log('provider:', env.GEMINI_API_KEY ? 'Gemini (free tier)' : env.GROQ_API_KEY ? 'Groq' : '(none set)');
console.log('model:', env.GEMINI_API_KEY ? env.GEMINI_MODEL : env.QWEN_MODEL || 'qwen/qwen3.8-27b (default)');
console.log('AI configured:', integrations.qwen);

if (integrations.qwen && !env.GEMINI_API_KEY) {
  try {
    const response = await fetch(`${env.GROQ_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
    });
    const data = (await response.json()) as { data?: Array<{ id?: string }>; error?: { message?: string; code?: string } };
    const names = (data.data ?? []).map((m) => m.id ?? '').filter((n) => n.toLowerCase().includes('qwen'));
    const errorMessage = data.error ? `${data.error.code ?? ''}${data.error.code ? ': ' : ''}${data.error.message ?? ''}` : '';
    console.log('\nAvailable Qwen models on Groq:');
    console.log(names.length ? names.join('\n') : `(none listed — ${errorMessage || 'unknown error'})`);
  } catch (err) {
    console.error('\nCould not list models:', err instanceof Error ? err.message : String(err));
  }
}

try {
  const suggestion = await generateProductSuggestions([imageUrl]);
  console.log('OK — suggestions:');
  console.log(JSON.stringify(suggestion, null, 2));
} catch (err) {
  console.error('\nFAILED:');
  console.error('error name:', err instanceof Error ? err.name : typeof err);
  console.error('status/code:', (err as { status?: unknown }).status ?? (err as { code?: unknown }).code ?? 'n/a');
  console.error('message:', err instanceof Error ? err.message : String(err));
  console.error('cause:', err instanceof Error && err.cause ? String((err.cause as Error).message ?? err.cause) : 'n/a');
  process.exitCode = 1;
}