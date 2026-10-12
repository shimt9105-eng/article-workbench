"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const IMAGE_TYPES = { png: "png", jpeg: "jpg", gif: "gif" };

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
  return (match?.[2] || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
}

function escapeAttribute(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function markdownSourceImages(content) {
  let number = 0;
  const images = [];
  const normalized = String(content || "").replace(/!\[([^\]]*)\]\((https:\/\/[^\s)]+)\)/gi, (_match, alt, src) => {
    number += 1;
    images.push({ number, alt, src });
    return `[资料图片 ${number}]`;
  });
  if (!images.length) return { content: String(content || ""), html: "", imageCount: 0 };
  let html = escapeAttribute(normalized).replace(/\n\s*\n/g, "</p><p>").replace(/\n/g, "<br>");
  for (const image of images) {
    html = html.replace(`[资料图片 ${image.number}]`, `<img src="${escapeAttribute(image.src)}" alt="${escapeAttribute(image.alt || `资料图片 ${image.number}`)}">`);
  }
  return { content: normalized, html: `<p>${html}</p>`, imageCount: images.length };
}

function imageContext(content, number) {
  const marker = new RegExp(`\\[资料图片\\s*${number}\\]`);
  const match = marker.exec(String(content || ""));
  if (!match) return { beforeText: "", afterText: "" };
  const before = content.slice(0, match.index).split(/\n\s*\n/).filter(Boolean).pop() || "";
  const after = content.slice(match.index + match[0].length).split(/\n\s*\n/).filter(Boolean)[0] || "";
  return { beforeText: before.replace(/[*#]/g, "").trim().slice(-240), afterText: after.replace(/[*#]/g, "").trim().slice(0, 240) };
}

function stageSourceImages(source, taskId, mediaRoot) {
  const html = String(source.html || "");
  const imageTags = [...html.matchAll(/<img\b[^>]*>/gi)];
  const missingCount = Math.max(0, Number(source.imageCount || 0) - imageTags.length);
  const warnings = [...(source.warnings || [])];
  if (missingCount) warnings.push(`${missingCount} 张资料图片未能提取，已保留原文提示；请检查文档图片权限或格式`);
  if (!imageTags.length) return { ...source, warnings, images: [] };
  const destination = path.join(mediaRoot, "source-images", taskId);
  const images = [];
  let number = 0;
  const stagedHtml = html.replace(/<img\b[^>]*>/gi, (tag) => {
    number += 1;
    const original = attribute(tag, "src");
    const context = imageContext(source.content, number);
    let imagePath = original;
    const embedded = original.match(/^data:image\/(png|jpeg|gif);base64,([a-z0-9+/=]+)$/i);
    if (embedded) {
      const bytes = Buffer.from(embedded[2], "base64");
      if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error(`资料图片 ${number} 无效或超过 10MB`);
      fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
      const digest = crypto.createHash("sha256").update(bytes).digest("hex");
      imagePath = path.join(destination, `${digest}.${IMAGE_TYPES[embedded[1].toLowerCase()]}`);
      if (!fs.existsSync(imagePath)) fs.writeFileSync(imagePath, bytes, { flag: "wx", mode: 0o600 });
    } else if (!/^https:\/\//i.test(original) && !path.isAbsolute(original)) {
      throw new Error(`资料图片 ${number} 没有可用的地址`);
    }
    images.push({ number, id: `资料图片 ${number}`, src: imagePath, alt: attribute(tag, "alt") || `资料图片 ${number}`, ...context });
    return tag.replace(/\s+src\s*=\s*(["'])[\s\S]*?\1/i, ` src="${escapeAttribute(imagePath)}"`);
  });
  return { ...source, html: stagedHtml, imageCount: images.length, warnings, images };
}

function imageMarkup(image) {
  return `<img src="${escapeAttribute(image.src)}" alt="${escapeAttribute(image.alt)}" style="display:block;max-width:100%;height:auto;margin:16px auto">`;
}

function paragraphScore(paragraph, image) {
  const text = paragraph.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ");
  const context = image.beforeText || image.afterText || "";
  const numbers = [...new Set(context.match(/\d+(?:\.\d+)?/g) || [])];
  const matchingNumbers = numbers.filter((number) => text.includes(number)).length;
  const words = context.match(/[\u4e00-\u9fff]{2,8}/g) || [];
  const matchingWords = words.filter((word) => text.includes(word)).length;
  return matchingNumbers * 3 + matchingWords;
}

function placeSourceImages(html, images) {
  let output = String(html || "");
  const warnings = [];
  for (const image of images || []) {
    const escaped = image.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const marker = new RegExp(`\\[\\s*${escaped}\\s*\\]`, "gi");
    const existing = output.includes(image.src);
    if (existing) {
      output = output.replace(marker, "");
      continue;
    }
    const markup = imageMarkup(image);
    if (marker.test(output)) {
      marker.lastIndex = 0;
      let inserted = false;
      output = output.replace(marker, () => {
        if (inserted) return "";
        inserted = true;
        return markup;
      });
      continue;
    }
    const paragraphs = [...output.matchAll(/<p\b[^>]*>[\s\S]*?<\/p>/gi)];
    let best = null;
    for (const paragraph of paragraphs) {
      const score = paragraphScore(paragraph[0], image);
      if (score > 0 && (!best || score > best.score)) best = { end: paragraph.index + paragraph[0].length, score };
    }
    if (best) output = output.slice(0, best.end) + markup + output.slice(best.end);
    else {
      output += markup;
      warnings.push(`${image.id} 未找到对应段落，已置于文末，请检查位置`);
    }
  }
  return { html: output, warnings };
}

module.exports = { markdownSourceImages, stageSourceImages, placeSourceImages };
