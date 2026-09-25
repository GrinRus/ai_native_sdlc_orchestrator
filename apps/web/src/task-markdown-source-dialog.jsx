import { useState } from "react";

import { normalizeProjectRelativeMarkdownPath as safeProjectRelativePath, isValidPinnedGitRevision as validPinnedRevision } from "../../../packages/contracts/src/task-markdown-source.mjs";
import { sanitizeMarkdownPreview } from "../../../packages/contracts/src/markdown-sanitization.mjs";
import { Dialog } from "./dialog.jsx";
import { Button, Icon, useRovingTabs } from "./ui/components.jsx";
import { firstNonNullish } from "../../../packages/contracts/src/value-normalization.mjs";

const MAX_SOURCE_COUNT = 10;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const SOURCE_TABS = [
  { id: "upload", label: "Upload snapshot", controls: "task-source-upload-panel" },
  { id: "repository", label: "Repository file", controls: "task-source-repository-panel" },
  { id: "paste", label: "Paste text", controls: "task-source-paste-panel" },
];
const PREVIEW_TABS = [
  { id: "preview", label: "Preview", controls: "task-preview-panel" },
  { id: "source", label: "Source", controls: "task-preview-panel" },
];
const INLINE_MARKDOWN_RENDERERS = [
  [/^`[^`]+`$/u, (piece, key) => <code key={key}>{piece.slice(1, -1)}</code>],
  [/^\*\*[^*]+\*\*$/u, (piece, key) => <strong key={key}>{piece.slice(2, -2)}</strong>],
  [/^\*[^*]+\*$/u, (piece, key) => <em key={key}>{piece.slice(1, -1)}</em>],
  [/^\[[^\]]+\]\([^)]+\)$/u, (piece, key) => {
    const match = /** @type {RegExpMatchArray} */ (piece.match(/^\[([^\]]+)\]\(([^)]+)\)$/u));
    const [, label, destination] = match;
    const href = safeExternalHref(destination);
    return href
      ? <span key={key}><a href={href} target="_blank" rel="noopener noreferrer">{label}</a> <small>(destination: {href})</small></span>
      : <span key={key}>{label} <small>(destination: {destination})</small></span>;
  }],
];

function plainInlineMarkdown(piece, key) { return <span key={key}>{piece}</span>; }

function inlineMarkdown(value, keyPrefix) {
  const pieces = String(value).split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/gu);
  return pieces.map((piece, index) => {
    const key = `${keyPrefix}-${index}`;
    const renderer = INLINE_MARKDOWN_RENDERERS.find(([pattern]) => pattern.test(piece))?.[1] ?? plainInlineMarkdown;
    return renderer(piece, key);
  });
}

function safeExternalHref(value) {
  try {
    const url = new URL(String(value));
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function renderMarkdown(value) {
  const lines = String(value ?? "").split(/\r?\n/u);
  const blocks = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    const fence = line.match(/^\s*```([^`]*)$/u);
    if (fence) {
      const code = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/u.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      blocks.push(<pre key={`block-${blocks.length}`}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/u);
    if (heading) {
      const level = heading[1].length;
      const content = inlineMarkdown(heading[2], `heading-${index}`);
      const Heading = `h${level}`;
      blocks.push(<Heading key={`block-${index}`}>{content}</Heading>);
      index += 1;
      continue;
    }
    if (/^\s*[-*+]\s+/u.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*+]\s+/u.test(lines[index])) {
        const itemIndex = index;
        const content = lines[index++].replace(/^\s*[-*+]\s+/u, "");
        items.push(<li key={`item-${itemIndex}`}>{inlineMarkdown(content, `list-${itemIndex}`)}</li>);
      }
      blocks.push(<ul key={`block-${index}`}>{items}</ul>);
      continue;
    }
    if (/^\s*>\s?/u.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s*>\s?/u.test(lines[index])) quote.push(lines[index++].replace(/^\s*>\s?/u, ""));
      blocks.push(<blockquote key={`block-${index}`}><p>{inlineMarkdown(quote.join(" "), `quote-${index}`)}</p></blockquote>);
      continue;
    }
    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^(#{1,6})\s+|^\s*```|^\s*[-*+]\s+|^\s*>\s?/u.test(lines[index])) paragraph.push(lines[index++]);
    blocks.push(<p key={`block-${index}`}>{inlineMarkdown(paragraph.join(" "), `paragraph-${index}`)}</p>);
  }
  return blocks;
}

