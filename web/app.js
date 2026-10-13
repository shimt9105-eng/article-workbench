const ui = Object.fromEntries([
  "newTaskButton", "taskList", "articleTitle", "articleMeta", "variantSwitcher", "modelToolbar", "saveStatus", "retryVariantButton", "publishButton", "articlePreview",
  "newTaskPanel", "newTaskForm", "modelOptions", "benchmarkInput", "essayInput",
  "lockedSystemPanel", "addModelButton", "addModelPanel", "addModelOptions", "cancelAddModelButton", "confirmAddModelButton",
  "systemDetails", "commentsPanel", "commentCount", "commentList", "selectionChip",
  "selectionPreview", "clearSelectionButton", "commentInput", "sendCommentButton", "busyOverlay", "busyTitle",
  "busyDetail", "publishDialog", "publishModelOptions", "closePublishButton", "cancelPublishButton", "confirmPublishButton", "toast",
].map((id) => [id, document.getElementById(id)]));

let appState = null;
let creating = false;
let selectedText = "";
let availableModels = [];
let editSaveTimer = null;
let pendingTextEdit = null;
let textSavePromise = null;
let variantSwitching = false;
let taskSwitching = false;

function activeTask() {
  return appState?.tasks?.find((task) => task.id === appState.activeTaskId) || null;
}

function variantsOf(task) {
  if(task?.systemLocked===false)return [];
  if (Array.isArray(task?.variants) && task.variants.length) return task.variants.filter(variant => variant.status !== "error" || variant.articleHtml);
  if (!task) return [];
  return [{
    modelId: task.modelId || task.modelName || "legacy",
    modelName: task.modelName || "历史任务默认模型",
    articleHtml: task.articleHtml || "",
    comments: task.comments || [],
    status: task.status || "idle",
  }];
}

