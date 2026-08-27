"""Create and verify a clean advancement-opinion template.

The bundled template contains an illustration for layout reference only.  It
must never appear in an enterprise-specific advancement opinion.  This tool
removes renderable picture markup from a DOCX copy before it is filled, and
can also verify a completed DOCX has no residual image markup.
"""

from __future__ import annotations

import argparse
import zipfile
from pathlib import Path

from lxml import etree


DRAWING_TAGS = {
    "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}drawing",
    "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}pict",
    "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}object",
}
XML_PART_PREFIXES = ("word/document.xml", "word/header", "word/footer")


def is_content_part(name: str) -> bool:
    return name == "word/document.xml" or name.startswith("word/header") or name.startswith("word/footer")


def count_renderable_images(docx_path: Path) -> int:
    count = 0
    with zipfile.ZipFile(docx_path) as archive:
        for name in archive.namelist():
            if not is_content_part(name) or not name.endswith(".xml"):
                continue
            root = etree.fromstring(archive.read(name))
            count += sum(1 for node in root.iter() if node.tag in DRAWING_TAGS)
    return count


def clean_template(source: Path, destination: Path) -> int:
    destination.parent.mkdir(parents=True, exist_ok=True)
    removed = 0
    with zipfile.ZipFile(source) as original, zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as cleaned:
        for item in original.infolist():
            data = original.read(item.filename)
            if is_content_part(item.filename) and item.filename.endswith(".xml"):
                root = etree.fromstring(data)
                for node in list(root.iter()):
                    if node.tag in DRAWING_TAGS:
                        parent = node.getparent()
                        if parent is not None:
                            parent.remove(node)
                            removed += 1
                data = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)
            cleaned.writestr(item, data)
    return removed


def main() -> None:
    parser = argparse.ArgumentParser(description="清除或检查推进意见模板中的示例图片")
    parser.add_argument("--input", required=True, type=Path, help="原模板或待检查DOCX")
    parser.add_argument("--output", type=Path, help="清图后的模板输出路径；未提供时只检查")
    parser.add_argument("--check", action="store_true", help="仅检查，不写文件")
    args = parser.parse_args()

    if not args.input.is_file():
        raise SystemExit(f"文件不存在：{args.input}")
    if args.check or args.output is None:
        remaining = count_renderable_images(args.input)
        if remaining:
            raise SystemExit(f"ADVANCEMENT_IMAGE_CHECK_FAILED: 发现 {remaining} 个可渲染图片对象：{args.input}")
        print(f"ADVANCEMENT_IMAGE_CHECK_OK: {args.input}")
        return

    removed = clean_template(args.input, args.output)
    remaining = count_renderable_images(args.output)
    if remaining:
        raise SystemExit(f"ADVANCEMENT_TEMPLATE_CLEAN_FAILED: 仍有 {remaining} 个图片对象")
    print(f"ADVANCEMENT_TEMPLATE_READY: removed={removed}; output={args.output}")


if __name__ == "__main__":
    main()
