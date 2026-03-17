# Chenflix WYSIWYG Editor

This editor is designed to let you update **text content only** by default so the HTML structure, semantics, and CSS stay intact. Attribute edits are optional and only occur when you explicitly enable them.

## How to use

1. Start a simple local server from the repo root:
   ```bash
   python3 -m http.server
   ```
2. Open `http://localhost:8000/editor/index.html` in Chrome, Edge, or another Chromium browser.
3. Click **Open HTML** and select the page you want to edit.
4. Click text in the preview to edit it in the right panel.
5. Click **Save** to write changes back to the file, or **Download** to save a copy.

## Design guarantees

- No tag restructuring or class/style changes when editing text.
- No inline styles or wrapper elements are injected.
- Attribute edits are opt-in and limited to safe attributes.

If you need structural changes, do those separately in your editor and re-open the file here for text updates.
