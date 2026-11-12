#!/usr/bin/env python3
"""Convierte un Markdown sencillo a PDF usando solo reportlab.

Soporta: títulos (#..####), párrafos, listas (- y 1.), tablas de tuberías
(| a | b |), bloques de código (```), citas (>) y líneas horizontales (---).
En línea: **negrita**, *cursiva* y `código`.

Uso:  python3 md2pdf.py entrada.md [-o salida.pdf] [--title T] [--author A]
"""
from __future__ import annotations

import argparse
import pathlib
import re

from reportlab.lib import colors
from reportlab.lib.enums import TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (BaseDocTemplate, Frame, KeepTogether, PageTemplate,
                                Paragraph, Preformatted, Spacer, Table, TableStyle)


def esc(text: str) -> str:
    return (text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def inline(text: str) -> str:
    """Markdown en línea -> marcado de reportlab.

    El énfasis se aplica SOLO fuera de los tramos entre backticks: si no, un
    `COUNT(*)` suelto se empareja con otro asterisco del texto y se come trozos
    del código.
    """
    piezas = re.split(r"(`[^`]+`)", text)
    salida = []
    for pieza in piezas:
        if pieza.startswith("`") and pieza.endswith("`") and len(pieza) > 2:
            salida.append('<font face="Courier">%s</font>' % esc(pieza[1:-1]))
            continue
        t = esc(pieza)
        t = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", t)
        t = re.sub(r"(?<![*\w])\*([^*]+)\*(?![*\w])", r"<i>\1</i>", t)
        t = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<link href="\2" color="blue">\1</link>', t)
        salida.append(t)
    return "".join(salida)


def build_styles():
    ss = getSampleStyleSheet()
    styles = {
        "h1": ParagraphStyle("h1", parent=ss["Heading1"], fontSize=19, spaceAfter=8, textColor=colors.HexColor("#1a3a5c")),
        "h2": ParagraphStyle("h2", parent=ss["Heading2"], fontSize=15, spaceBefore=12, spaceAfter=6, textColor=colors.HexColor("#1a3a5c")),
        "h3": ParagraphStyle("h3", parent=ss["Heading3"], fontSize=12.5, spaceBefore=10, spaceAfter=4, textColor=colors.HexColor("#31506e")),
        "h4": ParagraphStyle("h4", parent=ss["Heading4"], fontSize=11, spaceBefore=8, spaceAfter=3),
        "p": ParagraphStyle("p", parent=ss["BodyText"], fontSize=9.8, leading=14, alignment=TA_JUSTIFY, spaceAfter=5),
        "li": ParagraphStyle("li", parent=ss["BodyText"], fontSize=9.8, leading=14, leftIndent=10, bulletIndent=2, spaceAfter=2),
        "quote": ParagraphStyle("quote", parent=ss["BodyText"], fontSize=9.5, leading=13.5,
                                leftIndent=12, textColor=colors.HexColor("#444444")),
        "code": ParagraphStyle("code", parent=ss["Code"], fontSize=8.2, leading=10.5),
        "cell": ParagraphStyle("cell", parent=ss["BodyText"], fontSize=8.4, leading=10.8),
        "th": ParagraphStyle("th", parent=ss["BodyText"], fontSize=8.6, leading=11,
                             textColor=colors.white, fontName="Helvetica-Bold"),
    }
    return styles


class CodeBlock(Table):
    """Tabla de una celda que envuelve el código para darle fondo y recuadro."""


def code_block(code_lines, styles, available_width):
    """Bloque de código con fondo y recuadro (Preformatted solo no los pinta)."""
    pre = Preformatted("\n".join(code_lines), styles["code"], maxLineLength=110)
    t = CodeBlock([[pre]], colWidths=[available_width], hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f4f6f9")),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#c9d3de")),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t


def make_table(rows, styles, available_width):
    header, body = rows[0], rows[1:]
    data = [[Paragraph(inline(c), styles["th"]) for c in header]]
    for r in body:
        data.append([Paragraph(inline(c), styles["cell"]) for c in r])
    ncols = max(len(r) for r in data)
    for r in data:
        while len(r) < ncols:
            r.append(Paragraph("", styles["cell"]))
    # Ancho proporcional al contenido (raíz cuadrada, para que una celda muy larga
    # no se coma la tabla), con topes del 8 % y el 55 % por columna.
    medias = []
    for c in range(ncols):
        largos = [len(str(r[c])) for r in rows]
        medias.append(max(1.0, (sum(largos) / len(largos)) ** 0.5))
    total = sum(medias)
    pesos = [min(0.55, max(0.08, m / total)) for m in medias]
    escala = sum(pesos)
    widths = [available_width * p / escala for p in pesos]
    t = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a3a5c")),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#9aa7b4")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f2f5f9")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    return t


