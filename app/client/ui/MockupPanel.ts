/**
 * Draggable, collapsible mockup-controls panel for dev/testing.
 * Activated by adding `?mock=true` to the page URL.
 *
 * The panel is a pure container — callers supply content via
 * `buildMockupPanel(title, ...content)` using the exported
 * css helpers (`cssMockupSection`, `cssMockupRow`, `cssMockupButton`).
 */
import { isMockMode } from "app/client/ui/MockupState";
import { mouseDrag } from "app/client/ui/mouseDrag";

import { dom, DomElementArg, observable, styled } from "grainjs";

/**
 * Builds a mock panel from content contributed by page sections.
 * Returns null when mock mode is off. Each section provides its
 * buttons via a static `buildMockButtons()` method returning
 * `DomElementArg[]`.
 *
 * Usage:
 *   maybeBuildMockPanel(SectionA.buildMockButtons(), SectionB.buildMockButtons())
 */
export function maybeBuildMockPanel(...groups: DomElementArg[][]): DomElementArg {
  if (!isMockMode()) { return null; }
  return buildMockupPanel("Mock controls", ...groups.flat());
}

/**
 * Builds a fixed, draggable panel with the given title and content.
 * Returns a DOM element ready to be appended anywhere.
 */
export function buildMockupPanel(title: string, ...content: DomElementArg[]) {
  const collapsed = observable(false);

  return cssMockupPanel(
    mouseDrag((startEv, panel) => {
      if ((startEv.target as HTMLElement).tagName === "BUTTON") { return null; }
      startEv.preventDefault();
      const rect = panel.getBoundingClientRect();
      return {
        onMove(ev) {
          panel.style.left = `${rect.left + ev.clientX - startEv.clientX}px`;
          panel.style.top = `${rect.top + ev.clientY - startEv.clientY}px`;
          panel.style.right = "auto";
          panel.style.bottom = "auto";
        },
        onStop() { /* nothing to clean up */ },
      };
    }),
    cssMockupHeader(
      cssMockupTitle(title),
      cssMockupToggle(
        dom.text(use => use(collapsed) ? "\u25B6" : "\u25BC"),
        dom.on("click", () => collapsed.set(!collapsed.get())),
      ),
    ),
    cssMockupBody(
      dom.cls("collapsed", collapsed),
      ...content,
    ),
  );
}

// --- Styles -----------------------------------------------------------------

const cssMockupPanel = styled("div", `
  position: fixed;
  bottom: 16px;
  right: 16px;
  width: 340px;
  max-height: 70vh;
  background: #1a1a2e;
  color: #e0e0e0;
  border-radius: 8px;
  font-size: 12px;
  z-index: 1000;
  box-shadow: -2px -2px 12px rgba(0, 0, 0, 0.4);
  cursor: default;
  user-select: none;
`);

const cssMockupHeader = styled("div", `
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  cursor: grab;
  border-bottom: 1px solid #333;
  &:active { cursor: grabbing; }
`);

const cssMockupTitle = styled("div", `
  font-weight: bold;
  font-size: 13px;
  color: #fff;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`);

const cssMockupToggle = styled("button", `
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
  font-size: 12px;
  padding: 2px 4px;
  &:hover { color: #fff; }
`);

const cssMockupBody = styled("div", `
  padding: 8px 12px 12px;
  overflow-y: auto;
  max-height: calc(70vh - 40px);
  transition: max-height 0.25s ease, padding 0.25s ease, opacity 0.2s ease;
  &.collapsed {
    max-height: 0;
    padding-top: 0;
    padding-bottom: 0;
    overflow: hidden;
    opacity: 0;
  }
`);

export const cssMockupSection = styled("div", `
  font-weight: 600;
  margin-top: 10px;
  margin-bottom: 4px;
  color: #aaa;
  text-transform: uppercase;
  font-size: 10px;
  letter-spacing: 0.5px;
  &:first-child { margin-top: 0; }
`);

export const cssMockupRow = styled("div", `
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 4px;
  &:last-child { margin-bottom: 0; }
`);

export const cssMockupButton = styled("button", `
  padding: 4px 8px;
  border: 1px solid #444;
  border-radius: 3px;
  background: #2a2a4a;
  color: #ccc;
  cursor: pointer;
  font-size: 11px;
  user-select: none;
  &:hover {
    background: #3a3a5a;
    color: #fff;
  }
`);
