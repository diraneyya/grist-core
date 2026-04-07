import { makeT } from "app/client/lib/localization";
import { getHomeUrl } from "app/client/models/AppModel";
import { Notifier } from "app/client/models/NotifyModel";
import { showEnterpriseToggle } from "app/client/ui/ActivationPage";
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
import { getMockOverride, setMockOverride } from "app/client/ui/MockupState";
import { ToggleEnterpriseWidget } from "app/client/ui/ToggleEnterpriseWidget";
import { primaryButton } from "app/client/ui2018/buttons";
import { labeledSquareCheckbox } from "app/client/ui2018/checkbox";
import { cssLink } from "app/client/ui2018/links";
import { unstyledButton } from "app/client/ui2018/unstyled";
import { ConfigAPI } from "app/common/ConfigAPI";
import { commonUrls } from "app/common/gristUrls";
import { tokens } from "app/common/ThemePrefs";
import { getGristConfig } from "app/common/urlUtils";

import { Computed, Disposable, dom, DomContents, DomElementArg, makeTestId, Observable, styled } from "grainjs";

const t = makeT("EditionSection");
const testId = makeTestId("test-edition-");

type Edition = "enterprise" | "core";

interface EditionSectionOptions {
  controls?: AdminPanelControls;
  notifier?: Notifier;
}

export class EditionSection extends Disposable {
  /**
   * Short description shown next to the item name in the admin panel
   * collapsed row. Exposed so stubs (e.g. the legacy "Enterprise" item)
   * can use the same wording without duplication.
   */
  public static description(): string {
    return t("Choose which edition of Grist to run on this server");
  }

  /** Mock panel content for edition availability. */
  public static buildMockButtons(): DomElementArg[] {
    return [
      cssMockupSection("Edition availability"),
      cssMockupRow(
        cssMockupButton("Only community available",
          dom.on("click", () => setMockOverride("fullGristAvailable", "community-only"))),
        cssMockupButton("Full and community available",
          dom.on("click", () => setMockOverride("fullGristAvailable", "full-and-community"))),
        cssMockupButton("Only full available",
          dom.on("click", () => setMockOverride("fullGristAvailable", "full-only"))),
        cssMockupButton("No override",
          dom.on("click", () => setMockOverride("fullGristAvailable", undefined))),
      ),
    ];
  }

  /**
   * True when edition has been confirmed (selected or skipped). Used by the wizard
   * to gate the Continue button.
   */
  public canProceed: Computed<boolean>;

  /** True when the confirmed edition differs from what the server is running. */
  public isDirty: Computed<boolean>;

  public readonly fullGristAvailable: boolean;
  public readonly communityAvailable: boolean;
  public readonly editionForced: boolean;
  /** True — edition changes require a server restart. */
  public readonly needsRestart = true;

  // The user's wizard selection. Null until _buildSelector runs.
  private _selectedEdition = Observable.create<Edition | null>(this, null);
  // What the server is currently running. Updated after apply.
  private _serverEdition = Observable.create<Edition>(this, "core");
  // In admin panel mode (controls provided), edition is already confirmed.
  private _editionConfirmed = Observable.create<boolean>(this, !!this._options.controls);

  // Enterprise lifecycle widget — only created in admin panel mode (when notifier is available).
  private _toggleEnterprise: ToggleEnterpriseWidget | null;
  private _configAPI = new ConfigAPI(getHomeUrl());

  constructor(private _options: EditionSectionOptions = {}) {
    super();

    const mockEdition = getMockOverride<string>("fullGristAvailable");
    if (mockEdition === "community-only") {
      this.fullGristAvailable = false;
      this.communityAvailable = true;
    } else if (mockEdition === "full-and-community") {
      this.fullGristAvailable = true;
      this.communityAvailable = true;
    } else if (mockEdition === "full-only") {
      this.fullGristAvailable = true;
      this.communityAvailable = false;
    } else {
      this.fullGristAvailable = showEnterpriseToggle();
      this.communityAvailable = true;
    }

    this.editionForced = !!getGristConfig().forceEnableEnterprise;

    // Only create the enterprise lifecycle widget in admin panel mode.
    const notifier = this._options.notifier;
    this._toggleEnterprise = notifier ?
      ToggleEnterpriseWidget.create(this, notifier) :
      null;

    this._serverEdition.set(
      this._toggleEnterprise?.getEnterpriseToggleObservable().get() ? "enterprise" : "core",
    );

    this.canProceed = Computed.create(this, use => use(this._editionConfirmed));
    this.isDirty = Computed.create(this, (use) => {
      if (!use(this._editionConfirmed)) { return false; }
      const selected = use(this._selectedEdition);
      if (selected === null) { return false; }
      return selected !== use(this._serverEdition);
    });
  }