function sourceLabel(source) {
  return source?.preview?.filename || source?.preview?.project_relative_path || "Markdown source";
}

function sourceBytes(source) {
  return Number(source?.preview?.byte_length) || 0;
}

function sourceCountLabel(action, count) {
  return `${action} ${count} source${count === 1 ? "" : "s"}`;
}

function repositorySource(relativePath, revision) {
  return {
    schema_version: 1,
    source_id: `draft.repository.${relativePath}`,
    kind: "repository-markdown",
    immutable: true,
    stale: false,
    preview: { project_relative_path: relativePath, pinned_base_revision: revision || null, media_type: "text/markdown" },
    reference: { project_relative_path: relativePath, pinned_base_revision: revision || null },
  };
}

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(value >= 10 * 1024 ? 0 : 1)} KB`;
}

async function addMarkdownFiles({ fileList, allSources, attachmentBytes, setError, setSources, setActiveSourceId }) {
  setError("");
  const files = Array.from(fileList ?? []);
  if (!globalThis.crypto?.subtle) {
    setError("This browser cannot create a secure source digest. Reopen the local Task Workspace and try again.");
    return;
  }
  if (allSources.length + files.length > MAX_SOURCE_COUNT) {
    setError(`A Task can include at most ${MAX_SOURCE_COUNT} sources.`);
    return;
  }
  let nextBytes = attachmentBytes;
  const additions = [];
  for (const file of files) {
    if (!/\.md$/iu.test(file.name)) {
      setError(`${file.name || "This file"} must use the .md extension.`);
      return;
    }
    let content;
    let fileBytes;
    try {
      fileBytes = await file.arrayBuffer();
      content = new TextDecoder("utf-8", { fatal: true }).decode(fileBytes);
    } catch {
      setError(`${file.name} is not valid UTF-8 text or could not be read.`);
      return;
    }
    if (content.includes("\u0000")) {
      setError(`${file.name} must not contain NUL bytes.`);
      return;
    }
    const byteLength = fileBytes.byteLength;
    if (byteLength > MAX_FILE_BYTES) {
      setError(`${file.name} exceeds the 1 MiB per-file limit.`);
      return;
    }
    nextBytes += byteLength;
    if (nextBytes > MAX_UPLOAD_BYTES) {
      setError("Uploaded Markdown snapshots exceed the 5 MiB total limit.");
      return;
    }
    let digestBytes;
    try {
      digestBytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
    } catch {
      setError(`${file.name} could not be verified. Choose another file.`);
      return;
    }
    const digest = Array.from(new Uint8Array(digestBytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if ([...allSources, ...additions].some((source) => source.digest === `sha256:${digest}`)) continue;
    const name = file.name.replace(/[\\/]/gu, "_");
    additions.push({
      schema_version: 1,
      source_id: `draft.upload.${digest}`,
      kind: "upload-snapshot",
      immutable: true,
      stale: false,
      digest: `sha256:${digest}`,
      preview: { filename: name, media_type: "text/markdown", byte_length: byteLength, sanitized_markdown: sanitizeMarkdownPreview(content) },
      attachment: { name, content },
    });
  }
  if (additions.length) {
    setSources((current) => [...current, ...additions]);
    setActiveSourceId(additions.at(-1).source_id);
  }
}

function saveMarkdownSources({ mode, canAddRepository, repositoryPath, repositoryRevision, sources, pastedText, retainedSources, setError, onAdd }) {
  const sourceIds = retainedSources.map((entry) => entry.source_id);
  if (mode === "repository" && repositoryPath.trim()) {
    if (!canAddRepository) {
      setError("Choose a new, project-relative .md path and pin a full commit id when required.");
      return;
    }
    const source = repositorySource(safeProjectRelativePath(repositoryPath), repositoryRevision.trim());
    onAdd?.({ sources: [...sources, source], pastedText: "", sourceIds });
  } else if (mode === "paste") {
    if (pastedText.trim()) onAdd?.({ sources, pastedText: pastedText.trim(), sourceIds });
  } else {
    onAdd?.({ sources, pastedText: "", sourceIds });
  }
}

function sourceDialogPresentation({ mode, pastedText, activeSource, sourceSubmissionId, sources, allSources, canAddRepository, repositoryPath }) {
  const previewByKind = {
    "upload-snapshot": activeSource?.preview?.sanitized_markdown || "",
    "repository-markdown": activeSource?.preview?.sanitized_markdown || "AOR reads and sanitizes this connected repository file during preparation.",
  };
  const previewText = mode === "paste" ? sanitizeMarkdownPreview(pastedText) : previewByKind[activeSource?.kind] || "Choose a Markdown source to preview.";
  const selectedTab = SOURCE_TABS.find((tab) => tab.id === mode);
  const saveDisabled = new Map([["paste", !pastedText.trim()], ["repository", new Map([[true, !canAddRepository], [false, allSources.length === 0]]).get(Boolean(repositoryPath.trim()))]]).get(mode) ?? allSources.length === 0;
  const addLabel = mode === "paste"
    ? "Add to task brief"
    : sourceSubmissionId
      ? sourceCountLabel("Keep", allSources.length)
      : sourceCountLabel("Add", sources.length);
  return { previewText, selectedTab, saveDisabled, addLabel };
}

function UploadSourcePanel({ dragActive, setDragActive, addFiles }) { return <label className={`task-dropzone${dragActive ? " is-drag-active" : ""}`} id="task-source-upload-panel" onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }} onDragOver={(event) => { event.preventDefault(); setDragActive(true); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragActive(false); }} onDrop={(event) => { event.preventDefault(); setDragActive(false); void addFiles(event.dataTransfer.files); }}><span className="task-dropzone__icon"><Icon name="upload" /></span><strong>Drop .md files here</strong><span><input aria-label="Upload Markdown" id="task-markdown-upload" type="file" accept=".md,text/markdown" multiple onChange={(event) => { void addFiles(event.target.files); event.target.value = ""; }} />Choose files</span><small>Up to 10 sources · 1 MiB per file · 5 MiB total uploads</small></label>; }
function RepositorySourcePanel({ repositoryPath, setRepositoryPath, repositoryRevision, setRepositoryRevision, canAddRepository, addRepositorySource }) { return <div className="task-repository-form" id="task-source-repository-panel"><label htmlFor="repository-markdown-path">Project-relative Markdown path</label><input id="repository-markdown-path" value={repositoryPath} onChange={(event) => setRepositoryPath(event.target.value)} placeholder="docs/task.md" /><label htmlFor="repository-markdown-revision">Pinned current base revision</label><input id="repository-markdown-revision" value={repositoryRevision} onChange={(event) => setRepositoryRevision(event.target.value)} placeholder="Current checkout (automatic)" /><p className="task-muted">Leave revision blank to pin the current checkout automatically. An explicit revision must equal its current Git HEAD. AOR reads and sanitizes the file during task preparation.</p><Button onClick={addRepositorySource} disabled={!canAddRepository}>Add repository file</Button></div>; }
function PasteSourcePanel({ pastedText, setPastedText }) { return <div className="task-inline-markdown" id="task-source-paste-panel"><label htmlFor="task-markdown">Paste Markdown into the Task brief</label><textarea id="task-markdown" aria-label="Paste Markdown" rows="10" value={pastedText} onChange={(event) => setPastedText(event.target.value)} placeholder="# Context" /><p className="task-muted">Pasted text is added to the Task request and is not stored as a separate file.</p></div>; }
const SOURCE_MODE_PANELS = { upload: UploadSourcePanel, repository: RepositorySourcePanel, paste: PasteSourcePanel };

export function MarkdownSourceDialog({ selectedSources = [], initialSources = [], sourceSubmissionId = null, openerElementRef, onClose, onAdd }) {
  const [mode, setMode] = useState("upload");
  const [sources, setSources] = useState(() => initialSources);
  const [removedSourceIds, setRemovedSourceIds] = useState([]);
  const [activeSourceId, setActiveSourceId] = useState(firstNonNullish(initialSources[0]?.source_id, selectedSources[0]?.source_id, null));
  const [repositoryPath, setRepositoryPath] = useState("");
  const [repositoryRevision, setRepositoryRevision] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [previewTab, setPreviewTab] = useState("preview");
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const { getTabProps } = useRovingTabs({ tabs: SOURCE_TABS, selected: mode, onSelect: setMode });
  const { getTabProps: getPreviewTabProps } = useRovingTabs({ tabs: PREVIEW_TABS, selected: previewTab, onSelect: setPreviewTab });
  const retainedSources = selectedSources.filter((source) => !removedSourceIds.includes(source.source_id));
  const allSources = [...retainedSources, ...sources];
  const activeSource = allSources.find((source) => source.source_id === activeSourceId) ?? sources.at(-1) ?? retainedSources[0] ?? null;
  const attachmentBytes = allSources.reduce((total, source) => total + (source.kind === "upload-snapshot" ? sourceBytes(source) : 0), 0);
  const repositoryPathIsValid = Boolean(safeProjectRelativePath(repositoryPath) && /\.md$/iu.test(repositoryPath.trim()));
  const repositoryRevisionIsValid = validPinnedRevision(repositoryRevision.trim());
  const canAddRepository = repositoryPathIsValid
    && repositoryRevisionIsValid
    && allSources.length < MAX_SOURCE_COUNT
    && !allSources.some((source) => source.kind === "repository-markdown" && (source.reference?.project_relative_path ?? source.preview?.project_relative_path) === repositoryPath.trim());

  const addFiles = (fileList) => addMarkdownFiles({ fileList, allSources, attachmentBytes, setError, setSources, setActiveSourceId });
  const SourcePanel = SOURCE_MODE_PANELS[mode];

  function addRepositorySource() {
    if (!canAddRepository) return;
    const relativePath = safeProjectRelativePath(repositoryPath);
    const revision = repositoryRevision.trim();
    const source = repositorySource(relativePath, revision);
    setSources((current) => [...current, source]);
    setActiveSourceId(source.source_id);
    setRepositoryPath("");
    setRepositoryRevision("");
    setError("");
  }

  const saveSources = () => saveMarkdownSources({ mode, canAddRepository, repositoryPath, repositoryRevision, sources, pastedText, retainedSources, setError, onAdd });
  const { previewText, selectedTab, saveDisabled, addLabel } = sourceDialogPresentation({ mode, pastedText, activeSource, sourceSubmissionId, sources, allSources, canAddRepository, repositoryPath });

  return <Dialog open onClose={onClose} labelledBy="task-source-dialog-title" openerElementRef={openerElementRef} className="task-source-overlay" backdropClassName="task-source-backdrop">
    <div className="task-source-overlay__content">
      <header><h2 id="task-source-dialog-title">Add Markdown source</h2><button type="button" className="task-plain-icon" aria-label="Close Markdown Sources" onClick={onClose}><Icon name="close" /></button></header>
      <div className="task-source-tabs" role="tablist" aria-label="Markdown source type">{SOURCE_TABS.map((tab, index) => <button {...getTabProps(tab, index)} key={tab.id} id={`task-source-tab-${tab.id}`} type="button" role="tab" aria-selected={mode === tab.id} aria-controls={selectedTab?.id === tab.id ? tab.controls : undefined} className={mode === tab.id ? "is-selected" : ""} onClick={() => setMode(tab.id)}>{tab.label}</button>)}</div>
      <div className="task-source-overlay__grid">
        <div className="task-source-input-pane">
          <SourcePanel dragActive={dragActive} setDragActive={setDragActive} addFiles={addFiles} repositoryPath={repositoryPath} setRepositoryPath={setRepositoryPath} repositoryRevision={repositoryRevision} setRepositoryRevision={setRepositoryRevision} canAddRepository={canAddRepository} addRepositorySource={addRepositorySource} pastedText={pastedText} setPastedText={setPastedText} />
          {error ? <p className="task-inline-alert" role="alert">{error}</p> : null}
          <h3>Source list ({allSources.length})</h3>
          <div className="task-source-list">{allSources.map((source) => {
            const isDraftSource = sources.some((entry) => entry.source_id === source.source_id);
            const removable = isDraftSource || (Boolean(sourceSubmissionId) && source.kind !== "inline-text");
            const size = sourceBytes(source);
            const isStale = source.stale === true;
            return <div className="task-source-row task-source-row--detailed" key={source.source_id}><Icon name="file" /><div className="task-source-row__name"><strong title={sourceLabel(source)}>{sourceLabel(source)}</strong><span>{[size ? formatBytes(size) : null, source.kind === "upload-snapshot" ? "Uploaded snapshot" : source.kind === "repository-markdown" ? "Repository reference" : "Task source"].filter(Boolean).join(" · ")}</span><small className={`task-source-row__validation${isStale ? " is-stale" : ""}`}>{isStale ? "Stale source" : "Validated"}</small></div><button type="button" className="task-source-preview-button" onClick={() => { setActiveSourceId(source.source_id); setPreviewTab("preview"); setMode(source.kind === "repository-markdown" ? "repository" : "upload"); }}>{activeSourceId === source.source_id ? "Previewing" : "Preview"}</button>{removable ? <button type="button" className="task-icon-button" aria-label={`Remove ${sourceLabel(source)}`} onClick={() => { if (isDraftSource) setSources((current) => current.filter((entry) => entry.source_id !== source.source_id)); else setRemovedSourceIds((current) => current.includes(source.source_id) ? current : [...current, source.source_id]); if (activeSourceId === source.source_id) setActiveSourceId(null); }}><Icon name="close" /></button> : <span className="task-source-row__menu" aria-hidden="true"><Icon name="more" /></span>}<small className="task-source-row__digest" title={source.digest || "Digest not published"}>Digest: {source.digest || "Not published"}</small></div>;
          })}</div>
          {!allSources.length ? <p className="task-muted">No source added yet.</p> : null}
        </div>
        <div className="task-markdown-preview"><h3>{mode === "paste" ? "Pasted Task brief" : activeSource ? sourceLabel(activeSource) : "Markdown preview"}</h3>
          {mode === "paste" || activeSource?.kind === "upload-snapshot" || activeSource?.preview?.sanitized_markdown ? <><div className="task-preview-tabs" role="tablist" aria-label="Source presentation">{PREVIEW_TABS.map((tab, index) => <button {...getPreviewTabProps(tab, index)} key={tab.id} id={`task-preview-tab-${tab.id}`} type="button" role="tab" aria-selected={previewTab === tab.id} aria-controls={previewTab === tab.id ? tab.controls : undefined} onClick={() => setPreviewTab(tab.id)}>{tab.label}</button>)}</div>{previewTab === "preview" ? <div id="task-preview-panel" role="tabpanel" aria-labelledby="task-preview-tab-preview" className="task-markdown-preview__content">{renderMarkdown(previewText)}<p className="task-info-callout">HTML and remote embeds are shown as inert text. Link destinations are displayed before opening.</p></div> : <pre id="task-preview-panel" role="tabpanel" aria-labelledby="task-preview-tab-source" className="task-markdown-source" aria-label="Sanitized Markdown source">{previewText}</pre>}</> : <p className="task-muted">{previewText}</p>}
        </div>
      </div>
      <footer className="task-screen-footer"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={saveSources} disabled={saveDisabled}>{addLabel}</Button></footer>
    </div>
  </Dialog>;
}
