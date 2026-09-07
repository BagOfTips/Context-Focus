const { Notice, Plugin, PluginSettingTab, Setting, setIcon } = require("obsidian");

const VIEW_SELECTOR = ".markdown-preview-view, .markdown-source-view.mod-cm6";
const LIST_SELECTOR = "ul, ol";
const FOCUSED_LIST_CLASS = "context-focus-list";
const PATH_CLASS = "context-focus-path";
const EDITOR_LINE_SELECTOR = ".cm-line.HyperMD-list-line";
const EDITOR_SCOPE_CLASS = "context-focus-editor-item";
const PARAGRAPH_SCOPE_CLASS = "context-focus-paragraph";
const ACTIVE_PARAGRAPH_CLASS = "context-focus-paragraph-active";
const PAGE_SCOPE_CLASS = "context-focus-page-item";
const ACTIVE_PAGE_CLASS = "context-focus-page-active";
const TIMING_PROPERTY = "--context-focus-duration";
const DEFAULT_SETTINGS = {
  focusEnabled: true,
  focusBuffer: 150,
  fadeDuration: 250,
  focusLists: true,
  focusParagraphs: true,
  focusEditing: false,
  fadeScope: "connected",
};

module.exports = class ContextFocusPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.applySettings();
    this.addSettingTab(new ContextFocusSettingTab(this.app, this));

    this.activeContainer = null;
    this.activeItems = [];
    this.clearTimer = null;

    this.ribbonIconEl = this.addRibbonIcon("eye", "Toggle Context Focus", () => {
      this.toggleFocusEnabled();
    });
    this.ribbonIconEl.addClass("context-focus-ribbon");
    this.updateToggleUi();

    this.addCommand({
      id: "toggle-focus-effects",
      name: "Toggle focus effects",
      callback: () => this.toggleFocusEnabled(),
    });

    this.registerDomEvent(document, "pointerover", (event) => {
      const target = this.getFocusTarget(event.target);
      if (!target) {
        this.queueClear();
        return;
      }

      this.cancelClear();
      const previousTarget = this.getFocusTarget(event.relatedTarget);
      if (previousTarget?.element === target.element) return;
      if (target.type === "list") this.focusItem(target.element);
      else this.focusParagraph(target.element, target.editor);
    });

    this.registerDomEvent(document, "pointerout", (event) => {
      if (!this.activeContainer) return;
      const destination = event.relatedTarget;
      if (destination instanceof Element && this.activeContainer.contains(destination)) return;
      this.queueClear();
    });

    this.registerDomEvent(window, "blur", () => this.clearFocus());
  }

  onunload() {
    this.clearFocus();
    document.body.style.removeProperty(TIMING_PROPERTY);
  }

  applySettings() {
    document.body.style.setProperty(TIMING_PROPERTY, `${this.settings.fadeDuration}ms`);
  }

  async updateFadeDuration(duration) {
    this.settings.fadeDuration = duration;
    this.applySettings();
    await this.saveData(this.settings);
  }

  async updateFocusBuffer(duration) {
    this.settings.focusBuffer = duration;
    await this.saveData(this.settings);
  }

  async toggleFocusEnabled() {
    this.settings.focusEnabled = !this.settings.focusEnabled;
    if (!this.settings.focusEnabled) this.clearFocus();
    this.updateToggleUi();
    await this.saveData(this.settings);
    new Notice(`Context Focus ${this.settings.focusEnabled ? "enabled" : "disabled"}`);
  }

  updateToggleUi() {
    if (this.ribbonIconEl) {
      setIcon(this.ribbonIconEl, this.settings.focusEnabled ? "eye" : "eye-off");
    }
    this.ribbonIconEl?.toggleClass("is-active", this.settings.focusEnabled);
    this.ribbonIconEl?.setAttribute("aria-pressed", String(this.settings.focusEnabled));
  }

  queueClear() {
    this.cancelClear();
    if (!this.activeContainer) return;
    if (this.settings.focusBuffer <= 0) {
      this.clearFocus();
      return;
    }
    this.clearTimer = window.setTimeout(() => {
      this.clearTimer = null;
      this.clearFocus();
    }, this.settings.focusBuffer);
  }

  cancelClear() {
    window.clearTimeout(this.clearTimer);
    this.clearTimer = null;
  }

  async updateParagraphFocus(enabled) {
    this.settings.focusParagraphs = enabled;
    if (!enabled) this.clearFocus();
    await this.saveData(this.settings);
  }

  async updateListFocus(enabled) {
    this.settings.focusLists = enabled;
    if (!enabled) this.clearFocus();
    await this.saveData(this.settings);
  }

  async updateFadeScope(scope) {
    this.settings.fadeScope = scope;
    this.clearFocus();
    await this.saveData(this.settings);
  }

  async updateEditingFocus(enabled) {
    this.settings.focusEditing = enabled;
    if (!enabled) this.clearFocus();
    await this.saveData(this.settings);
  }

  getFocusTarget(target) {
    if (!this.settings.focusEnabled) return null;
    if (!(target instanceof Element)) return null;
    const view = target.closest(VIEW_SELECTOR);
    if (!view) return null;
    if (view.matches(".markdown-source-view.mod-cm6") && !this.settings.focusEditing) {
      return null;
    }

    if (this.settings.focusLists) {
      const listItem = this.getListItem(target);
      if (listItem) return { type: "list", element: listItem };
    }
    if (!this.settings.focusParagraphs) return null;

    const paragraph = this.getParagraph(target);
    return paragraph
      ? { type: "paragraph", element: paragraph.element, editor: paragraph.editor }
      : null;
  }

  getListItem(target) {
    if (!(target instanceof Element)) return null;
    const item = target.closest(`li, ${EDITOR_LINE_SELECTOR}`);
    if (!item || !item.closest(VIEW_SELECTOR)) return null;
    if (item.matches(EDITOR_LINE_SELECTOR)) return item;
    return item.closest(LIST_SELECTOR) ? item : null;
  }

  getParagraph(target) {
    if (!(target instanceof Element)) return null;
    const view = target.closest(VIEW_SELECTOR);
    if (!view) return null;

    if (view.matches(".markdown-preview-view")) {
      const block = target.closest(".el-p");
      if (block?.querySelector(":scope > p")) return { element: block, editor: false };
      return null;
    }

    const line = target.closest(".cm-line");
    if (!line || line.textContent.trim() === "") return null;
    const isMarkdownStructure = Array.from(line.classList)
      .some((className) => className.startsWith("HyperMD-"));
    return isMarkdownStructure ? null : { element: line, editor: true };
  }

  focusItem(item) {
    if (item.matches(EDITOR_LINE_SELECTOR)) {
      this.focusEditorLine(item);
      return;
    }

    const list = this.getRootList(item);
    if (!list) return;

    this.clearFocus();
    this.activeContainer = list;
    list.classList.add(FOCUSED_LIST_CLASS);
    this.activeItems.push(list);

    let current = item;
    while (current && list.contains(current)) {
      current.classList.add(PATH_CLASS);
      this.activeItems.push(current);

      const parentList = current.parentElement?.closest(LIST_SELECTOR);
      current = parentList?.parentElement?.closest("li") || null;
    }

    if (this.settings.fadeScope === "page") {
      this.applyPageScope(item, this.activeItems);
    }
  }

  focusEditorLine(item) {
    this.clearFocus();

    const siblings = Array.from(item.parentElement?.children || []);
    const itemIndex = siblings.indexOf(item);
    if (itemIndex < 0) return;

    let start = itemIndex;
    let end = itemIndex;
    while (start > 0 && siblings[start - 1].matches(EDITOR_LINE_SELECTOR)) start--;
    while (end + 1 < siblings.length && siblings[end + 1].matches(EDITOR_LINE_SELECTOR)) end++;

    const scope = siblings.slice(start, end + 1);
    scope.forEach((line) => line.classList.add(EDITOR_SCOPE_CLASS));

    const path = [item];
    let neededDepth = this.getEditorListDepth(item) - 1;
    for (let index = itemIndex - 1; index >= start && neededDepth > 0; index--) {
      const candidate = siblings[index];
      const depth = this.getEditorListDepth(candidate);
      if (depth === neededDepth) {
        path.push(candidate);
        neededDepth--;
      }
    }

    path.forEach((line) => line.classList.add(PATH_CLASS));
    this.activeContainer = item.parentElement;
    this.activeItems = [...scope, ...path];

    if (this.settings.fadeScope === "page") {
      this.applyPageScope(item, path);
    }
  }

  focusParagraph(paragraph, editor) {
    this.clearFocus();

    const siblings = Array.from(paragraph.parentElement?.children || []);
    const paragraphIndex = siblings.indexOf(paragraph);
    if (paragraphIndex < 0) return;

    if (this.settings.fadeScope === "page") {
      this.applyPageScope(paragraph, [paragraph]);
      return;
    }

    let start = paragraphIndex;
    let end = paragraphIndex;
    while (start > 0 && !this.isHeadingBlock(siblings[start - 1], editor)) start--;
    while (end + 1 < siblings.length && !this.isHeadingBlock(siblings[end + 1], editor)) end++;

    const scope = siblings
      .slice(start, end + 1)
      .filter((element) => this.isParagraphBlock(element, editor));
    if (scope.length < 2) return;

    scope.forEach((element) => element.classList.add(PARAGRAPH_SCOPE_CLASS));
    paragraph.classList.add(ACTIVE_PARAGRAPH_CLASS);
    this.activeContainer = paragraph.parentElement;
    this.activeItems = scope;
  }

  applyPageScope(focusedElement, activeElements) {
    const view = focusedElement.closest(VIEW_SELECTOR);
    if (!view) return;

    let scope;
    let active;
    if (view.matches(".markdown-preview-view")) {
      const container = focusedElement.closest(".markdown-preview-sizer");
      const activeBlock = this.getDirectChild(focusedElement, container);
      if (!container || !activeBlock) return;
      scope = Array.from(container.children);
      active = [activeBlock];
    } else {
      const container = focusedElement.parentElement;
      if (!container) return;
      scope = Array.from(container.children);
      active = activeElements;
    }

    scope.forEach((element) => element.classList.add(PAGE_SCOPE_CLASS));
    active.forEach((element) => element.classList.add(ACTIVE_PAGE_CLASS));
    this.activeContainer = view;
    this.activeItems = [...new Set([...this.activeItems, ...scope, ...active])];
  }

  getDirectChild(element, container) {
    if (!container) return null;
    let current = element;
    while (current?.parentElement && current.parentElement !== container) {
      current = current.parentElement;
    }
    return current?.parentElement === container ? current : null;
  }

  isHeadingBlock(element, editor) {
    return editor
      ? element.matches(".cm-line.HyperMD-header")
      : element.matches(".el-h1, .el-h2, .el-h3, .el-h4, .el-h5, .el-h6");
  }

  isParagraphBlock(element, editor) {
    if (editor) {
      return element.matches(".cm-line")
        && element.textContent.trim() !== ""
        && !Array.from(element.classList).some((className) => className.startsWith("HyperMD-"));
    }
    return element.matches(".el-p") && Boolean(element.querySelector(":scope > p"));
  }

  getEditorListDepth(line) {
    for (const className of line.classList) {
      const match = className.match(/^HyperMD-list-line-(\d+)$/);
      if (match) return Number(match[1]);
    }
    return 1;
  }

  getRootList(item) {
    let list = item.closest(LIST_SELECTOR);
    if (!list) return null;

    while (true) {
      const parentItem = list.parentElement?.closest("li");
      const parentList = parentItem?.closest(LIST_SELECTOR);
      if (!parentList) return list;
      list = parentList;
    }
  }

  clearFocus() {
    this.cancelClear();
    this.activeContainer?.classList.remove(FOCUSED_LIST_CLASS);
    this.activeItems.forEach((item) => {
      item.classList.remove(FOCUSED_LIST_CLASS);
      item.classList.remove(PATH_CLASS);
      item.classList.remove(EDITOR_SCOPE_CLASS);
      item.classList.remove(PARAGRAPH_SCOPE_CLASS);
      item.classList.remove(ACTIVE_PARAGRAPH_CLASS);
      item.classList.remove(PAGE_SCOPE_CLASS);
      item.classList.remove(ACTIVE_PAGE_CLASS);
    });
    this.activeContainer = null;
    this.activeItems = [];
  }
};

class ContextFocusSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Focus targets")
      .setHeading();

    new Setting(containerEl)
      .setName("Focus lists")
      .setDesc("Keep the hovered list item and its connected parent branch clear.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.focusLists)
          .onChange(async (value) => {
            await this.plugin.updateListFocus(value);
          })
      );

    new Setting(containerEl)
      .setName("Focus paragraphs")
      .setDesc("Dim other paragraphs in the same heading section when hovering a paragraph.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.focusParagraphs)
          .onChange(async (value) => {
            await this.plugin.updateParagraphFocus(value);
          })
      );

    new Setting(containerEl)
      .setName("Focus in editing mode")
      .setDesc("Enable focus effects in Live Preview and Source mode. Disabled by default.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.focusEditing)
          .onChange(async (value) => {
            await this.plugin.updateEditingFocus(value);
          })
      );

    new Setting(containerEl)
      .setName("Fade behaviour")
      .setHeading();

    new Setting(containerEl)
      .setName("Fade scope")
      .setDesc("Choose whether to dim connected content only or everything else in the note.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("connected", "Connected content")
          .addOption("page", "Entire note")
          .setValue(this.plugin.settings.fadeScope)
          .onChange(async (value) => {
            await this.plugin.updateFadeScope(value);
          })
      );

    new Setting(containerEl)
      .setName("Focus buffer")
      .setDesc("Wait briefly before clearing focus so moving between items does not flash.")
      .addSlider((slider) =>
        slider
          .setLimits(0, 500, 25)
          .setValue(this.plugin.settings.focusBuffer)
          .setDynamicTooltip()
          .onChange(async (value) => {
            await this.plugin.updateFocusBuffer(value);
          })
      );

    new Setting(containerEl)
      .setName("Fade duration")
      .setDesc("How long the focus fade takes in milliseconds.")
      .addSlider((slider) =>
        slider
          .setLimits(0, 1000, 25)
          .setValue(this.plugin.settings.fadeDuration)
          .setDynamicTooltip()
          .onChange(async (value) => {
            await this.plugin.updateFadeDuration(value);
          })
      );
  }
}
