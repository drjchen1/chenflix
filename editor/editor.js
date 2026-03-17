const openFileBtn = document.getElementById('openFileBtn');
const saveBtn = document.getElementById('saveBtn');
const downloadBtn = document.getElementById('downloadBtn');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const resetBtn = document.getElementById('resetBtn');
const preview = document.getElementById('preview');
const selectedText = document.getElementById('selectedText');
const selectedPath = document.getElementById('selectedPath');
const attrToggle = document.getElementById('attrToggle');
const attrSection = document.getElementById('attrSection');
const attrInputs = Array.from(attrSection.querySelectorAll('input[data-attr]'));
const statusFile = document.getElementById('statusFile');
const statusChanges = document.getElementById('statusChanges');
const statusAction = document.getElementById('statusAction');

let fileHandle = null;
let fileName = null;
let originalContent = '';
let selectedNode = null;
let selectedElement = null;
let highlightedElement = null;
let editorStyleEl = null;
let isLoading = false;

const historyStack = [];
const redoStack = [];

const blockedTags = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'IFRAME',
  'OBJECT',
  'HEAD',
  'TITLE',
  'META',
  'LINK'
]);

const fileInputFallback = document.createElement('input');
fileInputFallback.type = 'file';
fileInputFallback.accept = '.html,.htm';
fileInputFallback.style.display = 'none';
fileInputFallback.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) {
    return;
  }
  fileHandle = null;
  fileName = file.name;
  const content = await file.text();
  loadHtmlContent(content, file.name);
});

document.body.appendChild(fileInputFallback);

function setStatus(actionText = '—') {
  statusFile.textContent = fileName || 'No file loaded';
  statusChanges.textContent = String(historyStack.length);
  statusAction.textContent = actionText;
}

function updateButtons() {
  const hasFile = Boolean(originalContent);
  saveBtn.disabled = !fileHandle;
  downloadBtn.disabled = !hasFile;
  undoBtn.disabled = historyStack.length === 0;
  redoBtn.disabled = redoStack.length === 0;
  resetBtn.disabled = !hasFile;
}

function clearSelection() {
  selectedNode = null;
  selectedElement = null;
  selectedText.value = '';
  selectedPath.value = '';
  attrInputs.forEach((input) => {
    input.value = '';
  });
  removeHighlight();
}

function removeHighlight() {
  if (highlightedElement) {
    highlightedElement.classList.remove('editor-highlight');
    highlightedElement = null;
  }
}

function injectEditorStyles(doc) {
  if (!doc) {
    return;
  }
  if (!doc.head) {
    const head = doc.createElement('head');
    doc.documentElement.insertBefore(head, doc.body || doc.documentElement.firstChild);
  }
  editorStyleEl = doc.createElement('style');
  editorStyleEl.id = 'editor-style';
  editorStyleEl.textContent = `
    .editor-highlight {
      outline: 2px solid #ffbf47;
      outline-offset: 2px;
      background: rgba(255, 191, 71, 0.08);
    }
  `;
  doc.head.appendChild(editorStyleEl);
}

function cleanupEditorStyles(doc) {
  if (editorStyleEl && editorStyleEl.parentNode) {
    editorStyleEl.parentNode.removeChild(editorStyleEl);
    editorStyleEl = null;
  }
  if (doc) {
    const leftover = doc.getElementById('editor-style');
    if (leftover) {
      leftover.parentNode.removeChild(leftover);
    }
  }
  removeHighlight();
}

function getNodePath(node, root) {
  const path = [];
  let current = node;
  const rootNode = root || node.ownerDocument;
  while (current && current !== rootNode) {
    const parent = current.parentNode;
    if (!parent) {
      break;
    }
    const index = Array.prototype.indexOf.call(parent.childNodes, current);
    path.unshift(index);
    current = parent;
  }
  return path;
}

function getNodeByPath(root, path) {
  let current = root;
  for (const index of path) {
    if (!current || !current.childNodes || !current.childNodes[index]) {
      return null;
    }
    current = current.childNodes[index];
  }
  return current;
}

function getElementPathString(element) {
  if (!element) {
    return '';
  }
  const parts = [];
  let current = element;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let label = current.tagName.toLowerCase();
    if (current.id) {
      label += `#${current.id}`;
    } else if (current.classList && current.classList.length) {
      label += `.${current.classList[0]}`;
    }
    parts.unshift(label);
    current = current.parentElement;
  }
  return parts.join(' > ');
}

