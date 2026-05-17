#!/usr/bin/env python3
"""
Guardrails for GitHub Actions workflows:

  1. Fail if any ${{ ... }} expression exceeds EXPR_THRESHOLD chars
     (GitHub hard limit: 21000).
  2. Fail if a `run:` heredoc contains ${{ ... }} AND the body exceeds
     HEREDOC_DANGER chars — that combo is what blew past the 21000 limit
     before, because GitHub substitutes ${{ }} into the script text
     pre-shell.
  3. Warn (non-failing) on:
       - any ${{ }} inside a heredoc (suggest moving to an external script)
       - heredoc bodies > HEREDOC_WARN chars even without ${{ }}.

Usage: python3 scripts/ci/check-expression-length.py [<workflow-file>...]
Defaults to scanning every .yml/.yaml under .github/workflows/.
"""
import sys, glob, os, re

EXPR_THRESHOLD = 5000      # ~24% of GitHub's 21000 limit
HEREDOC_DANGER = 4000      # fail if heredoc has ${{ }} AND body > this
HEREDOC_WARN   = 8000      # warn-only for plain large heredocs


# ---------- expression scanner ----------

def find_expressions(text):
    """Yield (line, length, snippet) for every top-level ${{ ... }} expression."""
    i, n = 0, len(text)
    while i < n:
        j = text.find('${{', i)
        if j < 0:
            return
        depth = 0
        k = j
        while k < n:
            if text[k:k+2] == '}}' and depth == 1:
                k += 2
                break
            if text[k:k+3] == '${{':
                depth += 1
                k += 3
            elif text[k:k+2] == '}}':
                depth -= 1
                k += 2
            else:
                k += 1
        else:
            return
        yield (text[:j].count('\n') + 1, k - j, text[j:k])
        i = k


# ---------- heredoc scanner ----------

# Matches `<<` or `<<-` followed by an optionally-quoted terminator word.
HEREDOC_RE = re.compile(r"<<-?\s*['\"]?([A-Za-z_][A-Za-z0-9_]*)['\"]?")
# Matches a `run:` key (block or flow scalar start) — we then scan its body.
RUN_KEY_RE = re.compile(r"^(\s*)(?:-\s+)?run:\s*[|>]?[+-]?\s*$", re.MULTILINE)


def iter_run_blocks(text):
    """Yield (start_line, indent, body_text) for every `run: |` style block."""
    lines = text.splitlines(keepends=True)
    # Build line offsets
    offsets = [0]
    for ln in lines:
        offsets.append(offsets[-1] + len(ln))

    i = 0
    while i < len(lines):
        m = re.match(r"^(\s*)(?:-\s+)?run:\s*([|>][+-]?)?\s*$", lines[i])
        if not m:
            i += 1
            continue
        key_indent = len(m.group(1))
        # Determine body indent from first non-empty subsequent line
        j = i + 1
        body_indent = None
        body_start = j
        while j < len(lines):
            stripped = lines[j].rstrip('\n')
            if stripped.strip() == '':
                j += 1
                continue
            cur_indent = len(stripped) - len(stripped.lstrip(' '))
            if body_indent is None:
                if cur_indent <= key_indent:
                    break  # empty run block
                body_indent = cur_indent
            if cur_indent < body_indent and stripped.strip() != '':
                break
            j += 1
        if body_indent is not None and j > body_start:
            body = ''.join(lines[body_start:j])
            yield (body_start + 1, body_indent, body)
        i = max(j, i + 1)


def find_heredocs_in_run(body, body_start_line, body_indent):
    """Yield (start_line, terminator, body_text) for each heredoc inside a run body."""
    lines = body.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        # Strip YAML body indent for shell parsing
        shell_line = line[body_indent:] if len(line) >= body_indent else line.lstrip(' ')
        m = HEREDOC_RE.search(shell_line)
        if not m:
            i += 1
            continue
        term = m.group(1)
        # Find terminator line
        start = i + 1
        end = None
        for k in range(start, len(lines)):
            shell_k = lines[k][body_indent:] if len(lines[k]) >= body_indent else lines[k].lstrip(' ')
            if shell_k.strip() == term:
                end = k
                break
        if end is None:
            # Unterminated — skip
            i += 1
            continue
        hd_body = '\n'.join(lines[start:end])
        yield (body_start_line + i, term, hd_body)
        i = end + 1


# ---------- main ----------

def main(paths):
    if not paths:
        paths = sorted(glob.glob('.github/workflows/*.yml') +
                       glob.glob('.github/workflows/*.yaml'))
    if not paths:
        print('No workflow files found.', file=sys.stderr)
        return 0

    failed = False
    warn_count = 0
    max_expr = 0
    max_heredoc = 0

    for path in paths:
        if not os.path.isfile(path):
            continue
        text = open(path, 'r', encoding='utf-8').read()

        # 1) Expression length
        for line, length, expr in find_expressions(text):
            max_expr = max(max_expr, length)
            if length > EXPR_THRESHOLD:
                failed = True
                print(f'::error file={path},line={line}::Expression length '
                      f'{length} exceeds threshold {EXPR_THRESHOLD}: '
                      f'{expr[:120]}...')

        # 2/3) Heredoc checks inside run blocks
        for run_start, indent, body in iter_run_blocks(text):
            for hd_line, term, hd_body in find_heredocs_in_run(body, run_start, indent):
                size = len(hd_body)
                max_heredoc = max(max_heredoc, size)
                has_expr = '${{' in hd_body
                if has_expr and size > HEREDOC_DANGER:
                    failed = True
                    print(f'::error file={path},line={hd_line}::Heredoc <<{term} '
                          f'contains ${{{{ }}}} and body is {size} chars '
                          f'(> {HEREDOC_DANGER}). Move the script body to a '
                          f'file under scripts/ci/ and pass values via env.')
                elif has_expr:
                    warn_count += 1
                    print(f'::warning file={path},line={hd_line}::Heredoc <<{term} '
                          f'contains ${{{{ }}}} ({size} chars). Prefer passing '
                          f'GitHub context via env: instead of inlining.')
                elif size > HEREDOC_WARN:
                    warn_count += 1
                    print(f'::warning file={path},line={hd_line}::Heredoc <<{term} '
                          f'body is {size} chars (> {HEREDOC_WARN}). Consider '
                          f'extracting to scripts/ci/.')

    if failed:
        print(f'\nFAIL — guardrail violations found.', file=sys.stderr)
        return 1
    print(f'OK — largest expression: {max_expr} chars '
          f'(threshold {EXPR_THRESHOLD}, GitHub limit 21000). '
          f'Largest heredoc body: {max_heredoc} chars. '
          f'Warnings: {warn_count}.')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
