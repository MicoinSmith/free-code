import { writeFileSync } from 'fs';

export async function syncLiteLLMModels(): Promise<void> {
  if (process.env.USE_LITELLM !== 'true') return;

  try {
    const response = await fetch('http://localhost:7800/v1/models', {
      headers: { 'Authorization': `Bearer ${process.env.ANTHROPIC_API_KEY || 'sk-litellm'}` }
    });
    
    if (!response.ok) throw new Error(`Failed to fetch models: ${response.statusText}`);
    
    const data = await response.json();
    // Cache the raw data
    writeFileSync('/Users/srilanka/.free-code/.models_cache.json', JSON.stringify(data));
    console.log('[LiteLLM] Models synced to cache.');
  } catch (e) {
    console.error('[LiteLLM] Failed to sync models', e);
  }
}
