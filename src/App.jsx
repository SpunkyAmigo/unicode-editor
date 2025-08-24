import React, { useEffect, useRef, useState } from "react";

// Unicode ranges
const RANGE = {
  bold: { upperStart: 0x1d400, lowerStart: 0x1d41a, digitStart: 0x1d7ce },
  italic: { upperStart: 0x1d434, lowerStart: 0x1d44e },
};

function mapWithRanges(text, opts) {
  const { upperStart, lowerStart, digitStart } = opts;
  const out = [];
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (ch >= 'A' && ch <= 'Z' && upperStart) {
      out.push(String.fromCodePoint(upperStart + (code - 0x41)));
    } else if (ch >= 'a' && ch <= 'z' && lowerStart) {
      out.push(String.fromCodePoint(lowerStart + (code - 0x61)));
    } else if (ch >= '0' && ch <= '9' && digitStart) {
      out.push(String.fromCodePoint(digitStart + (code - 0x30)));
    } else {
      out.push(ch);
    }
  }
  return out.join("");
}

const STYLES = [
  { key: "bold", label: "Bold", fn: (s) => mapWithRanges(s, RANGE.bold) },
  { key: "italic", label: "Italic", fn: (s) => mapWithRanges(s, RANGE.italic) },
];

// --- Robust per-character toggling --- //
function decodeChar(ch) {
  const cp = ch.codePointAt(0);
  if (cp == null) return { type: "other", raw: ch };

  // Plain ASCII
  if (ch >= 'A' && ch <= 'Z') return { type: "upper", idx: cp - 0x41, bold: false, italic: false };
  if (ch >= 'a' && ch <= 'z') return { type: "lower", idx: cp - 0x61, bold: false, italic: false };
  if (ch >= '0' && ch <= '9') return { type: "digit", idx: cp - 0x30, bold: false, italic: false };

  // Bold
  if (cp >= 0x1d400 && cp <= 0x1d419) return { type: "upper", idx: cp - 0x1d400, bold: true, italic: false };
  if (cp >= 0x1d41a && cp <= 0x1d433) return { type: "lower", idx: cp - 0x1d41a, bold: true, italic: false };
  // Italic (note: U+1D455 is unassigned; small italic 'h' is U+210E)
  if (cp >= 0x1d434 && cp <= 0x1d44d) return { type: "upper", idx: cp - 0x1d434, bold: false, italic: true };
  if (cp >= 0x1d44e && cp <= 0x1d467) {
    const idx = cp - 0x1d44e;
    return { type: "lower", idx, bold: false, italic: true };
  }
  if (cp === 0x210e) return { type: "lower", idx: 7, bold: false, italic: true }; // ℎ

  // Bold Italic (ignored since button removed)
  if (cp >= 0x1d468 && cp <= 0x1d481) return { type: "upper", idx: cp - 0x1d468, bold: true, italic: true };
  if (cp >= 0x1d482 && cp <= 0x1d49b) return { type: "lower", idx: cp - 0x1d482, bold: true, italic: true };
  // Digits (bold only exists)
  if (cp >= 0x1d7ce && cp <= 0x1d7d7) return { type: "digit", idx: cp - 0x1d7ce, bold: true, italic: false };

  return { type: "other", raw: ch };
}

function encodeChar(node, nextBold, nextItalic) {
  const { type, idx } = node;
  if (type === "other") return node.raw;
  if (type === "upper") {
    if (nextBold && nextItalic) return String.fromCodePoint(0x1d468 + idx);
    if (nextBold) return String.fromCodePoint(0x1d400 + idx);
    if (nextItalic) return String.fromCodePoint(0x1d434 + idx);
    return String.fromCodePoint(0x41 + idx);
  }
  if (type === "lower") {
    if (nextBold && nextItalic) return String.fromCodePoint(0x1d482 + idx);
    if (nextBold) return String.fromCodePoint(0x1d41a + idx);
    if (nextItalic) {
      // real italic 'h' is U+210E, not in the contiguous range
      if (idx === 7) return String.fromCodePoint(0x210e);
      return String.fromCodePoint(0x1d44e + idx);
    }
    return String.fromCodePoint(0x61 + idx);
  }
  if (type === "digit") {
    if (nextBold) return String.fromCodePoint(0x1d7ce + idx);
    return String.fromCodePoint(0x30 + idx);
  }
  return node.raw;
}

function toggleTransform(text, styleKey) {
  const out = [];
  for (const ch of text) {
    const node = decodeChar(ch);
    if (node.type === "other") {
      out.push(node.raw);
      continue;
    }
    let nextBold = node.bold;
    let nextItalic = node.italic;
    if (styleKey === "bold") nextBold = !nextBold;
    if (styleKey === "italic") nextItalic = !nextItalic;
    out.push(encodeChar(node, nextBold, nextItalic));
  }
  return out.join("");
}

// ---------- Word expansion helpers (caret toggles current word) ---------- //
function isLowSurrogate(code) { return code >= 0xDC00 && code <= 0xDFFF; }
function isHighSurrogate(code) { return code >= 0xD800 && code <= 0xDBFF; }

