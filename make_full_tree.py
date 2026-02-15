# -*- coding: utf-8 -*-
"""
make_full_tree.py

✅ 더블클릭(인자 없이 실행) 시 기본 동작
- root: C:\\Myproject (존재하면)
- out : C:\\Myproject\\project_file_tree_YYYY-MM-DD_HH-MM-SS.txt (항상 저장)
- 작업 완료 후 자동 종료(엔터 대기 없음)

✅ PowerShell/CLI에서 실행 예시
- python C:\\Myproject\\make_full_tree.py
- python C:\\Myproject\\make_full_tree.py C:\\Myproject -o C:\\Myproject\\project_file_tree.txt --max-depth 12
- python C:\\Myproject\\make_full_tree.py D:\\OtherProject -o D:\\OtherProject\\tree.txt --max-depth 8

주의:
- 콘솔에서 유니코드 트리 문자가 깨지면 PowerShell에서:
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
"""

from __future__ import annotations

import argparse
import fnmatch
import os
import sys
from datetime import datetime  # ✅ [추가] 날짜/시간 포맷팅용
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Set, Tuple

HERE = Path(__file__).resolve().parent

def _norm(s: str) -> str:
    return s.lower() if os.name == "nt" else s


# =========================================================
# 기본 제외 목록(폴더/파일/글롭)
# =========================================================
DEFAULT_EXCLUDE_DIRS: Set[str] = {
    "node_modules",
    ".git",
    ".expo",
    ".expo-shared",
    "assets",
    ".idea",
    ".vscode",
    ".metro-cache",
    ".gradle",
    "build",
    "dist",
    "out",
    "coverage",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".cache",
    ".turbo",
    ".parcel-cache",
    ".pytest_cache",
    "__pycache__",
}

DEFAULT_EXCLUDE_PATH_CONTAINS: Tuple[str, ...] = (
    "android/.gradle",
    "android/app/build",
    "android/app/.cxx",
    "ios/pods",
    "ios/build",
    "web-build",
)

DEFAULT_EXCLUDE_FILES: Set[str] = {
    ".ds_store",
    "thumbs.db",
}

DEFAULT_EXCLUDE_GLOBS: Tuple[str, ...] = (
    "*.log",
    "*.tmp",
    "*.cache",
)


# =========================================================
# 기본값(더블클릭용 고정)
# =========================================================
DEFAULT_ROOT_WINDOWS = str(HERE)

# ✅ [수정] 기본 파일명 생성 함수 (날짜/시간 포함)
def get_default_out_path():
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    return str(HERE / f"{HERE.name}_tree_{timestamp}.txt")


@dataclass
class Options:
    root: Path
    max_depth: int
    show_files: bool
    max_entries_per_dir: int
    exclude_dirs: Set[str]
    exclude_files: Set[str]
    exclude_globs: Tuple[str, ...]
    exclude_path_contains: Tuple[str, ...]


def should_exclude_dir(dir_name: str, rel_posix: str, opt: Options) -> bool:
    dn = _norm(dir_name)
    if dn in opt.exclude_dirs:
        return True

    reln = _norm(rel_posix)
    for frag in opt.exclude_path_contains:
        if _norm(frag) in reln:
            return True
    return False


def should_exclude_file(file_name: str, opt: Options) -> bool:
    fn = _norm(file_name)
    if fn in opt.exclude_files:
        return True
    for pat in opt.exclude_globs:
        if fnmatch.fnmatch(fn, _norm(pat)):
            return True
    return False


def iter_children(path: Path) -> List[Path]:
    try:
        children = list(path.iterdir())
    except (PermissionError, OSError):
        return []
    children.sort(key=lambda p: (p.is_file(), _norm(p.name)))  # 폴더 먼저
    return children


def build_tree_lines(opt: Options) -> List[str]:
    root = opt.root.resolve()
    lines: List[str] = []
    lines.append(f"{root.name}/")

    def walk_dir(curr: Path, prefix: str, depth: int) -> None:
        if depth >= opt.max_depth:
            return

        rel_curr = curr.relative_to(root).as_posix() if curr != root else ""
        if rel_curr and should_exclude_dir(curr.name, rel_curr, opt):
            return

        children = iter_children(curr)

        filtered: List[Path] = []
        for child in children:
            rel = child.relative_to(root).as_posix()
            if child.is_dir():
                if should_exclude_dir(child.name, rel, opt):
                    continue
                filtered.append(child)
            else:
                if not opt.show_files:
                    continue
                if should_exclude_file(child.name, opt):
                    continue
                filtered.append(child)

        skipped = 0
        if opt.max_entries_per_dir > 0 and len(filtered) > opt.max_entries_per_dir:
            skipped = len(filtered) - opt.max_entries_per_dir
            filtered = filtered[: opt.max_entries_per_dir]

        count = len(filtered)
        for i, child in enumerate(filtered):
            is_last = i == (count - 1) and skipped == 0
            branch = "└── " if is_last else "├── "

            if child.is_dir():
                lines.append(f"{prefix}{branch}{child.name}/")
                extension = "    " if is_last else "│   "
                walk_dir(child, prefix + extension, depth + 1)
            else:
                lines.append(f"{prefix}{branch}{child.name}")

        if skipped > 0:
            lines.append(f"{prefix}└── … (skipped {skipped} entries)")

    walk_dir(root, "", 0)
    return lines


