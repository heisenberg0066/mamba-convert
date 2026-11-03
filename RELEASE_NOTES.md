**Mamba Convert 1.4.0: page organiser for Merge and Split**

* **New: organise pages when merging.** After adding PDFs (or images) to **Merge PDFs**, every page appears in a thumbnail grid, colour- and letter-coded by file (A·1, B·3 …).
  * Drag and drop pages to reorder them, inside a file or across files.
  * Reorder whole files: drag a file chip onto another, or use ↑ / ↓.
  * Delete, rotate (90° steps) or duplicate pages.
  * Insert another PDF or image at any position with **Insert file…**, or drop it on the grid where it should go.
  * Select several pages with Shift or Ctrl and move them together.
  * The merged PDF has exactly that order; you can name the output file.
* **New: build split outputs visually.** **Split PDF** shows the PDF's pages so you can put them into **groups** (Group 1, 2, 3 …, each with its own colour). Each group becomes one PDF.
  * Select pages (click, Shift+click, Ctrl+click) and press 1–9 or a group button.
  * Drag pages between groups, or reorder them inside a group.
  * Name each output file.
  * Quick groups: every page, every N pages, ranges such as `1-3, 5, 8-10`, and by bookmarks when the PDF has them.
  * Pages that are not in any group are not saved; the preview tells you how many.
* **Preview & save:** before anything is written you see each output's name, page count, page list and thumbnails.
* **Undo / redo** for every organiser action, and keyboard control: Delete, Ctrl+Z, Ctrl+Y, Ctrl+A, arrows (Shift extends the selection, Ctrl moves the selected pages), R to rotate, Ctrl+D to duplicate.
* **Fast with big PDFs:** thumbnails are rendered by MuPDF only when they scroll into view, and recently used documents stay open.
* Works in English and Arabic (RTL). Existing files are still never overwritten.
* **Tests:** unit tests for ordering, grouping, presets and output naming; real PDF checks of page order, rotation and page count for merge and split; a UI test that drives the organiser in the app window (click / Shift / Ctrl selection, drag and drop, keyboard, undo/redo, presets, saving through the queue). It runs in CI on the packaged Windows app.
* CI now checks the Convert → Reader handoff (open and Edit PDF) against **Mamba Reader 1.2.0**.

---

**Mamba Convert 1.3.0: Edit PDF**

* **New: Edit PDF.** It opens a PDF in Mamba Reader's visual editor, which needs Reader 1.1.0 or later. There you can:
  * edit and delete text, add text boxes;
  * move, resize, replace and insert images;
  * whiteout and redact;
  * sign (draw, type or import), add initials and date stamps;
  * fill form fields;
  * add, delete, reorder, rotate and merge pages;
  * undo/redo.

  Saving writes a new `<name> (edited).pdf`.
* **Where to find it:**
  * In the right-click wheel, under **PDF tools → Edit PDF**, when one PDF is selected.
  * In the **Tools** tab, as the **Edit PDF** card.
* **How it opens Reader:** Convert starts `Mamba Reader.exe --edit <file>`, falling back to `mamba-reader://edit?path=…`. The command line `Mamba Convert.exe --edit-in-reader <file>` does the same.
* **Includes everything from 1.2.1**, the wheel flicker fix (notes below).

---

**Mamba Convert 1.2.1: wheel flicker fix**

Fixed: the right-click wheel flickered, rapidly appearing and disappearing, once the mouse rested on it.

* **Cause:** each hover redrew the whole wheel and restarted its pop-in animation, which fades in from fully transparent. Redrawing put new elements under the still cursor, and the browser engine treated that as a fresh hover. The result was about 20 redraws a second, each starting the fade again.
* **Fix:**
  * Hovering the slice that is already selected no longer redraws anything.
  * The pop-in animation plays only when a ring first appears.
* **Window behaviour hardened at the same time:**
  * Showing the wheel never hides and re-shows it; it only updates it in place.
  * Files from later Explorer launches (one process per selected file) are merged into the open wheel.
  * Clicking away closes the wheel only after it has really gained focus and 300 ms have passed. Until then it takes focus back instead of hiding.
  * It stays on top at the highest level.
* **New diagnostic log:** `%APPDATA%\Mamba Convert\logs\wheel.log` records every launch, show, update, focus, blur and hide, with the reason.
* **Tests:**
  * A new regression test checks that a resting cursor causes no redraws.
  * A new Windows CI probe launches the real Explorer command for 1 and 3 files, both cold and with the tray helper running. It rests the real mouse cursor on a slice and samples the wheel's visibility and on-screen colour every 50 ms for 6 s.

The builds are not code-signed. If SmartScreen warns you, click **More info → Run anyway**.
