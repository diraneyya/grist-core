/**
 * Accumulates pending configuration changes from multiple sections,
 * then applies them together. Used by both the setup wizard and the
 * admin panel to batch saves and minimize restarts.
 *
 * Each section registers itself via `addSection()`. The manager
 * tracks aggregate dirty state and provides `applyAll()` to persist
 * everything, restart if needed, and reset dirty tracking.
 */
import { getHomeUrl } from "app/client/models/AppModel";
import { ConfigAPI } from "app/common/ConfigAPI";

import { Computed, Disposable, Observable } from "grainjs";

/**
 * Interface that each configurable section must implement to
 * participate in the pending-changes lifecycle.
 */
/**
 * A human-readable description of a pending change. The `label` is
 * translated (e.g. "Base URL"); the `value` is a literal (e.g. a URL)
 * that shouldn't pass through the translation pipeline.
 */
export interface PendingChangeDescription {
  label: string;
  value: string;
}

export interface ConfigSection {
  /** True when the section's confirmed state differs from the server. */
  isDirty: Computed<boolean>;
  /** True when the section's changes require a server restart. */
  needsRestart?: boolean;
  /** Persist this section's changes to the server. No-op if not dirty. */
  apply(): Promise<void>;
  /** Update internal tracking so isDirty becomes false. */
  markApplied(): void;
  /**
   * Describe the pending change for display in the restart banner.
   * Only called when isDirty is true.
   */
  describeChange?(): PendingChangeDescription;
}

export class PendingChangesManager extends Disposable {
  /** True when any registered section has pending changes. */
  public readonly hasPendingChanges: Observable<boolean> = Observable.create(this, false);

  /** True when any pending change requires a server restart. */
  public readonly needsRestart: Observable<boolean> = Observable.create(this, false);

  private _sections: ConfigSection[] = [];
  private _configAPI = new ConfigAPI(getHomeUrl());
  // Tracks whether an apply is in progress.
  private _applying = Observable.create<boolean>(this, false);

  /**
   * Register a section to be tracked. Subscribes to its isDirty observable
   * and updates aggregate flags whenever it changes.
   */
  public addSection(section: ConfigSection) {
    this._sections.push(section);
    this.autoDispose(section.isDirty.addListener(() => this._recompute()));
    this._recompute();
  }

  /** True while applyAll is in progress. */
  public get isApplying() { return this._applying; }

  /**
   * Apply all pending changes: persist each dirty section,
   * restart the server if any section requires it, then mark
   * everything as applied.
   */
  public async applyAll(): Promise<void> {
    await this._apply({ restart: true });
  }

  /**
   * Persist all pending changes to the server but do not restart.
   * Use this when the server is running in an environment that
   * doesn't support automatic restarts — the user will restart
   * manually to pick up the changes.
   */
  public async applyWithoutRestart(): Promise<void> {
    await this._apply({ restart: false });
  }

  /** Descriptions of current pending changes for display in the banner. */
  public describeChanges(): PendingChangeDescription[] {
    const out: PendingChangeDescription[] = [];
    for (const section of this._sections) {
      if (section.isDirty.get() && section.describeChange) {
        out.push(section.describeChange());
      }
    }
    return out;
  }

  private async _apply({ restart }: { restart: boolean }): Promise<void> {
    if (this._applying.get()) { return; }
    this._applying.set(true);
    try {
      await Promise.all(
        this._sections
          .filter(s => s.isDirty.get())
          .map(s => s.apply()),
      );

      if (restart && this.needsRestart.get()) {
        await this._configAPI.restartServer();
        await this._waitForServer();
      }

      for (const section of this._sections) {
        section.markApplied();
      }
      this._recompute();
    } finally {
      this._applying.set(false);
    }
  }

  private _recompute() {
    this.hasPendingChanges.set(this._sections.some(s => s.isDirty.get()));
    this.needsRestart.set(this._sections.some(s => s.needsRestart === true && s.isDirty.get()));
  }

  private async _waitForServer() {
    for (let i = 0; i < 30; i++) {
      try {
        await this._configAPI.healthcheck();
        return;
      } catch {
        await new Promise(res => setTimeout(res, 1000));
      }
    }
    throw new Error("Timed out waiting for Grist server to restart");
  }
}