def parse_markdown(md: str, styles, available_width):
    flow = []
    lines = md.splitlines()
    i = 0
    para = []

    def flush_para():
        if para:
            flow.append(Paragraph(inline(" ".join(para).strip()), styles["p"]))
            para.clear()

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if stripped.startswith("```"):
            flush_para()
            lang = stripped[3:].strip()
            i += 1
            code = []
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code.append(lines[i])
                i += 1
            i += 1
            flow.append(code_block(code, styles, available_width))
            flow.append(Spacer(1, 7))
            continue

        if not stripped:
            flush_para()
            i += 1
            continue

        m = re.match(r"^(#{1,4})\s+(.*)$", stripped)
        if m:
            flush_para()
            level = len(m.group(1))
            flow.append(Paragraph(inline(m.group(2)), styles["h%d" % level]))
            i += 1
            continue

        if re.match(r"^(-{3,}|\*{3,}|_{3,})$", stripped):
            flush_para()
            flow.append(Spacer(1, 4))
            i += 1
            continue

        if stripped.startswith(">"):
            flush_para()
            quote = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                quote.append(lines[i].strip()[1:].strip())
                i += 1
            flow.append(Paragraph(inline(" ".join(quote)), styles["quote"]))
            flow.append(Spacer(1, 4))
            continue

        if stripped.startswith("|") and i + 1 < len(lines) and re.match(r"^\|[\s:\-|]+\|$", lines[i + 1].strip()):
            flush_para()
            rows = []
            header = [c.strip() for c in stripped.strip("|").split("|")]
            rows.append(header)
            i += 2
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
                i += 1
            flow.append(make_table(rows, styles, available_width))
            flow.append(Spacer(1, 7))
            continue

        m = re.match(r"^(\s*)([-*+]|\d+[.)])\s+(.*)$", line)
        if m:
            flush_para()
            indent = len(m.group(1))
            marker = "" if m.group(2)[0].isdigit() else "•"
            text = m.group(3)
            style = ParagraphStyle("li%d" % indent, parent=styles["li"],
                                   leftIndent=10 + indent * 8)
            prefix = (m.group(2) + " ") if marker == "" else "• "
            flow.append(Paragraph(inline(prefix + text), style))
            i += 1
            continue

        para.append(stripped)
        i += 1

    flush_para()
    return flow


def keep_captions_together(flow):
    """Evita que el párrafo que introduce un bloque de código quede huérfano."""
    out = []
    i = 0
    while i < len(flow):
        f = flow[i]
        if (isinstance(f, Paragraph) and i + 1 < len(flow)
                and isinstance(flow[i + 1], CodeBlock)):
            grupo = [f, Spacer(1, 3), flow[i + 1]]
            i += 2
            if i < len(flow) and isinstance(flow[i], Spacer):
                grupo.append(flow[i])
                i += 1
            out.append(KeepTogether(grupo))
            continue
        out.append(f)
        i += 1
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Markdown -> PDF (solo reportlab)")
    ap.add_argument("input")
    ap.add_argument("-o", "--output")
    ap.add_argument("--title")
    ap.add_argument("--author", default="Diego Sevilla Ruiz · Universidad de Murcia")
    args = ap.parse_args()

    src = pathlib.Path(args.input)
    out = pathlib.Path(args.output or src.with_suffix(".pdf"))
    md = src.read_text(encoding="utf-8")
    styles = build_styles()

    doc = BaseDocTemplate(
        str(out), pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=16 * mm,
        title=args.title or src.stem, author=args.author,
        subject="Actividad BDGE · consultas SQL con tutor de IA",
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="normal")
    doc.addPageTemplates([PageTemplate(id="all", frames=[frame], onPage=_footer)])
    flow = keep_captions_together(parse_markdown(md, styles, doc.width))
    doc.build(flow)
    print(f"PDF generado: {out} ({out.stat().st_size} bytes)")
    return 0


def _footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(colors.HexColor("#666666"))
    canvas.drawString(doc.leftMargin, 10 * mm, "BDGE · Actividad con IA generativa · SQL")
    canvas.drawRightString(A4[0] - doc.rightMargin, 10 * mm, "pág. %d" % doc.page)
    canvas.restoreState()


if __name__ == "__main__":
    raise SystemExit(main())
