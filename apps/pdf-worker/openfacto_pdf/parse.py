"""One PDF per fresh process. Stdin accepts bytes only, stdout returns bounded JSON."""

import json
import os
import sys
import unicodedata

MAX_BYTES = 8 * 1024 * 1024
MAX_PAGES = 300
MAX_TEXT = 1_000_000
MAX_MEMORY = 512 * 1024 * 1024


def restrict_process():
    if os.name == "posix":
        import resource

        resource.setrlimit(resource.RLIMIT_AS, (MAX_MEMORY, MAX_MEMORY))
        resource.setrlimit(resource.RLIMIT_CPU, (15, 16))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    elif os.name == "nt":
        import ctypes
        from ctypes import wintypes

        class BasicLimits(ctypes.Structure):
            _fields_ = [
                ("process_time", ctypes.c_int64), ("job_time", ctypes.c_int64),
                ("flags", wintypes.DWORD), ("min_ws", ctypes.c_size_t),
                ("max_ws", ctypes.c_size_t), ("active", wintypes.DWORD),
                ("affinity", ctypes.c_size_t), ("priority", wintypes.DWORD),
                ("scheduling", wintypes.DWORD),
            ]

        class ExtendedLimits(ctypes.Structure):
            _fields_ = [
                ("basic", BasicLimits), ("io", ctypes.c_uint64 * 6),
                ("process_memory", ctypes.c_size_t), ("job_memory", ctypes.c_size_t),
                ("peak_process", ctypes.c_size_t), ("peak_job", ctypes.c_size_t),
            ]

        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateJobObjectW.restype = wintypes.HANDLE
        kernel.GetCurrentProcess.restype = wintypes.HANDLE
        job = wintypes.HANDLE(kernel.CreateJobObjectW(None, None))
        limits = ExtendedLimits()
        limits.basic.flags = 0x100 | 0x02  # ProcessMemory + ProcessTime
        limits.basic.process_time = 15 * 10_000_000
        limits.process_memory = MAX_MEMORY
        if not job or not kernel.SetInformationJobObject(
            job, 9, ctypes.byref(limits), ctypes.sizeof(limits)
        ) or not kernel.AssignProcessToJobObject(job, wintypes.HANDLE(kernel.GetCurrentProcess())):
            raise RuntimeError("ISOLATION_FAILED")


def page_issue(page, text):
    # OCR-less scans can contain a page number or a short invisible header.
    letters = sum(c.isalpha() for c in text)
    damaged = sum(c == "\ufffd" or unicodedata.category(c) == "Co" for c in text)
    unusable = not any(c.isalnum() for c in text) or damaged > len(text) / 5
    if not unusable and letters >= 20:
        return None
    import pymupdf

    images = page.get_image_info()
    if unusable:
        return "needs_ocr" if images else "needs_text"
    area = page.rect.get_area()
    if any((page.rect & pymupdf.Rect(img["bbox"])).get_area() >= area / 2 for img in images):
        return "needs_ocr"
    return None


def extract(data):
    import pymupdf

    if len(data) > MAX_BYTES or not data.startswith(b"%PDF-"):
        raise ValueError
    pymupdf.TOOLS.mupdf_display_errors(False)
    pymupdf.TOOLS.mupdf_display_warnings(False)
    with pymupdf.open(stream=data, filetype="pdf") as document:
        if (not document.is_pdf or document.needs_pass
                or not 1 <= document.page_count <= MAX_PAGES):
            raise ValueError
        pages = []
        diagnostics = []
        length = 0
        for index, page in enumerate(document):
            text = page.get_text("text", sort=True).replace("\x00", "").strip()
            length += len(text)
            if length > MAX_TEXT:
                raise ValueError
            issue = page_issue(page, text)
            if issue:
                diagnostics.append({"page": index + 1, "status": issue})
            else:
                pages.append({"page": index + 1, "text": text})
        if diagnostics:
            return {"code": "PDF_PAGES_NEED_TEXT", "pageCount": document.page_count,
                    "pageDiagnostics": diagnostics}
        return {"pages": pages, "pageCount": document.page_count}


def main():
    restrict_process()
    try:
        result = extract(sys.stdin.buffer.read(MAX_BYTES + 1))
    except ImportError:
        return 1
    except Exception:
        return 2
    sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False).encode("utf-8"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