  /**
   * Builds the status display for the admin panel collapsed view.
   */
  public buildStatusDisplay(): DomContents {
    if (this.editionForced) {
      return cssValueLabel(cssHappyText(t("On")));
    }
    if (!this.fullGristAvailable) {
      return cssValueLabel(t("community"));
    }
    const toggle = this._toggleEnterprise?.getEnterpriseToggleObservable();
    if (!toggle) {
      return cssValueLabel(t("community"));
    }
    return dom.domComputed(toggle, (isEnterprise) => {
      if (isEnterprise) {
        return cssValueLabel(cssHappyText(t("full")));
      }
      return cssValueLabel(t("community"));
    });
  }

  /**
   * Builds the expanded content for the admin panel.
   * Shows shared selector + enterprise lifecycle details.
   */
  public buildDom(): DomContents {
    return cssSectionContainer(
      this._buildCore(),
      // Admin panel shows the enterprise lifecycle details (activation keys, trial, etc.)
      this.fullGristAvailable && !this.editionForced && this._toggleEnterprise ?
        this._toggleEnterprise.buildEnterpriseSection() :
        null,
      testId("section"),
    );
  }

  /**
   * Builds the wizard-specific edition selector with confirm/skip flow.
   */
  public buildWizardDom(): DomContents {
    return cssSectionContainer(
      this._buildCore(),
      // Don't show confirmed/edit row when edition is forced — nothing to edit.
      this.editionForced ? null : buildConfirmedRow(
        this._editionConfirmed,
        () => { this._editionConfirmed.set(false); },
        { testPrefix: "edition" },
      ),
      testId("wizard"),
    );
  }

  public getSelectedEdition(): Edition | null {
    return this._selectedEdition.get();
  }

  /**
   * Read-only observable of whether the server is currently running
   * the enterprise edition. Returns null when no toggle is available
   * (e.g. wizard mode without a notifier).
   */
  public getEnterpriseToggleObservable() {
    return this._toggleEnterprise?.getEnterpriseToggleObservable();
  }

  /**
   * Persist the confirmed edition to the server via PATCH /api/config.
   * No-op if not dirty. Does NOT restart the server — the
   * PendingChangesManager handles that.
   */
  public async apply() {
    if (!this.isDirty.get()) { return; }
    const selected = this._selectedEdition.get();
    if (!selected) { return; }
    await this._configAPI.setValue({ edition: selected });
  }

  /** Call after all changes have been applied. Resets dirty state. */
  public markApplied() {
    const selected = this._selectedEdition.get();
    if (selected) { this._serverEdition.set(selected); }
  }

  public describeChange() {
    const selected = this._selectedEdition.get();
    return {
      label: t("Edition"),
      value: selected === "enterprise" ? t("Full Grist") : t("Community Edition"),
    };
  }

  // --- Shared core + mode-specific parts ---

  /**
   * Shared core: description, edition selector tabs, per-selection text.
   * Used by both admin panel and wizard.
   */
  private _buildCore(): DomContents {
    if (this.editionForced) {
      this._editionConfirmed.set(true);
      return cssSectionDescription(t("Full Grist is enabled via environment variable."));
    }

    if (!this.fullGristAvailable) {
      return this._buildUnavailableCore();
    }

    return this._buildSelector();
  }

  private _buildSelector(): DomContents {
    // Default to "enterprise" when Full Grist is available (or community isn't).
    const defaultEdition = (this.fullGristAvailable || !this.communityAvailable) ? "enterprise" : "core";
    this._selectedEdition.set(defaultEdition);
    const selectedEdition = this._selectedEdition;
    return [
      cssSectionDescription(
        t("Choose which edition of Grist to run on this server."),
      ),
      cssEditionButtons(
        cssEditionButton(
          t("Full Grist"),
          cssEditionButton.cls("-selected", use => use(selectedEdition) === "enterprise"),
          dom.on("click", () => { selectedEdition.set("enterprise"); this._editionConfirmed.set(false); }),
          testId("full-grist"),
        ),
        cssEditionButton(
          t("Community Edition"),
          cssEditionButton.cls("-selected", use => use(selectedEdition) === "core"),
          dom.on("click", () => { selectedEdition.set("core"); this._editionConfirmed.set(false); }),
          testId("community"),
        ),
      ),
      dom.domComputed(selectedEdition, (ed) => {
        if (ed === "enterprise") {
          return [
            cssSectionDescription(
              t("The full Grist experience, with all features enabled for improved security, " +
                "governance, and collaboration."),
            ),
            !this.editionForced && this._serverEdition.get() !== "enterprise" ? cssSectionDescription(
              t("You have 30 days to enter an activation key. Free activation keys are available " +
                "to individuals and small orgs with less than US $1 million in total annual funding. "),
              cssLink({ href: commonUrls.helpEnterpriseOptIn, target: "_blank" }, t("Learn more")),
              t(". For larger orgs, see "),
              cssLink({ href: commonUrls.plans, target: "_blank" }, t("pricing")),
              t("."),
            ) : null,
          ];
        }
        // Community tab
        if (!this.communityAvailable) {
          return [
            cssSectionDescription(
              t("The free and open-source heart of Grist, with everything you need to open and edit " +
                "Grist documents, control access, create forms, connect to single sign-on (SSO) " +
                "providers, and much more."),
            ),
            cssSectionDescription(
              t("Community Edition is not available in this installation."),
            ),
          ];
        }
        return cssSectionDescription(
          t("The free and open-source heart of Grist, with everything you need to open and edit " +
            "Grist documents, control access, create forms, connect to single sign-on (SSO) " +
            "providers, and much more."),
        );
      }),
      dom.domComputed((use) => {
        const ed = use(selectedEdition);
        const confirmed = use(this._editionConfirmed);
        // Can't confirm community when it's not available.
        if (ed === "core" && !this.communityAvailable) { return null; }
        if (confirmed) { return null; }
        return cssSectionButtonRow(
          primaryButton(
            t("Confirm edition"),
            dom.on("click", () => {
              this._editionConfirmed.set(true);
            }),
            testId("confirm"),
          ),
        );
      }),
    ];
  }