function isBlockedNode(node) {
  if (!node) {
    return true;
  }
  let current = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  while (current) {
    if (blockedTags.has(current.tagName)) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function getCaretRangeFromPoint(doc, x, y) {
  if (doc.caretRangeFromPoint) {
    return doc.caretRangeFromPoint(x, y);
  }
  if (doc.caretPositionFromPoint) {
    const position = doc.caretPositionFromPoint(x, y);
    if (!position) {
      return null;
    }
    const range = doc.createRange();
    range.setStart(position.offsetNode, position.offset);
    range.collapse(true);
    return range;
  }
  return null;
}

function findTextNodeFromRange(range) {
  if (!range) {
    return null;
  }
  let node = range.startContainer;
  if (node.nodeType === Node.TEXT_NODE) {
    return node;
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    const child = node.childNodes[range.startOffset];
    if (child && child.nodeType === Node.TEXT_NODE) {
      return child;
    }
  }
  return null;
}

function selectNode(node) {
  if (!node || !node.textContent) {
    return;
  }
  if (isBlockedNode(node)) {
    return;
  }
  const trimmed = node.textContent.replace(/\s+/g, ' ').trim();
  if (!trimmed) {
    return;
  }
  selectedNode = node;
  selectedElement = node.parentElement;
  selectedText.value = node.textContent;
  selectedPath.value = getElementPathString(selectedElement);

  removeHighlight();
  if (selectedElement) {
    selectedElement.classList.add('editor-highlight');
    highlightedElement = selectedElement;
  }

  if (attrToggle.checked) {
    populateAttributeInputs();
  }
}

function populateAttributeInputs() {
  if (!selectedElement) {
    attrInputs.forEach((input) => {
      input.value = '';
    });
    return;
  }
  attrInputs.forEach((input) => {
    const attr = input.dataset.attr;
    input.value = selectedElement.getAttribute(attr) || '';
  });
}

function pushHistory(entry) {
  historyStack.push(entry);
  redoStack.length = 0;
  setStatus('Change recorded');
  updateButtons();
}

function applyHistoryEntry(entry, direction) {
  if (!entry) {
    return;
  }
  const doc = preview.contentDocument;
  if (!doc) {
    return;
  }
  if (entry.type === 'text') {
    const node = getNodeByPath(doc, entry.path);
    if (node) {
      node.textContent = direction === 'undo' ? entry.from : entry.to;
      selectNode(node);
    }
  }
  if (entry.type === 'attr') {
    const element = getNodeByPath(doc, entry.path);
    if (element && element.nodeType === Node.ELEMENT_NODE) {
      const value = direction === 'undo' ? entry.from : entry.to;
      if (value === '' || value === null || value === undefined) {
        element.removeAttribute(entry.attr);
      } else {
        element.setAttribute(entry.attr, value);
      }
      selectNode(element.firstChild || element);
      if (attrToggle.checked) {
        populateAttributeInputs();
      }
    }
  }
}

function serializeDocument(doc) {
  const doctype = doc.doctype;
  let doctypeString = '';
  if (doctype) {
    doctypeString = `<!DOCTYPE ${doctype.name}`;
    if (doctype.publicId) {
      doctypeString += ` PUBLIC "${doctype.publicId}"`;
    } else if (doctype.systemId) {
      doctypeString += ' SYSTEM';
    }
    if (doctype.systemId) {
      doctypeString += ` "${doctype.systemId}"`;
    }
    doctypeString += '>';
  }
  return `${doctypeString}\n${doc.documentElement.outerHTML}`;
}

async function loadHtmlContent(content, name) {
  isLoading = true;
  originalContent = content;
  fileName = name;
  historyStack.length = 0;
  redoStack.length = 0;
  clearSelection();

  preview.srcdoc = content;
  preview.onload = () => {
    const doc = preview.contentDocument;
    if (!doc) {
      return;
    }
    injectEditorStyles(doc);
    doc.addEventListener('click', (event) => {
      const range = getCaretRangeFromPoint(doc, event.clientX, event.clientY);
      const node = findTextNodeFromRange(range);
      selectNode(node);
    }, true);
    isLoading = false;
    setStatus('Loaded');
    updateButtons();
  };
}

async function openFile() {
  if ('showOpenFilePicker' in window) {
    const [handle] = await window.showOpenFilePicker({
      types: [
        {
          description: 'HTML files',
          accept: { 'text/html': ['.html', '.htm'] }
        }
      ],
      excludeAcceptAllOption: true,
      multiple: false
    });
    if (!handle) {
      return;
    }
    fileHandle = handle;
    const file = await handle.getFile();
    fileName = file.name;
    const content = await file.text();
    loadHtmlContent(content, file.name);
  } else {
    fileInputFallback.value = '';
    fileInputFallback.click();
  }
}

async function saveFile() {
  if (!fileHandle) {
    return;
  }
  const doc = preview.contentDocument;
  if (!doc) {
    return;
  }
  cleanupEditorStyles(doc);
  const html = serializeDocument(doc);
  const writable = await fileHandle.createWritable();
  await writable.write(html);
  await writable.close();
  injectEditorStyles(doc);
  if (selectedElement) {
    selectedElement.classList.add('editor-highlight');
  }
  setStatus('Saved to disk');
}

function downloadFile() {
  const doc = preview.contentDocument;
  if (!doc) {
    return;
  }
  cleanupEditorStyles(doc);
  const html = serializeDocument(doc);
  injectEditorStyles(doc);
  if (selectedElement) {
    selectedElement.classList.add('editor-highlight');
  }
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName || 'edited.html';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus('Downloaded copy');
}

async function resetFile() {
  if (!fileHandle) {
    await loadHtmlContent(originalContent, fileName);
    return;
  }
  const file = await fileHandle.getFile();
  const content = await file.text();
  loadHtmlContent(content, file.name);
  setStatus('Reloaded from disk');
}

openFileBtn.addEventListener('click', () => {
  openFile().catch((error) => {
    console.error(error);
    setStatus('Open failed');
  });
});

saveBtn.addEventListener('click', () => {
  saveFile().catch((error) => {
    console.error(error);
    setStatus('Save failed');
  });
});

downloadBtn.addEventListener('click', () => {
  downloadFile();
});

resetBtn.addEventListener('click', () => {
  resetFile().catch((error) => {
    console.error(error);
    setStatus('Reload failed');
  });
});

undoBtn.addEventListener('click', () => {
  const entry = historyStack.pop();
  if (entry) {
    redoStack.push(entry);
    applyHistoryEntry(entry, 'undo');
    setStatus('Undo');
  }
  updateButtons();
});

redoBtn.addEventListener('click', () => {
  const entry = redoStack.pop();
  if (entry) {
    historyStack.push(entry);
    applyHistoryEntry(entry, 'redo');
    setStatus('Redo');
  }
  updateButtons();
});

selectedText.addEventListener('focus', () => {
  if (!selectedNode || isLoading) {
    return;
  }
  selectedText.dataset.startValue = selectedNode.textContent;
});

selectedText.addEventListener('input', () => {
  if (!selectedNode || isLoading) {
    return;
  }
  selectedNode.textContent = selectedText.value;
});

selectedText.addEventListener('blur', () => {
  if (!selectedNode || isLoading) {
    return;
  }
  const from = selectedText.dataset.startValue ?? '';
  const to = selectedNode.textContent;
  if (from !== to) {
    pushHistory({
      type: 'text',
      path: getNodePath(selectedNode, preview.contentDocument),
      from,
      to
    });
  }
  delete selectedText.dataset.startValue;
});

attrToggle.addEventListener('change', () => {
  attrSection.hidden = !attrToggle.checked;
  if (attrToggle.checked) {
    populateAttributeInputs();
  }
});

attrInputs.forEach((input) => {
  input.addEventListener('focus', () => {
    input.dataset.startValue = input.value;
  });

  input.addEventListener('input', () => {
    if (!selectedElement) {
      return;
    }
    const attr = input.dataset.attr;
    const value = input.value;
    if (value === '') {
      selectedElement.removeAttribute(attr);
    } else {
      selectedElement.setAttribute(attr, value);
    }
  });

  input.addEventListener('blur', () => {
    if (!selectedElement) {
      return;
    }
    const attr = input.dataset.attr;
    const from = input.dataset.startValue ?? '';
    const to = selectedElement.getAttribute(attr) || '';
    if (from !== to) {
      pushHistory({
        type: 'attr',
        path: getNodePath(selectedElement, preview.contentDocument),
        from,
        to,
        attr
      });
    }
    delete input.dataset.startValue;
  });
});

setStatus();
updateButtons();