function activeVariant(task) {
  const variants = variantsOf(task);
  return variants.find((variant) => variant.modelId === task?.activeModelId) || variants[0] || null;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function timeLabel(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function previewDocument(title, html, readOnly=false) {
  const safeTitle = escapeHtml(title || "公众号文章");
  const parsed = new DOMParser().parseFromString(`<main>${html || ""}</main>`, "text/html");
  const root = parsed.querySelector("main");
  let sourceHeading = root?.querySelector("h1");
  if (!sourceHeading) {
    const firstRootChild = root?.firstElementChild;
    const candidate = firstRootChild?.matches("p")
      ? firstRootChild
      : firstRootChild?.matches("section, div, article")
        ? firstRootChild.firstElementChild
        : null;
    const candidateText = candidate?.textContent?.trim() || "";
    const candidateWeight = String(candidate?.style?.fontWeight || "").toLowerCase();
    const candidateSize = Number.parseFloat(candidate?.style?.fontSize || "0");
    const centered = String(candidate?.style?.textAlign || "").toLowerCase() === "center";
    const bold = candidateWeight === "bold" || Number.parseInt(candidateWeight, 10) >= 600;
    if (candidate?.matches("p") && candidateText.length >= 4 && candidateText.length <= 80 && centered && (bold || candidateSize >= 20)) {
      sourceHeading = candidate;
    }
  }
  const articleTitle = escapeHtml(sourceHeading?.textContent?.trim() || title || "公众号文章");
  sourceHeading?.setAttribute("data-editor2-source-title", "1");
  if (root) {
    // DOMParser returns a detached document whose NodeFilter constructor is
    // not exposed in every Electron renderer context. SHOW_TEXT is the stable
    // platform constant (0x4), so use it directly for packaged-app parity.
    const walker = parsed.createTreeWalker(root, 0x4);
    const textNodes = [];
    while (walker.nextNode()) {
      if (walker.currentNode.nodeValue?.trim()) textNodes.push(walker.currentNode);
    }
    for (const textNode of textNodes) {
      const span = parsed.createElement("span");
      span.setAttribute("data-editor2-text", "1");
      span.setAttribute("contenteditable", readOnly ? "false" : "plaintext-only");
      span.setAttribute("spellcheck", "false");
      span.textContent = textNode.nodeValue;
      textNode.replaceWith(span);
    }
  }
  const articleBody = root?.innerHTML || html || "";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>
    *{box-sizing:border-box}html{background:#fff}body{margin:0;background:#fff;color:#222;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;overflow-wrap:anywhere}.wechat-article{width:min(677px,calc(100% - 48px));margin:0 auto;padding:50px 0 96px}.wechat-head{margin-bottom:32px}.wechat-title{margin:0 0 14px;font-size:22px;line-height:1.45;font-weight:700;letter-spacing:.01em;color:#1f2329}.wechat-meta{display:flex;gap:10px;align-items:center;font-size:14px;color:#b2b2b2}.wechat-author{color:#576b95}.wechat-body{font-size:17px;line-height:1.8;letter-spacing:.025em}.wechat-body p{margin:0 0 1.35em}.wechat-body h2{margin:2.2em 0 .9em;font-size:20px;line-height:1.55}.wechat-body h3{margin:1.8em 0 .8em;font-size:18px;line-height:1.55}.wechat-body img{display:block;max-width:100%;height:auto;margin:1.5em auto}.wechat-body a{color:#576b95;text-decoration:none}.wechat-body table{width:100%;border-collapse:collapse}.wechat-body th,.wechat-body td{padding:9px;border:1px solid #dedfe2}.wechat-body blockquote{margin:1.5em 0;padding:12px 16px;border-left:3px solid #d8d8d8;background:#f7f7f7;color:#666}.wechat-body ul,.wechat-body ol{padding-left:1.5em}[data-editor2-source-title]{display:none!important}[data-editor2-text],[data-editor2-preview-title]{cursor:text;border-radius:3px}[data-editor2-text]:focus,[data-editor2-preview-title]:focus{outline:2px solid rgba(51,112,255,.2);background:rgba(51,112,255,.045)}@media(max-width:720px){.wechat-article{width:100%;padding:32px 22px 72px}.wechat-title{font-size:21px}}
  </style></head><body><article class="wechat-article"><header class="wechat-head"><h1 class="wechat-title"><span data-editor2-preview-title="1" contenteditable="${readOnly ? "false" : "plaintext-only"}" spellcheck="false">${articleTitle}</span></h1><div class="wechat-meta"><span class="wechat-author">编辑2号</span><span>公众号文章预览</span></div></header><section class="wechat-body">${articleBody}</section></article></body></html>`;
}

function emptyPreviewDocument() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#fff;color:#747982;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}.empty{text-align:center;max-width:330px}.icon{font-size:34px;color:#3370ff}h2{margin:10px 0;color:#24262b;font-size:20px}p{font-size:14px;line-height:1.7}</style></head><body><div class="empty"><div class="icon">✦</div><h2>从一篇随笔开始</h2></div></body></html>`;
}

function attachPreviewSelection() {
  const doc = ui.articlePreview.contentDocument;
  if (!doc) return;
  doc.addEventListener("mouseup", () => {
    const selection = ui.articlePreview.contentWindow?.getSelection();
    if (!selection || selection.isCollapsed) return;
    selectedText = selection.toString().trim().slice(0, 8000);
    renderSelection();
    if (selectedText) ui.commentInput.focus();
  });
  attachPreviewEditing(doc);
}

function editedArticleHtml(doc) {
  const body = doc.querySelector(".wechat-body")?.cloneNode(true);
  if (!body) return "";
  const title = doc.querySelector("[data-editor2-preview-title]")?.textContent || "";
  const sourceTitle = body.querySelector("[data-editor2-source-title]");
  if (sourceTitle) {
    const titleSpans = [...sourceTitle.querySelectorAll("[data-editor2-text]")];
    if (titleSpans.length) {
      titleSpans[0].textContent = title;
      for (const span of titleSpans.slice(1)) span.textContent = "";
    } else {
      sourceTitle.textContent = title;
    }
    sourceTitle.removeAttribute("data-editor2-source-title");
  }
  for (const span of [...body.querySelectorAll("[data-editor2-text]")]) span.replaceWith(doc.createTextNode(span.textContent || ""));
  return body.innerHTML;
}

function scheduleTextSave(doc) {
  window.markWorkbenchTouched?.();
  const task = activeTask();
  const variant = activeVariant(task);
  if (!task || !variant || task.readOnly) return;
  const html = editedArticleHtml(doc);
  variant.articleHtml = html;
  pendingTextEdit = { taskId: task.id, modelId: variant.modelId, html };
  ui.saveStatus.textContent = "正在保存…";
  clearTimeout(editSaveTimer);
  editSaveTimer = setTimeout(commitTextSave, 650);
}

async function commitTextSave() {
  while(textSavePromise)await textSavePromise;
  const payload = pendingTextEdit;
  if (!payload) return;
  clearTimeout(editSaveTimer);
  pendingTextEdit = null;
  const saving=(async()=>{
    try {
      await window.editor2.updateArticleText(payload);
      ui.saveStatus.textContent = "已自动保存";
    } catch (error) {
      pendingTextEdit = pendingTextEdit || payload;
      ui.saveStatus.textContent = "保存失败，请先核对";
      toast(error.message || String(error), 12000);
    }
  })();
  textSavePromise=saving;
  await saving;
  if(textSavePromise===saving)textSavePromise=null;
}

function attachPreviewEditing(doc) {
  if(activeTask()?.readOnly)return;
  const editable = [...doc.querySelectorAll("[data-editor2-text], [data-editor2-preview-title]")];
  for (const element of editable) {
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || ((event.metaKey || event.ctrlKey) && ["b", "i", "u"].includes(event.key.toLowerCase()))) event.preventDefault();
    });
    element.addEventListener("beforeinput", (event) => {
      if (["insertParagraph", "insertLineBreak", "formatBold", "formatItalic", "formatUnderline"].includes(event.inputType)) event.preventDefault();
    });
    element.addEventListener("paste", (event) => {
      event.preventDefault();
      doc.execCommand("insertText", false, event.clipboardData?.getData("text/plain") || "");
    });
    element.addEventListener("drop", (event) => event.preventDefault());
    element.addEventListener("input", () => scheduleTextSave(doc));
  }
}