function prevChar(str, index) {
  if (index <= 0) return null;
  let end = index;
  let start = end - 1;
  const c = str.charCodeAt(start);
  if (isLowSurrogate(c) && start - 1 >= 0) {
    const c2 = str.charCodeAt(start - 1);
    if (isHighSurrogate(c2)) start -= 1;
  }
  return { start, end, ch: str.slice(start, end) };
}

function nextChar(str, index) {
  if (index >= str.length) return null;
  let start = index;
  let end = start + 1;
  const c = str.charCodeAt(start);
  if (isHighSurrogate(c) && start + 1 < str.length) {
    const c2 = str.charCodeAt(start + 1);
    if (isLowSurrogate(c2)) end = start + 2;
  }
  return { start, end, ch: str.slice(start, end) };
}

function isWordChar(ch) {
  const node = decodeChar(ch);
  if (node.type === "upper" || node.type === "lower" || node.type === "digit") return true;
  if (ch === "_") return true; // treat underscore as part of words
  return false;
}

function expandToWord(str, index) {
  let start = index;
  let end = index;

  // expand left
  let l = prevChar(str, start);
  while (l && isWordChar(l.ch)) {
    start = l.start;
    l = prevChar(str, start);
  }

  // expand right
  let r = nextChar(str, end);
  while (r && isWordChar(r.ch)) {
    end = r.end;
    r = nextChar(str, end);
  }

  if (end === start) return null; // no word around caret
  return { start, end };
}

function applyToSelection(textarea, styleKey, setValue) {
  const { selectionStart, selectionEnd, value } = textarea;

  // If a range is selected, use it.
  if (selectionStart !== null && selectionEnd !== null && selectionEnd > selectionStart) {
    const before = value.slice(0, selectionStart);
    const selected = value.slice(selectionStart, selectionEnd);
    const after = value.slice(selectionEnd);
    const replaced = toggleTransform(selected, styleKey);
    const next = before + replaced + after;
    setValue(next);
    const newStart = selectionStart;
    const newEnd = selectionStart + replaced.length;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(newStart, newEnd);
    });
    return;
  }

  // Otherwise, expand caret to current word and apply.
  if (selectionStart === selectionEnd) {
    const caret = selectionStart ?? 0;
    const span = expandToWord(value, caret);
    if (!span) return; // nothing to do if not on a word
    const { start, end } = span;
    const before = value.slice(0, start);
    const selected = value.slice(start, end);
    const after = value.slice(end);
    const replaced = toggleTransform(selected, styleKey);
    const next = before + replaced + after;
    setValue(next);
    const newStart = start;
    const newEnd = start + replaced.length;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(newStart, newEnd);
    });
  }
}

function useHotkeys(textareaRef, handlers) {
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key.toLowerCase() === "b") {
        e.preventDefault();
        handlers["bold"]?.();
      } else if (e.key.toLowerCase() === "i") {
        e.preventDefault();
        handlers["italic"]?.();
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [textareaRef, handlers]);
}

export default function UnicodeEditor() {
  const [value, setValue] = useState("");
  const textareaRef = useRef(null);

  useHotkeys(textareaRef, {
    bold: () => handleStyleClick("bold"),
    italic: () => handleStyleClick("italic"),
  });

  function handleStyleClick(key) {
    const ta = textareaRef.current;
    if (!ta) return;
    applyToSelection(ta, key, setValue);
  }

  function handleCopy() {
    navigator.clipboard.writeText(value).catch(() => {});
  }

  function handleClear() {
    setValue("");
    textareaRef.current?.focus();
  }

  return (
    <div className="min-h-screen w-full bg-neutral-50 text-neutral-900 flex flex-col">
      <div className="flex-1 mx-auto max-w-5xl px-4 py-8 w-full flex flex-col">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Unicode Editor</h1>
            <p className="text-sm text-neutral-600">Type plain text. Select text and click a style to convert or toggle Unicode equivalents.</p>
          </div>
          <div className="flex gap-2 items-center">
            <a
              href="https://github.com/SpunkyAmigo/unicode-editor"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md px-4 py-2 shadow-sm bg-gray-800 text-white hover:bg-gray-700 active:scale-[.98] flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              GitHub
            </a>
            <span className="text-sm text-neutral-500">⭐ Don't forget to give a star!</span>
          </div>
        </header>

        {/* Toolbar */}
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-7">
          {STYLES.map((s) => (
            <button
              key={s.key}
              onClick={() => handleStyleClick(s.key)}
              className="rounded-md bg-white px-3 py-2 text-sm shadow-sm border border-neutral-200 hover:bg-neutral-100"
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Editor */}
        <div className="mt-4 flex-1 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-neutral-700">Editor</label>
            <button
              onClick={handleCopy}
              className="rounded-md p-2 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800 transition-colors"
              title="Copy Unicode"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          </div>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Type here... Select text or place the caret in a word and use Ctrl/Cmd+B (Bold) or Ctrl/Cmd+I (Italic)."
            className="flex-1 w-full resize-none rounded-md border border-neutral-200 bg-white p-4 leading-relaxed shadow-sm focus:outline-none focus:ring-2 focus:ring-neutral-800"
          />
          <p className="mt-2 text-xs text-neutral-500">
            Tip: If no text is selected, toggling will apply to the current word. Applying the same style again toggles it. If both are on, toggling one leaves the other.
          </p>
        </div>
      </div>
    </div>
  );
}
