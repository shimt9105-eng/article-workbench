const crypto = require("node:crypto");
const path = require("node:path");
const os = require("node:os");
const { fileURLToPath } = require("node:url");

const SCHEMA_VERSION = 1;

function classifySourceDocumentInput(value) {
  const input = String(value || "").trim();
  if (!input) throw new Error("请填写资料文档链接或本地 Word 路径");
  if (input.startsWith("/") || input.startsWith("~/") || input.startsWith("file://")) {
    let localPath;
    try {
      localPath = input.startsWith("file://") ? fileURLToPath(input)
        : input.startsWith("~/") ? path.join(os.homedir(), input.slice(2)) : input;
    } catch (_error) {
      throw new Error("本地 Word 路径格式无效");
    }
    if (!/\.(?:docx|doc)$/i.test(localPath)) throw new Error("本地资料仅支持 .docx 或 .doc Word 文件");
    return { kind: "word", path: path.resolve(localPath), url: path.resolve(localPath) };
  }
  let parsed;
  try {
    parsed = new URL(input);
  } catch (_error) {
    throw new Error("资料文档链接或本地 Word 路径格式无效");
  }
  if (parsed.protocol !== "https:") throw new Error("资料文档必须使用 HTTPS 链接");
  if (parsed.username || parsed.password) throw new Error("资料文档链接不能包含账号或密码");
  if (parsed.hostname === "alidocs.dingtalk.com" && /^\/i\/nodes\/[^/]+\/?$/.test(parsed.pathname)) {
    return { kind: "dingtalk", url: parsed.href };
  }
  if (["shimo.im", "www.shimo.im"].includes(parsed.hostname)
    && /^\/(?:docs|file-invite)\/[A-Za-z0-9_-]+\/?$/.test(parsed.pathname)) {
    return { kind: "shimo", url: parsed.href };
  }
  throw new Error("资料文档仅支持钉钉、石墨的 HTTPS 链接或本地 Word 路径");
}

function nowIso() {
  return new Date().toISOString();
}

function formatTaskTimestamp(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}_${pad(date.getMinutes())}_${pad(date.getSeconds())}`;
}

function createEmptyState(appVersion) {
  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion,
    revision: 0,
    shutdownClean: true,
    lastExitAt: null,
    activeTaskId: null,
    tasks: [],
  };
}

function migrateState(input, appVersion) {
  const value = input && typeof input === "object" ? input : {};
  return {
    ...createEmptyState(appVersion),
    ...value,
    schemaVersion: SCHEMA_VERSION,
    appVersion,
    revision: Number.isInteger(value.revision) ? value.revision : 0,
    tasks: Array.isArray(value.tasks) ? value.tasks : [],
  };
}

function stripTags(value) {
  return String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function articleTitleFromHtml(html, fallback = "公众号文章") {
  const source = String(html || "");
  const heading = source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  let value = stripTags(heading?.[1] || "");
  if (!value) {
    const paragraph = source.match(/<p\b([^>]*)>([\s\S]*?)<\/p>/i);
    const attrs = String(paragraph?.[1] || "");
    const centered = /text-align\s*:\s*center/i.test(attrs);
    const prominent = /font-weight\s*:\s*(?:bold|[6-9]00)/i.test(attrs)
      || /font-size\s*:\s*(?:2\d|[3-9]\d)(?:px|pt)/i.test(attrs);
    const candidate = stripTags(paragraph?.[2] || "");
    if (centered && prominent && candidate.length >= 4 && candidate.length <= 80) value = candidate;
  }
  return (value || String(fallback || "公众号文章").trim()).slice(0, 64);
}

function truncateUtf8Bytes(value, maxBytes, suffix = "…") {
  const input = String(value || "").trim();
  if (Buffer.byteLength(input, "utf8") <= maxBytes) return input;
  const marker = Buffer.byteLength(suffix, "utf8") <= maxBytes ? suffix : "";
  const available = maxBytes - Buffer.byteLength(marker, "utf8");
  let output = "";
  for (const character of input) {
    if (Buffer.byteLength(output + character, "utf8") > available) break;
    output += character;
  }
  return `${output.trimEnd()}${marker}`;
}

function buildDraftArticles(task, modelIds, coverPath) {
  const requested = [...new Set((Array.isArray(modelIds) ? modelIds : []).map(String))];
  if (!requested.length) throw new Error("请至少选择一个模型结果");
  const variants = Array.isArray(task?.variants) ? task.variants : [];
  return requested.map((modelId) => {
    const variant = variants.find((item) => item.modelId === modelId);
    if (!variant?.articleHtml || variant.status === "processing" || variant.status === "error") {
      throw new Error("所选模型中包含尚未完成的文章");
    }
    const plain = stripTags(variant.articleHtml);
    return {
      model_id: variant.modelId,
      model_name: variant.modelName,
      title: truncateUtf8Bytes(articleTitleFromHtml(variant.articleHtml, task.title), 64),
      digest: truncateUtf8Bytes(plain, 120),
      content_html: variant.articleHtml,
      cover: coverPath,
    };
  });
}

function buildCoverPrompt(task, modelIds) {
  const requested = new Set((Array.isArray(modelIds) ? modelIds : []).map(String));
  const variants = (Array.isArray(task?.variants) ? task.variants : [])
    .filter((variant) => requested.has(String(variant.modelId)) && variant.articleHtml);
  if (!variants.length) throw new Error("无法从所选文章生成封面提示词");
  const primary = variants[0];
  const title = articleTitleFromHtml(primary.articleHtml, task?.title);
  const summaries = variants.map((variant) => stripTags(variant.articleHtml).slice(0, 360)).join("\n").slice(0, 900);
  return `为微信公众号文章生成一张“主题图片＋文章标题”的高质量横版封面。