def parse_csv_set(v: Optional[str]) -> Set[str]:
    if not v:
        return set()
    return {_norm(x.strip()) for x in v.split(",") if x.strip()}


def _default_root() -> str:
    # Windows에서 C:\Myproject가 있으면 그걸 기본으로, 아니면 현재 폴더
    if os.name == "nt" and Path(DEFAULT_ROOT_WINDOWS).is_dir():
        return DEFAULT_ROOT_WINDOWS
    return "."


def _default_out() -> str:
    # Windows 기본 저장 위치 (날짜 시간 포함)
    if os.name == "nt":
        return get_default_out_path()
    return ""  # 비-Windows는 기본 stdout


def main(argv: Optional[List[str]] = None) -> int:
    # ✅ [수정] argparse 기본값 설정 시 함수 호출이 아닌 None으로 설정 후 내부 처리
    # (매번 실행 시점의 시간을 반영하기 위함)
    p = argparse.ArgumentParser(
        description="Generate a filtered project file tree (Explorer-friendly)."
    )
    p.add_argument(
        "root",
        nargs="?",
        default=_default_root(),
        help="Root directory (default: C:\\Myproject if exists, else current directory).",
    )
    p.add_argument(
        "-o",
        "--out",
        default=None, # None으로 설정 후 아래에서 처리
        help="Output file path (default: current_folder_tree_YYYY-MM-DD_HH-MM-SS.txt).",
    )
    p.add_argument(
        "--stdout",
        action="store_true",
        help="Print to stdout (ignore --out default).",
    )
    p.add_argument(
        "--max-depth",
        type=int,
        default=12,
        help="Max directory depth to traverse (default: 12).",
    )
    p.add_argument(
        "--no-files",
        action="store_true",
        help="Do not include files; show directories only.",
    )
    p.add_argument(
        "--max-entries",
        type=int,
        default=300,
        help="Max entries per directory (default: 300). 0 means unlimited.",
    )
    p.add_argument(
        "--exclude-dir",
        default="",
        help="Additional comma-separated dir names to exclude (e.g. temp,.history).",
    )
    p.add_argument(
        "--include-dir",
        default="",
        help="Comma-separated dir names to FORCE include (remove from default excludes).",
    )
    p.add_argument(
        "--no-default-excludes",
        action="store_true",
        help="Disable default excludes (node_modules/.git/etc).",
    )

    args = p.parse_args(argv)

    root = Path(args.root)
    if not root.exists() or not root.is_dir():
        print(f"ERROR: root is not a directory: {root}", file=sys.stderr)
        return 2

    # ✅ [수정] --out 옵션이 없으면 기본값(날짜 포함) 생성
    out_file = args.out
    if not out_file and not args.stdout:
        out_file = _default_out()
        # Windows가 아니거나 _default_out이 비어있으면 현재 경로 기준 생성
        if not out_file:
             timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
             out_file = f"file_tree_{timestamp}.txt"

    if args.no_default_excludes:
        base_exclude_dirs = set()
        base_exclude_path_contains: Tuple[str, ...] = tuple()
        base_exclude_files = set()
        base_exclude_globs: Tuple[str, ...] = tuple()
    else:
        base_exclude_dirs = {_norm(x) for x in DEFAULT_EXCLUDE_DIRS}
        base_exclude_path_contains = DEFAULT_EXCLUDE_PATH_CONTAINS
        base_exclude_files = {_norm(x) for x in DEFAULT_EXCLUDE_FILES}
        base_exclude_globs = DEFAULT_EXCLUDE_GLOBS

    extra_ex_dirs = parse_csv_set(args.exclude_dir)
    include_dirs = parse_csv_set(args.include_dir)
    exclude_dirs = (base_exclude_dirs | extra_ex_dirs) - include_dirs

    opt = Options(
        root=root,
        max_depth=max(1, int(args.max_depth)),
        show_files=not args.no_files,
        max_entries_per_dir=max(0, int(args.max_entries)),
        exclude_dirs=exclude_dirs,
        exclude_files=base_exclude_files,
        exclude_globs=base_exclude_globs,
        exclude_path_contains=base_exclude_path_contains,
    )

    lines = build_tree_lines(opt)
    text = "\n".join(lines) + "\n"

    # 출력
    if args.stdout:
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass
        sys.stdout.write(text)
        return 0

    if out_file:
        out_path = Path(out_file)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(text, encoding="utf-8")
        print(f"✅ 완료: {out_path}")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:
        print(f"❌ 오류: {e}", file=sys.stderr)
        raise SystemExit(1)