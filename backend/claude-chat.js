// Apply Micu's documented Claude external protocol without changing saved settings.
function isMicuClaude(model) {
  if (!/^claude(?:[-_]|$)/i.test(model.name)) return false;
  try { const host = new URL(model.baseUrl).hostname; return host === 'micuapi.ai' || host.endsWith('.micuapi.ai'); } catch { return false; }
}
function resolveModel(model) {
  if (!isMicuClaude(model)) return model;
  const url = new URL(model.baseUrl);
  return { ...model, protocol: 'Anthropic Messages', baseUrl: url.origin + '/v1' };
}
function anthropicHeaders(model) {
  const headers = { 'anthropic-version': '2023-06-01' };
  if (isMicuClaude(model)) {
    headers.Authorization = `Bearer ${model.apiKey}`;
    headers['User-Agent'] = 'claude-cli/2.0.76 (external, cli)';
  } else headers['x-api-key'] = model.apiKey;
  return headers;
}
function claudeChatBody(model, body, maxTokens) {
  if (model.protocol !== 'OpenAI Chat' || !/^claude(?:[-_]|$)/i.test(model.name)) return body;
  return { ...body, max_tokens: maxTokens };
}
module.exports = { claudeChatBody, resolveModel, anthropicHeaders, isMicuClaude };