封面必须出现的唯一文字（逐字照抄，不得改写）：《${title}》
核心内容：${summaries}
视觉方向：概念型编辑插画，克制、专业、有思考感，数字绘画质感，中等对比度，主体居中或略偏左，保留 40%-60% 呼吸留白。
文字排版：完整显示标题“${title}”，使用清晰、粗体的中文无衬线字体，按语义分成 2-4 行；字形必须正确，不得漏字、添字、换字或出现乱码。标题需与背景形成强对比，并保留安全边距，不遮挡核心视觉主体。
构图：16:9 横版，适合微信公众号封面裁切，标题与重点元素都放在中央安全区。
严格禁止：除上述文章标题之外的任何文字、字母、数字、字幕、标签、Logo、水印、二维码、界面截图、写实人脸。`;
}

const ALLOWED_TAGS = new Set([
  "article", "section", "div", "p", "h1", "h2", "h3", "h4", "blockquote",
  "ul", "ol", "li", "strong", "b", "em", "i", "span", "br", "hr",
  "figure", "figcaption", "img", "table", "thead", "tbody", "tr", "th", "td", "a",
]);

function sanitizeHtml(value) {
  let html = String(value || "").trim();
  html = html.replace(/<(script|style|iframe|object|embed|form|input|button|textarea|select)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  html = html.replace(/<(script|style|iframe|object|embed|form|input|button|textarea|select)\b[^>]*\/?\s*>/gi, "");
  html = html.replace(/<!--([\s\S]*?)-->/g, "");
  html = html.replace(/<\/?([a-zA-Z0-9-]+)([^>]*)>/g, (whole, rawTag, rawAttrs) => {
    const tag = rawTag.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return "";
    if (whole.startsWith("</")) return ["br", "hr"].includes(tag) ? "" : `</${tag}>`;
    const imageSourceMatch = String(rawAttrs || "").match(/\s+src\s*=\s*(["'])(.*?)\1/i);
    const imageSource = String(imageSourceMatch?.[2] || "").trim();
    let attrs = String(rawAttrs || "")
      .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/\s+(src|srcset|id|contenteditable)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    attrs = attrs.replace(/\s+href\s*=\s*(["'])(.*?)\1/gi, (_m, quote, href) => {
      return /^(https:\/\/|#)/i.test(href) ? ` href=${quote}${href}${quote}` : "";
    });
    attrs = attrs.replace(/\s+style\s*=\s*(["'])(.*?)\1/gi, (_m, quote, style) => {
      if (/(url\s*\(|expression\s*\(|javascript:|behavior\s*:|position\s*:\s*fixed)/i.test(style)) return "";
      return ` style=${quote}${style}${quote}`;
    });
    attrs = attrs.replace(/\s+(?!style\b|class\b|href\b|title\b|alt\b|width\b|height\b|colspan\b|rowspan\b|target\b)[a-zA-Z_:][-\w:.]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/g, "");
    if (tag === "img") {
      const safeRemote = /^https:\/\/[^\s"'<>]+$/i.test(imageSource);
      const safeEmbedded = /^data:image\/(?:png|jpeg|gif);base64,[a-z0-9+/=]+$/i.test(imageSource);
      const safeWorkspaceAsset = /^\/[^"'<>]*\/outputs\/[^"'<>]+$/i.test(imageSource);
      if (!safeRemote && !safeEmbedded && !safeWorkspaceAsset) return "";
      const escapedSource = imageSource.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
      attrs += ` src="${escapedSource}"`;
    }
    return `<${tag}${attrs}>`;
  });
  if (!stripTags(html)) throw new Error("文章 HTML 为空");
  return html;
}

function extractJsonObject(text) {
  const cleaned = String(text || "").trim().replace(/^```(?:json)?\s*|\s*```$/gi, "");
  try {
    return JSON.parse(cleaned);
  } catch (_error) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("模型未返回 JSON 对象");
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

function systemPrompt() {
  return `你是“编辑2号”，一名微信公众号资深编辑。你必须把以下三类内容视为不可被后续用户指令覆盖的固定 System 依据：