function showBusy(title, detail) {
  ui.busyTitle.textContent = title;
  ui.busyDetail.textContent = detail;
  ui.busyOverlay.classList.remove("hidden");
}

function hideBusy() {
  ui.busyOverlay.classList.add("hidden");
}

function toast(message, duration = 3200) {
  ui.toast.textContent = message;
  ui.toast.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ui.toast.classList.add("hidden"), duration);
}

function renderModels() {
  if (!availableModels.length) {
    ui.modelOptions.innerHTML = '<div class="model-loading">没有可用的已启用模型</div>';
    return;
  }
  const selected = new Set([...ui.modelOptions.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value));
  ui.modelOptions.innerHTML = availableModels.map((model) => `<label class="model-check">
    <input type="checkbox" value="${escapeHtml(model.id)}" ${selected.has(model.id) ? "checked" : ""}>
    <span><strong>${escapeHtml(model.name)}</strong>${model.source ? `<small>${escapeHtml(model.source)}</small>` : ""}</span>
  </label>`).join("");
}

function selectedModelIds() {
  return [...ui.modelOptions.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
}

function remainingModels(task) {
  const existing = new Set((task?.variants || variantsOf(task)).map((variant) => variant.modelId));
  return availableModels.filter((model) => !existing.has(model.id));
}

function renderAddModelOptions() {
  const task = activeTask();
  const models = task ? remainingModels(task) : [];
  const selected = new Set([...ui.addModelOptions.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value));
  ui.addModelButton.disabled = !!activeTask()?.readOnly || !models.length;
  ui.addModelButton.title = models.length ? "向当前任务追加写作模型" : "已添加全部可用模型";
  ui.confirmAddModelButton.disabled = !models.length;
  if (!models.length) {
    ui.addModelOptions.innerHTML = '<div class="model-loading">没有尚未添加的已启用模型</div>';
    return;
  }
  ui.addModelOptions.innerHTML = models.map((model) => `<label class="model-check">
    <input type="checkbox" value="${escapeHtml(model.id)}" ${selected.has(model.id) ? "checked" : ""}>
    <span><strong>${escapeHtml(model.name)}</strong>${model.source ? `<small>${escapeHtml(model.source)}</small>` : ""}</span>
  </label>`).join("");
}

function selectedAddModelIds() {
  return [...ui.addModelOptions.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
}

function publishableVariants(task) {
  return variantsOf(task).filter((variant) => variant.articleHtml && variant.status !== "processing" && variant.status !== "error");
}

async function openPublishDialog() {
  if(activeTask()?.readOnly){toast("历史文章为只读展示");return;}
  await commitTextSave();
  const status = await window.webApi("/config/status");
  if (!status.wechat?.verifiedAt) { window.pendingPublish = true; window.openSettings(); return; }
  const task = activeTask();
  const variants = publishableVariants(task);
  if (!task || !variants.length) return;
  ui.publishModelOptions.innerHTML = variants.map((variant) => `<label class="model-check">
    <input type="checkbox" value="${escapeHtml(variant.modelId)}" ${variant.modelId === task.activeModelId ? "checked" : ""}>
    <span><strong>${escapeHtml(variant.modelName)}</strong><small>${escapeHtml(articleTitleForDisplay(variant.articleHtml, task.title))}</small></span>
  </label>`).join("");
  ui.publishDialog.classList.remove("hidden");
  ui.publishModelOptions.querySelector('input[type="checkbox"]')?.focus();
}

function closePublishDialog() {
  ui.publishDialog.classList.add("hidden");
}

function selectedPublishModelIds() {
  return [...ui.publishModelOptions.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
}

function articleTitleForDisplay(html, fallback) {
  const parsed = new DOMParser().parseFromString(String(html || ""), "text/html");
  const h1 = parsed.querySelector("h1");
  if (h1?.textContent?.trim()) return h1.textContent.trim();
  const first = parsed.querySelector("p");
  return first?.textContent?.trim().slice(0, 80) || fallback;
}

async function refreshModels() {
  try {
    availableModels = await window.editor2.listModels();
    renderModels();
    renderAddModelOptions();
  } catch (error) {
    availableModels = [];
    ui.modelOptions.innerHTML = '<div class="model-loading">模型读取失败</div>';
    toast(error.message || String(error));
  }
}

function renderTasks() {
  const tasks = appState?.tasks || [];
  if (!tasks.length) {
    ui.taskList.innerHTML = '<div class="task-empty">还没有文章任务</div>';
    return;
  }
  ui.taskList.innerHTML = tasks.map((task) => `
    <button class="task-item ${!creating && task.id === appState.activeTaskId ? "active" : ""}" data-task-id="${escapeHtml(task.id)}">
      <div class="task-summary"><strong title="${escapeHtml(task.title)}">${escapeHtml(task.title.replace(/\s*·?\s*\d{4}-\d{2}-\d{2}_\d{2}_\d{2}_\d{2}$/, "").trim() || task.title)}</strong><time>${escapeHtml(new Date(task.updatedAt || task.createdAt).toLocaleString("zh-CN", {year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}))}</time></div><span class="task-stage ${task.deliveryCompleted ? "completed" : "working"}">${task.deliveryCompleted ? "已完成" : "制作中"}</span>
    </button>`).join("");
}

function renderSelection() {
  if (!selectedText) {
    ui.selectionChip.classList.add("hidden");
    ui.selectionPreview.textContent = "";
    return;
  }
  ui.selectionPreview.textContent = selectedText;
  ui.selectionChip.classList.remove("hidden");
}

function commentMarkup(comment) {
  const assistant = comment.role !== "user";
  return `<article class="comment ${assistant ? "assistant" : "user"}">
    <div class="comment-head"><span class="avatar">${assistant ? "编" : "我"}</span><strong>${assistant ? "编辑2号" : "我"}</strong><time>${timeLabel(comment.createdAt)}</time></div>
    ${comment.selectedText ? `<blockquote>${escapeHtml(comment.selectedText)}</blockquote>` : ""}
    <p>${escapeHtml(comment.text)}</p>
  </article>`;
}

function renderComments(variant) {
  const comments = (variant?.comments || []).filter(comment => comment.role === "user" || !(comment.kind === "generation-error" || comment.text === variant?.lastError || /^(?:模型服务(?:商|调用|返回)|模型生成失败|模型调用超时|模型输出达到上限|服务商因无效请求|服务暂时不可用|生成结果已被更新)/.test(String(comment.text || ""))));
  ui.commentCount.textContent = String(comments.length);
  if (!comments.length) {
    ui.commentList.innerHTML = '<div class="comment-empty">选择文章文字或直接输入修改要求</div>';
    return;
  }
  const threads = [];
  for (const comment of comments) {
    if (comment.role === "user" || !threads.length) threads.push([comment]);
    else threads[threads.length - 1].push(comment);
  }
  ui.commentList.innerHTML = threads.map((thread) => `<section class="comment-thread">${thread.map(commentMarkup).join("")}</section>`).join("");
  ui.commentList.scrollTop = ui.commentList.scrollHeight;
}

const publishHint = document.createElement("span");
publishHint.style.display = "inline-flex";
ui.publishButton.replaceWith(publishHint);
publishHint.append(ui.publishButton);
window.refreshPublishButton = function () {
  const task = creating ? null : activeTask();
  let reason = "";
  if (!task || task.systemLocked === false || !publishableVariants(task).length) reason = "请先生成文章";
  else if (task.readOnly) reason = "历史文章为只读，不能发送";
  else if (window.trialRemaining === 0) reason = "体验额度已用完";
  else if (window.wechatBound === false) reason = "请先绑定公众号";
  ui.publishButton.disabled = !!reason;
  ui.publishButton.title = reason;
  publishHint.title = reason;
  ui.publishButton.style.pointerEvents = reason ? "none" : "";
};

function renderActive() {
  const task = creating ? null : activeTask();
  if (!task || task.systemLocked===false) {
    ui.newTaskPanel.classList.remove("hidden");
    ui.lockedSystemPanel.classList.add("hidden");
    ui.commentsPanel.classList.add("hidden");
    ui.articleTitle.textContent = task?.title || "新文章";
    ui.articleMeta.textContent = "";
    ui.modelToolbar.classList.add("hidden");
    ui.variantSwitcher.classList.add("hidden");
    ui.variantSwitcher.innerHTML = "";
    ui.articlePreview.srcdoc = emptyPreviewDocument();
    window.refreshPublishButton();
    ui.sendCommentButton.disabled=false;ui.commentInput.disabled=false;ui.addModelButton.disabled=false;
    ui.retryVariantButton.classList.add("hidden");
    ui.saveStatus.textContent = "";
    closePublishDialog();
    ui.addModelPanel.classList.add("hidden");
    return;
  }
  ui.newTaskPanel.classList.add("hidden");
  ui.lockedSystemPanel.classList.remove("hidden");
  ui.commentsPanel.classList.remove("hidden");
  const variants = variantsOf(task);
  const variant = activeVariant(task);
  ui.articleTitle.textContent = task.title;
  ui.articleMeta.textContent = `${variant?.modelName || "模型待定"} · System 已锁定 · ${variant?.status === "processing" ? "正在生成" : "网页预览"}`;
  ui.variantSwitcher.innerHTML = variants.map((item) => `<button class="variant-tab ${item.modelId === variant?.modelId ? "active" : ""}" data-model-id="${escapeHtml(item.modelId)}">${escapeHtml((item.source ? item.source + " / " : "") + item.modelName)}${item.status === "processing" ? " · 生成中" : ""}</button>`).join("");
  ui.modelToolbar.classList.remove("hidden");
  ui.variantSwitcher.classList.toggle("hidden", variants.length === 0);
  ui.articlePreview.srcdoc = previewDocument(task.title, variant?.articleHtml || "<p>文章尚未生成，可追加已启用模型继续创作。</p>", task.readOnly);
  window.refreshPublishButton();
  ui.sendCommentButton.disabled=!!task.readOnly || !variant || !availableModels.some(m=>m.id===variant.modelId);ui.commentInput.disabled=!!task.readOnly || !variant || !availableModels.some(m=>m.id===variant.modelId);ui.addModelButton.disabled=!!task.readOnly;
  ui.retryVariantButton.classList.toggle("hidden", task.readOnly || variant?.status !== "error" || !availableModels.some(m=>m.id===variant.modelId));
  ui.saveStatus.textContent = task.readOnly ? "历史记录 · 只读" : variant?.articleHtml ? "文字可直接编辑" : "暂无可编辑内容";
  renderAddModelOptions();
  if(task.readOnly){
    ui.addModelPanel.classList.add("hidden");
    ui.systemDetails.innerHTML=`<div class="system-row"><span>历史模型版本</span><p>${escapeHtml(variants.map(v=>v.modelName).join("、"))}</p></div>`;
    ui.commentList.innerHTML='';ui.commentCount.textContent='—';selectedText="";renderSelection();return;
  }
  const sourceLocation = task.sourceDocUrl || task.dingDocUrl || "";
  const sourceLabel = task.sourceDocTitle || task.dingDocTitle || sourceLocation;
  const sourceLink = /^https:\/\//i.test(sourceLocation)
    ? `<a href="${escapeHtml(sourceLocation)}">${escapeHtml(sourceLabel)}</a>`
    : `<p>${escapeHtml(sourceLabel)}<br>${escapeHtml(sourceLocation)}</p>`;
  const sourceNote = task.sourceDocImageCount ? `<p>内嵌图片 ${task.sourceDocImageCount} 张</p>` : "";
  const sourceWarnings = (task.sourceDocWarnings || []).map((value) => `<p>${escapeHtml(value)}</p>`).join("");
  const hasSource = !!(task.sourceDocHtml || task.sourceDocContent || task.dingDocContent || task.sourceImages?.length);
  ui.systemDetails.innerHTML = `
    <div class="system-row"><span>写作模型</span><p>${escapeHtml(variants.map((item) => item.modelName).join("、"))}</p></div>
    <div class="system-row"><span>资料文档</span>${sourceLink}${sourceNote}${sourceWarnings}</div>
    ${hasSource ? '<details class="source-preview"><summary>查看资料原文与图片</summary><iframe title="资料文档图文预览" sandbox="allow-same-origin"></iframe></details>' : ''}
    <div class="system-row"><span>对标文章</span><a href="${escapeHtml(task.benchmarkUrl)}">${escapeHtml(task.benchmarkTitle || task.benchmarkUrl)}</a></div>
    <div class="system-row"><span>原始随笔</span><p class="system-essay">${escapeHtml(task.originalEssay)}</p></div>`;
  const sourceBody = task.sourceDocHtml || `<p style="white-space:pre-wrap">${escapeHtml(task.sourceDocContent || task.dingDocContent || "")}</p>`;
  const sourcePreview = ui.systemDetails.querySelector(".source-preview iframe");
  if (sourcePreview) sourcePreview.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>body{font:14px/1.7 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#333;padding:12px;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #ddd;padding:6px}</style></head><body>${sourceBody}</body></html>`;
  renderComments(variant);
  selectedText = "";
  renderSelection();
}

function render() {
  renderTasks();
  renderActive();
}

ui.newTaskButton.addEventListener("click", async () => {
  ui.newTaskButton.disabled=true;
  try{await window.startNamedTask();}catch(e){toast(e.message,12000);}finally{ui.newTaskButton.disabled=false;}
});

ui.taskList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-task-id]");
  if (!button || taskSwitching || variantSwitching || button.dataset.taskId===activeTask()?.id) return;
  if(researchBusy){toast('搜索或推荐正在进行，请完成后再切换任务');return;}
  taskSwitching=true;
  try{
    await commitTextSave();if(pendingTextEdit)throw new Error('正文尚未保存，请稍后重试');
    await window.flushDraft?.();
    appState = await window.editor2.selectTask(button.dataset.taskId);creating=false;
    ui.addModelPanel.classList.add("hidden");render();
    await window.restoreTaskInputs?.(activeTask());
    await window.setWorkflowStep(activeTask()?.systemLocked===false?'research':'write');
  }catch(e){toast(e.message,12000);}finally{taskSwitching=false;}
});

ui.addModelButton.addEventListener("click", async () => {
  await window.setWorkflowStep("write");
  ui.addModelPanel.classList.remove("hidden");
  ui.addModelOptions.innerHTML = '<div class="model-loading">正在读取已启用模型…</div>';
  ui.confirmAddModelButton.disabled = true;
  try {
    availableModels = await window.editor2.listModels();
    renderAddModelOptions();
  } catch (error) {
    ui.addModelOptions.innerHTML = '<div class="model-loading">模型读取失败</div>';
    toast(error.message || String(error), 12000);
  }
});

ui.cancelAddModelButton.addEventListener("click", () => {
  ui.addModelPanel.classList.add("hidden");
});

ui.confirmAddModelButton.addEventListener("click", async () => {
  const task = activeTask();
  const modelIds = selectedAddModelIds();
  if (!task || !modelIds.length) {
    toast("请至少选择一个新模型");
    return;
  }
  showBusy("新增模型正在并行写作", `已选择 ${modelIds.length} 个模型，正在使用当前锁定的 System 生成…`);
  try {
    appState = await window.editor2.addModels({ taskId: task.id, modelIds });
    ui.addModelPanel.classList.add("hidden");
    render();
    toast(`${modelIds.length} 个模型结果已追加到当前任务`);
  } catch (error) {
    appState = await window.editor2.getState();
    render();
    toast(error.message || String(error), 12000);
  } finally {
    hideBusy();
  }
});

ui.variantSwitcher.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-model-id]");
  const task = activeTask();
  if (!button || !task || variantSwitching || taskSwitching || button.dataset.modelId===task.activeModelId) return;
  variantSwitching=true;
  try{
    await commitTextSave();
    if(pendingTextEdit)throw new Error("正文尚未保存，请保存成功后再切换模型");
    appState = await window.editor2.selectVariant(task.id, button.dataset.modelId);
    selectedText="";
    renderActive();
  }catch(error){toast(error.message||String(error),12000);}
  finally{variantSwitching=false;}
});