  private _buildUnavailableCore(): DomContents {
    const selectedTab = Observable.create(this, "core");
    const acknowledged = Observable.create(this, this._editionConfirmed.get());
    acknowledged.addListener((val) => { this._editionConfirmed.set(val); });
    this._editionConfirmed.addListener((val) => { if (!val) { acknowledged.set(false); } });
    return [
      cssSectionDescription(
        t("Choose which edition of Grist to run on this server."),
      ),
      cssEditionButtons(
        cssEditionButton(
          t("Full Grist"),
          cssEditionButton.cls("-selected", use => use(selectedTab) === "enterprise"),
          dom.on("click", () => { selectedTab.set("enterprise"); this._editionConfirmed.set(false); }),
          testId("full-grist"),
        ),
        cssEditionButton(
          t("Community Edition"),
          cssEditionButton.cls("-selected", use => use(selectedTab) === "core"),
          dom.on("click", () => { selectedTab.set("core"); this._editionConfirmed.set(false); }),
          testId("community"),
        ),
      ),
      dom.domComputed(selectedTab, (tab) => {
        if (tab === "enterprise") {
          return [
            cssSectionDescription(
              t("The full Grist experience, with all features enabled for improved security, " +
                "governance, and collaboration."),
            ),
            cssSectionDescription(
              t("Your installation does not bundle the Full Grist edition. Want Full Grist? "),
              cssLink({ href: commonUrls.helpEnterpriseOptIn, target: "_blank" },
                t("See how to enable it"),
              ),
              t("."),
            ),
            dom.maybe(use => !use(this._editionConfirmed), () =>
              labeledSquareCheckbox(acknowledged,
                t("I understand I am running Grist Community Edition"),
                testId("acknowledge"),
              ),
            ),
          ];
        }
        return [
          cssSectionDescription(
            t("The free and open-source heart of Grist, with everything you need to open and edit " +
              "Grist documents, control access, create forms, connect to single sign-on (SSO) " +
              "providers, and much more."),
          ),
          dom.maybe(use => !use(this._editionConfirmed), () => cssSectionButtonRow(
            primaryButton(
              t("Confirm edition"),
              dom.on("click", () => {
                this._editionConfirmed.set(true);
              }),
              testId("confirm"),
            ),
          )),
        ];
      }),
    ];
  }
}

// --- Styles ---

const cssEditionButtons = styled("div", `
  background: ${tokens.bgTertiary};
  border-radius: 10px;
  display: flex;
  column-gap: 3px;
  margin-bottom: 16px;
  padding: 3px;
`);

const cssEditionButton = styled(unstyledButton, `
  border-radius: 7px;
  color: ${tokens.secondary};
  cursor: pointer;
  flex: 1;
  font-weight: 500;
  padding: 8px 6px;
  text-align: center;
  transition: color 0.2s, background 0.2s, box-shadow 0.2s;

  &:hover, &-selected {
    color: ${tokens.body};
  }

  &:focus-visible {
    outline: 3px solid ${tokens.primary};
    outline-offset: 2px;
  }

  &-selected {
    background: ${tokens.bg};
    box-shadow:
      0 1px 3px rgba(0, 0, 0, 0.15),
      0 1px 2px rgba(0, 0, 0, 0.1);
    font-weight: 600;
  }

  &-disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`);
