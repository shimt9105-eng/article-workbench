// Micu's Claude Chat gateway accepts the system prompt as a top-level field.
// This matches the previously successful local editor request adapter.
function claudeChatBody(model, body, maxTokens) {
  if (model.protocol !== 'OpenAI Chat' || !/^claude(?:[-_]|$)/i.test(model.name)) return body;
  let micu = false;
  try { const host = new URL(model.baseUrl).hostname; micu = host === 'micuapi.ai' || host.endsWith('.micuapi.ai'); } catch {}
  if (!micu) return { ...body, max_tokens: maxTokens };
  const system = body.messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  return { ...body, max_tokens: Math.min(maxTokens, 8192), system, messages: body.messages.filter(m => m.role !== 'system') };
}
module.exports = { claudeChatBody };