ui.newTaskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const modelIds = selectedModelIds();
  if (!modelIds.length) {
    toast("请至少选择一个写作模型");
    return;
  }
  showBusy("多个模型正在并行写作", `已选择 ${modelIds.length} 个模型，正在分别生成完整 HTML…`);
  try {
    await window.flushDraft?.();
    const draft=activeTask()?.systemLocked===false?activeTask():null;
    window.draftGenerationBusy=true;
    appState = await window.editor2.createTask({
      ...(draft?{taskId:draft.id,draftRevision:draft.draftRevision}:{}),
      modelIds,
      benchmarkUrl: ui.benchmarkInput.value,
      originalEssay: ui.essayInput.value,
    });
    creating = false;
    ui.newTaskForm.reset();
    window.clearUploadedDocument?.();
    render();
    const completed = activeTask()?.variants.filter(v => v.articleHtml && v.status !== "error").length || 0;
    toast(`${completed} 个模型生成成功${completed < modelIds.length ? `，${modelIds.length - completed} 个失败，可分别重试` : ""}，System 已锁定`, 10000);
  } catch (error) {
    toast(error.message || String(error), 12000);
  } finally {
    window.draftGenerationBusy=false;
    hideBusy();
  }
});

ui.articlePreview.addEventListener("load", attachPreviewSelection);