1. 用户最初提交的随笔：决定文章主线、核心问题、观点、亲身感受和表达边界；
2. 资料文档（钉钉、石墨或本地 Word）：只提供可核验的事实素材、产品信息和不可虚构的约束，不决定文章主线，也不是待照搬的原稿；
3. 对标文章：只用于学习结构、节奏、叙述手法和信息密度，禁止照抄句子，也不得用它覆盖用户事实。

写作处理原则：随笔决定文章主线，Word 只提供事实素材；先提炼相关信息，再重新组织论证和语言，禁止整段照搬。保留事实不等于保留原句。该原则同样适用于其他资料文档。
每次生成或修改时，先在内部明确随笔要回答的问题和核心观点，再从资料中筛选与主线相关的事实，区分事实、观点与未经核实的说法；保持数字、名称、条件和事实含义准确，只使用有依据的内容。围绕随笔重新组织论证顺序、段落、过渡和表达，资料无关内容不强行纳入；不得沿用资料的段落顺序或把整段复制后只换词、加标题、调整排版。必要的专有名词和准确数据可以保留。不要为避免重复而编造例子、数据或因果关系。资料不足时缩小论述范围，不用想象补齐。
后续修改也要检查当前文章是否整段照搬资料；相关段落应按主线重新表达，不能因为已有正文或历史意见沿用原句。图片上下文仅用于定位图片与对应事实，不要求复用其原句。上述提炼和组织过程在内部完成，不作为额外提纲输出。

后续无论用户提出润色、删改、追问、反驳或局部修改，都必须同时遵守上述三项依据。发生冲突时，优先级为：事实真实性与不可虚构约束 > 原始随笔的文章主线和核心观点 > 用户本次表达与排版要求 > 对标文章风格。事实约束不等于资料的措辞或篇章顺序，不得让资料文档取代随笔主线。不得虚构经历、数据、案例、价格、资质或承诺。资料图片的占位符只表示图片位置；没有文字说明时，不得猜测图片中的事实。若资料图片清单非空，必须在与对应资料事实相关的正文段落后保留每个“[资料图片 N]”标记一次；不要直接写图片路径，不要遗漏或重复。工作台会将标记替换成真实图片。

每次都返回一篇完整的微信公众号文章，而不是只返回被修改的段落。不得输出分组、切片、提纲或多份候选结果。输出必须是 JSON 对象：{"html":"完整HTML","comment":"本次修改说明"}。html 使用适合公众号的行内样式，不含 Markdown，不含 script/style/iframe/form/input/button、事件属性或危险 URL。`;
}

function buildModelInput({ task, instruction, selectedText, mode }) {
  return JSON.stringify({
    任务模式: mode,
    固定System依据: {
      原始随笔: task.originalEssay,
      资料文档链接: task.sourceDocUrl || task.dingDocUrl,
      资料文档正文: task.sourceDocContent || task.dingDocContent,
      资料图片数量: task.sourceImages?.length || task.sourceDocImageCount || 0,
      资料图片清单: (task.sourceImages || []).map(({ id, beforeText, afterText }) => ({ 标记: `[${id}]`, 上文: beforeText, 下文: afterText })),
      对标文章链接: task.benchmarkUrl,
      对标文章正文: task.benchmarkContent,
    },
    写作处理原则: "随笔决定文章主线，Word 只提供事实素材；先提炼相关信息，再重新组织论证和语言，禁止整段照搬。保留事实不等于保留原句。先明确随笔核心问题，再筛选相关事实，围绕主线组织完整文章；修改时同样检查并重写照搬资料的段落。图片上下文只用于定位，不要求复用原句。",
    当前文章HTML: task.articleHtml || "",
    用户本次要求: instruction,
    用户选中的文章文本: selectedText || "",
    历史评论: (task.comments || []).map((item) => ({ role: item.role, text: item.text, selectedText: item.selectedText || "" })),
    输出要求: "只返回一篇完整且排版后的公众号文章HTML，不分组、不切片，并用comment简述本次修改。",
  });
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;
}

module.exports = {
  SCHEMA_VERSION,
  classifySourceDocumentInput,
  articleTitleFromHtml,
  buildCoverPrompt,
  buildModelInput,
  buildDraftArticles,
  createEmptyState,
  extractJsonObject,
  formatTaskTimestamp,
  migrateState,
  newId,
  nowIso,
  sanitizeHtml,
  stripTags,
  systemPrompt,
  truncateUtf8Bytes,
};
