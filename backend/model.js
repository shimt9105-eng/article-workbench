const {extractJsonObject,sanitizeHtml,systemPrompt}=require("./core");
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

async function callModel(model, input) {
  const headers = { "Content-Type": "application/json" };
  let endpoint;
  let body;
  if (model.protocol === "OpenAI Chat") {
    endpoint = `${model.baseUrl}/chat/completions`;
    headers.Authorization = `Bearer ${model.apiKey}`;
    body = { model: model.name, messages: [{ role: "system", content: systemPrompt() }, { role: "user", content: input }], response_format: { type: "json_object" } };
    if (/^claude(?:[-_]|$)/i.test(model.name)) body.max_tokens = 12000;
  } else if (model.protocol === "OpenAI Responses") {
    endpoint = `${model.baseUrl}/responses`;
    headers.Authorization = `Bearer ${model.apiKey}`;
    body = { model: model.name, instructions: systemPrompt(), input, store: false };
    if (model.thinking && !["none", "不支持", "不确定"].includes(model.thinking)) body.reasoning = { effort: model.thinking };
  } else if (model.protocol === "Anthropic Messages") {
    endpoint = `${model.baseUrl}/messages`;
    headers["x-api-key"] = model.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    body = { model: model.name, max_tokens: 12000, system: systemPrompt(), messages: [{ role: "user", content: input }] };
  } else {
    throw new Error(`模型协议暂不支持：${model.protocol}`);
  }
  const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(420000) });
  const raw = await response.text();
  if (!response.ok) {
    let detail = "";
    try { detail = JSON.parse(raw)?.error?.message || ""; } catch (_error) {}
    throw new Error(`模型服务返回 HTTP ${response.status}${detail ? `：${String(detail).slice(0, 180)}` : ""}`);
  }
  const payload = JSON.parse(raw);
  const parsed = extractJsonObject(modelResponseText(payload, model.protocol));
  return {
    html: sanitizeHtml(String(parsed.html || "")),
    comment: String(parsed.comment || "已根据固定 System 依据更新全文").trim().slice(0, 500),
    modelName: model.name,
  };
}

module.exports={callModel,modelResponseText};
