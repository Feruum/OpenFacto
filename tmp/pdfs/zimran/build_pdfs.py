from pathlib import Path
from xml.sax.saxutils import escape
import json
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,KeepTogether
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.pagesizes import A4
from pypdf import PdfReader

ROOT=Path(__file__).resolve().parents[3]
manifest=json.loads((Path(__file__).parent/'content.json').read_text(encoding='utf-8'))
OUT=ROOT/'output'/'pdf';OUT.mkdir(parents=True,exist_ok=True)
pdfmetrics.registerFont(TTFont('Zimran','C:/Windows/Fonts/arial.ttf'))
pdfmetrics.registerFont(TTFont('ZimranBold','C:/Windows/Fonts/arialbd.ttf'))
INK=HexColor('#291C42');GRAY=HexColor('#625D6D');PAPER=HexColor('#F8F5EF');LAV=HexColor('#E9E1F4')
styles={
 'kicker':ParagraphStyle('zk',fontName='ZimranBold',fontSize=9,leading=13,textColor=GRAY,spaceAfter=11),
 'title':ParagraphStyle('zt',fontName='ZimranBold',fontSize=25,leading=31,textColor=INK,spaceAfter=15),
 'lead':ParagraphStyle('zl',fontName='Zimran',fontSize=11,leading=16,textColor=INK,spaceAfter=14),
 'h':ParagraphStyle('zh',fontName='ZimranBold',fontSize=15,leading=19,textColor=INK,spaceBefore=14,spaceAfter=8,keepWithNext=True),
 'q':ParagraphStyle('zq',fontName='ZimranBold',fontSize=10.5,leading=14,textColor=INK,spaceAfter=4,keepWithNext=True),
 'body':ParagraphStyle('zb',fontName='Zimran',fontSize=9.5,leading=14,textColor=INK,spaceAfter=5),
 'source':ParagraphStyle('zs',fontName='Zimran',fontSize=7.2,leading=9.5,textColor=GRAY,spaceAfter=8),
}
def p(text,style='body'):return Paragraph(escape(text),styles[style])
def page(c,doc):
    w,h=A4;c.saveState();c.setFillColor(PAPER);c.rect(0,0,w,h,fill=1,stroke=0)
    c.setFillColor(INK);c.roundRect(42,h-39,20,12,3,stroke=0,fill=1)
    c.setFont('ZimranBold',9);c.drawString(72,h-36,'OPENFACTO / BUSINESS CUP 2.0')
    c.setStrokeColor(HexColor('#D3CADF'));c.line(42,46,w-42,46)
    c.setFillColor(GRAY);c.setFont('Zimran',7.3)
    c.drawString(42,32,'Сводка материалов организаторов / актуально на 09.11.2026')
    c.drawRightString(w-42,32,str(doc.page));c.restoreState()

lookup={f['key']:f for f in manifest['faqs']}
results=[]
for i,item in enumerate(manifest['documents'],1):
    story=[p(f'ПАМЯТКА {i:02d} / ZIMRAN × AIESEC × NAZARBAYEV UNIVERSITY','kicker'),p(item['title'],'title'),
      p('Практические ответы по опубликованной программе и разъяснениям организаторов. 14-15 ноября 2026, Назарбаев Университет, Астана.','lead'),
      p('Основа: текущая страница businesscup.zimran.io/en и ответы аккаунта Business Cup из предоставленного экспорта General Q&A. Это подготовленная для OpenFacto сводка; личные результаты отбора доступны только у организаторов.','source')]
    for title,keys in item['sections']:
        if not keys:
            story.append(KeepTogether([p(title,'h'),p('• '+manifest['uncertainties'][0])]))
            for text in manifest['uncertainties'][1:]:story.append(p('• '+text))
            story.append(p('Неизвестные детали следует уточнять у @aiesec_astana или по tech@zimran.io.'))
        for n,key in enumerate(keys):
            f=lookup[key]
            refs=[]
            for ref in f['provenance']:
                refs.append('официальный сайт' if ref.startswith('https:') else 'Business Cup / сообщение '+ref.removeprefix('message'))
            story.append(KeepTogether(([p(title,'h')] if n==0 else [])+[p(f['title'],'q'),p(f['body']),p('Источник: '+', '.join(refs)+'.','source')]))
    story.append(KeepTogether([p('Источники и обновления','h'),p('https://businesscup.zimran.io/en','source'),
        p('Telegram General Q&A: сообщения аккаунта Business Cup, 29 октября - 8 ноября 2026. Личные имена и персональные обращения не включены.','source')]))
    path=OUT/item['filename']
    SimpleDocTemplate(str(path),pagesize=A4,rightMargin=44,leftMargin=44,topMargin=64,bottomMargin=62,
        title=item['title'],author='OpenFacto',subject='Zimran Business Cup 2.0 - сводка для участников').build(story,onFirstPage=page,onLaterPages=page)
    reader=PdfReader(path)
    assert all(len(pg.extract_text().strip())>80 for pg in reader.pages)
    results.append({'file':str(path),'pages':len(reader.pages),'bytes':path.stat().st_size})
print(json.dumps(results,ensure_ascii=False))
