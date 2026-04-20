import { makeT } from "app/client/lib/localization";
import { AdminChecks } from "app/client/models/AdminChecks";
import { cssDangerText, cssHappyText, cssValueLabel } from "app/client/ui/AdminPanelCss";
import { colors, theme } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { loadingSpinner } from "app/client/ui2018/loaders";
import { BackupsBootProbeDetails } from "app/common/BootProbe";
import { components, tokens } from "app/common/ThemePrefs";

import { Computed, Disposable, dom, Observable, styled, UseCBOwner } from "grainjs";

const t = makeT("BackupsSection");

const NONE_BACKEND = "none";

const STORAGE_META: Record<string, { label: string; desc: string }> = {
  minio: {
    label: t("S3 (MinIO client)"),
    desc: t("S3-compatible service via MinIO client library. Works with AWS S3, MinIO, and others."),
  },
  s3: {
    label: t("S3 (AWS client)"),
    desc: t("S3-compatible service via native AWS SDK. Supports IAM roles and AWS-native auth."),
  },
  azure: {
    label: t("Azure Blob Storage"),
    desc: t("Microsoft Azure Blob Storage for document backups."),
  },
  [NONE_BACKEND]: {
    label: t("No external storage"),
    desc: t("Documents stored on local disk only. No off-server backups."),
  },
};

function backendLabel(name: string): string {
  return STORAGE_META[name]?.label ?? name;
}

function backendDesc(name: string): string {
  return STORAGE_META[name]?.desc ?? "";
}

export class BackupsSection extends Disposable {
  public readonly selected = Observable.create<string>(this, "");
  public readonly canProceed = Computed.create(this, this.selected, (_use, sel) => Boolean(sel));

  constructor(private _checks: AdminChecks) {
    super();

    // Pre-select the active backend once the probe resolves, so users who
    // already have backups configured can Continue without clicking.
    const activeBackend = Computed.create(this, use => this._probeDetails(use)?.backend);
    this.autoDispose(activeBackend.addListener((backend) => {
      if (backend && !this.selected.get()) {
        this.selected.set(backend);
      }
    }));
  }

  public buildDom() {
    return cssConfigurator(
      cssTitle(
        icon("Database"),
        cssSectionName(t("Backups")),
      ),
      cssDescription(
        t("Store document backups on an external service like S3 or Azure. \
          This protects against data loss if the server's disk fails."),
      ),
      dom.domComputed((use) => {
        const details = this._probeDetails(use);
        if (!details) {
          return cssLoading(
            loadingSpinner(),
            t("Loading backup providers..."),
          );
        }
        const available = new Set(details.availableBackends ?? []);
        const externalNames = Object.keys(STORAGE_META).filter(n => n !== NONE_BACKEND);
        const enabled = [...externalNames.filter(n => available.has(n)), NONE_BACKEND];
        const disabled = externalNames.filter(n => !available.has(n));
        return cssBackendList(
          ...enabled.map(name => this._buildBackendCard(name, details.backend, false)),
          ...disabled.map(name => this._buildBackendCard(name, details.backend, true)),
        );
      }),
      dom.domComputed(this.selected, name => this._buildSetupInstructions(name)),
    );
  }

  public buildStatusDisplay() {
    return dom.domComputed((use) => {
      const details = this._probeDetails(use);
      if (!details) { return t("checking..."); }
      const active = details.backend;
      if (active && active !== NONE_BACKEND) {
        return cssValueLabel(cssHappyText(backendLabel(active)));
      }
      return cssValueLabel(cssDangerText(t("Off")));
    });
  }

  private _probeDetails(use: UseCBOwner): BackupsBootProbeDetails | undefined {
    const req = this._checks.requestCheckById(use, "backups");
    const result = req ? use(req.result) : undefined;
    if (!result || result.status === "none") { return undefined; }
    return result.details as BackupsBootProbeDetails | undefined;
  }

