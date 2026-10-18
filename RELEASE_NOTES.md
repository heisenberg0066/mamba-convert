**Mamba Convert 1.2.0: the Explorer wheel**

* **Right-click → Mamba Convert** on any supported file, multi-selection or folder opens a radial pie menu at your mouse.
  * The inner ring holds the categories that fit your files: Convert, Compress, Edit/Studio, Flipbook, PDF tools, Audio/Video, Strip metadata and Mamba Reader.
  * The outer rings hold the options, e.g. Convert → PNG/WebP/PDF…, Compress → Low/Medium/Strong, Edit → Resize → 50 %/1920 px…
* It has smooth animations, works with the keyboard (← → Enter Backspace 1–9 Esc) and supports English and Arabic.
* Jobs run in the background with a small progress toast that has **Show in folder** and **Open** buttons.
* **Ctrl+Alt+M** opens the wheel for the files selected in File Explorer. This uses the tray helper, which starts with Windows and can be switched off in the tray menu.
* An optional **floating bubble** stays on top; drop files on it to get the same wheel.
* Single-instance: Explorer multi-selections are merged into one wheel.
* `--open-in-reader <file>` hands a file to Mamba Reader from the command line.
* The installer adds per-user registry entries for 72 file types and folders. The uninstaller removes all of them, including the start-up entry.
* The flipbook engine is updated to the shared Mamba Reader v2 engine.

The build was verified on `windows-latest`:
* engine and wheel-model tests;
* packaged smoke test and wheel UI test;
* silent install with the registry checked;
* Explorer command line for a single file, a 3-file multi-select and a folder;
* Convert → Mamba Reader handoff;
* uninstall cleanup.

The builds are not code-signed. If SmartScreen warns you, click **More info → Run anyway**.
