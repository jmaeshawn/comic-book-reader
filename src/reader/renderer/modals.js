/**
 * @license
 * Copyright 2020-2026 Álvaro García
 * www.binarynonsense.com
 * SPDX-License-Identifier: BSD-2-Clause
 */

import * as modals from "../../shared/renderer/modals.js";
import { sendIpcToMain, on } from "../renderer.js";

let g_openModal;
let g_tocEntries = [];
let g_currentPageIndex = 0;
let g_tocModalCleanup;
let g_pagesContainerDiv;

const BookType = {
  COMIC: "comic",
  EBOOK: "ebook",
};

///////////////////////////////////////////////////////////////////////////////
// EXPORTS ////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

// NOTE: getOpenModal, showModal and modalClosed  are called from
// home-screen's renderer. initModalsOnIpcCallbacks fron reader's renderer

export function getOpenModal() {
  return g_openModal;
}

export function showModal(config) {
  g_openModal = modals.show(config);
}

export function setCurrentPageIndex(pageIndex) {
  if (Number.isInteger(pageIndex)) {
    g_currentPageIndex = pageIndex;
  }
}

export function hasTocEntries() {
  return g_tocEntries.length > 0;
}

export function modalClosed() {
  if (g_tocModalCleanup) {
    g_tocModalCleanup();
    g_tocModalCleanup = undefined;
  }
  g_openModal = undefined;
}

export function initModalsOnIpcCallbacks() {
  on("close-modal", () => {
    if (g_openModal) {
      modals.close(g_openModal);
      modalClosed();
    }
  });

  on(
    "show-modal-prompt",
    (question, defaultValue, textButton1, textButton2, mode = 0) => {
      showModalPrompt(question, defaultValue, textButton1, textButton2, mode);
    },
  );

  on("show-modal-prompt-password", (...args) => {
    showModalPromptPassword(...args);
  });

  on("show-modal-info", (...args) => {
    showModalAlert(...args);
  });

  on("show-modal-question-openas", (...args) => {
    showModalQuestionOpenAs(...args);
  });

  on("show-modal-request-open-confirmation", (...args) => {
    showModalRequestOpenConfirmation(...args);
  });

  on("show-modal-properties", (...args) => {
    showModalProperties(...args);
  });

  on("show-modal-quick-menu", (...args) => {
    showModalQuickMenu(...args);
  });

  on("update-toc", (tocEntries) => {
    g_tocEntries = Array.isArray(tocEntries) ? tocEntries : [];
  });

  on("show-modal-toc", (tocEntries) => {
    showModalToc(Array.isArray(tocEntries) ? tocEntries : g_tocEntries);
  });
}

///////////////////////////////////////////////////////////////////////////////
// MODAL CREATORS /////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(text) {
  return escapeHtml(text).replace(/`/g, "&#96;");
}

function getTocButtonHtml(entry) {
  const title = escapeHtml(entry.title);
  const pageLabel = `Page ${entry.pageIndex + 1}`;
  const thumbnail = entry.thumbnail
    ? `<img class="toolbar-toc-thumbnail" src="${escapeAttribute(
        entry.thumbnail,
      )}" alt="" />`
    : `<span class="toolbar-toc-thumbnail toolbar-toc-thumbnail-placeholder"></span>`;

  return `
    <span class="toolbar-toc-entry">
      ${thumbnail}
      <span class="toolbar-toc-entry-text">
        <span class="toolbar-toc-title"><span class="toolbar-toc-title-content">${title}</span></span>
        <span class="toolbar-toc-page">${pageLabel}</span>
      </span>
    </span>
  `;
}

function adjustTocModalWidth(modalFrame, listDiv) {
  const standardWidth = 520;
  const viewportPadding = 60;
  const maxWidth = Math.max(
    320,
    Math.min(standardWidth * 2, window.innerWidth - viewportPadding),
  );

  const titleElements = Array.from(
    listDiv.querySelectorAll(".toolbar-toc-title"),
  );

  titleElements.forEach((titleElement) => {
    titleElement.classList.remove("toolbar-toc-title-marquee");
    titleElement.style.removeProperty("--toolbar-toc-marquee-distance");
  });

  modalFrame.style.width = `${Math.min(standardWidth, maxWidth)}px`;

  let neededExtraWidth = 0;
  titleElements.forEach((titleElement) => {
    neededExtraWidth = Math.max(
      neededExtraWidth,
      titleElement.scrollWidth - titleElement.clientWidth,
    );
  });

  if (neededExtraWidth > 0) {
    modalFrame.style.width = `${Math.min(
      maxWidth,
      Math.ceil(Math.min(standardWidth, maxWidth) + neededExtraWidth + 8),
    )}px`;
  }

  titleElements.forEach((titleElement) => {
    const overflowAmount = titleElement.scrollWidth - titleElement.clientWidth;
    if (overflowAmount > 1) {
      titleElement.classList.add("toolbar-toc-title-marquee");
      titleElement.style.setProperty(
        "--toolbar-toc-marquee-distance",
        `${Math.ceil(-overflowAmount - 24)}px`,
      );
    }
  });
}

function getCurrentTocIndex(tocEntries) {
  let currentTocIndex = -1;

  tocEntries.forEach((entry, index) => {
    if (
      Number.isInteger(entry.pageIndex) &&
      entry.pageIndex <= g_currentPageIndex
    ) {
      currentTocIndex = index;
    }
  });

  return currentTocIndex;
}

function isTocShortcut(event) {
  return (
    event &&
    !event.repeat &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    event.key &&
    event.key.toLowerCase() === "t"
  );
}

export function showModalToc(tocEntries = g_tocEntries) {
  if (g_openModal || !Array.isArray(tocEntries) || tocEntries.length === 0) {
    return;
  }

  const modalsDiv = document.querySelector("#modals");
  if (!modalsDiv) {
    return;
  }

  const modalDiv = document.createElement("div");
  modalDiv.className = "modal modal-toc modal-toc-custom";
  modalDiv.innerHTML = `
    <div class="modal-frame modal-frame-show">
      <div class="modal-topbar">
        <button class="modal-close-button toolbar-toc-close" title="close" type="button">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div class="modal-title">Table of Contents</div>
      <div class="toolbar-toc-list" tabindex="0"></div>
    </div>
  `;

  const modalFrame = modalDiv.querySelector(".modal-frame");
  const listDiv = modalDiv.querySelector(".toolbar-toc-list");
  const closeButton = modalDiv.querySelector(".toolbar-toc-close");

  const closeTocModal = () => {
    if (g_openModal) {
      modals.close(g_openModal);
      modalClosed();
    }
  };

  const currentTocIndex = getCurrentTocIndex(tocEntries);
  let selectedTocIndex = currentTocIndex >= 0 ? currentTocIndex : 0;

  const updateKeyboardSelection = (scrollIntoView = true) => {
    const rows = Array.from(listDiv.querySelectorAll(".toolbar-toc-row"));
    rows.forEach((row, index) => {
      row.classList.toggle(
        "toolbar-toc-row-keyboard-selected",
        index === selectedTocIndex,
      );
    });

    const selectedRow = rows[selectedTocIndex];
    if (selectedRow && scrollIntoView) {
      selectedRow.scrollIntoView({ block: "nearest" });
    }
  };

  const activateSelectedTocEntry = () => {
    const selectedEntry = tocEntries[selectedTocIndex];
    if (!selectedEntry) {
      return;
    }

    sendIpcToMain("go-to-page", selectedEntry.pageIndex + 1);
    closeTocModal();
  };

  tocEntries.forEach((entry, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      index === currentTocIndex
        ? "toolbar-toc-row toolbar-toc-row-current"
        : "toolbar-toc-row";
    button.innerHTML = getTocButtonHtml(entry);
    button.addEventListener("mouseenter", () => {
      selectedTocIndex = index;
      updateKeyboardSelection(false);
    });
    button.addEventListener("click", () => {
      selectedTocIndex = index;
      activateSelectedTocEntry();
    });
    listDiv.appendChild(button);
  });

  updateKeyboardSelection(false);

  closeButton.addEventListener("click", closeTocModal);

  const stopReaderWheelHandling = (event) => {
    if (modalDiv.contains(event.target)) {
      event.stopImmediatePropagation();
    }
  };

  const handleTocKeyDown = (event) => {
    if (event.key === "Escape" || isTocShortcut(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeTocModal();
      return;
    }

    if (event.key === "ArrowDown") {
      selectedTocIndex = Math.min(tocEntries.length - 1, selectedTocIndex + 1);
      updateKeyboardSelection();
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    if (event.key === "ArrowUp") {
      selectedTocIndex = Math.max(0, selectedTocIndex - 1);
      updateKeyboardSelection();
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      activateSelectedTocEntry();
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  window.addEventListener("wheel", stopReaderWheelHandling, {
    capture: true,
    passive: false,
  });
  window.addEventListener("keydown", handleTocKeyDown, true);

  g_tocModalCleanup = () => {
    window.removeEventListener("wheel", stopReaderWheelHandling, true);
    window.removeEventListener("keydown", handleTocKeyDown, true);
  };

  modalsDiv.appendChild(modalDiv);
  g_openModal = modalDiv;
  adjustTocModalWidth(modalFrame, listDiv);
  listDiv.scrollTop = 0;
  listDiv.focus({ preventScroll: true });

  const currentRow = listDiv.querySelector(".toolbar-toc-row-current");
  if (currentRow) {
    currentRow.scrollIntoView({ block: "center" });
  }
}

function showModalPrompt(
  question,
  defaultValue,
  textButton1,
  textButton2,
  mode = 0,
) {
  if (g_openModal) {
    return;
  }
  if (mode === 0) {
    g_openModal = modals.show({
      title: question,
      message: defaultValue,
      zIndexDelta: -450,
      input: {},
      close: {
        callback: () => {
          modalClosed();
        },
        key: "Escape",
      },
      buttons: [
        {
          text: textButton1.toUpperCase(),
          callback: (showFocus, value) => {
            sendIpcToMain("go-to-page", value);
            modalClosed();
          },
          key: "Enter",
        },
        {
          text: textButton2.toUpperCase(),
          callback: () => {
            modalClosed();
          },
        },
      ],
    });
  } else if (mode === 1) {
    g_openModal = modals.show({
      title: question,
      message: defaultValue,
      zIndexDelta: -450,
      input: {},
      close: {
        callback: () => {
          modalClosed();
        },
        key: "Escape",
      },
      buttons: [
        {
          text: textButton1.toUpperCase(),
          callback: (showFocus, value) => {
            sendIpcToMain("enter-scale-value", parseInt(value));
            modalClosed();
          },
          key: "Enter",
        },
        {
          text: textButton2.toUpperCase(),
          callback: () => {
            modalClosed();
          },
        },
      ],
    });
  }
  if (mode === 2) {
    g_openModal = modals.show({
      title: question,
      message: defaultValue,
      zIndexDelta: -450,
      input: {},
      close: {
        callback: () => {
          modalClosed();
        },
        key: "Escape",
      },
      buttons: [
        {
          text: textButton1.toUpperCase(),
          callback: (showFocus, value) => {
            sendIpcToMain("go-to-percentage", value);
            modalClosed();
          },
          key: "Enter",
        },
        {
          text: textButton2.toUpperCase(),
          callback: () => {
            modalClosed();
          },
        },
      ],
    });
  }
}

function showModalPromptPassword(title, message, textButton1, textButton2) {
  if (g_openModal) {
    return;
  }
  g_openModal = modals.show({
    title: title,
    message: message,
    zIndexDelta: -450,
    input: { type: "password" },
    close: {
      callback: () => {
        sendIpcToMain("password-canceled");
        modalClosed();
      },
      key: "Escape",
    },
    buttons: [
      {
        text: textButton1.toUpperCase(),
        callback: (showFocus, value) => {
          sendIpcToMain("password-entered", value);
          modalClosed();
        },
        key: "Enter",
      },
      {
        text: textButton2.toUpperCase(),
        callback: () => {
          sendIpcToMain("password-canceled");
          modalClosed();
        },
      },
    ],
  });
}

function showModalAlert(title, message, textButton1) {
  if (g_openModal) {
    return;
  }
  g_openModal = modals.show({
    title: title,
    message: message,
    zIndexDelta: -450,
    close: {
      callback: () => {
        modalClosed();
      },
      key: "Escape",
    },
    buttons: [
      {
        text: textButton1.toUpperCase(),
        callback: () => {
          modalClosed();
        },
        key: "Enter",
      },
    ],
  });
}

function showModalQuestionOpenAs(
  title,
  message,
  textButton1,
  textButton2,
  filePath,
) {
  if (g_openModal) {
    return;
  }
  g_openModal = modals.show({
    title: title,
    message: message,
    zIndexDelta: -450,
    close: {
      callback: () => {
        modalClosed();
      },
      key: "Escape",
    },
    buttons: [
      {
        text: textButton1.toUpperCase(),
        callback: () => {
          sendIpcToMain("booktype-entered", filePath, BookType.COMIC);
          modalClosed();
        },
        key: "Enter",
      },
      {
        text: textButton2.toUpperCase(),
        callback: () => {
          sendIpcToMain("booktype-entered", filePath, BookType.EBOOK);
          modalClosed();
        },
      },
    ],
  });
}

function showModalRequestOpenConfirmation(
  title,
  message,
  textButton1,
  textButton2,
  filePath,
) {
  if (g_openModal) {
    return;
  }
  g_openModal = modals.show({
    title: title,
    message: message,
    zIndexDelta: -450,
    close: {
      callback: () => {
        modalClosed();
      },
      key: "Escape",
    },
    buttons: [
      {
        text: textButton1.toUpperCase(),
        callback: () => {
          sendIpcToMain("open-file", filePath);
          modalClosed();
        },
      },
      {
        text: textButton2.toUpperCase(),
        callback: () => {
          modalClosed();
        },
      },
    ],
  });
}

function showModalProperties(title, message, textButton1, textButton2) {
  if (g_openModal) {
    return;
  }
  let buttons = [];
  if (textButton2) {
    buttons.push({
      text: textButton2.toUpperCase(),
      callback: () => {
        modalClosed();
        sendIpcToMain("open-metadata-tool");
      },
    });
  }
  buttons.push({
    text: textButton1.toUpperCase(),
    callback: () => {
      modalClosed();
    },
  });
  g_openModal = modals.show({
    title: title,
    log: { message: message, useDiv: true },
    frameWidth: 600,
    zIndexDelta: -450,
    close: {
      callback: () => {
        modalClosed();
      },
      key: "Escape",
    },
    buttons: buttons,
  });
}

function showModalQuickMenu(
  title,
  textButtonBack,
  textCloseFile,
  textButtonFileBrowser,
  textButtonHistory,
  textButtonFullscreen,
  textButtonQuit,
  showFocus,
) {
  if (g_openModal) {
    return;
  }
  let buttons = [];
  buttons.push({
    text: textButtonBack.toUpperCase(),
    fullWidth: true,
    callback: () => {
      modalClosed();
    },
  });
  if (!g_pagesContainerDiv) {
    g_pagesContainerDiv = document.getElementById("pages-container");
  }
  let fileOpen = g_pagesContainerDiv && g_pagesContainerDiv.innerHTML !== "";
  if (fileOpen) {
    buttons.push({
      text: textCloseFile.toUpperCase(),
      fullWidth: true,
      callback: () => {
        modalClosed();
        sendIpcToMain("close-file", true);
      },
    });
  }
  buttons.push({
    text: textButtonFileBrowser.toUpperCase(),
    fullWidth: true,
    callback: (showFocus) => {
      modalClosed();
      sendIpcToMain("open-file-browser-tool", showFocus);
    },
  });
  buttons.push({
    text: textButtonHistory.toUpperCase(),
    fullWidth: true,
    callback: (showFocus) => {
      modalClosed();
      sendIpcToMain("open-history-tool", showFocus);
    },
  });
  buttons.push({
    text: textButtonFullscreen.toUpperCase(),
    fullWidth: true,
    callback: () => {
      modalClosed();
      sendIpcToMain("toggle-fullscreen");
    },
  });
  buttons.push({
    text: textButtonQuit.toUpperCase(),
    fullWidth: true,
    callback: () => {
      modalClosed();
      sendIpcToMain("quit");
    },
  });
  g_openModal = modals.show({
    showFocus: showFocus,
    title: title,
    frameWidth: 400,
    zIndexDelta: -450,
    close: {
      callback: () => {
        modalClosed();
      },
      key: "Escape," + g_navKeys.quickMenu[0],
      gpCommand: g_navButtons.quickMenu[0],
    },
    buttons: buttons,
  });
}