ui.clearSelectionButton.addEventListener("click", () => {
  selectedText = "";
  renderSelection();
});

ui.publishButton.addEventListener("click", () => openPublishDialog().catch(error => toast(error.message)));
ui.retryVariantButton.addEventListener("click", async () => {
  const task = activeTask();
  const variant = activeVariant(task);
  if (!task || variant?.status !== "error") return;
  showBusy(variant.modelName + " 正在重试", "仅重新生成当前失败的模型结果…");
  try {
    appState = await window.editor2.retryVariant({ taskId: task.id, modelId: variant.modelId });
    render();
    toast("失败模型已重新生成");
  } catch (error) {
    appState = await window.editor2.getState();
    render();
    toast(error.message || String(error), 14000);
  } finally {
    hideBusy();
  }
});
ui.closePublishButton.addEventListener("click", closePublishDialog);
ui.cancelPublishButton.addEventListener("click", closePublishDialog);
ui.publishDialog.addEventListener("click", (event) => {
  if (event.target === ui.publishDialog) closePublishDialog();
});
ui.confirmPublishButton.addEventListener("click", async () => {
  const task = activeTask();
  const modelIds = selectedPublishModelIds();
  if (!task || !modelIds.length) {
    toast("请至少选择一个模型结果");
    return;
  }
  closePublishDialog();
  showBusy("正在生成封面并发送", `已选择 ${modelIds.length} 个模型结果，正在读取已启用的生图模型…`);
  try {
    await commitTextSave();
    if (pendingTextEdit) throw new Error("正文尚未保存成功，请先刷新核对");
    const response = await window.editor2.publishArticles({ taskId: task.id, modelIds });
    renderTasks();
    if (response.canceled) {
      toast("已取消发送");
      return;
    }
    const succeeded = response.results.filter((item) => ["success", "duplicate"].includes(item.status));
    const failed = response.results.filter((item) => item.status === "failed");
    const duplicateCount = succeeded.filter((item) => item.status === "duplicate").length;
    const summary = `本次生成 ${response.coverCount || 0} 张封面，草稿箱已确认 ${succeeded.length} 篇${duplicateCount ? `（${duplicateCount} 篇已存在，未重复建立）` : ""}`;
    toast(failed.length ? `${summary}；${failed.length} 篇失败：${failed.map((item) => `${item.model_name}：${item.error}`).join("；")}` : summary, 14000);
  } catch (error) {
    toast(error.message || String(error), 14000);
  } finally {
    hideBusy();
  }
});

ui.sendCommentButton.addEventListener("click", async () => {
  const task = activeTask();
  const variant = activeVariant(task);
  const instruction = ui.commentInput.value.trim();
  if (!task || !variant || !instruction) return;
  showBusy(`${variant.modelName} 正在更新全文`, selectedText ? "已附加选中的文章文本作为评论上下文…" : "正在遵守固定 System 处理本次要求…");
  try {
    appState = await window.editor2.sendComment({ taskId: task.id, modelId: variant.modelId, instruction, selectedText });
    ui.commentInput.value = "";
    selectedText = "";
    render();
    toast("全文已更新，评论已记录");
  } catch (error) {
    appState = await window.editor2.getState();
    render();
    toast(error.message || String(error), 12000);
  } finally {
    hideBusy();
  }
});

// Startup is owned by experience.js; avoid duplicate state/model reads.
