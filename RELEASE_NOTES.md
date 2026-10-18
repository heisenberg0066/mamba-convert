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
