const {extractJsonObject,sanitizeHtml,systemPrompt}=require("./core");
const {claudeChatBody,resolveModel,anthropicHeaders,isMicuClaude}=require('./claude-chat');
function modelResponseText(payload, protocol) {
  if (protocol === "OpenAI Chat") {
    const content = payload?.choices?.[0]?.message?.content;
    return Array.isArray(content) ? content.map((item) => item.text || "").join("") : String(content || "");
  }
  if (protocol === "Anthropic Messages") {
    return (payload.content || []).filter((item) => item.type === "text").map((item) => item.text || "").join("");
  }
  if (protocol === "OpenAI Responses") {
    if (typeof payload.output_text === "string") return payload.output_text;
    return (payload.output || []).flatMap((item) => item.content || []).filter((part) => ["output_text", "text"].includes(part.type)).map((part) => part.text || "").join("");
  }
  throw new Error(`不支持的模型协议：${protocol}`);
}

function modelHttpError(response, raw, model) {
  let payload;try{payload=JSON.parse(raw);}catch{payload={};}
  const detail=String(payload.error?.message||payload.message||'').replaceAll(model.apiKey||'__absent_key__','[REDACTED]').replace(/sk-[a-zA-Z0-9_-]+/g,'[REDACTED]');
  const error=new Error(`模型服务返回 HTTP ${response.status}${detail?'：'+detail.slice(0,300):''}`);
  error.httpStatus=response.status;
  error.providerRequestId=String(payload.request_id||detail.match(/request id:\s*([a-zA-Z0-9_-]+)/i)?.[1]||response.headers?.get('request-id')||response.headers?.get('x-request-id')||'').replaceAll(model.apiKey||'__absent_key__','').replace(/sk-[a-zA-Z0-9_-]+/g,'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,120);
  error.code=/too many invalid requests/i.test(detail)?'UPSTREAM_INVALID_REQUEST_COOLDOWN':'MODEL_HTTP_ERROR';
  return error;
}

async function callModel(model, input) {
  model = resolveModel(model);
  const headers = { "Content-Type": "application/json" };
  let endpoint;
  let body;
  if (model.protocol === "OpenAI Chat") {
    endpoint = `${model.baseUrl}/chat/completions`;
    headers.Authorization = `Bearer ${model.apiKey}`;
    body = { model: model.name, messages: [{ role: "system", content: systemPrompt() }, { role: "user", content: input }], response_format: { type: "json_object" } };
    body = claudeChatBody(model, body, 12000);
  } else if (model.protocol === "OpenAI Responses") {
    endpoint = `${model.baseUrl}/responses`;
    headers.Authorization = `Bearer ${model.apiKey}`;
    body = { model: model.name, instructions: systemPrompt(), input, store: false };
    if (model.thinking && !["none", "不支持", "不确定"].includes(model.thinking)) body.reasoning = { effort: model.thinking };
  } else if (model.protocol === "Anthropic Messages") {
    endpoint = `${model.baseUrl}/messages`;
    Object.assign(headers, anthropicHeaders(model));
    body = { model: model.name, max_tokens: isMicuClaude(model) ? 8192 : 12000, system: systemPrompt(), messages: [{ role: "user", content: input }] };
  } else {
    throw new Error(`模型协议暂不支持：${model.protocol}`);
  }
  const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(420000) });
  const raw = await response.text();
  if (!response.ok) throw modelHttpError(response, raw, model);
  const payload = JSON.parse(raw);
  if(payload.stop_reason==='max_tokens'){const e=new Error('模型输出达到上限，未保存不完整文章');e.code='MODEL_OUTPUT_TRUNCATED';throw e;}
  const parsed = extractJsonObject(modelResponseText(payload, model.protocol));
  if(!String(parsed.html||'').trim()){const e=new Error('模型未返回有效正文');e.code='MODEL_EMPTY_HTML';throw e;}
  const html=sanitizeHtml(String(parsed.html||'')).trim();
  if(!html){const e=new Error('模型未返回有效正文');e.code='MODEL_EMPTY_HTML';throw e;}
  return {
    html,
    comment: String(parsed.comment || "已根据固定 System 依据更新全文").trim().slice(0, 500),
    modelName: model.name,
  };
}

module.exports={callModel,modelResponseText,modelHttpError};