  private _buildSetupInstructions(backend: string) {
    if (backend === "minio") {
      return cssInstructions(
        dom("div", t("Set these environment variables and restart Grist to enable MinIO storage:")),
        cssCodeBlock(
          "GRIST_DOCS_MINIO_BUCKET=my-grist-docs\n" +
          "GRIST_DOCS_MINIO_ENDPOINT=s3.amazonaws.com\n" +
          "GRIST_DOCS_MINIO_ACCESS_KEY=...\n" +
          "GRIST_DOCS_MINIO_SECRET_KEY=...",
        ),
        dom("div", t("Works with AWS S3, MinIO, and any S3-compatible storage provider.")),
      );
    }
    if (backend === "s3") {
      return cssInstructions(
        dom("div", t("Set these environment variables and restart Grist to enable S3 storage:")),
        cssCodeBlock(
          "GRIST_DOCS_S3_BUCKET=my-grist-docs\n" +
          "GRIST_DOCS_S3_PREFIX=v1/\n",
        ),
      );
    }
    if (backend === "azure") {
      return cssInstructions(
        dom("div", t("Set these environment variables and restart Grist to enable Azure storage:")),
        cssCodeBlock(
          "AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=...\n" +
          "GRIST_AZURE_CONTAINER=my-grist-docs\n" +
          "GRIST_AZURE_PREFIX=v1/\n",
        ),
      );
    }
    return null;
  }

  private _buildBackendCard(name: string, activeBackend: string | undefined, isDisabled: boolean) {
    const isActive = activeBackend === name && name !== NONE_BACKEND;
    return cssBackendCard(
      cssBackendCard.cls("-selected", use => use(this.selected) === name && !isDisabled),
      cssBackendCard.cls("-disabled", isDisabled),
      isDisabled ? null : dom.on("click", () => this.selected.set(name)),
      cssRadio(
        dom.attr("type", "radio"),
        dom.attr("name", "storage-backend"),
        dom.attr("value", name),
        dom.prop("disabled", isDisabled),
        dom.prop("checked", use => use(this.selected) === name && !isDisabled),
        isDisabled ? null : dom.on("change", () => this.selected.set(name)),
      ),
      cssBackendBody(
        cssBackendNameRow(
          cssBackendName(backendLabel(name)),
          isActive ? cssBadge(cssBadge.cls("-ok"), t("Active")) : null,
          isDisabled ? cssBadge(cssBadge.cls("-enterprise"), t("Enterprise")) : null,
        ),
        cssBackendDesc(backendDesc(name)),
      ),
    );
  }
}

const cssConfigurator = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 12px;
`);

const cssTitle = styled("div", `
  --icon-color: ${components.accentIcon};
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
`);

const cssSectionName = styled("div", `
  font-weight: 700;
  font-size: 17px;
  letter-spacing: -0.2px;
  color: var(--grist-theme-text);  
`);

const cssDescription = styled("div", `
  font-size: 13px;
  color: var(--grist-theme-text-light);
  margin-bottom: 16px;
  line-height: 1.55;  
`);

const cssBackendList = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 8px;
`);

const cssBackendCard = styled("div", `
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 18px;
  border: 1.5px solid ${components.inputBorder};
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.2s, background-color 0.2s, box-shadow 0.2s;

  &:hover {
    border-color: ${components.controlFg};
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  }
  &-selected {
    border-color: ${components.controlFg};
    background-color: ${components.lightHover};
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  }
  &-disabled {
    cursor: not-allowed;
    background-color: ${components.lightHover};
  }
  &-disabled:hover {
    border-color: ${components.inputBorder};
    box-shadow: none;
  }
`);

const cssRadio = styled("input", `
  margin-top: 2px;
  flex-shrink: 0;
`);

const cssBackendBody = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
`);

const cssBackendNameRow = styled("div", `
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`);

const cssBackendName = styled("span", `
  font-weight: 600;
  font-size: ${tokens.mediumFontSize};
`);

const cssBadge = styled("span", `
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.2px;

  &-ok {
    background-color: #e6f4ea;
    color: #1e7e34;
  }
  &-enterprise {
    background-color: ${colors.orange};
    color: white;
  }
`);

const cssBackendDesc = styled("div", `
  font-size: ${tokens.smallFontSize};
  color: ${components.lightText};
`);

const cssInstructions = styled("div", `
  padding: 14px 18px;
  background-color: ${components.lightHover};
  border-radius: 8px;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  line-height: 1.5;
`);

const cssCodeBlock = styled("pre", `
  margin: 0;
  padding: 10px 14px;
  background-color: ${components.inputBg};
  border: 1px solid ${components.inputBorder};
  border-radius: 6px;
  font-size: 12px;
  font-family: "SFMono-Regular", "Consolas", "Liberation Mono", "Menlo", monospace;
  overflow-x: auto;
  line-height: 1.5;
`);

const cssLoading = styled("div", `
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 48px 32px;
  color: ${theme.lightText};
`);
