# Genera respuesta.pdf a partir de respuesta.md
#
#   make            -> doc/respuesta.pdf
#   make clean      -> borra el PDF
#   make deps       -> instala lo único que hace falta (reportlab)
#
# El conversor es md2pdf.py y no necesita LaTeX, pandoc, ni conexión a red.

PYTHON ?= python3
MD     := respuesta.md
PDF    := $(MD:.md=.pdf)
SRC    := $(wildcard *.md)
OBJS   := $(patsubst %.md,%.pdf,$(SRC))

.PHONY: all clean deps list

all: $(PDF)

%.pdf: %.md md2pdf.py
	$(PYTHON) md2pdf.py "$<" -o "$@"

list:
	@echo "Markdown: $(SRC)"
	@echo "PDFs:     $(OBJS)"

deps:
	$(PYTHON) -c "import reportlab" 2>/dev/null || $(PYTHON) -m pip install --user reportlab

clean:
	rm -f $(OBJS)

.SUFFIXES:
