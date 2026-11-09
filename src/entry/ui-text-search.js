/**
 * Find-in-text controller shared by the Injection Preview and the snippet editor.
 * Matches are wrapped inside the target element, so no second text layer is drawn.
 */

const MATCH_CLASS = 'sc-search-match';
const ACTIVE_CLASS = 'sc-search-match-active';

/**
 * @typedef {{ start: number, end: number }} TextMatch
 */

/**
 * Case-insensitive literal search. Recomputed on every call, never cached.
 * @param {string} text
 * @param {string} query
 * @returns {TextMatch[]}
 */
export function findTextMatches(text, query) {
    if (!query) {
        return [];
    }
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped, 'giu');
    const matches = [];
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
        matches.push({ start: match.index, end: match.index + match[0].length });
    }
    return matches;
}

/**
 * Read the plain source text of a contenteditable surface, mapping line breaks to newlines.
 * @param {HTMLElement} root
 * @returns {string}
 */
export function readPlainText(root) {
    let text = '';
    const visit = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            text += node.nodeValue;
            return;
        }
        if (node.nodeName === 'BR') {
            // A trailing BR is the browser placeholder for an empty line, not a newline.
            if (node.nextSibling || node.parentNode !== root) {
                text += '\n';
            }
            return;
        }
        const isBlock = node.nodeName === 'DIV' || node.nodeName === 'P';
        if (isBlock && text && !text.endsWith('\n')) {
            text += '\n';
        }
        node.childNodes.forEach(visit);
    };
    root.childNodes.forEach(visit);
    return text;
}

/**
 * @returns {{ toggle: HTMLButtonElement, bar: HTMLElement, input: HTMLInputElement, count: HTMLElement, previous: HTMLButtonElement, next: HTMLButtonElement }}
 */
export function buildSearchControls() {
    const host = document.createElement('div');
    host.innerHTML = `
        <button class="menu_button sc-search-toggle" type="button" title="Search in text (Ctrl+F)" aria-label="Search in text" aria-expanded="false"><i class="fa-solid fa-magnifying-glass"></i></button>
        <div class="sc-search-bar" role="search">
            <div class="sc-search-field">
                <input class="sc-search-input" type="search" placeholder="Search in text" aria-label="Search in text" autocomplete="off" spellcheck="false">
                <span class="sc-search-count" aria-live="polite"></span>
                <button class="menu_button sc-search-nav" type="button" title="Previous match (Shift+Enter)" aria-label="Previous match"><i class="fa-solid fa-chevron-up"></i></button>
                <button class="menu_button sc-search-nav" type="button" title="Next match (Enter)" aria-label="Next match"><i class="fa-solid fa-chevron-down"></i></button>
            </div>
        </div>`;
    const navButtons = host.querySelectorAll('button.sc-search-nav');
    return {
        toggle: /** @type {HTMLButtonElement} */ (host.querySelector('.sc-search-toggle')),
        bar: /** @type {HTMLElement} */ (host.querySelector('.sc-search-bar')),
        input: /** @type {HTMLInputElement} */ (host.querySelector('.sc-search-input')),
        count: /** @type {HTMLElement} */ (host.querySelector('.sc-search-count')),
        previous: /** @type {HTMLButtonElement} */ (navButtons[0]),
        next: /** @type {HTMLButtonElement} */ (navButtons[1]),
    };
}

/**
 * @param {HTMLElement} root
 * @returns {Text[]}
 */
function textNodesOf(root) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        nodes.push(/** @type {Text} */ (node));
    }
    return nodes;
}

/**
 * @param {HTMLElement} root
 */
function clearHighlights(root) {
    const marks = root.querySelectorAll(`mark.${MATCH_CLASS}, mark.${ACTIVE_CLASS}`);
    if (!marks.length) {
        return;
    }
    marks.forEach((mark) => mark.replaceWith(...mark.childNodes));
    root.normalize();
}

/**
 * Wrap each match in a mark. Text nodes are split so the source text is unchanged.
 * @param {HTMLElement} root
 * @param {TextMatch[]} matches
 * @param {number} activeIndex
 */
function paintMatches(root, matches, activeIndex) {
    if (!matches.length) {
        return;
    }
    const nodes = textNodesOf(root);
    const pieces = [];
    matches.forEach((match, index) => {
        const className = index === activeIndex ? ACTIVE_CLASS : MATCH_CLASS;
        let nodeStart = 0;
        for (const node of nodes) {
            const nodeEnd = nodeStart + node.data.length;
            const start = Math.max(match.start, nodeStart);
            const end = Math.min(match.end, nodeEnd);
            if (end > start) {
                pieces.push({ node, start: start - nodeStart, end: end - nodeStart, className });
            }
            nodeStart = nodeEnd;
        }
    });
    // Apply right-to-left so earlier offsets inside a split node stay valid.
    for (let i = pieces.length - 1; i >= 0; i--) {
        const { node, start, end, className } = pieces[i];
        const target = start > 0 ? node.splitText(start) : node;
        if (end - start < target.data.length) {
            target.splitText(end - start);
        }
        const mark = document.createElement('mark');
        mark.className = className;
        target.before(mark);
        mark.append(target);
    }
}

/**
 * @param {HTMLElement} root
 * @param {Node} node
 * @param {number} offset
 * @returns {number}
 */
function textOffset(root, node, offset) {
    const range = document.createRange();
    range.selectNodeContents(root);
    range.setEnd(node, offset);
    return range.toString().length;
}

/**
 * @param {HTMLElement} root
 * @returns {TextMatch | null}
 */
function readSelectionOffsets(root) {
    const selection = window.getSelection();
    if (!selection?.rangeCount) {
        return null;
    }
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
        return null;
    }
    return {
        start: textOffset(root, range.startContainer, range.startOffset),
        end: textOffset(root, range.endContainer, range.endOffset),
    };
}

/**
 * @param {HTMLElement} root
 * @param {number} start
 * @param {number} end
 */
function writeSelectionOffsets(root, start, end) {
    const nodes = textNodesOf(root);
    const locate = (offset) => {
        let remaining = offset;
        for (const node of nodes) {
            if (remaining <= node.data.length) {
                return [node, remaining];
            }
            remaining -= node.data.length;
        }
        const last = nodes[nodes.length - 1];
        return last ? [last, last.data.length] : [root, 0];
    };
    const [startNode, startOffset] = locate(start);
    const [endNode, endOffset] = locate(end);
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
}

/**
 * Insert plain text at the caret, keeping the contenteditable source exact.
 * @param {HTMLElement} root
 * @param {string} text
 */
function insertPlainText(root, text) {
    const selection = window.getSelection();
    if (!selection) {
        return;
    }
    let range = selection.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || !root.contains(range.startContainer)) {
        root.focus({ preventScroll: true });
        range = document.createRange();
        range.selectNodeContents(root);
        range.collapse(false);
    }
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
}

/**
 * Wire the search bar to a root element. Every event re-reads the live text,
 * so counts and highlights never lag behind typing.
 * @param {object} options
 * @param {HTMLElement} options.root - Element whose text is searched.
 * @param {HTMLElement} options.shortcutTarget - Element that handles Ctrl/Cmd+F.
 * @param {boolean} [options.editable] - True when root is a contenteditable surface.
 * @param {HTMLElement} options.toggle
 * @param {HTMLElement} options.bar
 * @param {HTMLInputElement} options.input
 * @param {HTMLElement} options.count
 * @param {HTMLButtonElement} options.previous
 * @param {HTMLButtonElement} options.next
 * @returns {{ refresh: () => void }}
 */
