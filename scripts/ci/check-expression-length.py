#!/usr/bin/env python3
"""
Guardrail: fail CI if any GitHub Actions ${{ ... }} expression exceeds a safe
threshold, well below GitHub's hard 21000-character limit.

Usage: python3 scripts/ci/check-expression-length.py [<workflow-file>...]
Defaults to scanning every .yml/.yaml under .github/workflows/.
"""
import sys, glob, os

THRESHOLD = 5000  # ~24% of GitHub's 21000 limit — generous safety margin

def find_expressions(text):
    """Yield (start_line, length) for every top-level ${{ ... }} expression."""
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
            # Unclosed expression — let GitHub report it
            return
        yield (text[:j].count('\n') + 1, k - j, text[j:k])
        i = k

def main(paths):
    if not paths:
        paths = sorted(glob.glob('.github/workflows/*.yml') +
                       glob.glob('.github/workflows/*.yaml'))
    if not paths:
        print('No workflow files found.', file=sys.stderr)
        return 0
    failed = False
    max_seen = 0
    for path in paths:
        if not os.path.isfile(path):
            continue
        text = open(path, 'r', encoding='utf-8').read()
        for line, length, expr in find_expressions(text):
            max_seen = max(max_seen, length)
            if length > THRESHOLD:
                failed = True
                print(f'::error file={path},line={line}::Expression length '
                      f'{length} exceeds threshold {THRESHOLD}: '
                      f'{expr[:120]}...')
    if failed:
        print(f'\nFAIL — at least one expression exceeded {THRESHOLD} chars.',
              file=sys.stderr)
        return 1
    print(f'OK — largest expression: {max_seen} chars '
          f'(threshold {THRESHOLD}, GitHub limit 21000).')
    return 0

if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
