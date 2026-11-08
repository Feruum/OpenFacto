from pathlib import Path
import json
from lxml import html

root=Path('C:/Users/Ferumm/Downloads/Telegram Desktop/ChatExport_2026-11-09')
out=Path('tmp/pdfs/zimran')
out.mkdir(parents=True,exist_ok=True)
messages=[]
for file in sorted(root.rglob('messages*.html')):
    soup=html.fromstring(file.read_text(encoding='utf-8'))
    def first(node,cls):
        rows=node.xpath('.//*[contains(concat(" ",normalize-space(@class)," ")," '+cls+' ")]')
        return rows[0] if rows else None
    last_author=None
    for msg in soup.xpath('//div[contains(@class,"message default")]'):
        text=first(msg,'text')
        if text is None: continue
        date=first(msg,'date')
        reply=first(msg,'reply_to')
        author=first(msg,'from_name')
        if author is not None: last_author=' '.join(author.itertext()).strip()
        reply_link=reply.xpath('.//a/@href') if reply is not None else []
        messages.append({'id':msg.get('id'),'date':date.get('title') if date is not None else None,
            'author':last_author,
            'reply':reply_link[0] if reply_link else None,
            'text':' '.join(t.strip() for t in text.itertext() if t.strip())})
(out/'export-messages.json').write_text(json.dumps(messages,ensure_ascii=False,indent=2),encoding='utf-8')
print('Messages:',len(messages))
lookup={m['id']:m for m in messages}
for m in messages:
    if m['author']=='Business Cup':
        target=lookup.get((m['reply'] or '').split('#')[-1].replace('go_to_',''),{})
        print(json.dumps({'id':m['id'],'date':m['date'],'question':target.get('text'),'answer':m['text']},ensure_ascii=False))
