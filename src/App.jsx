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

export default function UnicodeMarkdownEditor() {
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
            <h1 className="text-2xl font-bold tracking-tight">Unicode Markdown-like Editor</h1>
            <p className="text-sm text-neutral-600">Type plain text. Select text and click a style to convert or toggle Unicode equivalents.</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCopy}
              className="rounded-md px-4 py-2 shadow-sm bg-neutral-900 text-white hover:bg-neutral-800 active:scale-[.98]"
            >
              Copy Unicode
            </button>
            <button
              onClick={handleClear}
              className="rounded-md px-4 py-2 shadow-sm bg-white border border-neutral-200 hover:bg-neutral-100"
            >
              Clear
            </button>
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
          <label className="mb-2 text-sm font-medium text-neutral-700">Editor</label>
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
