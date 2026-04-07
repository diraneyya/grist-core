import { makeT } from "app/client/lib/localization";
import { getHomeUrl, reportError } from "app/client/models/AppModel";
import {
  AdminPanelControls,
  buildConfirmedRow,
  cssHappyText,
  cssSectionButtonRow,
  cssSectionContainer,
  cssSectionDescription,
  cssValueLabel,
} from "app/client/ui/AdminPanelCss";
import { cssMockupButton, cssMockupRow, cssMockupSection } from "app/client/ui/MockupPanel";
import { basicButton, primaryButton } from "app/client/ui2018/buttons";
import { theme, vars } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { ConfigAPI, ServerConfig } from "app/common/ConfigAPI";

import { Computed, Disposable, dom, DomContents, DomElementArg, input, makeTestId,
  Observable, styled } from "grainjs";

const t = makeT("BaseUrlSection");
const testId = makeTestId("test-base-url-");

type UrlStatus = "loading" | "loaded" | "saving" | "saved" | "error";

interface BaseUrlSectionOptions {
  controls?: AdminPanelControls;
}

export class BaseUrlSection extends Disposable {
  /** Mock panel content: clear APP_HOME_URL via a direct API call. */
  public static buildMockButtons(): DomElementArg[] {
    const clear = async () => {
      await fetch("/api/config/server", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ APP_HOME_URL: null }),
      });
      window.location.reload();
    };
    return [
      cssMockupSection("Base URL"),
      cssMockupRow(
        cssMockupButton("Unset APP_HOME_URL", dom.on("click", () => { clear().catch(reportError); })),
      ),
    ];
  }

  /**
   * True when the URL has been confirmed (saved or skipped). Used by the wizard
   * to gate the Continue button.
   */
  public canProceed: Computed<boolean>;

  /** True when current state differs from what the server has. */
  public isDirty: Computed<boolean>;

  /** Base URL changes require a server restart to take effect safely. */
  public readonly needsRestart = true;

  private _detectedUrl = typeof window !== "undefined" ? window.location.origin : "";
  // What the server currently has. Updated on load and after each successful apply.
  private _serverUrl = Observable.create<string>(this, "");
  private _editedUrl = Observable.create<string>(this, "");
  private _isManuallySet = Observable.create<boolean>(this, false);
  private _status = Observable.create<UrlStatus>(this, "loading");
  private _error = Observable.create<string>(this, "");
  private _urlConfirmed = Observable.create<boolean>(this, false);
  private _urlSkipped = Observable.create<boolean>(this, false);
  private _testedUrlValue = "";  // The URL that was tested.
  private _isGrist = false;      // Whether the tested URL responded like Grist.
  private _testResult = Observable.create<"idle" | "testing" | "passed" | "failed">(this, "idle");
  private _testError = Observable.create<string>(this, "");

  private _configAPI = new ConfigAPI(getHomeUrl());

  constructor(_options: BaseUrlSectionOptions = {}) {
    super();

    this.canProceed = Computed.create(this, use => use(this._urlConfirmed));
    this.isDirty = Computed.create(this, (use) => {
      if (!use(this._urlConfirmed)) { return false; }
      // "Leave automatic": dirty only if the server currently has a
      // manually-set URL that needs clearing.
      if (use(this._urlSkipped)) { return use(this._isManuallySet); }
      const current = use(this._editedUrl).trim();
      if (!current) { return false; }
      if (current === use(this._serverUrl)) { return false; }
      return true;
    });

    // Reset test state only when URL changes from what was tested.
    this._editedUrl.addListener((url) => {
      if (this._testResult.get() === "passed" && url.trim() !== this._testedUrlValue) {
        this._testResult.set("idle");
        this._testError.set("");
      }
    });

    this._load().catch(reportError);
  }

  /**
   * Persist the confirmed URL to the server. Called by the wizard's
   * "Apply and Continue" handler. No-op if not dirty.
   */
  public async apply() {
    if (!this.isDirty.get()) { return; }
    if (this._urlSkipped.get()) {
      await this._clear();
    } else {
      await this._save();
    }
  }

  /** Call after all changes have been applied. Resets dirty state. */
  public markApplied() {
    if (this._urlSkipped.get()) {
      this._serverUrl.set("");
    } else {
      this._serverUrl.set(this._editedUrl.get().trim());
    }
  }

  public describeChange() {
    if (this._urlSkipped.get()) {
      return { label: t("Base URL"), value: t("automatic") };
    }
    return { label: t("Base URL"), value: this._editedUrl.get().trim() };
  }

  /**
   * Builds the status display for the admin panel collapsed view.
   */
  public buildStatusDisplay(): DomContents {
    return dom.domComputed(this._status, (status) => {
      if (status === "loading") {
        return cssValueLabel(t("checking"), testId("status"));
      }
      if (this._isManuallySet.get()) {
        return cssValueLabel(cssHappyText(t("set")), testId("status"));
      }
      return cssValueLabel(t("not set"), testId("status"));
    });
  }

  public buildDom(): DomContents { return this._buildSection({ allowSkip: false }); }
  public buildWizardDom(): DomContents { return this._buildSection({ allowSkip: true }); }

  /**
   * Shared Test URL → Confirm URL flow used by both the admin panel
   * and the wizard. In wizard mode, a "Leave automatic" button is shown
   * alongside confirm, which clears any manually-set URL on the server.
   */
  private _buildSection(opts: { allowSkip: boolean }): DomContents {
    return cssSectionContainer(
      this._buildCore(),
      buildConfirmedRow(this._urlConfirmed, () => {
        this._urlConfirmed.set(false);
        this._urlSkipped.set(false);
        this._testResult.set("idle");
      }, { skipped: this._urlSkipped, skippedLabel: t("Automatic"), testPrefix: "base-url" }),
      dom.maybe(use => !use(this._urlConfirmed), () => [
        dom.domComputed(this._testResult, result => this._buildTestStatus(result)),
        cssSectionButtonRow(
          // Show "Test URL" until a successful test; then show "Confirm URL".
          dom.domComputed(this._testResult, (result) => {
            if (result !== "passed") {
              return primaryButton(
                t("Test URL"),
                dom.on("click", () => this._testUrl()),
                dom.boolAttr("disabled", use =>
                  use(this._editedUrl).trim() === "" || use(this._testResult) === "testing",
                ),
                testId("test"),
              );
            }
            return primaryButton(
              t("Confirm URL"),
              dom.on("click", () => this._urlConfirmed.set(true)),
              testId("save"),
            );
          }),
          opts.allowSkip ? basicButton(
            t("Leave automatic"),
            dom.on("click", () => {
              this._urlSkipped.set(true);
              this._urlConfirmed.set(true);
            }),
            testId("skip"),
          ) : null,
        ),
      ]),
      testId("section"),
    );
  }

  private _buildCore(): DomContents {
    return [
      cssSectionDescription(
        t("The URL where users and integrations reach this Grist server. " +
          "Auth callbacks, API links, and email notifications all depend on this being correct."),
      ),
      cssUrlRow(
        cssUrlInput(
          this._editedUrl,
          { onInput: true },
          { placeholder: t("https://grist.example.com") },
          // Lock the input once the user has confirmed (until they click
          // the edit pencil).
          dom.boolAttr("disabled", use =>
            use(this._status) === "saving" || use(this._urlConfirmed),
          ),
          testId("input"),
        ),
      ),
      // Tell the user what relationship the current input has to reality:
      // already matches what the server has, or an auto-detected hint.
      dom.domComputed((use) => {
        if (use(this._status) !== "loaded") { return null; }
        const current = use(this._editedUrl).trim();
        if (!current) { return null; }
        if (current === use(this._serverUrl)) {
          return cssSavedMsg(
            icon("Tick"),
            t("Already set on this server."),
            testId("current-hint"),
          );
        }
        if (!use(this._isManuallySet) && current === this._detectedUrl) {
          return cssWarning(
            icon("Warning"),
            t("This URL was auto-detected — confirm it is correct, then save."),
            testId("not-saved-warning"),
          );
        }
        return null;
      }),
      dom.maybe(
        use => use(this._status) === "error",
        () => cssErrorMsg(
          dom.text(this._error),
          testId("error"),
        ),
      ),
    ];
  }

  private _buildTestStatus(result: "idle" | "testing" | "passed" | "failed"): DomContents {
    if (result === "testing") {
      return cssHint(t("Testing..."), testId("test-status"));
    }
    if (result === "passed") {
      return cssSavedMsg(
        icon("Tick"),
        this._isGrist ? t("Grist is reachable") : t("URL is reachable"),
        testId("test-status"),
      );
    }
    if (result === "failed") {
      const showDetail = Observable.create(null, false);
      return cssErrorMsg(
        dom("div",
          t("Could not reach server at this URL. "),
          dom("a",
            dom.style("cursor", "pointer"),
            dom.text(use => use(showDetail) ? "\u25BC" : "\u25B6"),
            dom.on("click", () => showDetail.set(!showDetail.get())),
          ),
        ),
        dom.maybe(showDetail, () =>
          dom("div", dom.style("margin-top", "4px"), this._testError.get()),
        ),
        testId("test-status"),
      );
    }
    return null;
  }

  private async _testUrl() {
    const url = this._editedUrl.get().trim();
    if (!url) { return; }
    this._testResult.set("testing");
    this._testError.set("");
    this._testedUrlValue = url;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const statusUrl = new URL("status", url.endsWith("/") ? url : url + "/").href;
      const resp = await fetch(statusUrl, { signal: controller.signal });
      if (!resp.ok) { throw new Error(`${resp.status} ${resp.statusText}`); }
      const body = await resp.text();
      if (this.isDisposed()) { return; }
      this._isGrist = /grist/i.test(body);
      this._testResult.set("passed");
    } catch (err) {
      if (this.isDisposed()) { return; }
      this._testError.set((err as Error).message || t("Could not reach server"));
      this._testResult.set("failed");
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async _load() {
    try {
      const config: ServerConfig = await this._configAPI.getServerConfig();
      if (this.isDisposed()) { return; }
      this._serverUrl.set(config.APP_HOME_URL || "");
      this._editedUrl.set(config.APP_HOME_URL || this._detectedUrl);
      this._isManuallySet.set(config.isManuallySet);
      this._status.set("loaded");
    } catch (err) {
      // Silently continue on error (endpoint may not exist during early startup).
      if (this.isDisposed()) { return; }
      this._editedUrl.set(this._detectedUrl);
      this._status.set("loaded");
    }
  }

  private async _clear() {
    this._status.set("saving");
    this._error.set("");
    try {
      await this._configAPI.saveServerConfig({ APP_HOME_URL: null });
      if (this.isDisposed()) { return; }
      this._serverUrl.set("");
      this._isManuallySet.set(false);
      this._editedUrl.set(this._detectedUrl);
      this._status.set("loaded");
    } catch (err) {
      if (this.isDisposed()) { return; }
      this._error.set((err as Error).message || t("Failed to save"));
      this._status.set("error");
      throw err;
    }
  }

  private async _save() {
    const url = this._editedUrl.get().trim();
    if (!url) { return; }

    this._status.set("saving");
    this._error.set("");
    try {
      await this._configAPI.saveServerConfig({ APP_HOME_URL: url });
      if (this.isDisposed()) { return; }
      this._serverUrl.set(url);
      this._isManuallySet.set(true);
      this._status.set("loaded");
    } catch (err) {
      if (this.isDisposed()) { return; }
      this._error.set((err as Error).message || t("Failed to save"));
      this._status.set("error");
      throw err;
    }
  }
}

const cssUrlRow = styled("div", `
  display: flex;
  gap: 8px;
`);

const cssUrlInput = styled(input, `
  color: ${theme.inputFg};
  background-color: ${theme.inputBg};
  font-size: ${vars.mediumFontSize};
  height: 42px;
  line-height: 16px;
  width: 100%;
  padding: 13px;
  border: 1px solid ${theme.inputBorder};
  border-radius: 3px;
  outline: none;

  &::placeholder {
    color: ${theme.inputPlaceholderFg};
  }
`);

const cssHint = styled("div", `
  display: flex;
  align-items: center;
  gap: 4px;
  color: ${theme.lightText};
  font-size: ${vars.smallFontSize};
`);

const cssWarning = styled("div", `
  display: flex;
  align-items: center;
  gap: 4px;
  color: ${theme.controlFg};
  font-size: ${vars.smallFontSize};
`);

const cssErrorMsg = styled("div", `
  color: ${theme.errorText};
  font-size: ${vars.smallFontSize};
`);

const cssSavedMsg = styled("div", `
  display: flex;
  align-items: center;
  gap: 4px;
  color: ${theme.controlPrimaryBg};
  font-size: ${vars.smallFontSize};
`);