export function attachTextSearch({
    root,
    shortcutTarget,
    editable = false,
    toggle,
    bar,
    input,
    count,
    previous,
    next,
}) {
    let open = false;
    let composing = false;
    let activeIndex = 0;
    let matchTotal = 0;

    const readText = () => (editable ? readPlainText(root) : (root.textContent ?? ''));

    /**
     * @param {{ scroll?: boolean, selectActive?: boolean }} [options]
     */
    const render = ({ scroll = false, selectActive = false } = {}) => {
        const query = open ? input.value.trim() : '';
        const matches = findTextMatches(readText(), query);
        matchTotal = matches.length;
        activeIndex = Math.min(Math.max(activeIndex, 0), Math.max(matchTotal - 1, 0));
        const caret =
            editable && root.contains(document.activeElement) ? readSelectionOffsets(root) : null;
        clearHighlights(root);
        paintMatches(root, matches, activeIndex);
        const active = matches[activeIndex];
        if (selectActive && active) {
            writeSelectionOffsets(root, active.start, active.end);
        } else if (caret) {
            writeSelectionOffsets(root, caret.start, caret.end);
        }
        if (scroll) {
            root.querySelector(`.${ACTIVE_CLASS}`)?.scrollIntoView({
                block: 'nearest',
                inline: 'nearest',
            });
        }
        previous.disabled = matchTotal === 0;
        next.disabled = matchTotal === 0;
        count.textContent = matchTotal
            ? `${activeIndex + 1} of ${matchTotal}`
            : query
              ? 'No matches'
              : '';
    };

    const step = (delta) => {
        if (!matchTotal) {
            return;
        }
        activeIndex = (activeIndex + delta + matchTotal) % matchTotal;
        render({ scroll: true, selectActive: !editable });
    };

    const setOpen = (value) => {
        open = value;
        bar.classList.toggle('open', value);
        toggle.classList.toggle('active', value);
        toggle.setAttribute('aria-expanded', String(value));
        if (value) {
            input.focus({ preventScroll: true });
            input.select();
            render({ scroll: true });
            return;
        }
        activeIndex = 0;
        render();
        if (editable) {
            root.focus({ preventScroll: true });
        }
    };
    {
        activeIndex = 0;
        render({ scroll: true, selectActive: true });
        input.focus({ preventScroll: true });
    }

    toggle.addEventListener('click', () => setOpen(!open));
    input.addEventListener('input', () => render({ scroll: true }));
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            step(event.shiftKey ? -1 : 1);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
        }
    });
    previous.addEventListener('click', () => step(-1));
    next.addEventListener('click', () => step(1));
    shortcutTarget.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
            event.preventDefault();
            if (open) {
                input.focus({ preventScroll: true });
                input.select();
            } else {
                setOpen(true);
            }
        }
    });

    if (editable) {
        root.addEventListener('beforeinput', (event) => {
            if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') {
                event.preventDefault();
                insertPlainText(root, '\n');
                render();
            }
        });
        root.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' || event.ctrlKey || event.metaKey || event.isComposing) {
                return;
            }
            event.preventDefault();
            insertPlainText(root, '\n');
            if (open) {
                render();
            }
        });
        root.addEventListener('paste', (event) => {
            event.preventDefault();
            const text = event.clipboardData?.getData('text/plain') ?? '';
            insertPlainText(root, text.replace(/\r\n?/g, '\n'));
            if (open) {
                render();
            }
        });
        root.addEventListener('compositionstart', () => {
            composing = true;
        });
        root.addEventListener('compositionend', () => {
            composing = false;
            if (open) {
                render();
            }
        });
        root.addEventListener('input', () => {
            if (open && !composing) {
                render();
            }
        });
    }

    return {
        refresh: () => {
            if (open) {
                render();
            }
        },
    };
}

/** @type {{ refresh: () => void } | null} */
let previewSearch = null;

/**
 * Add search to the Injection Preview. The preview is read-only, so matches highlight in place.
 * @returns {void}
 */
export function bindPreviewSearch() {
    const preview = document.getElementById('sc_preview');
    const tokenCount = document.getElementById('sc_preview_token_count');
    if (!preview || !tokenCount) {
        return;
    }
    const controls = buildSearchControls();
    tokenCount.closest('.sc-field-actions')?.prepend(controls.toggle);
    preview.before(controls.bar);
    previewSearch = attachTextSearch({ ...controls, root: preview, shortcutTarget: preview });
}

/**
 * Re-paint preview matches after the preview DOM is rebuilt.
 * @returns {void}
 */
export function refreshPreviewSearch() {
    previewSearch?.refresh();
}
