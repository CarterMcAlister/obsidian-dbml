import { App, Modal, Setting } from "obsidian";

export interface ConfirmModalOptions {
  title: string;
  message: string;
  confirmText: string;
  cancelText?: string;
}

export function confirmWithModal(app: App, options: ConfirmModalOptions): Promise<boolean> {
  return new Promise((resolve) => new ConfirmModal(app, options, resolve).open());
}

class ConfirmModal extends Modal {
  private resolved = false;

  constructor(app: App, private options: ConfirmModalOptions, private resolveConfirm: (confirmed: boolean) => void) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.options.title);
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: this.options.message });

    new Setting(this.contentEl)
      .addButton((button) => button
        .setButtonText(this.options.confirmText)
        .setCta()
        .onClick(() => this.submit(true)))
      .addButton((button) => button
        .setButtonText(this.options.cancelText || "Cancel")
        .onClick(() => this.submit(false)));
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) this.resolveConfirm(false);
  }

  private submit(confirmed: boolean): void {
    this.resolved = true;
    this.resolveConfirm(confirmed);
    this.close();
  }
}
