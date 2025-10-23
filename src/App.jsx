import React, { useEffect, useRef, useState } from "react";
import { 
  MdFormatBold, 
  MdFormatItalic, 
  MdFormatListBulleted, 
  MdFormatListNumbered,
  MdContentCopy,
  MdCheck
} from "react-icons/md";
import { FaGithub } from "react-icons/fa";

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

// ---------- List management helpers ---------- //
function getLineRange(text, selectionStart, selectionEnd) {
  // Find the start and end of the lines that contain the selection
  let lineStart = selectionStart;
  let lineEnd = selectionEnd;
  
  // Move lineStart to the beginning of the line
  while (lineStart > 0 && text[lineStart - 1] !== '\n') {
    lineStart--;
  }
  
  // Move lineEnd to the end of the line (or end of text)
  while (lineEnd < text.length && text[lineEnd] !== '\n') {
    lineEnd++;
  }
  
  return { lineStart, lineEnd };
}

function isLineWithBullet(line) {
  return /^\s*•\s/.test(line);
}

function isLineWithNumber(line) {
  return /^\s*\d+\.\s/.test(line);
}

function getNumberFromLine(line) {
  const match = line.match(/^\s*(\d+)\.\s/);
  return match ? parseInt(match[1], 10) : null;
}

function addBulletToLine(line) {
  // If line already has bullet, remove it
  if (isLineWithBullet(line)) {
    return line.replace(/^\s*•\s/, '');
  }
  // If line has number, replace with bullet
  if (isLineWithNumber(line)) {
    return line.replace(/^\s*\d+\.\s/, '• ');
  }
  // Add bullet to line
  const indent = line.match(/^\s*/)?.[0] || '';
  const content = line.slice(indent.length);
  return content ? `${indent}• ${content}` : `${indent}• `;
}

function addNumberToLine(line, number) {
  // If line already has number, remove it
  if (isLineWithNumber(line)) {
    return line.replace(/^\s*\d+\.\s/, '');
  }
  // If line has bullet, replace with number
  if (isLineWithBullet(line)) {
    return line.replace(/^\s*•\s/, `${number}. `);
  }
  // Add number to line
  const indent = line.match(/^\s*/)?.[0] || '';
  const content = line.slice(indent.length);
  return content ? `${indent}${number}. ${content}` : `${indent}${number}. `;
}

function toggleListOnSelection(textarea, listType, setValue, setListMode, setCurrentNumber) {
  const { selectionStart, selectionEnd, value } = textarea;
  const { lineStart, lineEnd } = getLineRange(value, selectionStart, selectionEnd);
  
  const before = value.slice(0, lineStart);
  const selectedLines = value.slice(lineStart, lineEnd);
  const after = value.slice(lineEnd);
  
  const lines = selectedLines.split('\n');
  let processedLines;
  let newListMode = "none";
  
  if (listType === "bullets") {
    // Check if any line has bullets - if so, remove all bullets, otherwise add bullets
    const hasBullets = lines.some(line => isLineWithBullet(line));
    processedLines = lines.map(line => addBulletToLine(line));
    newListMode = hasBullets ? "none" : "bullets";
  } else if (listType === "numbers") {
    // Check if any line has numbers - if so, remove all numbers, otherwise add numbers
    const hasNumbers = lines.some(line => isLineWithNumber(line));
    let currentNum = 1;
    processedLines = lines.map(line => {
      if (line.trim() === '') return line; // Don't number empty lines
      const result = addNumberToLine(line, currentNum);
      if (!hasNumbers && result !== line) currentNum++;
      return result;
    });
    newListMode = hasNumbers ? "none" : "numbers";
    setCurrentNumber(currentNum);
  }
  
  const newContent = before + processedLines.join('\n') + after;
  setValue(newContent);
  setListMode(newListMode);
  
  // Restore selection
  const newSelectionStart = lineStart;
  const newSelectionEnd = lineStart + processedLines.join('\n').length;
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(newSelectionStart, newSelectionEnd);
  });
}

function useHotkeys(textareaRef, handlers) {
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      const shift = e.shiftKey;
      
      // Handle list shortcuts
      if (mod && shift && e.key === '8') {
        e.preventDefault();
        handlers["bullets"]?.();
        return;
      }
      if (mod && shift && e.key === '7') {
        e.preventDefault();
        handlers["numbers"]?.();
        return;
      }
      
      // Handle Enter key for list continuation
      if (e.key === "Enter") {
        const handled = handlers["enter"]?.(e);
        if (handled) {
          e.preventDefault();
        }
        return;
      }
      
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
  const [copySuccess, setCopySuccess] = useState(false);
  const [listMode, setListMode] = useState("none"); // "none", "bullets", "numbers"
  const [currentNumber, setCurrentNumber] = useState(1);
  const textareaRef = useRef(null);

  useHotkeys(textareaRef, {
    bold: () => handleStyleClick("bold"),
    italic: () => handleStyleClick("italic"),
    bullets: () => handleListClick("bullets"),
    numbers: () => handleListClick("numbers"),
    enter: handleEnterKey,
  });

  function handleStyleClick(key) {
    const ta = textareaRef.current;
    if (!ta) return;
    applyToSelection(ta, key, setValue);
  }

  function handleListClick(listType) {
    const ta = textareaRef.current;
    if (!ta) return;
    toggleListOnSelection(ta, listType, setValue, setListMode, setCurrentNumber);
  }

  function handleEnterKey(e) {
    const ta = textareaRef.current;
    if (!ta) return false;
    
    const { selectionStart, value } = ta;
    
    // Find the current line
    let lineStart = selectionStart;
    while (lineStart > 0 && value[lineStart - 1] !== '\n') {
      lineStart--;
    }
    
    const currentLine = value.slice(lineStart, selectionStart);
    
    // Check if current line has a bullet or number
    if (isLineWithBullet(currentLine)) {
      // If the line only has the bullet (no content), remove the bullet and exit list mode
      if (/^\s*•\s*$/.test(currentLine)) {
        const before = value.slice(0, lineStart);
        const after = value.slice(selectionStart);
        setValue(before.trimEnd() + '\n' + after);
        setListMode("none");
        requestAnimationFrame(() => {
          ta.setSelectionRange(lineStart + 1, lineStart + 1);
        });
        return true;
      }
      
      // Continue with bullet
      const indent = currentLine.match(/^\s*/)?.[0] || '';
      const newLine = `\n${indent}• `;
      const before = value.slice(0, selectionStart);
      const after = value.slice(selectionStart);
      setValue(before + newLine + after);
      requestAnimationFrame(() => {
        const newPos = selectionStart + newLine.length;
        ta.setSelectionRange(newPos, newPos);
      });
      return true;
    }
    
    if (isLineWithNumber(currentLine)) {
      // If the line only has the number (no content), remove the number and exit list mode
      if (/^\s*\d+\.\s*$/.test(currentLine)) {
        const before = value.slice(0, lineStart);
        const after = value.slice(selectionStart);
        setValue(before.trimEnd() + '\n' + after);
        setListMode("none");
        setCurrentNumber(1);
        requestAnimationFrame(() => {
          ta.setSelectionRange(lineStart + 1, lineStart + 1);
        });
        return true;
      }
      
      // Continue with next number
      const number = getNumberFromLine(currentLine);
      const indent = currentLine.match(/^\s*/)?.[0] || '';
      const nextNumber = (number || 0) + 1;
      const newLine = `\n${indent}${nextNumber}. `;
      const before = value.slice(0, selectionStart);
      const after = value.slice(selectionStart);
      setValue(before + newLine + after);
      setCurrentNumber(nextNumber + 1);
      requestAnimationFrame(() => {
        const newPos = selectionStart + newLine.length;
        ta.setSelectionRange(newPos, newPos);
      });
      return true;
    }
    
    // If we're in list mode but current line doesn't have formatting, add it
    if (listMode === "bullets") {
      const newLine = '\n• ';
      const before = value.slice(0, selectionStart);
      const after = value.slice(selectionStart);
      setValue(before + newLine + after);
      requestAnimationFrame(() => {
        const newPos = selectionStart + newLine.length;
        ta.setSelectionRange(newPos, newPos);
      });
      return true;
    }
    
    if (listMode === "numbers") {
      const newLine = `\n${currentNumber}. `;
      const before = value.slice(0, selectionStart);
      const after = value.slice(selectionStart);
      setValue(before + newLine + after);
      setCurrentNumber(currentNumber + 1);
      requestAnimationFrame(() => {
        const newPos = selectionStart + newLine.length;
        ta.setSelectionRange(newPos, newPos);
      });
      return true;
    }
    
    return false; // Let default Enter behavior happen
  }

  function handleCopy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }).catch(() => {});
  }

  function handleClear() {
    setValue("");
    textareaRef.current?.focus();
  }

  // Character and word count logic
  const characterCount = value.length;
  const wordCount = value.trim() === "" ? 0 : value.trim().split(/\s+/).length;

  return (
    <div className="min-h-screen w-full bg-neutral-50 text-neutral-900 flex flex-col">
      <div className="flex-1 mx-auto max-w-5xl px-4 py-8 w-full flex flex-col">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Unicode Editor</h1>
            <p className="text-sm text-neutral-600">Type plain text. Select text and click a style to convert or toggle Unicode equivalents.</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <a
              href="https://github.com/SpunkyAmigo/unicode-editor"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg px-4 py-2.5 shadow-lg bg-gradient-to-r from-gray-800 to-gray-900 text-white hover:from-gray-700 hover:to-gray-800 active:scale-[.98] flex items-center gap-2 transition-all duration-200 border border-gray-600/20"
            >
              <FaGithub className="w-4 h-4" />
              GitHub
            </a>
            <span className="text-xs text-neutral-500">⭐ Don't forget to give a star!</span>
          </div>
        </header>

        {/* Editor */}
        <div className="mt-4 flex-1 flex flex-col relative">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-neutral-700">Editor</label>
          </div>
          {/* Toolbar: compact, neat, all controls in one row */}
          <div className="mb-3 flex items-center gap-2 px-2 py-1 rounded-md bg-white border border-neutral-200 shadow-sm">
            {/* Character and word count */}
            <span className="text-xs text-neutral-500 px-2">Chars: <strong>{characterCount}</strong></span>
            <span className="text-xs text-neutral-500 px-2">Words: <strong>{wordCount}</strong></span>
            {/* Separator */}
            <span className="mx-2 h-5 w-px bg-neutral-200" />
            {/* Style buttons */}
            <button
              onClick={() => handleStyleClick("bold")}
              className="rounded-md p-2 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800 transition-colors border border-neutral-200 hover:border-neutral-300"
              title="Bold (Ctrl/Cmd+B)"
            >
              <MdFormatBold className="w-5 h-5" />
            </button>
            <button
              onClick={() => handleStyleClick("italic")}
              className="rounded-md p-2 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800 transition-colors border border-neutral-200 hover:border-neutral-300"
              title="Italic (Ctrl/Cmd+I)"
            >
              <MdFormatItalic className="w-5 h-5" />
            </button>
            {/* Separator */}
            <span className="mx-2 h-5 w-px bg-neutral-200" />
            {/* List buttons */}
            <button
              onClick={() => handleListClick("bullets")}
              className={`rounded-md p-2 transition-colors border ${
                listMode === "bullets" 
                  ? "bg-neutral-800 text-white border-neutral-800" 
                  : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800 border-neutral-200 hover:border-neutral-300"
              }`}
              title="Bullet List (Ctrl/Cmd+Shift+8)"
            >
              <MdFormatListBulleted className="w-5 h-5" />
            </button>
            <button
              onClick={() => handleListClick("numbers")}
              className={`rounded-md p-2 transition-colors border ${
                listMode === "numbers" 
                  ? "bg-neutral-800 text-white border-neutral-800" 
                  : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800 border-neutral-200 hover:border-neutral-300"
              }`}
              title="Numbered List (Ctrl/Cmd+Shift+7)"
            >
              <MdFormatListNumbered className="w-5 h-5" />
            </button>
            {/* Separator */}
            <span className="mx-2 h-5 w-px bg-neutral-200" />
            {/* Copy button */}
            <button
              onClick={handleCopy}
              className="rounded-md p-2 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800 transition-colors border border-neutral-200 hover:border-neutral-300"
              title="Copy Unicode"
              style={{ minWidth: 36 }}
            >
              {copySuccess ? (
                <MdCheck className="w-4 h-4 text-green-600" />
              ) : (
                <MdContentCopy className="w-4 h-4" />
              )}
            </button>
          </div>
          {/* Editor textarea */}
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
